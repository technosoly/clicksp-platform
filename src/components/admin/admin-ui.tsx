import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Small building blocks shared by admin pages (server components). */

export function PageHeader({ title, description, actions, testId }: { title: string; description?: string; actions?: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold" data-testid={testId}>
          {title}
        </h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, description, children, className, testId }: { title?: string; description?: string; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-5", className)} data-testid={testId}>
      {title ? <h2 className="font-semibold">{title}</h2> : null}
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className={title || description ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-accent text-accent-foreground",
  orange: "bg-brand-orange/15 text-brand-orange-strong",
  success: "bg-success/10 text-success",
  danger: "bg-destructive/10 text-destructive",
} as const;

export function Badge({ children, tone = "neutral", testId }: { children: ReactNode; tone?: keyof typeof TONES; testId?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", TONES[tone])} data-testid={testId}>
      {children}
    </span>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
