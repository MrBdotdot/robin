import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** Footer content sticks to the bottom of the sheet (e.g. action buttons). */
  footer?: ReactNode;
  className?: string;
}

/**
 * Bottom sheet on mobile, centered modal on desktop. Renders to body via portal,
 * traps scroll on the page behind, closes on backdrop click or Esc.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: SheetProps) {
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "sheet-title" : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "relative flex w-full flex-col bg-card text-card-foreground shadow-2xl",
          "max-h-[92vh] rounded-t-2xl",
          "md:m-4 md:max-w-lg md:rounded-2xl",
          // Safe area for iOS home indicator
          "pb-[max(0px,env(safe-area-inset-bottom))]",
          className
        )}
      >
        {/* Drag handle (mobile only — visual cue) */}
        <div className="mx-auto mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted md:hidden" />

        {(title || description) && (
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              {title && (
                <h3 id="sheet-title" className="truncate text-base font-semibold">
                  {title}
                </h3>
              )}
              {description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="border-t bg-card px-5 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
