import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/**
 * Tiny field wrapper used across all wizard steps so labels stay consistent.
 * `htmlFor` is optional — pass it when the field has a single labelable input.
 */
export function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
