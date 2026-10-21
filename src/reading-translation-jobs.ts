import { useSyncExternalStore } from "react";
import type { Insight, ReadingVersion } from "./types";

type TranslationJob =
  | { source: string; status: "pending" }
  | { source: string; status: "success"; result: Insight; applied?: boolean }
  | { source: string; status: "error"; error: string };
const jobs = new Map<string, TranslationJob>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const keyFor = (paperId: string, versionId: string, language: string) => JSON.stringify([paperId, versionId, language]);
const emit = () => { for (const listener of listeners) listener(); };

/** Only session memory: navigation must not lose a paid request or its failure.
 * Results contain one translation, never a paper snapshot that could replace
 * later selections, notes, figures, or source versions. */
export function useReadingTranslationJob(paperId: string, versionId: string, language: string) {
  const key = keyFor(paperId, versionId, language);
  return useSyncExternalStore(subscribe, () => jobs.get(key), () => undefined);
}

export function translationSource(version: ReadingVersion) {
  return JSON.stringify([version.markdown, version.language, version.figures]);
}

export function markReadingTranslationApplied(paperId: string, versionId: string, language: string, job: TranslationJob) {
  const key = keyFor(paperId, versionId, language);
  if (jobs.get(key) === job && job.status === "success" && !job.applied) {
    jobs.set(key, { ...job, applied: true });
    emit();
  }
}

export function startReadingTranslation({ paperId, versionId, language, source, load }: {
  paperId: string;
  versionId: string;
  language: string;
  source: string;
  load: () => Promise<Insight>;
}) {
  const key = keyFor(paperId, versionId, language);
  // Synchronous registration also protects rapid clicks before React rerenders.
  if (jobs.get(key)?.status === "pending") return;
  const pending: TranslationJob = { source, status: "pending" };
  jobs.set(key, pending);
  emit();
  void Promise.resolve().then(load).then(result => {
    if (jobs.get(key) === pending) jobs.set(key, { source, status: "success", result });
  }, reason => {
    if (jobs.get(key) === pending) jobs.set(key, { source, status: "error", error: reason instanceof Error ? reason.message : String(reason) });
  }).finally(() => {
    // Bound completed session history without evicting a request in flight.
    if (jobs.size > 200) for (const [oldKey, job] of jobs) {
      if (jobs.size <= 200) break;
      if (oldKey !== key && job.status !== "pending") jobs.delete(oldKey);
    }
    emit();
  });
}
