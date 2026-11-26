import "server-only";
import { headers } from "next/headers";
import { requestMetaFromHeaders, type RequestMeta } from "./request-meta";

/** Request metadata of the current request (Server Components and Server Actions). */
export async function currentRequestMeta(): Promise<RequestMeta> {
  return requestMetaFromHeaders(await headers());
}
