/** Only local, positive PDF page fragments are executable reading navigation.
 * The model-provided quote is untrusted until it matches source PDF text. */
export function paperCitation(href: string | undefined, title?: string | null): {page:number;quote?:string} | undefined {
  const match = /^#page=([1-9]\d{0,5})$/.exec(href || '');
  if (!match) return;
  const quote = typeof title === 'string' ? title.trim() : '';
  return {page:Number(match[1]), ...(quote && quote.length <= 500 ? {quote} : {})};
}
