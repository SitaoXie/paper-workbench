/** Only stable, known validation failures receive UI copy. Provider and other
 * server errors keep their diagnostic message instead of being guessed at. */
const numericSelectionMessage = 'The selection contains only numbers or symbols, with no text to translate. Select the surrounding caption or sentence.';
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: unknown) {
    super(message); this.name = 'ApiRequestError'; this.status = status;
    if (typeof code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(code)) this.code = code;
  }
}
export function selectionErrorMessage(error: unknown, locale: string): string {
  const record = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown } : undefined;
  const message = typeof record?.message === 'string' ? record.message : typeof error === 'string' ? error : '';
  const knownNumeric = record?.code === 'selection_no_translatable_text' || (!record?.code && message === numericSelectionMessage);
  if (knownNumeric) return locale.startsWith('zh')
    ? '选文只有数字或符号，无需翻译。请一并选择周围的图注或句子。'
    : 'The selection contains only numbers or symbols. Select the surrounding caption or sentence to translate.';
  if (record?.code === 'selection_model_unconfigured') return locale.startsWith('zh')
    ? '尚未连接模型。可使用下方的订阅助手，或在侧栏配置模型 API。'
    : 'No model is connected. Use your subscription agent below, or configure a model API in the sidebar.';
  return message || (locale.startsWith('zh') ? '请求失败，请重试。' : 'Request failed. Try again.');
}
