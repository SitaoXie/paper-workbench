/** A small legal PDF with named destinations, nested outlines and printed labels. */
export const longOutlineTitle = 'Methods: controlled evidence, comparison groups, uncertainty estimates, implementation details, replication protocol, and the complete experimental design without truncating the section title';
export function outlinePdf({ outline = true, title = 'Introduction', firstPageText = 'Introduction to evidence' } = {}) {
  const literal = value => '(' + value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)') + ')';
  const stream = value => `<< /Length ${Buffer.byteLength(value)} >>\nstream\n${value}\nendstream`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${outline ? '/Outlines 10 0 R /PageMode /UseOutlines' : ''} /PageLabels 15 0 R /Names 16 0 R >>`,
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 9 0 R >> >> /Contents 4 0 R >>',
    stream(`BT /F1 24 Tf 50 730 Td ${literal(firstPageText)} Tj ET`),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>',
    stream('BT /F1 24 Tf 50 730 Td (Method page) Tj 0 -230 Td (Named method destination) Tj 0 -200 Td (Controlled evidence subsection) Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>',
    stream('BT /F1 24 Tf 50 600 Td (Results and limitations) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Outlines /First 11 0 R /Last 13 0 R /Count 4 >>',
    `<< /Title ${literal(title)} /Parent 10 0 R /Next 12 0 R /Dest [3 0 R /XYZ 50 730 null] >>`,
    `<< /Title ${literal(longOutlineTitle)} /Parent 10 0 R /Prev 11 0 R /Next 13 0 R /First 14 0 R /Last 14 0 R /Count 1 /Dest (methods) >>`,
    '<< /Title (Results) /Parent 10 0 R /Prev 12 0 R /Dest [7 0 R /FitH 600] >>',
    '<< /Title (Controlled evidence subsection) /Parent 12 0 R /Dest [5 0 R /XYZ 50 300 null] >>',
    '<< /Nums [0 << /S /r >> 1 << /S /D /St 1 >>] >>',
    '<< /Dests 17 0 R >>',
    '<< /Names [(methods) [5 0 R /XYZ 50 500 null]] >>',
  ];
  let pdf = '%PDF-1.7\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const start=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  pdf+=offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
