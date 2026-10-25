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
