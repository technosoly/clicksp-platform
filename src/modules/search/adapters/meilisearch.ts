import "server-only";
import { env } from "@/lib/env";

/**
 * A small client for the Meilisearch REST API (v1.58, the version in
 * docker-compose.yml; https://www.meilisearch.com/docs/reference/api/overview).
 * Only the calls the store needs; the API key stays on the server. Writes are
 * asynchronous tasks in Meilisearch; `waitForTask` waits for one when the
 * caller needs the result (the full rebuild).
 */

export class MeiliError extends Error {}

type Config = { host: string; key: string | null };

export function meiliConfig(): Config | null {
  const { MEILISEARCH_HOST, MEILISEARCH_API_KEY } = env();
  return MEILISEARCH_HOST ? { host: MEILISEARCH_HOST.replace(/\/+$/, ""), key: MEILISEARCH_API_KEY ?? null } : null;
}

async function call<T>(config: Config, method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<T> {
  const response = await fetch(`${config.host}/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new MeiliError(`meilisearch ${method} ${path.split("?")[0]}: ${response.status} ${detail.slice(0, 300)}`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

type Task = { taskUid: number };
const index = (uid: string) => `indexes/${encodeURIComponent(uid)}`;

export const meili = {
  updateSettings: (c: Config, uid: string, settings: object) => call<Task>(c, "PATCH", `${index(uid)}/settings`, settings),
  addDocuments: (c: Config, uid: string, docs: object[]) => call<Task>(c, "POST", `${index(uid)}/documents?primaryKey=id`, docs),
  deleteDocuments: (c: Config, uid: string, ids: string[]) => call<Task>(c, "POST", `${index(uid)}/documents/delete-batch`, ids),
  deleteIndex: (c: Config, uid: string) => call<Task>(c, "DELETE", index(uid)),
  swapIndexes: (c: Config, a: string, b: string) => call<Task>(c, "POST", "swap-indexes", [{ indexes: [a, b] }]),
  indexExists: async (c: Config, uid: string) => {
    try {
      await call(c, "GET", index(uid));
      return true;
    } catch (error) {
      if (error instanceof MeiliError && / 404 /.test(error.message)) return false;
      throw error;
    }
  },
  search: (c: Config, uid: string, params: { q: string; offset: number; limit: number }, timeoutMs: number) =>
    call<{ hits: { id: string }[]; estimatedTotalHits: number }>(c, "POST", `${index(uid)}/search`, { ...params, attributesToRetrieve: ["id"] }, timeoutMs),
  /** Waits until a task finishes; throws if it failed or takes longer than the timeout. */
  async waitForTask(c: Config, task: Task, timeoutMs = 60_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    for (let delay = 50; ; delay = Math.min(delay * 2, 1000)) {
      const t = await call<{ status: string; error: { message?: string } | null }>(c, "GET", `tasks/${task.taskUid}`);
      if (t.status === "succeeded") return;
      if (t.status === "failed" || t.status === "canceled") throw new MeiliError(`meilisearch task ${task.taskUid} ${t.status}: ${t.error?.message ?? ""}`);
      if (Date.now() > until) throw new MeiliError(`meilisearch task ${task.taskUid} still ${t.status}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  },
};
