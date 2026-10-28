import { presentChatMessage } from "./answer-presentation.mjs";

// A source budget is not a model token limit. Keep historical turns separately
// bounded so a long conversation cannot silently multiply the source allowance.
function clipped(text, limit) {
  if (text.length <= limit) return text;
  const marker = "\n[Earlier conversation message truncated; middle omitted.]\n";
  if (limit <= marker.length) return marker.slice(0, limit);
  const available = limit - marker.length;
  const head = Math.ceil(available / 2);
  const tail = available - head;
  return text.slice(0, head) + marker + (tail ? text.slice(-tail) : "");
}

function historicalMessage(message, currentVisualEvidenceIds) {
  message = presentChatMessage(message);
  if (message.role === 'assistant' && (message.source?.toolImageCount > 0 || message.source?.initialPageImageCount > 0))
    message = { ...message, historicalPixels: true };
  if (message.role !== "assistant" || !message.source || !Object.hasOwn(message.source, "visualEvidenceIds")) return message;
  const ids = message.source.visualEvidenceIds;
  if (!Array.isArray(ids) || ids.length > 32 || ids.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)))
    return { role: "assistant", content: "[Earlier assistant answer omitted: its visual-evidence provenance is invalid. The stored answer remains in history; do not reconstruct its claims.]", visualEvidenceWithdrawn: true };
  if (!ids.length) return message;
  if (ids.some(id => !currentVisualEvidenceIds.has(id)))
    return { role: "assistant", content: "[Earlier assistant answer omitted: visual evidence used by that answer is now excluded, stale, superseded or unavailable. The stored answer remains in history; do not reconstruct or rely on its claims.]", visualEvidenceWithdrawn: true };
  return {
    ...message,
    historicalVisualEvidenceIds: [...new Set(ids)],
  };
}

export function prepareConversationHistory(history = [], sourceBudget = 44000, { currentVisualEvidenceIds = new Set() } = {}) {
  const budget = Math.floor(sourceBudget / 2);
  const originalCount = Array.isArray(history) ? history.length : 0;
  const recent = (Array.isArray(history) ? history.slice(-48) : []).filter(message =>
    message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
    .map(message => historicalMessage(message, currentVisualEvidenceIds));
  const groups = [];
  for (let index = recent.length - 1; index >= 0; index--) {
    if (recent[index].role === "assistant" && index > 0 && recent[index - 1].role === "user")
      groups.push([recent[--index], recent[index + 1]]);
    else groups.push([recent[index]]);
  }
  const selected = [];
  let characters = 0;
  let truncatedMessages = 0;
  let withdrawnVisualMessages = 0;
  let historicalPixels = false;
  const visualEvidenceIds = new Set();
  for (const group of groups) {
    const remaining = budget - characters;
    const messageBudget = Math.max(8000, Math.floor(budget / 4));
    const lengths = group.map(message => Math.min(messageBudget, message.content.length));
    if (remaining <= 0 || (remaining < 160 * group.length && lengths.reduce((sum, length) => sum + length, 0) > remaining)) break;
    let allowance = remaining;
    // Allocate short questions first; a long answer cannot squeeze its paired
    // question out. When both are long, divide the remaining space fairly.
    const limits = new Array(group.length).fill(0);
    const ordered = lengths.map((length, index) => ({ length, index })).sort((a, b) => a.length - b.length);
    ordered.forEach((entry, index) => {
      limits[entry.index] = Math.min(entry.length, Math.floor(allowance / (ordered.length - index)));
      allowance -= limits[entry.index];
    });
    const messages = group.map((message, index) => {
      if (message.content.length > limits[index]) truncatedMessages++;
      if (message.visualEvidenceWithdrawn) withdrawnVisualMessages++;
      if (message.historicalPixels) historicalPixels = true;
      for (const id of message.historicalVisualEvidenceIds || []) visualEvidenceIds.add(id);
      return { role: message.role, content: clipped(message.content, limits[index]), ...(message.role==="user"&&message.images?.length?{images:message.images}:{}) };
    });
    selected.unshift(...messages);
    characters += messages.reduce((sum, message) => sum + message.content.length, 0);
    if (lengths.reduce((sum, length) => sum + length, 0) > remaining) break;
  }
  const omittedMessages = originalCount - selected.length;
  const incomplete = selected.some((message, index) => message.role === "assistant" && (index === 0 || selected[index - 1].role !== "user"));
  let notice = omittedMessages || truncatedMessages || incomplete
    ? `\n[Conversation history is incomplete: ${omittedMessages} older message(s) omitted, ${truncatedMessages} message(s) shortened.${incomplete ? " Some retained replies have no paired user message." : ""} Missing history is unavailable; do not reconstruct it or treat prior answers as source evidence.]`
    : "";
  if (historicalPixels || visualEvidenceIds.size) notice += "\nInternal history guidance; do not quote this guidance in your answer. Earlier assistant answers are unverified model interpretations, not original evidence or a new inspection of pixels. Earlier image pixels are not automatically replayed. Use the currently supplied images or view_pdf_page/view_figure to verify visual claims. When evidence is missing, explain the relevant limitation naturally in the user's language.";
  return { messages: selected, characters, budget, omittedMessages, truncatedMessages, incomplete, notice, withdrawnVisualMessages, visualEvidenceIds: [...visualEvidenceIds] };
}
