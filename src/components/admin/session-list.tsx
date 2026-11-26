import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/i18n/dates";
import type { Locale } from "@/lib/i18n/config";
import { Badge } from "./admin-ui";

export interface SessionView {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  current?: boolean;
}

/** A short, readable device name from a user agent (display only). */
export function deviceName(userAgent: string | null): string {
  if (!userAgent) return "?";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

export async function SessionList({ sessions, locale, action }: { sessions: SessionView[]; locale: Locale; action?: (s: SessionView) => ReactNode }) {
  const t = await getTranslations("AdminPeople");
  if (sessions.length === 0) return <p className="text-sm text-muted-foreground">{t("noSessions")}</p>;
  return (
    <ul className="divide-y rounded-lg border" data-testid="session-list">
      {sessions.map((s) => (
        <li key={s.id} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="font-medium" dir="ltr">
              {deviceName(s.userAgent)}
            </span>
            {s.current ? (
              <span className="ms-2">
                <Badge tone="success">{t("thisDevice")}</Badge>
              </span>
            ) : null}
            <span className="block text-xs text-muted-foreground">
              <span dir="ltr">{s.ipAddress ?? "—"}</span> · {t("lastActive", { time: formatDate(s.lastSeenAt, locale, { dateStyle: "medium", timeStyle: "short" }) })}
            </span>
          </span>
          {action ? action(s) : null}
        </li>
      ))}
    </ul>
  );
}
