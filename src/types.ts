import { ApiRequestError } from "./selection-errors";
export type ReadingPolicyIdentity = { id: string; version: string; sha256: string };
export type Report = {
  figuresRevision?: string;
  pdfRevision?: string;
  requestedFormat?: ReadingFormat;
  interactiveGenerationError?: string;
  derivedFromReadingId?: string;
  markdown: string;
  mode: string;
  createdAt: string;
  coverage?: string;
  contextCharacters?: number;
  sourceCharacters?: number;
  stages?: { role: string; content: string }[];
  language?: string;
  source?: { kind?: string; agent?: string; model?: string; readingPolicy?: ReadingPolicyIdentity };
  /** Original article attribution, distinct from a derived interactive companion. */
  articleSource?: { kind?: string; agent?: string; model?: string };
};
export type Insight = {
  figuresRevision?: string;
  pdfRevision?: string;
  interactive?: InteractiveData;
  interactiveTranslationError?: string;
  figureCaptions?: Record<string, string>;
  captionTranslationError?: string;
  markdown: string;
  language: string;
  createdAt?: string;
  source?: { kind?: string; agent?: string; model?: string; readingPolicy?: ReadingPolicyIdentity };
  stale?: boolean;
};
export type Figure = {
  id: string;
  page: number;
  caption: string;
  label?: string;
  largeCrop?: boolean;
  source?: {kind?:string;method?:string;reviewed?:boolean;pdfRevision?:string;reviewedAt?:string};
  crop?: { x: number; y: number; width: number; height: number };
};
export type VisionSettings = {
  enabled: boolean;
  profileId?: string;
  model?: string;
};
export type RecommendationSettings = { enabled: boolean; profileId?: string; model?: string };
export type ModelCapability = "text" | "vision";
export type VisualEvidence = {
  /** Server-derived eligibility, evaluated before any CLI page filtering. */
  eligibleForContext?: boolean;
  pdfRevision?: string;
  sourceRevisionChanged?: boolean;
  id: string;
  excluded?: boolean;
  updatedAt?: string;
  figureId: string;
  page: number;
  crop: NonNullable<Figure["crop"]>;
  caption?: string;
  markdown: string;
  language: string;
  focus?: string;
  imageHash: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: string;
  source: { kind: "model"; model: string; profileId: string };
  pixelsProvided: true;
  analysisMethod: "vision-model";
  modelUnverified: true;
  stale?: boolean;
  binding: "client-rendered-pdf-crop";
  limitations: string[];
};
export type ReadingStyle = "quick" | "deep" | "critical";
export type ReadingVersion = Report & {
  /** Server token binding the original article and figure snapshot for derived interactive imports. */
  derivationRevision?: string;
  derivedSourceRevision?: string;
  agentTaskId?: string;
  format?: ReadingFormat;
  interactive?: InteractiveData;
  id: string;
  title?: string;
  style: ReadingStyle;
  focus?: string;
  figures?: Figure[];
  translations?: Record<string, Insight>;
};
export type Activity = {
  id: string;
  paperId?: string;
  agentTaskId?: string;
  sourceScope?: "pdf" | "source-text" | "reading" | "abstract";
  readingId?: string;
  kind: "translation" | "explanation";
  text?: string;
  quote?: string;
  result?: { text: string; source?: Record<string, string> };
  page?: number;
  pages?: number[];
  language?: string;
  createdAt: string;
  source?: Record<string, string>;
};
export type Conversation = {
  /** Client-only marker for an unsent tab-local draft. */
  draft?: boolean;
  id: string;
  title: string;
  messageCount: number;
  kind?: string;
  createdAt?: string;
  source?: {kind?:string;conversationId?:string;messageId?:string;action?:string};
};
export type Paper = {
  /** Opaque source-only identity for invalidating recommended questions. */
  recommendationSourceRevision?: string;
  pdfRevision?: string;
  id: string;
  title: string;
  authors: string[];
  institutions?: string[];
  abstract: string;
  text: string;
  url: string;
  pdfUrl?: string;
  localPdfUrl?: string;
  hasPdf?: boolean;
  metadataOnly?: boolean;
  abstractIsExcerpt?: boolean;
  ingestionWarnings?: string[];
  source: string;
  createdAt: string;
  publishedAt?: string;
  tags: string[];
  favorite: boolean;
  report?: Report;
  readingVersions?: ReadingVersion[];
  activeReadingId?: string;
  summaryHistory?: Insight[];
  reportHistory?: Report[];
  pageCount?: number;
  summary?: Insight;
  figures?: Figure[];
  visualEvidence?: VisualEvidence[];
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
  requestTimeoutSeconds?: number;
  activeProfileId?: string;
  profiles?: ModelProfile[];
  modelCapabilities?: Record<string, ModelCapability>;
  vision?: VisionSettings;
  recommendations?: RecommendationSettings;
};
export type ModelProfile = Omit<
  Settings,
  "profiles" | "activeProfileId" | "vision" | "recommendations"
> & {
  id: string;
  name: string;
  models: string[];
};
export type SourceScope = 'pdf' | 'source-text' | 'reading' | 'abstract';
export type QuestionMetadata = {page?:number;pages?:number[];quote?:string;sourceScope?:SourceScope;readingId?:string};
export type Message = { images?: {id:string;name?:string;url:string}[]; reasoning?: {round:number;text:string}[]; reasoningTruncated?:boolean; streaming?:boolean; streamStatus?:string; streamError?:string; id?: string; paperId?: string | null; conversationId?: string; agentTaskId?: string; mode?: string; source?: {agent?: string; [key:string]:unknown}; role: "user" | "assistant"; content: string; questionText?: string; metadata?: QuestionMetadata };
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
  if (!r.ok) throw new ApiRequestError(typeof data.error === "string" ? data.error : `请求失败 (${r.status})`, r.status, data.code);
  return data;
}

export type ReadingFormat = "article" | "interactive";
export type InteractiveCitation = { page?: number; label?: string };
export type InteractiveBlock =
  | {
      id: string;
      type: "concept";
      title: string;
      text: string;
      citations: InteractiveCitation[];
    }
  | {
      id: string;
      type: "figure";
      figureId: string;
      explanation: string;
      citations: InteractiveCitation[];
    }
  | {
      id: string;
      type: "question";
      question: string;
      answer: string;
      explanation?: string;
      citations: InteractiveCitation[];
    };
export type InteractiveData = { schemaVersion: 1; blocks: InteractiveBlock[] };
