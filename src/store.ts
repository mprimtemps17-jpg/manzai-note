import { object, validRecord } from "./domain.ts";
import type { RecordItem } from "./domain.ts";

type Workspace = { records: RecordItem[]; pending: RecordItem[]; draft: string };
type ApiError = Error & { status: number };
const key = (owner: string) => "manzai-note:v1:" + owner;
const empty = (): Workspace => ({ records: [], pending: [], draft: "" });

function read(owner: string): Workspace {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(owner)) ?? "null");
    if (!object(value)) return empty();
    return {
      records: Array.isArray(value.records) ? value.records.filter(validRecord) : [],
      pending: Array.isArray(value.pending) ? value.pending.filter(validRecord) : [],
      draft: typeof value.draft === "string" ? value.draft : "",
    };
  } catch {
    return empty();
  }
}

export async function api<T>(path: string, data?: unknown, signal?: AbortSignal, owner?: string): Promise<T> {
  const timeout = AbortSignal.timeout(data && path === "/api/generate" ? 65_000 : 12_000);
  const headers = new Headers();
  if (data !== undefined) headers.set("Content-Type", "application/json");
  if (owner?.startsWith("user:")) headers.set("X-Workspace-Owner", owner.slice(5));
  const response = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const content: unknown = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(object(content) && typeof content.error === "string" ? content.error : "通信に失敗しました。"), { status: response.status }) as ApiError;
  }
  return content as T;
}
export const statusOf = (error: unknown): number | undefined =>
  object(error) && typeof error.status === "number" ? error.status : undefined;

function latest(records: RecordItem[]): RecordItem[] {
  const result = new Map<string, RecordItem>();
  for (const record of records) {
    const previous = result.get(record.id);
    if (!previous || previous.updatedAt < record.updatedAt ||
      (previous.updatedAt === record.updatedAt && previous.value !== null)) result.set(record.id, record);
  }
  return [...result.values()];
}

export class WorkspaceStore {
  owner = "guest";
  state = read(this.owner);
  onPersistenceFailure = () => {};
  onSync = (_state: "syncing" | "ok" | "offline" | "expired") => {};
  onChange = () => {};
  private active = new Set<string>();

  persist() {
    try {
      localStorage.setItem(key(this.owner), JSON.stringify(this.state));
      return true;
    } catch {
      this.onPersistenceFailure();
      return false;
    }
  }
  draft(text: string) {
    this.state.draft = text;
    this.persist();
  }
  setOwner(id: string | null) {
    const next = id ? "user:" + id : "guest";
    if (next === this.owner) return;
    const guest = this.owner === "guest" ? this.state : null;
    this.owner = next;
    this.state = read(next);
    if (guest && id && (guest.records.length || guest.draft)) {
      const accountIds = new Set(this.state.records.map(item => item.id));
      const imports = guest.records.filter(item => item.value && !accountIds.has(item.id));
      this.state.records = latest([...this.state.records, ...imports]);
      this.state.pending = latest([...this.state.pending, ...imports]);
      const guestDraft = guest.draft.trim();
      const merged = [guest.draft, this.state.draft].filter(Boolean).join("\n\n");
      if (merged.length <= 2000) this.state.draft = merged;
      else if (guestDraft) {
        const now = Date.now();
        const memo: RecordItem = { id: crypto.randomUUID(), kind: "memo", updatedAt: now,
          value: { text: guestDraft, status: "inbox", createdAt: now } };
        this.state.records.push(memo);
        this.state.pending.push(memo);
      }
      if (this.persist()) {
        try { localStorage.removeItem(key("guest")); } catch { /* account copy is already persisted */ }
      }
    }
    this.onChange();
  }
  change(records: RecordItem[]) {
    this.state.records = latest([...this.state.records, ...records])
      .filter(record => this.owner !== "guest" || record.value !== null);
    if (this.owner !== "guest") this.state.pending = latest([...this.state.pending, ...records]);
    this.persist();
    this.onChange();
    void this.sync();
  }
  async sync(): Promise<void> {
    const { owner, state } = this;
    if (owner === "guest" || this.active.has(owner)) return;
    this.active.add(owner);
    const current = () => this.owner === owner && this.state === state;
    let again = false;
    this.onSync("syncing");
    try {
      const remote: RecordItem[] = [];
      let page: number | null = 0;
      while (page !== null && current()) {
        const result: { records: RecordItem[]; nextPage: number | null } = await api("/api/records?page=" + page, undefined, undefined, owner);
        remote.push(...result.records);
        page = result.nextPage;
      }
      if (!current()) return;
      state.records = latest([...state.records, ...remote]);
      const accepted = new Map(state.records.map(record => [record.id, record]));
      state.pending = state.pending.filter(record => {
        const winner = accepted.get(record.id);
        return winner?.updatedAt === record.updatedAt && (winner.value !== null || record.value === null);
      });
      const snapshot = [...state.pending];
      for (let index = 0; index < snapshot.length && current(); index += 12) {
        const batch = snapshot.slice(index, index + 12);
        await api("/api/records", { records: batch }, undefined, owner);
        if (!current()) return;
        const sent = new Map(batch.map(record => [record.id, record.updatedAt]));
        state.pending = state.pending.filter(record => sent.get(record.id) !== record.updatedAt);
        this.persist();
      }
      if (!current()) return;
      this.persist();
      this.onChange();
      this.onSync("ok");
      again = !!state.pending.length;
    } catch (error) {
      if (current()) this.onSync(statusOf(error) === 401 ? "expired" : "offline");
    } finally {
      this.active.delete(owner);
      if (again && current()) void this.sync();
      else if (this.owner === owner && !current()) void this.sync();
    }
  }
}
