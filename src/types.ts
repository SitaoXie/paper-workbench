export type Report = {
  markdown: string;
  mode: string;
  createdAt: string;
  coverage?: string;
  contextCharacters?: number;
  sourceCharacters?: number;
  stages?: { role: string; content: string }[];
  language?: string;
  source?: { kind?: string; agent?: string; model?: string };
};
export type Insight = {
  markdown: string;
  language: string;
  createdAt?: string;
  source?: { kind?: string; agent?: string; model?: string };
  stale?: boolean;
};
export type Figure = {
  id: string;
  page: number;
  caption: string;
  crop?: { x: number; y: number; width: number; height: number };
};
export type Paper = {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  text: string;
  url: string;
  pdfUrl?: string;
  localPdfUrl?: string;
  hasPdf?: boolean;
  metadataOnly?: boolean;
  ingestionWarnings?: string[];
  source: string;
  createdAt: string;
  publishedAt?: string;
  tags: string[];
  favorite: boolean;
  report?: Report;
  pageCount?: number;
  summary?: Insight;
  figures?: Figure[];
  translations?: Record<
    string,
    Partial<Record<"abstract" | "report" | "summary", Insight>>
  >;
};
export type Settings = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  modelConfigured?: boolean;
  extraBody?: Record<string, unknown>;
  contextChars?: number;
  maxOutputTokens?: number;
  activeProfileId?: string;
  profiles?: ModelProfile[];
};
export type ModelProfile = Omit<Settings, "profiles" | "activeProfileId"> & {
  id: string;
  name: string;
  models: string[];
};
export type Message = { role: "user" | "assistant"; content: string };
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? init.headers
        : { "Content-Type": "application/json", ...init?.headers },
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error("服务暂时不可用，请确认本地服务已启动。");
  }
  if (!r.ok) throw new Error(data.error || `请求失败 (${r.status})`);
  return data;
}
