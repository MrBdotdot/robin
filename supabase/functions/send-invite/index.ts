// Sends an invite email. Triggered by the InviteSheet "Email it" button.
//
// Body: { invite_id: string }
// Auth: requires the caller to be an admin member.
//
// Email is sent via Resend's HTTP API. Configure these project secrets in
// Supabase Studio (Project Settings -> Edge Functions -> Secrets):
//   - RESEND_API_KEY        (required)
//   - INVITE_FROM_EMAIL     (e.g. no-reply@yourdomain.com or onboarding@resend.dev)
//   - APP_URL               (e.g. https://your-app.vercel.app)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://round-robin.example.com";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // Verify the caller is signed in and an admin.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: membership } = await adminClient
    .from("rr_memberships")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "admin") {
    return new Response("forbidden", { status: 403 });
  }

  const { invite_id } = await req.json();
  if (!invite_id) return new Response("invite_id required", { status: 400 });

  const { data: invite, error: inviteErr } = await adminClient
    .from("rr_invites")
    .select("*")
    .eq("id", invite_id)
    .maybeSingle();
  if (inviteErr || !invite) return new Response("invite not found", { status: 404 });

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
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY not configured. Set it in Supabase project secrets." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("INVITE_FROM_EMAIL") ?? "no-reply@example.com",
      to: invite.email,
      subject,
      html,
    }),
  });

  if (!emailRes.ok) {
    const text = await emailRes.text();
    return new Response(JSON.stringify({ error: `email send failed: ${text}` }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
