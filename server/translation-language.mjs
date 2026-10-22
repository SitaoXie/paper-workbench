/** Conservative en/zh prose mismatch check, not general language identification. */
export function substantialLanguageMismatch(value, language, original) {
  const target = String(language || "").toLowerCase().split("-")[0];
  // Technical identifiers, formulas, code and short source quotations can
  // legitimately remain unchanged. Do not classify those alone as prose.
  const prose = value.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|`[^`]*`/g, " ");
  const han = (prose.match(/\p{Script=Han}/gu) || []).length;
  const latin = (prose.match(/[A-Za-z]/g) || []).length;
  const words = (prose.match(/[A-Za-z]{2,}(?:[-'][A-Za-z]+)*/g) || []).length;
  const unchanged = value === original;
  if (target === "en") return han >= (unchanged ? 8 : 20) && han > latin * .5;
  if (target === "zh") return words >= (unchanged ? 10 : 25) && han < words * .4;
  return false;
}
