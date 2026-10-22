/** Compact page ranges without inventing intervening source pages. */
export function pageLabel(page?: number, pages?: number[]) {
  const values = [...new Set(pages?.length ? pages : page ? [page] : [])].filter(value => Number.isSafeInteger(value) && value > 0).sort((a,b)=>a-b);
  const ranges: string[] = [];
  for (let index=0;index<values.length;index++) { const start=values[index];let end=start;while(values[index+1]===end+1)end=values[++index];ranges.push(start===end?`${start}`:`${start}–${end}`); }
  return values.length ? `p.${ranges.join(', ')}` : '';
}
