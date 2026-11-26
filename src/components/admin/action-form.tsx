"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Link, usePathname } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils/cn";
import type { ActionState } from "@/modules/identity/api/admin-action";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

function Submit({ label, variant, testId }: { label: string; variant?: ButtonProps["variant"]; testId?: string }) {
  const { pending } = useFormStatus();
  const t = useTranslations("AdminForms");
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-disabled={pending} data-testid={testId}>
      {pending ? t("working") : label}
    </Button>
  );
}

/** Shows a one-time password link with a copy button. */
export function OneTimeLink({ link, expiresAt }: { link: string; expiresAt?: string }) {
  const t = useTranslations("AdminForms");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const expires = expiresAt
    ? new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Tehran",
      }).format(new Date(expiresAt))
    : null;
  return (
    <div className="space-y-2 rounded-lg border border-brand-orange/40 bg-accent/60 p-3" data-testid="one-time-link">
      <p className="text-sm font-medium">{t("linkTitle")}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={link}
          dir="ltr"
          aria-label={t("linkTitle")}
          className="h-10 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
          data-testid="one-time-link-value"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-10"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("linkHelp")} {expires ? t("linkExpires", { time: expires }) : null}
      </p>
    </div>
  );
}

export function ActionFeedback({ state, namespace = "AdminForms" }: { state: ActionState; namespace?: string }) {
  const t = useTranslations(namespace);
  const common = useTranslations("AdminForms");
  const pathname = usePathname();
  if (state.error === "mfa_required") {
    return (
      <p role="alert" className="rounded-md bg-accent px-3 py-2 text-sm" data-testid="form-mfa-required">
        {common("errors.mfa_required")}{" "}
        <Link href={`/admin/mfa?next=${encodeURIComponent(pathname)}`} className="font-semibold text-brand-orange-strong underline">
          {common("verifyNow")}
        </Link>
      </p>
    );
  }
  if (state.error) {
    const key = `errors.${state.error}`;
    const message = t.has(key) ? t(key) : common.has(key) ? common(key) : common("errors.unexpected");
    return (
      <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="form-error">
        {message}
      </p>
    );
  }
  if (state.ok && state.message) {
    const key = `messages.${state.message}`;
    return (
      <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success" data-testid="form-success">
        {t.has(key) ? t(key) : common.has(key) ? common(key) : common("messages.saved")}
      </p>
    );
  }
  return null;
}

/**
 * A Server Action form for admin screens: carries the locale, shows errors,
 * success messages, a "verify with two-factor" link when the action needs a
 * fresh code, and one-time links. The server authorizes every submission.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitVariant,
  testId,
  className,
  namespace,
  hideAfterLink = false,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: string;
  submitVariant?: ButtonProps["variant"];
  testId?: string;
  className?: string;
  namespace?: string;
  /** Replace the form with the link once one is issued (create account). */
  hideAfterLink?: boolean;
}) {
  const locale = useLocale();
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  if (hideAfterLink && state.link) {
    return (
      <div className="space-y-3">
        <ActionFeedback state={state} namespace={namespace} />
        <OneTimeLink link={state.link} expiresAt={state.expiresAt} />
      </div>
    );
  }
  return (
    <form action={formAction} className={cn("space-y-3", className)} noValidate data-testid={testId}>
      <input type="hidden" name="locale" value={locale} />
      {children}
      <ActionFeedback state={state} namespace={namespace} />
      {state.link ? <OneTimeLink link={state.link} expiresAt={state.expiresAt} /> : null}
      <div>
        <Submit label={submitLabel} variant={submitVariant} testId={testId ? `${testId}-submit` : undefined} />
      </div>
    </form>
  );
}
