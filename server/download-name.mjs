/** A readable portable filename; never interpolate it unescaped into a header. */
export function annotatedPdfFilename(title) {
  let stem = typeof title === 'string' ? title.toWellFormed().normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '') : '';
  const characters = Array.from(stem).slice(0, 100);
  // Common filesystems cap names in bytes, so 100 Chinese/emoji characters
  // can still exceed the limit even though the code-point count looks short.
  while (Buffer.byteLength(characters.join(''), 'utf8') > 200) characters.pop();
  stem = characters.join('').replace(/[. ]+$/g, '');
  if (!stem || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem)) stem = 'paper';
  return `${stem}-annotated.pdf`;
}
export function annotatedPdfDisposition(title) {
  const encoded = encodeURIComponent(annotatedPdfFilename(title)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="paper-annotated.pdf"; filename*=UTF-8''${encoded}`;
}
