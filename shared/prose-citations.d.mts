export type ProseCitation = {
  start: number;
  end: number;
  label: string;
  sourceTarget?: "abstract" | "text";
  pages?: { page: number; lastPage?: number }[];
};
export function proseCitations(raw: string, decodedValue?: string): ProseCitation[];
