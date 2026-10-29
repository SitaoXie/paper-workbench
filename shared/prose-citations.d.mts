export type ProseCitation = {
  start: number;
  end: number;
  label: string;
  rawStart?: number;
  rawEnd?: number;
  sourceTarget?: "abstract" | "text";
  pages?: { page: number; lastPage?: number }[];
};
export function proseCitations(raw: string, decodedValue?: string, sourceSpans?: boolean): ProseCitation[];
