// A legacy internal history annotation was accidentally placed in assistant
// prose. Match only that exact reserved prefix, never arbitrary caveats/quotes.
export const legacyVisualHistoryPrefix = "[Earlier model interpretation of PDF images, not original evidence. Those earlier image pixels are not automatically replayed in this turn. Use the currently supplied page images or view_pdf_page/view_figure again to verify visual claims.]";

export function cleanAssistantContent(content) {
  let rest = content;
  while (rest.trimStart().startsWith(legacyVisualHistoryPrefix))
    rest = rest.trimStart().slice(legacyVisualHistoryPrefix.length).trimStart();
  return rest;
}

export function presentChatMessage(message) {
  return message.role === 'assistant' && typeof message.content === 'string'
    ? { ...message, content: cleanAssistantContent(message.content) } : message;
}

// Hold only a possible leading annotation, so a split SSE chunk cannot flash
// internal text. Once normal prose starts, all subsequent content is untouched.
export function createAnswerEventFilter(emit) {
  let pending = '', open = true, stripped = false, template;
  const flush = () => {
    if (pending) emit({ ...template, delta: pending });
    pending = '';
  };
  return {
    push(event) {
      if (event.type === 'round') {
        flush(); open = true; stripped = false; template = undefined;
        emit(event); return;
      }
      if (event.type !== 'text' || !open) { emit(event); return; }
      template = event;
      const incoming = pending + (event.delta || '');
      pending = cleanAssistantContent(incoming);
      stripped ||= pending !== incoming;
      if (stripped) pending = pending.trimStart();
      if (legacyVisualHistoryPrefix.startsWith(pending.trimStart())) return;
      open = false; flush();
    },
    finish: flush,
  };
}
