import { Construction } from "lucide-react";

interface PlaceholderProps {
  title: string;
  description?: string;
}

/**
 * Stand-in for screens we haven't built yet. Keeps the routing wired up
 * and gives the user a clear "coming soon" instead of a blank page.
 */
export default function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 md:px-6 md:py-16">
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-muted/30 px-6 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Construction className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
