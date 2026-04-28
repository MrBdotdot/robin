import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlayerPickerSheet } from "@/components/PlayerPickerSheet";

import {
  STEPS,
  initialWizardState,
  type WizardState,
} from "./wizard/types";
import { Step1Basics } from "./wizard/Step1Basics";
import { Step2Scoring } from "./wizard/Step2Scoring";
import { Step3Format } from "./wizard/Step3Format";
import { Step4Settings } from "./wizard/Step4Settings";
import { Step5Players } from "./wizard/Step5Players";
import { submitWizard } from "./wizard/submit";

export default function EventCreate() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [s, setS] = useState<WizardState>(initialWizardState);
  const [submitting, setSubmitting] = useState(false);
  const [playerInput, setPlayerInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));

  const canAdvance = useMemo(() => {
    if (step === 1)
      return s.name.trim().length > 0 && s.sportLabel.trim().length > 0;
    if (step === 5) {
      const min = s.mode === "doubles_americano" ? 4 : 2;
      return s.playerNames.length >= min;
    }
    return true;
  }, [step, s]);

  const next = () => setStep((n) => Math.min(STEPS.length, n + 1));
  const back = () => setStep((n) => Math.max(1, n - 1));

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const newId = await submitWizard(s);
      toast.success("Event created", {
        description: `${s.name.trim()} is ready to play.`,
      });
      navigate(`/events/${newId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't create event", { description: msg });
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex items-center gap-3">
        <Link
          to="/events"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label="Back to events"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">New event</h1>
          <p className="text-sm text-muted-foreground">
            Step {step} of {STEPS.length}: {STEPS[step - 1].label}
          </p>
        </div>
      </header>

      <ProgressBar step={step} />

      <Card className="p-5 md:p-6">
        {step === 1 && <Step1Basics s={s} set={set} />}
        {step === 2 && <Step2Scoring s={s} set={set} />}
        {step === 3 && <Step3Format s={s} set={set} />}
        {step === 4 && <Step4Settings s={s} set={set} />}
        {step === 5 && (
          <Step5Players
            s={s}
            set={set}
            playerInput={playerInput}
            setPlayerInput={setPlayerInput}
            onOpenPicker={() => setPickerOpen(true)}
          />
        )}
      </Card>

      <PlayerPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        alreadySelectedNames={s.playerNames}
        mode={s.mode}
        onAdd={(picked) => {
          const lower = new Set(s.playerNames.map((n) => n.toLowerCase()));
          const fresh = picked.filter((n) => !lower.has(n.toLowerCase()));
          if (fresh.length > 0) {
            set("playerNames", [...s.playerNames, ...fresh]);
            toast.success(
              `Added ${fresh.length} player${fresh.length === 1 ? "" : "s"}`
            );
          }
        }}
      />

      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={back}
          disabled={step === 1 || submitting}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        {step < STEPS.length ? (
          <Button onClick={next} disabled={!canAdvance}>
            Next
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={!canAdvance || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Create event
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="mb-6 flex items-center gap-1.5">
      {STEPS.map((s) => (
        <div
          key={s.id}
          className={cn(
            "h-1.5 flex-1 rounded-full transition-colors",
            step >= s.id ? "bg-primary" : "bg-muted"
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}
