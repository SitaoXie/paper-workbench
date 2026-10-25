import type { Paper, Settings } from './types';

export type PaperRecommendation = {
  id: string;
  questions: { id: string; question: string; angle: string }[];
  language: string;
  createdAt: string;
  source: { kind: 'model'; model: string; profileId: string };
  coverage: string;
  contextCharacters: number;
};
export type RecommendationResponse = { enabled: boolean; recommendation: PaperRecommendation | null; cached: boolean };
export type RecommendationRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

// Include the dedicated connection's public configuration, never the active chat
// model. Switching the latter must not start another recommendation generation.
export function recommendationConfiguration(settings: Settings) {
  const value = settings.recommendations;
  const profile = settings.profiles?.find(profile => profile.id === value?.profileId);
  return JSON.stringify([!!value?.enabled, value?.profileId || '', value?.model || '', profile?.provider,
    profile?.baseUrl, profile?.apiKeyConfigured, profile?.contextChars, profile?.maxOutputTokens,
    profile?.requestTimeoutSeconds, profile?.extraBody]);
}

export function paperRecommendationIdentity(paper: Paper, language: string, settings: Settings) {
  return JSON.stringify([paper.id, paper.pdfRevision, paper.recommendationSourceRevision,
    language, recommendationConfiguration(settings)]);
}

/** A manual refresh is a one-shot action, not a persistent preference. */
export function consumeRecommendationRefresh(attempt: { sequence: number; identity: string; refresh: boolean }, identity: string, consumed: { current: number }) {
  const refresh = attempt.sequence > consumed.current && attempt.identity === identity && attempt.refresh;
  consumed.current = attempt.sequence;
  return refresh;
}

export async function loadPaperRecommendations(request: RecommendationRequest, {
  paperId, language, enabled, refresh = false, signal,
}: { paperId: string; language: string; enabled: boolean; refresh?: boolean; signal: AbortSignal }): Promise<RecommendationResponse> {
  if (!enabled || signal.aborted) return { enabled: false, recommendation: null, cached: false };
  const path = `/papers/${encodeURIComponent(paperId)}/recommendations`;
  if (!refresh) {
    const saved = await request<RecommendationResponse>(`${path}?language=${encodeURIComponent(language)}`, { signal });
    if (signal.aborted || !saved.enabled || saved.recommendation) return saved;
  }
  if (signal.aborted) return { enabled: false, recommendation: null, cached: false };
  return request<RecommendationResponse>(path, { method: 'POST', signal, body: JSON.stringify({ language, refresh }) });
}
