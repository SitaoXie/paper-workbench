import { ApiError } from "./network.mjs";

export function validateAgentTaskId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new ApiError("agentTaskId must be a UUID.");
  return value.toLowerCase();
}

function binding(activity) {
  return JSON.stringify({
    paperId: activity.paperId,
    sourceScope: activity.sourceScope,
    readingId: activity.readingId ?? null,
    page: activity.page ?? null,
    pages: activity.sourceScope === "pdf" ? activity.pages ?? [activity.page] : [],
    text: activity.text,
    kind: activity.kind,
    language: activity.language,
  });
}

// Validation and insertion run synchronously before the route's first await.
// UUID reuse never changes the stored result, its provenance or its timestamp.
export function existingTaskActivity(activities, candidate) {
  if (!candidate.agentTaskId) return undefined;
  const existing = activities.find(item => item.agentTaskId === candidate.agentTaskId);
  if (!existing) return undefined;
  if (binding(existing) !== binding(candidate))
    throw new ApiError("This agent task is already bound to a different source selection or operation.", 409);
  if (existing.result?.text !== candidate.result.text)
    throw new ApiError("This agent task already has a different result. The saved result was preserved; use a new task for a revision.", 409);
  return existing;
}
