import { randomUUID } from "node:crypto";
import { ApiError } from "./network.mjs";
import { readingState, readingDerivationRevision, readingDerivationSource } from "./reading.mjs";
import { validateAgentSource, validateMarkdown } from "./insights.mjs";
import { validateInteractive } from "./interactive.mjs";
import { validateAgentTaskId } from "./activity-task.mjs";

function object(value, allowed, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new ApiError(`${name} must be an object.`);
  if (Object.keys(value).some(key => !allowed.includes(key)))
    throw new ApiError(`${name} contains unsupported fields. This operation only derives interactive blocks from a fixed reading.`);
}

/** Validate fully before mutation; the route inserts synchronously before its first await. */
export function prepareDerivedInteractive(body, paper) {
  object(body, ["source", "derivedInteractive"], "Derived interactive import");
  const source = validateAgentSource(body.source);
  const request = body.derivedInteractive;
  object(request, ["sourceReadingId", "expectedSourceRevision", "agentTaskId", "interactive"], "derivedInteractive");
  if (typeof request.sourceReadingId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(request.sourceReadingId))
    throw new ApiError("sourceReadingId must identify a fixed original reading version.");
  if (typeof request.expectedSourceRevision !== "string" || !/^[a-f0-9]{64}$/.test(request.expectedSourceRevision))
    throw new ApiError("expectedSourceRevision must be the saved reading's derivationRevision.");
  const agentTaskId = validateAgentTaskId(request.agentTaskId);
  const state = readingState(paper);
  const original = state.readingVersions.find(version => version.id === request.sourceReadingId);
  if (!original) throw new ApiError("Source reading version not found in this paper.", 404);
  if (readingDerivationRevision(paper, original) !== request.expectedSourceRevision)
    throw new ApiError("The source reading or its evidence binding changed. Review the current fixed version before creating a new task.", 409);
  const snapshot = readingDerivationSource(paper, original);
  validateMarkdown(snapshot.markdown, "Original reading markdown");
  const interactive = validateInteractive(request.interactive, {pageCount: paper.pages?.length, figures: snapshot.figures});
  const previous = state.readingVersions.find(version => version.agentTaskId === agentTaskId);
  if (previous) {
    if (previous.derivedFromReadingId !== original.id || previous.derivedSourceRevision !== request.expectedSourceRevision || JSON.stringify(previous.interactive) !== JSON.stringify(interactive))
      throw new ApiError("This interactive task already has a different source or result. The saved version was preserved; use a new task for an intentional revision.", 409);
    return { readingVersion: previous, reused: true };
  }
  const id = randomUUID();
  return { reused: false, readingVersion: {
    ...snapshot, id, readingId: id, format: "interactive", interactive,
    mode: "agent-interactive", createdAt: new Date().toISOString(), stages: [], source,
    ...(original.articleSource || original.source ? { articleSource: structuredClone(original.articleSource || original.source) } : {}),
    derivedFromReadingId: original.id, derivedSourceRevision: request.expectedSourceRevision,
    agentTaskId, translations: {},
  } };
}
