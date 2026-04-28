import { useState, type FormEvent, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { isUnlocked, tryUnlock } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PasswordGateProps {
  children: ReactNode;
}

export function PasswordGate({ children }: PasswordGateProps) {
  const [unlocked, setUnlocked] = useState<boolean>(() => isUnlocked());
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (tryUnlock(value)) {
      setUnlocked(true);
    } else {
      setError(true);
      setValue("");
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <CardTitle>Round Robin</CardTitle>
          <CardDescription>Enter the password to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="password"
              inputMode="numeric"
              autoFocus
              autoComplete="current-password"
              placeholder="Password"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(false);
              }}
              aria-invalid={error}
              aria-describedby={error ? "pwd-error" : undefined}
            />
            {error && (
              <p id="pwd-error" className="text-sm text-destructive">
                Incorrect password.
              </p>
            )}
            <Button type="submit" size="lg" className="w-full">
              Unlock
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
