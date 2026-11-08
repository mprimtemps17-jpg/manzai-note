import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const testToken = index => Buffer.from(String(index).padStart(32, "0")).toString("base64url");
export const hashToken = value => createHash("sha256").update(value).digest("base64url");
export const fakeOutput = {
  title: "コンビニ温め相談室",
  analysis: {
    premise: "コンビニの温め確認を人生相談と取り違える。",
    contrast: "電子レンジの待ち時間と人生を立て直す時間の差。",
    punchline: "人生の相談料までポイントカードで払おうとする。",
  },
  lines: [
    { role: "ボケ", text: "すみません、僕の人生も温めてもらえますか？" },
    { role: "ツッコミ", text: "お弁当だけです。人生はフタ外しても無理です。" },
    { role: "ボケ", text: "じゃあ、相談料もポイントつきます？" },
    { role: "ツッコミ", text: "まず弁当買ってから来い！" },
  ],
};

export function fixture(delay = 850) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  const insert = db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)");
  for (let i = 0; i < 30; i++) insert.run(hashToken(testToken(i)), "test-user-" + i, "テスト作家", Date.now() + 86_400_000);
  return {
    DB: {
      prepare(sql) {
        const statement = db.prepare(sql);
        return {
          bind(...args) {
            return {
              async first() { return statement.get(...args) ?? null; },
              async all() { return { results: statement.all(...args) }; },
              run() { return statement.run(...args); },
            };
          },
        };
      },
      async batch(statements) {
        db.exec("BEGIN");
        try {
          const results = statements.map(statement => statement.run());
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
    APP_ORIGIN: "http://127.0.0.1:4185",
    GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-only",
    AI_LIMITER: { async limit() { return { success: true }; } },
    AI: {
      async run(_model, options) {
        await new Promise(resolve => setTimeout(resolve, delay));
        if (options.messages[1].content.includes("生成失敗テスト")) throw new Error("test failure");
        return { choices: [{ message: { content: JSON.stringify(fakeOutput) }, finish_reason: "stop" }] };
      },
    },
  };
}
