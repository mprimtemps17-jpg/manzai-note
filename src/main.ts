import "./style.css";
import { maxMemoLength, maxSelected, statusLabels, statuses, validDuration, validOutput, validStyle } from "./domain.ts";
import type { Duration, Memo, RecordItem, Script, Session, Source, Status, Style } from "./domain.ts";
import { icon, googleIcon } from "./icons.ts";
import { api, statusOf, WorkspaceStore } from "./store.ts";
import { escape, filters, generatePage, generationSkeleton, memoList, scriptsPage, shell } from "./views.ts";
import type { Filter, MemoRecord, ScriptRecord, View } from "./views.ts";
import { bindSwipe } from "./swipe.ts";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = shell();
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => app.querySelector<T>(selector)!;
const store = new WorkspaceStore();
const capture = $<HTMLTextAreaElement>("#capture");
const search = $<HTMLInputElement>("#search");
const sheet = $<HTMLDialogElement>("#sheet");
const loading = $<HTMLDialogElement>("#loading");
const toastElement = $("#toast");

let view: View = "memos";
let filter: Filter = "all";
let duration: Duration = 1;
let style: Style = "しゃべくり";
let openedScript: string | undefined;
let session: Session = { user: null, loginConfigured: false, aiConfigured: false };
let connection: "syncing" | "ok" | "offline" = "ok";
let controller: AbortController | undefined;
let toastTimer = 0;
let toastAction: (() => void) | undefined;
let sessionRequest = 0;
const selected = new Set<string>();

const memos = () => store.state.records.filter((item): item is MemoRecord => item.kind === "memo" && item.value !== null)
  .sort((a, b) => b.value.createdAt - a.value.createdAt || a.id.localeCompare(b.id));
const scripts = () => store.state.records.filter((item): item is ScriptRecord => item.kind === "script" && item.value !== null)
  .sort((a, b) => b.value.createdAt - a.value.createdAt || a.id.localeCompare(b.id));

function toast(message: string, action?: () => void) {
  window.clearTimeout(toastTimer);
  toastAction = action;
  toastElement.innerHTML = `<span>${escape(message)}</span>${action ? '<button data-action="undo">取り消す</button>' : ""}`;
  toastElement.hidden = false;
  toastTimer = window.setTimeout(() => { toastElement.hidden = true; toastAction = undefined; }, action ? 7000 : 4000);
}
function renderProfile() {
  $("#profile-name").textContent = session.user?.name ?? "アカウント";
  $("#profile-status").textContent = session.user ?
    ({ ok: "同期済み", syncing: "同期中", offline: "同期を待機中" } as const)[connection] : "この端末に保存";
}
function renderMemos() {
  const items = memos();
  const query = search.value.trim().toLocaleLowerCase("ja");
  $("#count-chip span").textContent = items.length + " 件";
  $("#filters").innerHTML = filters(filter, items);
  $("#memo-list").innerHTML = memoList(items.filter(item =>
    (filter === "all" || item.value.status === filter) && item.value.text.toLocaleLowerCase("ja").includes(query)),
    !!items.length, filter, !!query);
}
function render() {
  const items = memos();
  const available = new Set(items.map(item => item.id));
  for (const id of selected) if (!available.has(id)) selected.delete(id);
  if (view === "memos") renderMemos();
  if (view === "generate") {
    const page = $("#generate-page");
    const pickerScroll = page.querySelector(".picker")?.scrollTop ?? 0;
    page.innerHTML = generatePage(items, selected, duration, style, !!session.user, session.aiConfigured);
    page.querySelector(".picker")!.scrollTop = pickerScroll;
  }
  if (view === "scripts") {
    const saved = scripts();
    $("#scripts-page").innerHTML = scriptsPage(saved, saved.find(item => item.id === openedScript));
  }
  renderProfile();
}
function show(next: View, script?: string, focus = true) {
  view = next;
  openedScript = script;
  for (const id of ["memos", "generate", "scripts"]) $("#" + id + "-page").hidden = id !== view;
  app.querySelectorAll<HTMLButtonElement>("nav [data-nav]").forEach(button => {
    if (button.dataset.nav === next) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  render();
  window.scrollTo(0, 0);
  if (focus) {
    const heading = $("#" + next + "-page h1");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
function refreshComposer() {
  $("#draft-count").textContent = capture.value.length.toLocaleString("ja-JP");
  $<HTMLButtonElement>("#save-memo").disabled = !capture.value.trim();
}
function applyOwner(id: string | null) {
  store.setOwner(id);
  if (capture.value !== store.state.draft) capture.value = store.state.draft;
  refreshComposer();
}
async function checkSession() {
  const request = ++sessionRequest;
  try {
    const result = await api<Session>("/api/session");
    if (request !== sessionRequest) return;
    if (session.user?.id !== result.user?.id) {
      controller?.abort();
      selected.clear();
      openedScript = undefined;
    }
    session = result;
    applyOwner(session.user?.id ?? null);
    render();
    void store.sync();
  } catch {
    if (request === sessionRequest && session.user) {
      connection = "offline";
      renderProfile();
    }
  }
}
store.onChange = render;
store.onPersistenceFailure = () => toast("端末に保存できません。ブラウザの空き容量を確認してください。");
store.onSync = state => {
  if (state === "expired") { void checkSession(); return; }
  connection = state;
  renderProfile();
};

function change(record: RecordItem, value: Memo | Script | null) {
  store.change([{ ...record, value, updatedAt: Math.max(Date.now(), record.updatedAt + 1) }]);
}
function setStatus(id: string, status: Status) {
  const record = memos().find(item => item.id === id);
  if (!record || record.value.status === status) return;
  const owner = store.owner;
  change(record, { ...record.value, status });
  toast(statusLabels[status] + "に移動しました", () => {
    if (store.owner !== owner) return;
    const latest = memos().find(item => item.id === id);
    if (latest?.value.status === status) change(latest, { ...latest.value, status: record.value.status });
  });
}
bindSwipe($("#memo-list"), setStatus);

function openSheet(title: string, content: string) {
  sheet.innerHTML = `<div class="sheet-inner"><div class="sheet-grip"></div><header class="sheet-head"><h2 id="sheet-title">${escape(title)}</h2>
    <button class="icon-button" data-action="close-sheet" aria-label="閉じる">${icon("close", 19)}</button></header>${content}</div>`;
  if (!sheet.open) sheet.showModal();
  sheet.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
}
function openAccount() {
  if (session.user) {
    openSheet("アカウント", `<div class="account-summary"><span class="square-icon mint">${icon("account")}</span>
      <div><strong>${escape(session.user.name)}</strong><p>Google でログイン中</p></div></div>
      <div class="sheet-actions"><button class="button secondary" data-action="logout">ログアウト</button></div>`);
  } else {
    openSheet("アカウント", `<p class="sheet-info">Googleでログインすると、端末のメモをアカウントに移して同期し、台本を生成できます。</p>
      <div class="sheet-actions">${session.loginConfigured ?
        `<a class="button google" href="/auth/google">${googleIcon} Googleでログイン</a>` :
        `<button class="button google" disabled>${googleIcon} Googleでログイン</button><p class="sheet-info">Googleログインは現在利用できません。</p>`}</div>`);
  }
}
function memoEditor(id: string) {
  const record = memos().find(item => item.id === id);
  if (!record) return;
  openSheet("メモを編集", `<form id="edit-memo" data-id="${id}"><label class="visually-hidden" for="edit-text">メモの内容</label>
    <textarea id="edit-text" rows="6" maxlength="${maxMemoLength}" required data-initial-focus>${escape(record.value.text)}</textarea>
    <div class="sheet-actions end"><button class="button primary" type="submit">変更を保存</button></div></form>`);
}
function memoMenu(id: string) {
  const record = memos().find(item => item.id === id);
  if (!record) return;
  openSheet("メモの操作", `<div class="menu-options">
    ${statuses.map(status => `<button data-action="set-status" data-id="${id}" data-status="${status}">${statusLabels[status]}にする
      ${record.value.status === status ? icon("check", 17) : ""}</button>`).join("")}
    <button data-action="use-memo" data-id="${id}">${icon("spark", 17)} このメモでネタ作成</button>
    <button class="danger-text" data-action="delete-memo" data-id="${id}">${icon("trash", 17)} メモを削除</button>
  </div>`);
}
function scriptEditor(id: string) {
  const record = scripts().find(item => item.id === id);
  if (!record) return;
  const { value } = record;
  openSheet("台本を編集", `<form id="edit-script" data-id="${id}">
    <label class="field-label" for="script-name">タイトル</label>
    <input id="script-name" value="${escape(value.title)}" maxlength="120" required data-initial-focus>
    <label class="field-label" for="script-lines">セリフ</label>
    <p class="field-help">各行を「ボケ：」または「ツッコミ：」で始めてください。</p>
    <textarea id="script-lines" rows="9" maxlength="42000" required>${escape(value.lines.map(line =>
      line.role + "：" + line.text.replace(/\s*\n\s*/g, " ")).join("\n"))}</textarea>
    <p id="edit-error" class="field-error" role="alert" hidden></p>
    <div class="sheet-actions end"><button class="button primary" type="submit">変更を保存</button></div>
  </form>`);
}
function confirmDelete(id: string, kind: "memo" | "script") {
  const record = store.state.records.find(item => item.id === id && item.kind === kind && item.value);
  if (!record) return;
  const name = kind === "memo" ? "メモ" : "台本";
  openSheet(name + "を削除しますか？", `<div class="sheet-actions end">
    <button class="button secondary" data-action="close-sheet">キャンセル</button>
    <button class="button danger" data-action="confirm-delete" data-id="${id}">削除する</button></div>`);
}
function remove(id: string) {
  const record = store.state.records.find(item => item.id === id && item.value);
  if (!record) return;
  const owner = store.owner;
  sheet.close();
  change(record, null);
  if (record.kind === "script") show("scripts");
  toast((record.kind === "memo" ? "メモ" : "台本") + "を削除しました", () => {
    if (store.owner !== owner) return;
    change({ ...record, updatedAt: record.updatedAt + 1 }, record.value);
  });
}
function addSamples() {
  const samples: { text: string; status: Status }[] = [
    { text: "コンビニで「温めますか？」と聞かれて、人生を温めてほしいと思った。", status: "ready" },
    { text: "スマホの顔認証に、寝起きの自分だけ他人扱いされる。", status: "inbox" },
    { text: "カフェの『少々お待ちください』の少々は、人によって何分？", status: "shelved" },
  ];
  const now = Date.now();
  store.change(samples.map((memo, index) => ({ id: crypto.randomUUID(), kind: "memo", updatedAt: now - index,
    value: { ...memo, createdAt: now - index } })));
  toast("サンプルメモを3件追加しました");
}
async function startGeneration() {
  if (!selected.size || controller) return;
  if (!session.user) { openAccount(); return; }
  if (!session.aiConfigured) { toast("Workers AI は現在利用できません。"); return; }
  const sources: Source[] = memos().filter(item => selected.has(item.id)).map(item => ({ id: item.id, text: item.value.text }));
  const input = { sources, duration, style };
  const owner = store.owner;
  const request = new AbortController();
  controller = request;
  loading.innerHTML = generationSkeleton();
  loading.showModal();
  document.body.classList.add("generating");
  try {
    const output = await api<unknown>("/api/generate", input, request.signal, owner);
    if (request.signal.aborted || store.owner !== owner) return;
    if (!validOutput(output)) throw new Error("台本の形式を読み取れませんでした。");
    const id = crypto.randomUUID(), now = Date.now();
    store.change([{ id, kind: "script", updatedAt: now, value: { ...output, ...input, createdAt: now } }]);
    selected.clear();
    loading.close();
    show("scripts", id);
    toast("台本を保存しました");
  } catch (error) {
    if (request.signal.aborted) return;
    if (statusOf(error) === 401) void checkSession();
    loading.close();
    toast(error instanceof Error && statusOf(error) ? error.message : "台本を生成できませんでした。再試行してください。");
  } finally {
    controller = undefined;
    if (loading.open) loading.close();
    loading.replaceChildren();
    document.body.classList.remove("generating");
  }
}
async function copyScript(id: string) {
  const record = scripts().find(item => item.id === id);
  if (!record) return;
  const text = record.value.title + "\n\n" + record.value.lines.map(line => line.role + "： " + line.text).join("\n");
  try { await navigator.clipboard.writeText(text); toast("台本をコピーしました"); }
  catch { toast("コピーできませんでした。"); }
}
async function signOut() {
  try {
    await api("/api/logout", {});
    ++sessionRequest;
    controller?.abort();
    session = { ...session, user: null };
    selected.clear();
    applyOwner(null);
    sheet.close();
    show("memos");
    toast("ログアウトしました");
  } catch { toast("ログアウトできませんでした。再試行してください。"); }
}

app.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  if (event.target === sheet) { sheet.close(); return; }
  const button = event.target.closest<HTMLElement>("[data-action], [data-nav], [data-filter]");
  if (!button) return;
  const { action, nav, id = "", status, filter: nextFilter } = button.dataset;
  if (nav) { show(nav as View); return; }
  if (nextFilter) {
    filter = nextFilter as Filter;
    renderMemos();
    $<HTMLButtonElement>(`[data-filter="${nextFilter}"]`).focus({ preventScroll: true });
    return;
  }
  switch (action) {
    case "account": openAccount(); break;
    case "search": {
      const bar = $("#search-bar");
      bar.hidden = !bar.hidden;
      button.setAttribute("aria-expanded", String(!bar.hidden));
      if (bar.hidden) { search.value = ""; renderMemos(); } else search.focus();
      break;
    }
    case "samples": addSamples(); break;
    case "edit-memo": memoEditor(id); break;
    case "memo-menu": memoMenu(id); break;
    case "set-status": sheet.close(); setStatus(id, status as Status); break;
    case "use-memo": selected.clear(); selected.add(id); sheet.close(); show("generate"); break;
    case "delete-memo": confirmDelete(id, "memo"); break;
    case "delete-script": confirmDelete(id, "script"); break;
    case "confirm-delete": remove(id); break;
    case "close-sheet": sheet.close(); break;
    case "generate": void startGeneration(); break;
    case "cancel-generate": controller?.abort(); break;
    case "open-script": show("scripts", id); break;
    case "edit-script": scriptEditor(id); break;
    case "copy-script": void copyScript(id); break;
    case "logout": void signOut(); break;
    case "undo": {
      const undo = toastAction;
      toastAction = undefined;
      toastElement.hidden = true;
      undo?.();
      break;
    }
  }
});
app.addEventListener("change", event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.dataset.pick) {
    const id = input.dataset.pick;
    if (input.checked && selected.size < maxSelected) selected.add(id);
    else selected.delete(id);
    render();
    $<HTMLInputElement>(`[data-pick="${id}"]`).focus({ preventScroll: true });
  }
  if (input.name === "duration" && validDuration(Number(input.value))) duration = Number(input.value) as Duration;
  if (input.name === "style" && validStyle(input.value)) style = input.value;
});
app.addEventListener("submit", event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === "composer") {
    const text = capture.value.trim();
    if (!text) return;
    const now = Date.now();
    capture.value = "";
    store.state.draft = "";
    filter = "all";
    search.value = "";
    store.change([{ id: crypto.randomUUID(), kind: "memo", updatedAt: now, value: { text, status: "inbox", createdAt: now } }]);
    refreshComposer();
    toast("メモを保存しました");
  }
  if (form.id === "edit-memo") {
    const record = memos().find(item => item.id === form.dataset.id);
    const text = $<HTMLTextAreaElement>("#edit-text").value.trim();
    if (!record || !text) return;
    sheet.close();
    change(record, { ...record.value, text });
    toast("メモを更新しました");
  }
  if (form.id === "edit-script") {
    const record = scripts().find(item => item.id === form.dataset.id);
    if (!record) return;
    const title = $<HTMLInputElement>("#script-name").value.trim();
    const lines = $<HTMLTextAreaElement>("#script-lines").value.split("\n").filter(line => line.trim()).map(line => {
      const parsed = /^\s*(ボケ|ツッコミ)\s*[：:]\s*(.+)$/.exec(line);
      return { role: parsed?.[1], text: parsed?.[2].trim() };
    });
    const result = { title, lines, analysis: record.value.analysis };
    if (!validOutput(result)) {
      $("#edit-error").textContent = "タイトルと、両方の役が入った4〜80行のセリフを入力してください。";
      $("#edit-error").hidden = false;
      return;
    }
    sheet.close();
    change(record, { ...record.value, ...result });
    toast("台本を更新しました");
  }
});
capture.addEventListener("input", () => { store.draft(capture.value); refreshComposer(); });
capture.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.isComposing && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    $<HTMLFormElement>("#composer").requestSubmit();
  }
});
search.addEventListener("input", renderMemos);
loading.addEventListener("cancel", event => { event.preventDefault(); controller?.abort(); });
window.addEventListener("online", () => void checkSession());
document.addEventListener("visibilitychange", () => { if (!document.hidden) void checkSession(); });

capture.value = store.state.draft;
refreshComposer();
show("memos", undefined, false);
if (!matchMedia("(pointer: coarse)").matches) capture.focus({ preventScroll: true });
void checkSession();
const url = new URL(location.href);
if (url.searchParams.has("auth")) {
  toast(url.searchParams.get("auth") === "failed" ? "Googleログインに失敗しました。再試行してください。" : "Googleログインは現在利用できません。");
  url.searchParams.delete("auth");
  history.replaceState(null, "", url);
}
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { void navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
