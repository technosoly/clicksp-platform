import "server-only";
import { cookies } from "next/headers";
import { cookiesAreSecure as secure } from "@/lib/http/secure-cookies";
import { GUEST_CART_DAYS } from "../domain/cart-rules";

/**
 * The guest cart cookie: a random token whose SHA-256 names the cart. HttpOnly,
 * SameSite=Lax, and `__Host-` prefixed on HTTPS so another subdomain can't
 * plant one. It carries no prices or quantities.
 */
const name = () => (secure() ? "__Host-clicksp_cart" : "clicksp_cart");

export async function readCartToken(): Promise<string | undefined> {
  return (await cookies()).get(name())?.value;
}

export async function setCartToken(token: string): Promise<void> {
  (await cookies()).set(name(), token, { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge: GUEST_CART_DAYS * 86_400 });
}

export async function clearCartToken(): Promise<void> {
  (await cookies()).set(name(), "", { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge: 0 });
}
