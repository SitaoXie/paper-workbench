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
