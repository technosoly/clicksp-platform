"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function SubmitButton({ label, pendingLabel, testId }: { label: string; pendingLabel: string; testId?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending} aria-disabled={pending} data-testid={testId}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
