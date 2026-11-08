import { Readable } from "node:stream";
import { defineConfig } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import worker from "./worker/index.ts";

export default defineConfig(async () => {
  // External services are substituted only in the isolated browser-test process.
  const env = process.env.MANZAI_E2E === "1" ? (await import("./tests/fixture.mjs")).fixture() : {};
  const workerMiddleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/") && !req.url?.startsWith("/auth/")) return next();
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const init: RequestInit & { duplex?: "half" } = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
        init.duplex = "half";
      }
      const host = req.headers.host ?? "localhost";
      const response = await worker.fetch(new Request("http://" + host + req.url, init), env);
      response.headers.forEach((value, name) => { if (name !== "set-cookie") res.setHeader(name, value); });
      if (response.headers.has("set-cookie")) res.setHeader("set-cookie", response.headers.getSetCookie());
      res.statusCode = response.status;
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.statusCode = 500;
      res.end();
    }
  };
  return { plugins: [{
    name: "manzai-local-worker",
    configureServer(server) { server.middlewares.use(workerMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(workerMiddleware); },
  }] };
});
