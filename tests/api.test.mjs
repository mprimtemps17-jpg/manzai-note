import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../worker/index.ts";
import { fakeOutput, fixture, testToken } from "./fixture.mjs";

const origin = "http://127.0.0.1:4185";
const input = { sources: [{ id: "source-test", text: "コンビニで人生を温めたい" }], duration: 2, style: "しゃべくり" };
const record = (id, text = "メモ") => ({ id, kind: "memo", updatedAt: Date.now(),
  value: { text, status: "inbox", createdAt: Date.now() } });
const call = (env, path, { token, data, originOverride, headers = {} } = {}) => {
  const init = { headers: { ...headers, ...(token === undefined ? {} : { Cookie: "mn_session=" + testToken(token) }) } };
  if (data !== undefined) {
    init.method = "POST";
    init.body = JSON.stringify(data);
    Object.assign(init.headers, { "Content-Type": "application/json", Origin: originOverride ?? origin });
  }
  return worker.fetch(new Request(origin + path, init), env);
};

test("unauthenticated access and cross-origin writes are rejected", async () => {
  const env = fixture(0);
  assert.equal((await call(env, "/api/records")).status, 401);
  assert.equal((await call(env, "/api/generate", { data: input })).status, 401);
  assert.equal((await call(env, "/api/generate", { token: 0, data: input, originOverride: "https://another.example" })).status, 403);
});

test("D1 rows are account-scoped and an account switch cannot misroute a write", async () => {
  const env = fixture(0);
  const memo = record("isolated-memo");
  assert.equal((await call(env, "/api/records", { token: 0, data: { records: [memo] } })).status, 200);
  assert.deepEqual((await (await call(env, "/api/records", { token: 0 })).json()).records, [memo]);
  assert.deepEqual((await (await call(env, "/api/records", { token: 1 })).json()).records, []);
  assert.equal((await call(env, "/api/records", { token: 1, data: { records: [memo] },
    headers: { "X-Workspace-Owner": "test-user-0" } })).status, 401);
});

test("stale retries cannot resurrect deleted rows", async () => {
  const env = fixture(0);
  const memo = record("removed-memo");
  const removed = { ...memo, value: null, updatedAt: memo.updatedAt + 1 };
  for (const change of [memo, removed, memo, removed]) {
    assert.equal((await call(env, "/api/records", { token: 0, data: { records: [change] } })).status, 200);
  }
  assert.deepEqual((await (await call(env, "/api/records", { token: 0 })).json()).records, [removed]);
});

test("invalid input, future timestamps, missing AI, and rate limits are handled", async () => {
  const env = fixture(0);
  assert.equal((await call(env, "/api/generate", { token: 0, data: { ...input, sources: [] } })).status, 400);
  assert.equal((await call(env, "/api/generate", { token: 0, data: { ...input, sources: [input.sources[0], input.sources[0]] } })).status, 400);
  assert.equal((await call(env, "/api/records", { token: 0, data: { records: [{ ...record("future-record"), updatedAt: Date.now() + 800_000 }] } })).status, 400);
  assert.equal((await call({ ...env, AI: undefined }, "/api/generate", { token: 0, data: input })).status, 503);
  assert.equal((await call({ ...env, AI_LIMITER: { limit: async () => ({ success: false }) } }, "/api/generate", { token: 0, data: input })).status, 429);
});

test("Workers AI receives a structured prompt; malformed model output becomes a controlled error", async () => {
  const env = fixture(0);
  const models = [];
  env.AI.run = async (model, options) => {
    models.push({ model, options });
    return { choices: [{ message: { content: JSON.stringify(fakeOutput) } }] };
  };
  const res = await call(env, "/api/generate", { token: 0, data: input });
  assert.deepEqual(await res.json(), fakeOutput);
  assert.equal(models[0].model, "@cf/qwen/qwen3-30b-a3b-fp8");
  assert.equal(models[0].options.response_format.type, "json_schema");
  assert.ok(models[0].options.messages[1].content.includes(input.sources[0].text));
  env.AI.run = async () => ({ choices: [{ message: { content: "{}" } }] });
  assert.equal((await call(env, "/api/generate", { token: 0, data: input })).status, 502);
});

test("Google authorization uses PKCE and rejects mismatched state", async () => {
  const env = fixture(0);
  const response = await call(env, "/auth/google");
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(location.searchParams.get("nonce"));
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.equal((await call(env, "/auth/google/callback?code=test&state=wrong", { headers: { Cookie: cookie } }))
    .headers.get("location"), "/?auth=failed");
});

test("Google callback verifies an RSA-signed ID token before creating and revoking a session", async t => {
  const env = fixture(0);
  const start = await call(env, "/auth/google");
  const oauth = new URL(start.headers.get("location")).searchParams;
  const oauthCookie = start.headers.get("set-cookie").split(";")[0];
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-jwk", alg: "RS256" };
  const sign = nonce => new SignJWT({ nonce, name: "漫才テスト" }).setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer("https://accounts.google.com").setAudience(env.GOOGLE_CLIENT_ID)
    .setIssuedAt().setExpirationTime("5m").setSubject("google-test-account").sign(privateKey);
  let idToken = await sign("wrong-nonce");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      assert.equal(options.body.get("code_verifier"), oauthCookie.split(".")[1]);
      return Response.json({ id_token: idToken });
    }
    assert.equal(String(url), "https://www.googleapis.com/oauth2/v3/certs");
    return Response.json({ keys: [jwk] });
  });
  const callback = () => call(env, "/auth/google/callback?code=one-time&state=" + oauth.get("state"), { headers: { Cookie: oauthCookie } });
  assert.equal((await callback()).headers.get("location"), "/?auth=failed");
  idToken = await sign(oauth.get("nonce"));
  const success = await callback();
  assert.equal(success.headers.get("location"), "/");
  const session = success.headers.getSetCookie().find(value => value.startsWith("mn_session="));
  assert.match(session, /HttpOnly; SameSite=Lax/);
  const headers = { Cookie: session.split(";")[0] };
  const status = await (await call(env, "/api/session", { headers })).json();
  assert.deepEqual(status.user, { id: "google-test-account", name: "漫才テスト" });
  assert.equal((await call(env, "/api/logout", { headers, data: {} })).status, 204);
  assert.equal((await (await call(env, "/api/session", { headers })).json()).user, null);
});
