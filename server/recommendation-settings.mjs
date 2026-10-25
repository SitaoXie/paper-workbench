import { ApiError } from './network.mjs';

export function validateRecommendationSettings(input, current, profiles) {
  const prior = current || { enabled: false, profileId: '', model: '' };
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['enabled','profileId','model'].includes(key))))
    throw new ApiError('recommendations must contain only enabled, profileId and model.');
  const value = { ...prior, ...input };
  if (typeof value.enabled !== 'boolean' || typeof value.profileId !== 'string' || typeof value.model !== 'string' || value.profileId.length > 80 || value.model.length > 200)
    throw new ApiError('Invalid recommendation settings.');
  const profile = profiles.find(item => item.id === value.profileId);
  if (!profile?.models.includes(value.model)) {
    // Removing the selected connection/model disables this optional feature.
    if (input?.enabled === true) throw new ApiError('Select an existing connection and model for recommendations.');
    return { enabled: false, profileId: '', model: '' };
  }
  return { enabled: value.enabled, profileId: value.profileId, model: value.model };
}
