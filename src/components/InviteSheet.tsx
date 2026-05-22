import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Copy, Check, Trash2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import type { Invite, Role } from "@/types/database";
import { formatDate } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_EXPIRY_DAYS = 7;

function randomToken(): string {
  // 32 random bytes -> base64url-like; sufficient entropy for invite tokens.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Translate raw Postgres errors from migration-007's constraints into something a human can read. */
function friendlyInviteError(raw: string, email: string): string {
  if (raw.includes("rr_invites_unique_pending_email")) {
    return `An invite for ${email} is already pending. Revoke it first if you want to start over.`;
  }
  if (raw.includes("is already a member")) {
    return `${email} is already a member — no invite needed.`;
  }
  return raw;
}

export function InviteSheet({ open, onOpenChange }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("participant");
  const [submitting, setSubmitting] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const loadInvites = async () => {
    const { data, error } = await supabase
      .from("rr_invites")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setInvites(data as Invite[]);
  };

  useEffect(() => {
    if (open) loadInvites();
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const token = randomToken();
      const expires_at = new Date(
        Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const { error } = await supabase.from("rr_invites").insert({
        email,
        role,
        token,
        expires_at,
        created_by: user.id,
      });
      if (error) throw error;
      toast.success("Invite created");
      setEmail("");
      setRole("participant");
      await loadInvites();
    } catch (err) {
      const raw =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message ?? "Could not create invite";
      toast.error(friendlyInviteError(raw, email));
    } finally {
      setSubmitting(false);
    }
  };

  const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

  const onCopy = async (token: string) => {
    await navigator.clipboard.writeText(inviteUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 1500);
  };

  const onSendEmail = async (invite: Invite) => {
    try {
      const { error } = await supabase.functions.invoke("send-invite", {
        body: { invite_id: invite.id },
      });
      if (error) throw error;
      toast.success(`Email sent to ${invite.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send email");
    }
  };

  const onRevoke = async (invite: Invite) => {
    if (!confirm(`Revoke invite for ${invite.email}?`)) return;
    const { error } = await supabase.from("rr_invites").delete().eq("id", invite.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Invite revoked");
    await loadInvites();
  };

  const pending = invites.filter((i) => !i.accepted_at);
  const accepted = invites.filter((i) => i.accepted_at);

  return (
    <Sheet open={open} onClose={() => onOpenChange(false)} title="Invite someone">
      <form className="space-y-3" onSubmit={onSubmit}>
        <Input
          type="email"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="participant">Participant</option>
          <option value="organizer">Organizer</option>
        </Select>
        <Button type="submit" disabled={submitting || !email} className="w-full">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate invite"}
        </Button>
      </form>

      {pending.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-semibold">Pending</h3>
          {pending.map((i) => (
            <div key={i.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{i.email}</div>
                  <div className="text-xs text-muted-foreground">
                    <Badge variant="outline">{i.role}</Badge>
                    {" · expires "}
                    {formatDate(i.expires_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(i)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Revoke invite"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onCopy(i.token)}
                  className="flex-1"
                >
                  {copiedToken === i.token ? (
                    <>
                      <Check className="mr-1 h-3 w-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1 h-3 w-3" />
                      Copy link
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onSendEmail(i)}
                >
                  <Mail className="mr-1 h-3 w-3" />
                  Email it
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {accepted.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-semibold">Accepted</h3>
          {accepted.map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded-md border p-3 text-sm text-muted-foreground">
              <span>{i.email}</span>
              <Badge variant="outline">{i.role}</Badge>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
