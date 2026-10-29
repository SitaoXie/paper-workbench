import {normalizeWithOffsets} from '../shared/pdf-text.mjs';
import { ApiError } from './network.mjs';

export function metadataNames(values) {
  const seen = new Set();
  return values.filter(value => typeof value === 'string').map(value => value.replace(/\s+/g, ' ').trim())
    .filter(value => {
      const key = value.normalize('NFKC').toLowerCase();
      if (!value || value.length > 300 || seen.has(key)) return false;
      seen.add(key); return true;
    });
}

export function validatePaperMetadata(body) {
  const update = {};
  for (const [field, limit] of [['authors', 1000], ['institutions', 200]]) {
    if (!(field in body)) continue;
    const values = body[field];
    if (!Array.isArray(values) || values.length > limit || values.some(value => typeof value !== 'string' ||
      !value.trim() || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value)))
      throw new ApiError(`${field} must contain up to ${limit} non-empty single-line names, each up to 300 characters.`);
    update[field] = metadataNames(values);
  }
  return update;
}

export function authorsFromPdfInfo(author,source){
 if(typeof author!=='string'||!author.trim())return [];
 let parts=author.split(/\s*(?:;|\||\band\b)\s*/i);
 if(parts.length===1&&author.includes(',')){
  const comma=author.split(',').map(value=>value.trim());
  if(comma.every(value=>/\S+\s+\S+/.test(value)))parts=comma;else return [];
 }
 const header=source.split(/\babstract\b|摘\s*要/i)[0].slice(0,8000);
 const compact=value=>normalizeWithOffsets(String(value||'')).text.replace(/\s/g,'');
 return metadataNames(parts).filter(name=>name.length<=120&&/\p{L}+\s+\p{L}+|^[\p{Script=Han}]{2,6}$/u.test(name)&&!/university|research|institute|corporation|\binc\b/i.test(name)&&!/@|anonymous|unknown|microsoft word|adobe|latex/i.test(name)&&/\p{L}/u.test(name)&&compact(header).includes(compact(name)));
}
