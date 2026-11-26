import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

/**
 * Security headers applied to every response. The Content-Security-Policy is
 * set in proxy.ts (a per-request nonce on admin and account pages).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // HSTS is only honoured over HTTPS; the reverse proxy terminates TLS in production.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // forbidden() and forbidden.tsx: admin pages answer 403 to a typed URL the
  // admin has no permission for (Next.js 16, still marked experimental).
  experimental: { authInterrupts: true },
  images: {
    formats: ["image/avif", "image/webp"],
    // Remote product images will come from our own S3-compatible storage only.
    remotePatterns: [],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
