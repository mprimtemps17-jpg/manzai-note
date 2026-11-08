import { durations, maxSelected, statusLabels, statuses, styles } from "./domain.ts";
import type { Duration, Memo, RecordItem, Script, Status, Style } from "./domain.ts";
import { icon } from "./icons.ts";
import type { Icon } from "./icons.ts";

export type View = "memos" | "generate" | "scripts";
export type MemoRecord = RecordItem & { value: Memo };
export type ScriptRecord = RecordItem & { value: Script };
export type Filter = Status | "all";
const nav: { id: View; name: string; icon: Icon }[] = [
  { id: "memos", name: "メモ", icon: "note" },
  { id: "generate", name: "ネタ作成", icon: "spark" },
  { id: "scripts", name: "台本", icon: "mic" },
];

export const escape = (text: string | number) => String(text).replace(/[&<>"']/g,
  value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
const longDate = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" });
const shortDate = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" });
export const dateLabel = (time: number) => shortDate.format(time);
export const statusPill = (status: Status) => `<span class="status-pill ${status}"><i></i>${statusLabels[status]}</span>`;
const titleFor = (text: string) => {
  const line = text.trim().split("\n")[0];
  return line.length > 44 ? line.slice(0, 44) + "…" : line;
};

export function shell() {
  return `
    <a class="skip" href="#main">本文へ</a>
    <header class="mobile-header">
      <button class="brand" data-nav="memos"><img src="/icon.svg" alt="" width="34" height="34">漫才ノート</button>
      <button class="icon-button mobile-profile" data-action="account" aria-label="アカウント">${icon("account", 20)}</button>
    </header>
    <div class="layout">
      <aside class="sidebar" aria-label="サイドバー">
        <button class="brand" data-nav="memos"><img src="/icon.svg" alt="" width="41" height="41">漫才ノート</button>
        <div class="nav-group">
          <div class="nav-label">ワークスペース</div>
          <nav class="desktop-nav" aria-label="メインメニュー">${nav.map(item =>
            `<button data-nav="${item.id}">${icon(item.icon)}<span>${item.name}</span>${icon("chevron", 15)}</button>`).join("")}</nav>
        </div>
        <div class="sidebar-foot">
          <button class="profile-button" data-action="account">
            <span class="profile-icon">${icon("account", 19)}</span>
            <span><strong id="profile-name">アカウント</strong><small id="profile-status">この端末に保存</small></span>
            ${icon("chevron", 14)}
          </button>
        </div>
      </aside>
      <main id="main" tabindex="-1">
        <div class="page" id="memos-page">
          <div class="page-heading">
            <div><div class="eyebrow"><span class="live-dot"></span><time datetime="${new Date().toISOString()}">${longDate.format(Date.now())}</time></div>
              <h1>メモ</h1></div>
            <div class="count-chip" id="count-chip">${icon("layers", 16)}<span>0 件</span></div>
          </div>
          <form class="composer glass" id="composer">
            <div class="composer-heading"><div class="square-icon mint">${icon("pen", 20)}</div><label for="capture">クイックメモ</label></div>
            <textarea id="capture" maxlength="2000" rows="3" placeholder="思いついたことを書く…" spellcheck="false"></textarea>
            <div class="composer-footer"><span class="draft-count"><span id="draft-count">0</span> / 2,000</span>
              <button type="submit" class="button primary" id="save-memo">${icon("plus", 18)} メモを保存</button></div>
          </form>
          <section class="memo-section" aria-labelledby="memo-heading">
            <div class="section-head"><h2 id="memo-heading">メモ一覧</h2>
              <button class="icon-button search-button" data-action="search" aria-label="メモを検索" aria-controls="search-bar" aria-expanded="false">${icon("search", 19)}</button></div>
            <div id="search-bar" class="search-bar glass" hidden>${icon("search", 18)}<input type="search" id="search" aria-label="メモを検索" placeholder="メモの内容で検索"></div>
            <div class="filters" id="filters" role="group" aria-label="メモのステータス"></div>
            <p class="mobile-gesture">右へ ネタ候補 <span>・</span> 左へ 保留</p>
            <div id="memo-list" class="memo-list"></div>
          </section>
        </div>
        <div class="page" id="generate-page" hidden></div>
        <div class="page" id="scripts-page" hidden></div>
      </main>
      <aside class="right-rail" aria-label="ネタ作成とフリック操作">
        <section class="rail-creation glass">
          <div class="rail-decoration" aria-hidden="true"><span>${icon("note", 24)}</span><span>${icon("mic", 25)}</span><span>${icon("spark", 23)}</span></div>
          <div class="square-icon mint">${icon("spark", 22)}</div>
          <h2>ネタ作成</h2>
          <p>メモを選んで、分析と台本生成へ。</p>
          <button class="button primary rail-button" data-nav="generate">メモを選ぶ ${icon("arrow", 17)}</button>
        </section>
        <section class="gesture-card glass">
          <h2>${icon("swipe", 18)} フリック操作</h2>
          <div><span class="gesture-badge mint">${icon("arrow", 16)}</span><span>右にフリック</span><strong>ネタ候補</strong></div>
          <div><span class="gesture-badge amber">${icon("left", 16)}</span><span>左にフリック</span><strong>保留</strong></div>
        </section>
      </aside>
    </div>
    <nav class="mobile-nav glass" aria-label="モバイルメニュー">${nav.map(item =>
      `<button data-nav="${item.id}">${icon(item.icon, 22)}<span>${item.name}</span></button>`).join("")}</nav>
    <dialog id="sheet" aria-labelledby="sheet-title"></dialog>
    <dialog id="loading" class="loading-dialog" aria-labelledby="loading-title"></dialog>
    <div class="toast" id="toast" role="status" hidden></div>
  `;
}
export function filters(active: Filter, all: MemoRecord[]) {
  return (["all", ...statuses] as const).map(value => `
    <button class="filter" data-filter="${value}" aria-pressed="${value === active}">
      ${value === "all" ? "" : `<i class="filter-dot ${value}"></i>`}${value === "all" ? "すべて" : statusLabels[value]}
      <span>${value === "all" ? all.length : all.filter(item => item.value.status === value).length}</span>
    </button>`).join("");
}
export function memoList(records: MemoRecord[], anyRecords: boolean, filter: Filter, searching: boolean) {
  if (!records.length) {
    return `<div class="empty glass">
      <div class="empty-icon">${icon(searching ? "search" : "note", 25)}</div>
      <h3>${searching ? "一致するメモがありません" : filter !== "all" ? `${statusLabels[filter]}のメモはありません` : "メモはまだありません"}</h3>
      ${!anyRecords && filter === "all" && !searching ? `<button class="button secondary sample-button" data-action="samples">${icon("plus", 15)} サンプルを追加</button>` : ""}
    </div>`;
  }
  return records.map(({ id, value }, index) => `<article class="swipe-card" data-swipe-id="${id}" style="--enter:${Math.min(index, 6) * 24}ms">
    <div class="swipe-side ready" aria-hidden="true">${icon("check", 20)} ネタ候補</div>
    <div class="swipe-side shelved" aria-hidden="true">保留 ${icon("box", 19)}</div>
    <div class="memo-card glass">
      <button class="memo-content" data-action="edit-memo" data-id="${id}">
        <span class="memo-heading"><strong>${escape(titleFor(value.text))}</strong></span>
        <span class="memo-meta">${statusPill(value.status)}<time datetime="${new Date(value.createdAt).toISOString()}">${dateLabel(value.createdAt)}</time></span>
      </button>
      <button class="icon-button memo-menu" data-action="memo-menu" data-id="${id}" aria-label="${escape(titleFor(value.text))}の操作">${icon("dots", 20)}</button>
    </div>
  </article>`).join("");
}
export function generatePage(items: MemoRecord[], selected: Set<string>, duration: Duration, style: Style, user: boolean, ai: boolean) {
  const ordered = [...items].sort((a, b) => Number(b.value.status === "ready") - Number(a.value.status === "ready"));
  return `
    <div class="page-heading"><div><div class="eyebrow">${icon("spark", 15)} ワークスペース</div><h1>ネタ作成</h1></div></div>
    <section class="glass setup-card" aria-labelledby="sources-title">
      <div class="setup-head"><div class="square-icon mint">${icon("layers")}</div><div><h2 id="sources-title">使うメモ</h2><p>台本の素材を最大${maxSelected}件選択</p></div>
        <span class="count-chip">${selected.size} / ${maxSelected}</span></div>
      <div class="picker">
        ${ordered.length ? ordered.map(({ id, value }) => `<label class="pick-row">
          <input type="checkbox" data-pick="${id}" ${selected.has(id) ? "checked" : ""} ${selected.size >= maxSelected && !selected.has(id) ? "disabled" : ""}>
          <span class="tick">${icon("check", 16)}</span>
          <span class="pick-text">${escape(titleFor(value.text))}</span>${statusPill(value.status)}
        </label>`).join("") : `<p class="no-sources">使えるメモがありません。</p><button class="button secondary" data-nav="memos">メモを書く ${icon("arrow", 16)}</button>`}
      </div>
    </section>
    <section class="glass setup-card" aria-labelledby="format-title">
      <div class="setup-head"><div class="square-icon neutral">${icon("mic")}</div><div><h2 id="format-title">台本の設定</h2></div></div>
      <fieldset><legend>長さの目安</legend><div class="segments">${durations.map(value => `<label><input type="radio" name="duration" value="${value}" ${duration === value ? "checked" : ""}><span>${value}分</span></label>`).join("")}</div></fieldset>
      <fieldset><legend>形式</legend><div class="segments">${styles.map(value => `<label><input type="radio" name="style" value="${value}" ${style === value ? "checked" : ""}><span>${value}</span></label>`).join("")}</div></fieldset>
    </section>
    <div class="generation-footer">
      <button class="button primary generate-button" data-action="generate" ${selected.size ? "" : "disabled"}>${icon("spark")} 分析して台本をつくる</button>
      <p>${user ? (ai ? "選んだメモを Workers AI に送信します。" : "Workers AI は現在利用できません。") : "台本生成には Google ログインが必要です。"}</p>
    </div>`;
}
export function scriptsPage(items: ScriptRecord[], open?: ScriptRecord) {
  if (!open) {
    return `<div class="page-heading"><div><div class="eyebrow">${icon("mic", 15)} ワークスペース</div><h1>台本</h1></div><div class="count-chip">${icon("layers", 16)} ${items.length} 件</div></div>
      ${items.length ? `<div class="memo-list">${items.map(({ id, value }) => `<button class="script-card glass" data-action="open-script" data-id="${id}">
        <span class="square-icon mint">${icon("mic", 20)}</span><span class="script-name"><strong>${escape(value.title)}</strong><small>${value.duration}分目安 ・ ${escape(value.style)} ・ ${dateLabel(value.createdAt)}</small></span>${icon("chevron", 17)}</button>`).join("")}</div>` :
        `<div class="empty glass"><div class="empty-icon">${icon("mic", 25)}</div><h3>台本はまだありません</h3><button class="button secondary" data-nav="generate">ネタを作成 ${icon("arrow", 16)}</button></div>`}`;
  }
  const { value, id } = open;
  return `<button class="button bare back-button" data-nav="scripts">${icon("left", 17)} 台本一覧</button>
    <div class="page-heading script-title"><div><div class="eyebrow">${icon("clock", 15)} ${value.duration}分目安 ・ ${escape(value.style)}</div><h1>${escape(value.title)}</h1></div></div>
    <div class="script-tools"><button class="button secondary" data-action="copy-script" data-id="${id}">${icon("copy", 17)} コピー</button>
      <button class="button secondary" data-action="edit-script" data-id="${id}">${icon("pen", 17)} 編集</button></div>
    <section class="glass setup-card analysis-card"><div class="setup-head"><div class="square-icon mint">${icon("spark")}</div><div><h2>メモの分析</h2></div></div>
      <dl><dt>題材</dt><dd>${escape(value.analysis.premise)}</dd><dt>笑いのズレ</dt><dd>${escape(value.analysis.contrast)}</dd><dt>オチ</dt><dd>${escape(value.analysis.punchline)}</dd></dl></section>
    <section class="glass setup-card dialogue"><div class="setup-head"><div class="square-icon neutral">${icon("mic")}</div><div><h2>台本</h2></div></div>
      <ol>${value.lines.map(line => `<li><span class="role ${line.role === "ボケ" ? "boke" : "tsukkomi"}">${line.role}</span><p>${escape(line.text)}</p></li>`).join("")}</ol></section>
    <details class="glass source-details"><summary>元のメモ（${value.sources.length}件）</summary>${value.sources.map(source => `<p>${escape(source.text)}</p>`).join("")}</details>
    <button class="button bare delete-script" data-action="delete-script" data-id="${id}">${icon("trash", 16)} 台本を削除</button>`;
}
export function generationSkeleton() {
  return `<div class="loading-wrap"><header><img src="/icon.svg" alt="" width="36" height="36"><strong>漫才ノート</strong></header>
    <div class="loading-content" aria-busy="true"><div class="square-icon mint loading-spark">${icon("spark", 25)}</div>
      <h2 id="loading-title" role="status">メモを分析して台本を作成中</h2><p>題材、笑いのズレ、オチを組み立てています。</p>
      <div class="skeleton-panel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="skeleton-panel second" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    </div><button class="button secondary" data-action="cancel-generate">キャンセル</button>
  </div>`;
}
