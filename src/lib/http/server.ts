import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { requestMetaFromHeaders, type RequestMeta } from "./request-meta";

/** Request metadata of the current request (Server Components and Server Actions). */
export async function currentRequestMeta(): Promise<RequestMeta> {
  return requestMetaFromHeaders(await headers(), env().TRUSTED_IP_HEADER);
}
