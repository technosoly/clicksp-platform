import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { SessionKind } from "../domain/policy";
import type { IssuedSession } from "../service/sessions";

/**
 * Session cookies. Admin and customer sessions use different cookies, so a
 * customer session can never be presented as an admin one (the session row's
 * kind is checked as well). HttpOnly always; Secure on HTTPS and in production. The admin cookie is
 * SameSite=Strict: it is never sent on requests started by another site.
 */
const BASE_NAMES: Record<SessionKind, string> = {
  admin: "clicksp_admin",
  customer: "clicksp_session",
};

/** Secure on HTTPS, and always in production (whatever APP_URL says). */
export function secure(): boolean {
  return env().APP_URL.startsWith("https://") || env().APP_ENV === "production" || process.env.NODE_ENV === "production";
}

/**
 * With Secure the `__Host-` prefix is used: the browser then only accepts the
 * cookie from this exact host, over HTTPS, with Path=/ and no Domain, so a
 * sibling subdomain cannot plant or overwrite a session cookie.
 */
export function sessionCookieName(kind: SessionKind, isSecure = secure()): string {
  return isSecure ? `__Host-${BASE_NAMES[kind]}` : BASE_NAMES[kind];
}

export async function readSessionToken(kind: SessionKind): Promise<string | undefined> {
  return (await cookies()).get(sessionCookieName(kind))?.value;
}

export async function setSessionCookie(kind: SessionKind, session: IssuedSession): Promise<void> {
  (await cookies()).set(sessionCookieName(kind), session.token, {
    httpOnly: true,
    secure: secure(),
    sameSite: kind === "admin" ? "strict" : "lax",
    path: "/",
    expires: session.expiresAt,
  });
}

export async function clearSessionCookie(kind: SessionKind): Promise<void> {
  (await cookies()).set(sessionCookieName(kind), "", {
    httpOnly: true,
    secure: secure(),
    sameSite: kind === "admin" ? "strict" : "lax",
    path: "/",
    maxAge: 0,
  });
}
