import { expect, test } from "@playwright/test";
import { testToken } from "./fixture.mjs";

const example = "コンビニでおにぎりを温めたら、店員が拍手してくれた。";
const capture = page => page.getByRole("textbox", { name: "クイックメモ" });
const nav = (page, name) => page.getByRole("navigation").getByRole("button", { name, exact: true });
const card = (page, text) => page.locator(".swipe-card").filter({ hasText: text });
const generate = page => page.getByRole("button", { name: "分析して台本をつくる" });
async function save(page, text) {
  await capture(page).fill(text);
  await page.getByRole("button", { name: "メモを保存", exact: true }).click();
  await expect(card(page, text)).toBeVisible();
}
async function pauseGeneration(page) {
  const { promise, resolve } = Promise.withResolvers();
  await page.route("**/api/generate", async route => {
    await promise;
    await route.continue().catch(() => {});
  }, { times: 1 });
  return resolve;
}
async function asUser(context, info, variant = 0) {
  const base = { "chromium-desktop": 1, "chromium-touch": 8, "webkit-iphone": 15 }[info.project.name];
  await context.addCookies([{ url: "http://127.0.0.1:4185", name: "mn_session", value: testToken(base + variant), httpOnly: true }]);
}
async function drag(page, context, target, right, project) {
  await target.scrollIntoViewIfNeeded();
  const area = await target.boundingBox();
  const start = Math.round(area.x + area.width * (right ? .28 : .69));
  const y = Math.round(area.y + area.height / 2);
  const distance = right ? 96 : -96;
  if (project === "chromium-touch") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start, y }] });
    for (let step = 1; step <= 6; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start + distance * step / 6, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(start, y);
    await page.mouse.down();
    await page.mouse.move(start + distance, y, { steps: 6 });
    await page.mouse.up();
  }
}

test("quick memo is usable while session is loading; draft and note survive reload", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await page.route("**/api/session", async route => { await wait; await route.continue().catch(() => {}); });
  await page.goto("/");
  await expect(capture(page)).toBeInViewport();
  if (info.project.name === "chromium-desktop") await expect(capture(page)).toBeFocused();
  else await capture(page).tap();
  await capture(page).fill(example);
  await page.reload();
  await expect(capture(page)).toHaveValue(example);
  await page.getByRole("button", { name: "メモを保存", exact: true }).click();
  await expect(card(page, example).locator(".status-pill")).toHaveText("未整理");
  release();
  await page.reload();
  await expect(card(page, example)).toBeVisible();
  await expect(capture(page)).toHaveValue("");
  expect(await page.locator("html").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("flick both ways, undo, filter, and keyboard-accessible status menu", async ({ page, context }, info) => {
  await page.goto("/");
  await save(page, example);
  const memo = card(page, example);
  await drag(page, context, memo, true, info.project.name);
  await expect(memo.locator(".status-pill")).toHaveText("ネタ候補");
  await drag(page, context, memo, false, info.project.name);
  await expect(memo.locator(".status-pill")).toHaveText("保留");
  await page.getByRole("button", { name: "取り消す" }).click();
  await expect(memo.locator(".status-pill")).toHaveText("ネタ候補");
  await page.locator('[data-filter="shelved"]').click();
  await expect(memo).toHaveCount(0);
  await page.locator('[data-filter="ready"]').click();
  await expect(memo).toBeVisible();
  await memo.getByRole("button", { name: /の操作$/ }).click();
  await page.getByRole("button", { name: "未整理にする" }).click();
  await expect(memo).toHaveCount(0);
  await page.locator('[data-filter="inbox"]').click();
  await expect(memo).toBeVisible();
});

test("edit, search, delete and undo a memo", async ({ page }) => {
  await page.goto("/");
  await save(page, example);
  await card(page, example).locator(".memo-content").click();
  await page.getByRole("textbox", { name: "メモの内容" }).fill("商店街でからあげのテーマ曲が流れた。");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await page.getByRole("button", { name: "メモを検索" }).click();
  await page.getByRole("searchbox").fill("おにぎり");
  await expect(page.getByText("一致するメモがありません")).toBeVisible();
  await page.getByRole("searchbox").fill("からあげ");
  await card(page, "からあげ").getByRole("button", { name: /の操作$/ }).click();
  await page.getByRole("button", { name: "メモを削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(card(page, "からあげ")).toHaveCount(0);
  await page.getByRole("button", { name: "取り消す" }).click();
  await expect(card(page, "からあげ")).toBeVisible();
});

test("guest can pick notes and is offered only Google authentication", async ({ page }) => {
  await page.goto("/");
  await save(page, example);
  await nav(page, "ネタ作成").click();
  await expect(generate(page)).toBeDisabled();
  await page.locator(".pick-row").filter({ hasText: example }).click();
  await expect(generate(page)).toBeEnabled();
  await generate(page).click();
  const account = page.getByRole("dialog", { name: "アカウント" });
  await expect(account.getByRole("link", { name: "Googleでログイン" })).toHaveAttribute("href", "/auth/google");
  await expect(account.getByRole("textbox")).toHaveCount(0);
});

test("analysis reaches full-screen skeleton, stores a script, and supports editing", async ({ page, context }, info) => {
  await asUser(context, info);
  await page.goto("/");
  await expect(page.locator("#profile-name")).toHaveText("テスト作家");
  await save(page, example);
  await nav(page, "ネタ作成").click();
  await page.locator(".pick-row").filter({ hasText: example }).click();
  await page.getByText("2分", { exact: true }).click();
  await page.getByText("コント漫才", { exact: true }).click();
  const release = await pauseGeneration(page);
  const response = page.waitForResponse(res => res.url().endsWith("/api/generate"));
  try {
    await generate(page).click();
    const dialog = page.getByRole("dialog", { name: "メモを分析して台本を作成中" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".skeleton-panel")).toHaveCount(2);
    expect(await dialog.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.width === innerWidth && rect.height === innerHeight;
    })).toBe(true);
  } finally {
    release();
  }
  const request = (await response).request().postDataJSON();
  expect(request).toMatchObject({ duration: 2, style: "コント漫才", sources: [{ text: example }] });
  await expect(page.getByRole("heading", { name: "コンビニ温め相談室" })).toBeVisible();
  await expect(page.getByText("笑いのズレ", { exact: true })).toBeVisible();
  await expect(page.getByText("まず弁当買ってから来い！")).toBeVisible();
  await page.getByText("元のメモ（1件）").click();
  await expect(page.locator(".source-details").getByText(example, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("textbox", { name: "タイトル" }).fill("温め相談室 改稿");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByRole("heading", { name: "温め相談室 改稿" })).toBeVisible();
  await expect(page.locator("#profile-status")).toHaveText("同期済み");
  await page.reload();
  await nav(page, "台本").click();
  await page.getByRole("button", { name: /温め相談室 改稿/ }).click();
  await expect(page.getByRole("heading", { name: "温め相談室 改稿" })).toBeVisible();
});

test("generation cancellation and service error preserve the selection", async ({ page, context }, info) => {
  await asUser(context, info, 1);
  await page.goto("/");
  await expect(page.locator("#profile-name")).toHaveText("テスト作家");
  await save(page, "生成失敗テスト");
  await nav(page, "ネタ作成").click();
  await page.locator(".pick-row").filter({ hasText: "生成失敗テスト" }).click();
  const release = await pauseGeneration(page);
  const request = page.waitForRequest("**/api/generate");
  try {
    await generate(page).click();
    await request;
    await page.getByRole("button", { name: "キャンセル" }).click();
    await expect(page.locator("#loading")).not.toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByRole("checkbox", { name: /生成失敗テスト/ })).toBeChecked();
  await generate(page).click();
  await expect(page.locator("#toast")).toContainText("台本を生成できませんでした。");
  await expect(page.getByRole("checkbox", { name: /生成失敗テスト/ })).toBeChecked();
  await nav(page, "台本").click();
  await expect(page.getByText("台本はまだありません")).toBeVisible();
});

test.describe("offline", () => {
  test.use({ serviceWorkers: "allow" });

  test("guest memo can be saved after re-opening offline", async ({ page, context }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await save(page, "オフラインで書いたメモ");
    await page.reload();
    await expect(card(page, "オフラインで書いたメモ")).toBeVisible();
  });
});
