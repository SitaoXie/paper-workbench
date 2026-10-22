/** Translate only conventional numbered prefixes. The original label and all
 * non-prefix text remain source data, never rewritten or used as a binding. */
export function displayCitationLabel(label: string | undefined, language: string): string {
  if (!label) return '';
  if (language.startsWith('en')) return label.replace(/^(图|表)\s*(\d+(?:[.-]\d+)*(?:[a-z])?)(?=$|[\s:：.、\-–—(（])/i, (_, kind, number) => `${kind === '图' ? 'Figure' : 'Table'} ${number}`);
  if (language.startsWith('zh')) return label.replace(/^(Figure|Fig\.?|Table)\s+(\d+(?:[.-]\d+)*(?:[a-z])?)(?=$|[\s:：.、\-–—(（])/i, (_, kind, number) => `${/^table$/i.test(kind) ? '表' : '图'}${number}`);
  return label;
}
