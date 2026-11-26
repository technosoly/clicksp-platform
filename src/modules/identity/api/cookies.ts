import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { SessionKind } from "../domain/policy";
import type { IssuedSession } from "../service/sessions";

/**
 * Session cookies. Admin and customer sessions use different cookies, so a
 * customer session can never be presented as an admin one (the session row's
 * kind is checked as well). HttpOnly always; Secure whenever the site runs on
 * HTTPS (APP_URL), which is every deployed environment. The admin cookie is
 * SameSite=Strict: it is never sent on requests started by another site.
 */
export const SESSION_COOKIES: Record<SessionKind, string> = {
  admin: "clicksp_admin",
  customer: "clicksp_session",
};

function secure(): boolean {
  return env().APP_URL.startsWith("https://");
}

export async function readSessionToken(kind: SessionKind): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIES[kind])?.value;
}

export async function setSessionCookie(kind: SessionKind, session: IssuedSession): Promise<void> {
  (await cookies()).set(SESSION_COOKIES[kind], session.token, {
    httpOnly: true,
    secure: secure(),
    sameSite: kind === "admin" ? "strict" : "lax",
    path: "/",
    expires: session.expiresAt,
  });
}

export async function clearSessionCookie(kind: SessionKind): Promise<void> {
  (await cookies()).set(SESSION_COOKIES[kind], "", {
    httpOnly: true,
    secure: secure(),
    sameSite: kind === "admin" ? "strict" : "lax",
    path: "/",
    maxAge: 0,
  });
}
