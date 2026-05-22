// Sends an invite email. Triggered by the InviteSheet "Email it" button.
//
// Body: { invite_id: string }
// Auth: requires the caller to be an admin member.
//
// Email is sent via Resend's HTTP API. Configure these project secrets in
// Supabase Studio (Project Settings -> Edge Functions -> Secrets):
//   - RESEND_API_KEY        (required)
//   - INVITE_FROM_EMAIL     (e.g. no-reply@yourdomain.com or onboarding@resend.dev)
//   - INVITE_FROM_NAME      (optional display name, e.g. "Will from Robin Rounds")
//   - APP_URL               (e.g. https://your-app.vercel.app)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://round-robin.example.com";

// Browser preflight needs explicit CORS allowance. Permissive defaults
// are fine since the function does its own admin check.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });

const textResponse = (body: string, status: number) =>
  new Response(body, { status, headers: CORS_HEADERS });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return textResponse("method not allowed", 405);
  }

  // Verify the caller is signed in and an admin.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return textResponse("unauthorized", 401);

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: membership } = await adminClient
    .from("rr_memberships")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "admin") {
    return textResponse("forbidden", 403);
  }

  const { invite_id } = await req.json();
  if (!invite_id) return textResponse("invite_id required", 400);

  const { data: invite, error: inviteErr } = await adminClient
    .from("rr_invites")
    .select("*")
    .eq("id", invite_id)
    .maybeSingle();
  if (inviteErr || !invite) return textResponse("invite not found", 404);

  const inviteUrl = `${APP_URL}/invite/${invite.token}`;
  const subject = "You're invited to Round Robin";
  const html = `
    <p>Hi,</p>
    <p>You've been invited to join Round Robin as a <strong>${invite.role}</strong>.</p>
    <p><a href="${inviteUrl}">Accept your invite</a></p>
    <p>This link expires on ${new Date(invite.expires_at).toDateString()}.</p>
    <p>If you weren't expecting this, you can ignore this email.</p>
  `;

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    return jsonResponse(
      { error: "RESEND_API_KEY not configured. Set it in Supabase project secrets." },
      500
    );
  }

  // Resend accepts either a bare email ("noreply@x.com") or a name+email
  // string ("Name <noreply@x.com>"). Recipients see the display name.
  const fromEmail = Deno.env.get("INVITE_FROM_EMAIL") ?? "no-reply@example.com";
  const fromName = Deno.env.get("INVITE_FROM_NAME");
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: invite.email, subject, html }),
  });

  if (!emailRes.ok) {
    const text = await emailRes.text();
    return jsonResponse({ error: `email send failed: ${text}` }, 502);
  }

  return jsonResponse({ ok: true }, 200);
});
