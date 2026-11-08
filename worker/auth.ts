import { createRemoteJWKSet, jwtVerify } from "jose";
import type { User } from "../src/domain.ts";

export interface AuthEnv {
  DB?: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_ORIGIN?: string;
}

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const encoder = new TextEncoder();
const ttl = 30 * 24 * 60 * 60;
const temporaryTtl = 10 * 60;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
async function hash(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export function configured(env: AuthEnv): boolean {
  return !!(env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_ORIGIN);
}
function local(url: URL): boolean {
  return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
}
function key(name: string, url: URL): string {
  return local(url) ? name : "__Host-" + name;
}
function cookie(name: string, value: string, age: number, url: URL): string {
  return `${key(name, url)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${local(url) ? "" : "; Secure"}`;
}
function getCookie(request: Request, name: string): string | undefined {
  const prefix = key(name, new URL(request.url)) + "=";
  return request.headers.get("Cookie")?.split(";").map(pair => pair.trim()).find(pair => pair.startsWith(prefix))?.slice(prefix.length);
}
function redirect(target: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}
function validOrigin(url: URL, env: AuthEnv): boolean {
  return url.origin === env.APP_ORIGIN && (url.protocol === "https:" || local(url));
}

export async function currentUser(request: Request, env: AuthEnv): Promise<User | null> {
  const token = getCookie(request, "mn_session");
  if (!env.DB || !token || !/^[\w-]{43}$/.test(token)) return null;
  const user = await env.DB.prepare("SELECT user_id AS id, name FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await hash(token), Date.now()).first<User>();
  return user ?? null;
}
export async function startGoogle(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!configured(env) || !validOrigin(url, env)) return redirect("/?auth=unavailable");
  const state = random(), verifier = random(), nonce = random();
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: env.APP_ORIGIN + "/auth/google/callback",
    response_type: "code", scope: "openid profile", state, nonce,
    code_challenge: await hash(verifier), code_challenge_method: "S256",
  }).toString();
  return redirect(google.href, [cookie("mn_oauth", [state, verifier, nonce].join("."), temporaryTtl, url)]);
}
export async function finishGoogle(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const clear = cookie("mn_oauth", "", 0, url);
  const fail = () => redirect("/?auth=failed", [clear]);
  const [state, verifier, nonce] = getCookie(request, "mn_oauth")?.split(".") ?? [];
  const code = url.searchParams.get("code");
  if (!configured(env) || !validOrigin(url, env) || !state || !verifier || !nonce || !code ||
      state !== url.searchParams.get("state")) return fail();
  try {
    const exchange = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: env.APP_ORIGIN + "/auth/google/callback", grant_type: "authorization_code", code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!exchange.ok) return fail();
    const token = await exchange.json<{ id_token?: string }>();
    if (!token.id_token) return fail();
    const { payload } = await jwtVerify(token.id_token, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: env.GOOGLE_CLIENT_ID, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat", "nonce"],
    });
    if (!payload.sub || payload.nonce !== nonce) return fail();
    const name = typeof payload.name === "string" ? payload.name.slice(0, 120) : "Google ユーザー";
    const session = random();
    const previousToken = getCookie(request, "mn_session");
    const now = Date.now();
    const cleanup = env.DB!.prepare("DELETE FROM sessions WHERE expires_at <= ? OR token_hash = ?")
      .bind(now, previousToken ? await hash(previousToken) : "");
    const create = env.DB!.prepare("INSERT INTO sessions (token_hash, user_id, name, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await hash(session), payload.sub, name, now + ttl * 1000);
    await env.DB!.batch([cleanup, create]);
    return redirect("/", [clear, cookie("mn_session", session, ttl, url)]);
  } catch {
    return fail();
  }
}
export async function logout(request: Request, env: AuthEnv): Promise<Response> {
  const token = getCookie(request, "mn_session");
  if (env.DB && token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hash(token)).run();
  return new Response(null, {
    status: 204, headers: { "Cache-Control": "no-store", "Set-Cookie": cookie("mn_session", "", 0, new URL(request.url)) },
  });
}
