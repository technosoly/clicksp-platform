import { env } from "@/lib/env";
import { requestMetaFromHeaders } from "@/lib/http/request-meta";
import { handleGatewayCallback } from "@/modules/payments/service/gateway";

/**
 * Where a payment gateway sends the customer back (GET or POST, per gateway).
 * No session is needed: the service finds the attempt by our own reference
 * and asks the gateway itself whether the money arrived. The customer is then
 * sent to their order, which shows the result read from the database.
 */
export const dynamic = "force-dynamic";

async function handle(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const meta = requestMetaFromHeaders(request.headers, env().TRUSTED_IP_HEADER);
  const result = await handleGatewayCallback(provider, request, meta);
  if (result.outcome === "unknown") return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const locale = result.locale === "en" ? "en" : "fa";
  const target = new URL(`/${locale}/account/orders/${result.orderNumber}`, env().APP_URL);
  return new Response(null, { status: 303, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
