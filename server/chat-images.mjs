import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ApiError} from './network.mjs';
import {validateRasterImage} from './vision.mjs';
export function validateChatImages(input=[]) {
 if(!Array.isArray(input)||input.length>4)throw new ApiError('最多附加 4 张图片 / Attach up to 4 images.');
 let bytes=0;
 const images=input.map(item=>{
  const image=validateRasterImage(item);bytes+=image.buffer.length;
  return {...image.image,width:image.width,height:image.height,name:typeof item.name==='string'?item.name.replace(/[\u0000-\u001f]/g,'').slice(0,160):'Image'};
 });
 if(bytes>4*1024*1024)throw new ApiError('图片总大小不能超过 4 MiB / Images must total at most 4 MiB.',413);
 return images;
}
export function chatImagePath(directory,image) {
 if(!/^[a-f0-9]{64}$/.test(image.id)||!['image/png','image/jpeg'].includes(image.mimeType))throw new ApiError('Invalid image reference.');
 return path.join(directory,'chat-images',image.id+(image.mimeType==='image/png'?'.png':'.jpg'));
}
export async function saveChatImages(directory,images) {
 if(!images.length)return [];
 await mkdir(path.join(directory,'chat-images'),{recursive:true,mode:0o700});
 return Promise.all(images.map(async image=>{
  const buffer=Buffer.from(image.data,'base64'),id=createHash('sha256').update(buffer).digest('hex');
  const ref={id,mimeType:image.mimeType,name:image.name,width:image.width,height:image.height,url:`/api/chat-images/${id}`};
  await writeFile(chatImagePath(directory,ref),buffer,{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  return ref;
 }));
}
export async function hydrateChatImages(directory,messages,vision) {
 // Only saved messages call this helper. Request-supplied history is text-only.
 return Promise.all(messages.map(async (message,index)=>{
  if(index<messages.length-12)return {...message,images:undefined};
  if(message.role!=='user'||!message.images?.length)return message;
  const images=[];
  if(vision)for(const ref of message.images.slice(0,4)){
   try {const data=(await readFile(chatImagePath(directory,ref))).toString('base64');images.push(...validateChatImages([{...ref,data}]));}catch{}
  }
  return {...message,images,content:message.content+(images.length<message.images.length?'\n[Earlier image attachment pixels are unavailable; do not claim to inspect those images.]':'')};
 }));
}
