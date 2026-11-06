/** Keep old records readable without promoting an absent model result to a note. */
export function activityResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'text' in result && typeof result.text === 'string') return result.text;
  return '';
}
export function usableActivityResult(result: unknown): boolean {
  const text = activityResultText(result).trim().replace(/^```(?:json|text)?\s*/i, '').replace(/\s*```$/, '').trim();
  return !!text && !/^(?:null|undefined|"null"|'null'|`null`)$/i.test(text);
}

/** Reuse an automatically saved single-page result without losing its geometry.
 * A different source, kind, language or body remains a separate annotation. */
export function matchingActivityAnnotation(
  activity: {kind:string;page?:number;pages?:number[];sourceScope?:string;quote?:string;text?:string;result?:unknown;language?:string},
  annotations: {kind:string;page:number;quote?:string;body?:string;language?:string;segments?:unknown[]}[],
): boolean {
  if (!activity.page || (activity.pages?.length || 0)>1 || (activity.sourceScope && activity.sourceScope!=='pdf') || !usableActivityResult(activity.result)) return false;
  const quote=(activity.quote || activity.text || '').trim(),body=activityResultText(activity.result).trim();
  return !!quote && annotations.some(note=>note.kind===activity.kind && note.page===activity.page && (note.segments?.length||0)<=1 &&
    (note.quote||'').trim()===quote && (note.body||'').trim()===body && (!activity.language||!note.language||activity.language===note.language));
}
