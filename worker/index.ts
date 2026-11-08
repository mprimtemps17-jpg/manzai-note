import { object, validRecord } from "../src/domain.ts";
import type { RecordItem } from "../src/domain.ts";
import { configured, currentUser, finishGoogle, logout, startGoogle } from "./auth.ts";
import type { AuthEnv } from "./auth.ts";
import { generate, validInput } from "./ai.ts";
import type { AiBinding } from "./ai.ts";

export interface Env extends AuthEnv {
  ASSETS?: Fetcher;
  AI?: AiBinding;
  AI_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const apiHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: apiHeaders });
const failure = (error: string, status: number) => json({ error }, status);

async function body(request: Request, max: number): Promise<unknown> {
  if (!request.body || request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    throw new Error("Invalid request format");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, data = "";
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength;
      if (size > max) throw new Error("Payload too large");
      data += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(data + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const { method } = request;
    if (!path.startsWith("/api/") && !path.startsWith("/auth/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }
    if (method !== "GET" && (method !== "POST" || request.headers.get("Origin") !== url.origin)) {
      return failure("リクエストを確認してください。", 403);
    }

    try {
      if (method === "GET" && path === "/auth/google") return await startGoogle(request, env);
      if (method === "GET" && path === "/auth/google/callback") return await finishGoogle(request, env);
      if (method === "POST" && path === "/api/logout") return await logout(request, env);
      const user = await currentUser(request, env);
      if (method === "GET" && path === "/api/session") {
        return json({ user, loginConfigured: configured(env), aiConfigured: !!(env.AI && env.AI_LIMITER) });
      }
      if (!user || !env.DB) return failure("Googleでログインしてください。", 401);
      const expectedUser = request.headers.get("X-Workspace-Owner");
      if (expectedUser && expectedUser !== user.id) return failure("アカウントが切り替わりました。", 401);
      if (method === "GET" && path === "/api/records") {
        const page = url.searchParams.get("page") || "0";
        if (!/^\d{1,6}$/.test(page)) return failure("ページを確認してください。", 400);
        const pageSize = 200;
        const { results } = await env.DB.prepare(
          "SELECT id, kind, value, updated_at AS updatedAt FROM records WHERE user_id = ? ORDER BY id LIMIT ? OFFSET ?",
        ).bind(user.id, pageSize + 1, Number(page) * pageSize).all<Omit<RecordItem, "value"> & { value: string | null }>();
        return json({ records: results.slice(0, pageSize).map(item => ({ ...item, value: item.value ? JSON.parse(item.value) : null })),
          nextPage: results.length > pageSize ? Number(page) + 1 : null });
      }
      if (method === "POST" && path === "/api/records") {
        const input = await body(request, 600_000).catch(() => null);
        if (!object(input) || !Array.isArray(input.records) || !input.records.length || input.records.length > 12 ||
            !input.records.every(validRecord) || input.records.some(item => item.updatedAt > Date.now() + 5 * 60_000)) {
          return failure("保存する内容を確認してください。", 400);
        }
        const writes = input.records.map(item => env.DB!.prepare(
          `INSERT INTO records (user_id, id, kind, value, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
           WHERE records.kind = excluded.kind AND (excluded.updated_at > records.updated_at
             OR (excluded.updated_at = records.updated_at AND excluded.value IS NULL))`,
        ).bind(user.id, item.id, item.kind, item.value ? JSON.stringify(item.value) : null, item.updatedAt));
        await env.DB.batch(writes);
        return json({ saved: true });
      }
      if (method === "POST" && path === "/api/generate") {
        const input = await body(request, 128_000).catch(() => null);
        if (!validInput(input)) return failure("メモと生成設定を確認してください。", 400);
        if (!env.AI || !env.AI_LIMITER) return failure("Workers AI は現在利用できません。", 503);
        if (!(await env.AI_LIMITER.limit({ key: user.id })).success) {
          return failure("生成回数の上限に達しました。少し待ってから再試行してください。", 429);
        }
        try {
          return json(await generate(env.AI, input));
        } catch {
          return failure("台本を生成できませんでした。時間をおいて再試行してください。", 502);
        }
      }
      return failure("ページが見つかりません。", 404);
    } catch {
      return failure("通信処理でエラーが発生しました。少し待ってから再試行してください。", 503);
    }
  },
};
