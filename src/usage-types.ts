export type Field = 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedInputTokens' | 'cacheWriteTokens' | 'reasoningTokens';
export type Totals = Record<Field, number | null>;
export type Summary = { requests: number; failed: number; unknownUsage: number; totals: Totals; reported: Record<Field, number> };
export type Model = { key: string; provider: string; model: string; profileName: string };
export type Group = Summary & { key: string };
export type Entry = Totals & { id: string; startedAt: string; model: string; profileName: string; provider: string; operation: string; stage?: string; status: string };
export type Usage = Summary & {
  trackingSince: string; generatedAt: string; timeZone: string; from: string | null; to: string;
  models: Model[]; byModel: (Model & Summary)[]; byOperation: Group[]; daily: Group[];
  byProfile?: (Summary & {key:string;profileId:string;profileName:string;provider:string})[];
  cache?: {requests:number;inputTokens:number|null;cachedInputTokens:number|null;rate:number|null};
  recent: Entry[]; offset: number; hasMore: boolean;
  storage: { unreadableRecords: number; unsavedRecords: number; readError: boolean };
};

