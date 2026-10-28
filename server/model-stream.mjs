import { readSse } from '../shared/sse.mjs';
import { ApiError } from './network.mjs';

/** Reconstruct the native turn for tool continuation; expose only explicit display text. */
export async function readModelStream(response, anthropic, emit, recordUsage, onActivity) {
  const message = { role: 'assistant', content: '' }, blocks = [], calls = [];
  let usage = {}, stop, complete = false, characters = 0, received = 0;
  const delta = (type, value) => {
    if (typeof value !== 'string' || !value) return;
    characters += value.length; if (characters > 2_000_000) throw new ApiError('Model stream exceeded the response size limit.', 502);
    emit({ type, delta: value });
  };
  try {
    for await (const frame of readSse(response.body, onActivity)) {
      received += frame.data.length;
      if (received > 16_000_000) throw new ApiError('Model stream exceeded the response size limit.', 502);
      if (frame.data === '[DONE]') { complete = true; break; }
      let data; try { data = JSON.parse(frame.data); } catch { throw new ApiError('Invalid model stream event.', 502); }
      if (data.error || data.type === 'error') throw new ApiError('The model stream reported an error. No incomplete answer was saved.', 502);
      if (anthropic) {
        if (data.type === 'message_start') { usage = { ...data.message?.usage }; recordUsage(usage); }
        if (data.type === 'content_block_start') {
          const block = { ...data.content_block }; blocks[data.index] = block;
          if (block.type === 'text') delta('text', block.text);
          if (block.type === 'thinking') delta('reasoning', block.thinking);
        }
        if (data.type === 'content_block_delta') {
          const block = blocks[data.index], d = data.delta;
          if (!block || !d) throw new ApiError('Invalid model stream block.', 502);
          if (d.type === 'text_delta') { block.text = (block.text || '') + d.text; delta('text', d.text); }
          if (d.type === 'thinking_delta') { block.thinking = (block.thinking || '') + d.thinking; delta('reasoning', d.thinking); }
          if (d.type === 'signature_delta') block.signature = (block.signature || '') + d.signature;
          if (d.type === 'input_json_delta') block.partialJson = (block.partialJson || '') + d.partial_json;
        }
        if (data.type === 'message_delta') { stop = data.delta?.stop_reason; usage = { ...usage, ...data.usage }; recordUsage(usage); }
        if (data.type === 'message_stop') { complete = true; break; }
      } else {
        if (data.usage) { usage = data.usage; recordUsage(usage); }
        const choice = data.choices?.find(c => c.index === 0 || c.index === undefined); if (!choice) continue;
        const d = choice.delta || {};
        if (typeof d.content === 'string') { message.content += d.content; delta('text', d.content); }
        for (const field of ['reasoning_content', 'reasoning']) if (typeof d[field] === 'string') { message[field] = (message[field] || '') + d[field]; delta('reasoning', d[field]); }
        // Opaque provider fields may be required on the next tool round, but are never UI text.
        if (Array.isArray(d.reasoning_details)) message.reasoning_details = [...(message.reasoning_details || []), ...d.reasoning_details];
        if (typeof d.encrypted_content === 'string') message.encrypted_content = (message.encrypted_content || '') + d.encrypted_content;
        if (d.extra_content && typeof d.extra_content === 'object') message.extra_content = { ...message.extra_content, ...d.extra_content };
        for (const part of d.tool_calls || []) {
          if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 16) throw new ApiError('Invalid streamed tool index.', 502);
          const call = calls[part.index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (part.id) call.id += part.id;
          if (part.extra_content && typeof part.extra_content === 'object') call.extra_content = { ...call.extra_content, ...part.extra_content };
          if (typeof part.thought_signature === 'string') call.thought_signature = part.thought_signature;
          if (part.function?.name) call.function.name += part.function.name;
          if (part.function?.arguments) call.function.arguments += part.function.arguments;
          if (call.function.arguments.length > 100000) throw new ApiError('Streamed tool arguments too large.', 502);
        }
        if (choice.finish_reason) stop = choice.finish_reason;
      }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('The model stream was interrupted. Retry the question; no incomplete answer was saved.', 502);
  }
  if (!complete || !stop) throw new ApiError('The model stream ended before completion. No incomplete answer was saved.', 502);
  if (anthropic) {
    for (const block of blocks) if (block?.type === 'tool_use' && block.partialJson !== undefined) {
      try { block.input = JSON.parse(block.partialJson); } catch { throw new ApiError('Invalid streamed tool arguments.', 502); }
      delete block.partialJson;
    }
    return { content: blocks, stop_reason: stop, usage };
  }
  if (calls.length) message.tool_calls = calls.filter(Boolean);
  return { choices: [{ message, finish_reason: stop }], usage };
}
