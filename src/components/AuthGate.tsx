import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Lock, Mail } from "lucide-react";
import { signInWithMagicLink, useSession } from "@/lib/auth";
import { bootstrapMembership } from "@/lib/membership";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const session = useSession();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  // Bootstrap the membership row on first sign-in. Idempotent.
  useEffect(() => {
    if (session && session !== "loading") {
      bootstrapMembership().catch((e) => {
        console.error("bootstrap_membership failed:", e);
      });
    }
  }, [session]);

  if (session === "loading") {
    return (
      <div className="flex min-h-full items-center justify-center bg-muted/30 p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (session) {
    return <>{children}</>;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Preserve invite token if user landed via /invite/:token
      const path = window.location.pathname;
      const redirectTo = path.startsWith("/invite/")
        ? `${window.location.origin}${path}`
        : window.location.origin;
      await signInWithMagicLink(email, redirectTo);
      setLinkSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send link");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Round Robin
          </CardTitle>
          <CardDescription>
            {linkSent
              ? "Check your email for a sign-in link."
              : "Enter your email; we'll send you a one-time link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkSent ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center text-sm text-muted-foreground">
              <Mail className="h-8 w-8 text-primary" />
              <p>
                We sent a link to <strong>{email}</strong>. Open it on this device
                to sign in.
              </p>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => {
                  setLinkSent(false);
                  setEmail("");
                }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={onSubmit}>
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={submitting || !email}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Send me a link"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
