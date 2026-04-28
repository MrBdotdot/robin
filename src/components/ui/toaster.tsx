/**
 * Re-export of the Sonner toaster, pre-styled for the app.
 * Usage:
 *   import { toast } from "sonner";
 *   toast("Saved", { description: "Match score updated" });
 */
import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      richColors
      closeButton
      // 10s default for undo-able toasts; per-call duration can override
      duration={10000}
      toastOptions={{
        classNames: {
          toast:
            "bg-card text-card-foreground border-border shadow-md rounded-xl",
        },
      }}
    />
  );
}
