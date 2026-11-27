/** Pages a customer may be sent back to after signing in; anything else goes to the account page (no open redirects). */
const AFTER_SIGN_IN = ["/account", "/cart", "/checkout"] as const;
export const afterSignIn = (value: unknown): (typeof AFTER_SIGN_IN)[number] => AFTER_SIGN_IN.find((path) => path === value) ?? "/account";
