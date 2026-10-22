/** Original synthetic source: a nested Form in a translated transparency group. */
export function figureGroupPdf({userUnit=1,rotation=0}={}) {
  const stream=(dictionary,contents)=>`<< ${dictionary} /Length ${Buffer.byteLength(contents)} >>\nstream\n${contents}\nendstream`;
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /UserUnit ${userUnit} /Rotate ${rotation} /Resources << /Font << /F1 5 0 R >> /XObject << /Outer 6 0 R >> >> /Contents 4 0 R >>`,
    stream('','/Outer Do BT /F1 8 Tf 20 45 Td (Figure 1: A translated group.) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('/Type /XObject /Subtype /Form /BBox [0 0 80 60] /Matrix [1 0 0 1 40 60] /Group << /S /Transparency /I false /K false >> /Resources << /XObject << /Inner 7 0 R >> >>','/Inner Do'),
    stream('/Type /XObject /Subtype /Form /BBox [0 0 80 60] /Resources << >>','0.2 0.5 0.8 rg 0 0 80 60 re f'),
  ];
  let pdf='%PDF-1.7\n';const offsets=[0];
  for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const start=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  pdf+=offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
