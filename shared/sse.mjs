/** Bounded SSE decoder: handles UTF-8 splits, CRLF, comments and multiline data. */
export async function* readSse(body, onActivity) {
  if (!body) throw new Error('Missing event stream.');
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', event = '', data = [], size = 0;
  const consume = line => {
    if (!line) { const value = data.length ? { event: event || 'message', data: data.join('\n') } : null; event = ''; data = []; size = 0; return value; }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':'), field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1); if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    if (field === 'data') { size += value.length; if (size > 4_000_000) throw new Error('Event too large.'); data.push(value); }
    return null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read(); if(value?.byteLength)onActivity?.(); buffer += decoder.decode(value, { stream: !done });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1); const item = consume(line); if (item) yield item; }
      if (buffer.length > 4_000_000) throw new Error('Event too large.');
      if (done) break;
    }
    if (buffer) consume(buffer.replace(/\r$/, ''));
    const last = consume(''); if (last) yield last;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
