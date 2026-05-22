import { useEffect, useState, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { signInWithMagicLink, useSession } from "@/lib/auth";
import { useMembership } from "@/lib/membership";
import { supabase } from "@/lib/supabase";
import type { InviteLookup } from "@/types/database";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; invite: InviteLookup }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "already_used" };

export default function Invite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = useSession();
  const { status: memStatus, membership } = useMembership();

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [accepting, setAccepting] = useState(false);

  // Look up invite on mount.
  useEffect(() => {
    if (!token) {
      setLoad({ kind: "not_found" });
      return;
    }
    supabase
      .rpc("lookup_invite", { _token: token })
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setLoad({ kind: "not_found" });
          return;
        }
        const invite = data[0] as InviteLookup;
        if (invite.accepted_at) setLoad({ kind: "already_used" });
        else if (new Date(invite.expires_at) < new Date()) setLoad({ kind: "expired" });
        else {
          setLoad({ kind: "loaded", invite });
          setEmail(invite.email);
        }
      });
  }, [token]);

  // If signed in + has membership: redirect to home (admins to /, others to /me).
  useEffect(() => {
    if (session === "loading" || memStatus === "loading") return;
    if (session && membership && load.kind === "loaded") {
      // Already a member of the tenant — accept the invite anyway to mark it used,
      // then redirect to home.
      (async () => {
        await supabase.rpc("accept_invite", { _token: token });
        toast.info("You're already a member.");
        navigate(membership.role === "admin" ? "/" : "/me", { replace: true });
      })();
    }
  }, [session, memStatus, membership, load.kind, token, navigate]);

  const onSubmitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signInWithMagicLink(email, `${window.location.origin}/invite/${token}`);
      setLinkSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send link");
    } finally {
      setSubmitting(false);
    }
  };

  const onAccept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      const { error } = await supabase.rpc("accept_invite", { _token: token });
      if (error) throw error;
      toast.success("Welcome to Round Robin");
      // Re-fetch membership after accept; navigate home.
      navigate(load.kind === "loaded" && load.invite.role === "admin" ? "/" : "/me", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not accept invite");
    } finally {
      setAccepting(false);
    }
  };

  // Render states.
  if (load.kind === "loading" || session === "loading" || memStatus === "loading") {
    return (
      <Centered>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Centered>
    );
  }

  if (load.kind === "not_found") {
    return (
      <Centered>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              Invite not found
            </CardTitle>
            <CardDescription>
              This invite link doesn't match anything we have on record. Ask the admin who sent it for a fresh link.
            </CardDescription>
          </CardHeader>
        </Card>
      </Centered>
    );
  }

  if (load.kind === "expired" || load.kind === "already_used") {
    return (
      <Centered>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              {load.kind === "expired" ? "Invite expired" : "Invite already used"}
            </CardTitle>
            <CardDescription>
              {load.kind === "expired"
                ? "This invite link has expired."
                : "This invite has already been accepted."}
              {" "}Ask the admin to send you a fresh one.
            </CardDescription>
          </CardHeader>
        </Card>
      </Centered>
    );
  }

  // Loaded + valid.
  const invite = load.invite;

  if (!session) {
    // Sign-in form, prefilled with the invited email.
    return (
      <Centered>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>You're invited</CardTitle>
            <CardDescription>
              Join Round Robin as <Badge variant="outline">{invite.role}</Badge>. Enter your email and we'll send you a one-time sign-in link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {linkSent ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center text-sm text-muted-foreground">
                <Mail className="h-8 w-8 text-primary" />
                <p>
                  Check <strong>{email}</strong> for a sign-in link. Open it on this device to continue accepting the invite.
                </p>
              </div>
            ) : (
              <form className="space-y-3" onSubmit={onSubmitEmail}>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
                <Button type="submit" className="w-full" disabled={submitting || !email}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send me a link"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </Centered>
    );
  }

  // Signed in, no membership yet → show Accept button.
  return (
    <Centered>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Almost there
          </CardTitle>
          <CardDescription>
            Accept this invite to join Round Robin as <Badge variant="outline">{invite.role}</Badge>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onAccept} disabled={accepting} className="w-full">
            {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept invite"}
          </Button>
        </CardContent>
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      {children}
    </div>
  );
}
