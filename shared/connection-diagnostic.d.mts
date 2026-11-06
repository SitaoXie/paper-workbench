export type ConnectionDiagnostic = { code: string; status?: number; title: string; steps: string[] };
export function connectionDiagnostic(error: unknown, locale?: string): ConnectionDiagnostic;
