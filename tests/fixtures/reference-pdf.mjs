import {PDFDocument,PDFName,PDFString,StandardFonts} from 'pdf-lib';
export async function referencePdf(){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 const pages=Array.from({length:4},()=>pdf.addPage([600,800]));
 const line='Compare [13] with [7]. See section 3.2. Broken [99].';
 pages[0].drawText(line,{x:50,y:640,size:16,font});
 pages[1].drawText('13. Primary source at the destination.',{x:50,y:600,size:16,font});
 pages[1].drawText('Original evidence: the comparison retained uncertainty.',{x:50,y:570,size:14,font});
 pages[2].drawText('7. Independent source; different conditions.',{x:50,y:500,size:16,font});
 pages[3].drawText('3.2 Methods and limits',{x:50,y:550,size:16,font});
 const annotations=[];
 for(const [text,dest] of [['13','cite.primary'],['7','cite.independent'],['3.2','section.methods'],['99','cite.missing']]){
  const x=50+font.widthOfTextAtSize(line.slice(0,line.indexOf(text)),16),w=font.widthOfTextAtSize(text,16);
  annotations.push(pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,636,x+w,658],Border:[0,0,0],Dest:PDFString.of(dest)})));
 }
 pages[0].node.set(PDFName.of('Annots'),pdf.context.obj(annotations));
 const names=pdf.context.obj({Names:[PDFString.of('cite.independent'),[pages[2].ref,PDFName.of('XYZ'),50,510,null],PDFString.of('cite.primary'),[pages[1].ref,PDFName.of('XYZ'),50,610,null],PDFString.of('section.methods'),[pages[3].ref,PDFName.of('XYZ'),50,560,null]]});
 pdf.catalog.set(PDFName.of('Names'),pdf.context.obj({Dests:pdf.context.register(names)}));
 return Buffer.from(await pdf.save());
}
