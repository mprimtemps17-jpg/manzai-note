export const statuses = ["inbox", "ready", "shelved"] as const;
export type Status = typeof statuses[number];
export const statusLabels: Record<Status, string> = { inbox: "未整理", ready: "ネタ候補", shelved: "保留" };
export const styles = ["しゃべくり", "コント漫才", "どちらでも"] as const;
export type Style = typeof styles[number];
export const durations = [1, 2, 3] as const;
export type Duration = typeof durations[number];
export const maxMemoLength = 2000;
export const maxSelected = 8;

export interface Memo {
  text: string;
  status: Status;
  createdAt: number;
}
export interface Analysis {
  premise: string;
  contrast: string;
  punchline: string;
}
export interface Line {
  role: "ボケ" | "ツッコミ";
  text: string;
}
export interface Source {
  id: string;
  text: string;
}
export interface Script {
  title: string;
  analysis: Analysis;
  lines: Line[];
  sources: Source[];
  duration: Duration;
  style: Style;
  createdAt: number;
}
export interface RecordItem {
  id: string;
  kind: "memo" | "script";
  value: Memo | Script | null;
  updatedAt: number;
}
export interface User {
  id: string;
  name: string;
}
export interface Session {
  user: User | null;
  loginConfigured: boolean;
  aiConfigured: boolean;
}

export const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const words = (value: unknown, max: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const date = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
export const validSource = (value: unknown): value is Source =>
  object(value) && validId(value.id) && words(value.text, maxMemoLength);
export const validDuration = (value: unknown): value is Duration =>
  durations.some(duration => duration === value);
export const validStyle = (value: unknown): value is Style => styles.some(style => style === value);
export function validOutput(value: unknown): value is Pick<Script, "title" | "analysis" | "lines"> {
  if (!object(value) || !words(value.title, 120) || !object(value.analysis)) return false;
  const { premise, contrast, punchline } = value.analysis;
  return words(premise, 800) && words(contrast, 800) && words(punchline, 800) &&
    Array.isArray(value.lines) && value.lines.length >= 4 && value.lines.length <= 80 &&
    value.lines.every(line => object(line) && (line.role === "ボケ" || line.role === "ツッコミ") && words(line.text, 500)) &&
    value.lines.some(line => line.role === "ボケ") && value.lines.some(line => line.role === "ツッコミ");
}
export function validRecord(value: unknown): value is RecordItem {
  if (!object(value) || !validId(value.id) || !date(value.updatedAt) ||
      (value.kind !== "memo" && value.kind !== "script")) return false;
  const data = value.value;
  if (data === null) return true;
  if (!object(data) || !date(data.createdAt)) return false;
  if (value.kind === "memo") return words(data.text, maxMemoLength) && statuses.some(status => status === data.status);
  return validDuration(data.duration) && validStyle(data.style) && Array.isArray(data.sources) &&
    data.sources.length > 0 && data.sources.length <= maxSelected && data.sources.every(validSource) &&
    validOutput(data);
}
