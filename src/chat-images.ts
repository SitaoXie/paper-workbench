export type DraftChatImage={id:string;name:string;mimeType:'image/png'|'image/jpeg';data:string};
export function clipboardImageFiles(data:DataTransfer):File[] {
 const files=Array.from(data.files||[]).filter(file=>file.type.startsWith('image/'));
 return files.length?files:Array.from(data.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);
}
export async function readChatImage(file:File):Promise<DraftChatImage> {
 if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('支持 PNG、JPEG、WebP、GIF 图片 / Supported images: PNG, JPEG, WebP, GIF.');
 if(file.size>20*1024*1024)throw Error('图片过大，请先缩小 / Image is too large; resize it first.');
 const bitmap=await createImageBitmap(file);
 try {
  const scale=Math.min(1,3000/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法读取图片 / Unable to read image.');
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  let uri=canvas.toDataURL('image/png');
  if(uri.length>4*1024*1024*4/3){ctx.globalCompositeOperation='destination-over';ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);uri=canvas.toDataURL('image/jpeg',.9);}
  if(uri.length>4*1024*1024*4/3)throw Error('图片仍超过 4 MiB，请缩小后再试 / Image exceeds 4 MiB; resize and retry.');
  return {id:crypto.randomUUID(),name:file.name||'Pasted image',mimeType:uri.startsWith('data:image/png')?'image/png':'image/jpeg',data:uri.split(',')[1]};
 } finally { bitmap.close(); }
}
