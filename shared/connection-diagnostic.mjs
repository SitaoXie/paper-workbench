/** Translate known, sanitized transport errors into next steps. Never echo an
 * upstream response, submitted endpoint, key, or arbitrary error message. */
export function connectionDiagnostic(error, locale = 'en') {
  const text = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : '';
  const status = Number(/Model API returned HTTP (\d{3})\b/.exec(text)?.[1]) || undefined;
  const zh = locale.startsWith('zh');
  const result = (code, cnTitle, enTitle, cnSteps, enSteps) => ({ code, ...(status ? {status} : {}), title: zh ? cnTitle : enTitle, steps: zh ? cnSteps : enSteps });
  if (status === 401 || status === 403) return result('authentication', '密钥或模型权限未通过', 'Key or model access was rejected',
    ['重新填写该连接的 API Key，检查是否已过期。', '确认这把密钥有权调用所选模型；兼容网关也可能单独限制模型。'],
    ['Re-enter the key for this connection and check whether it has expired.', 'Verify that the key can access this model; compatible gateways may apply their own model permissions.']);
  if (status === 404) return result('not-found', '接口路径或模型未找到', 'Endpoint or model was not found',
    ['填写 API Base URL，而不是控制台网址或完整的 chat/completions 地址。', '核对服务文档中的协议、路径前缀和完整模型 ID。'],
    ['Use the API base URL, not a console URL or the full chat/completions endpoint.', 'Check the provider’s protocol, path prefix, and exact model ID.']);
  if (status === 429) return result('quota', '服务限流或额度不足', 'Rate limit or quota reached',
    ['到服务商控制台检查额度、余额和并发限制。', '等待限流窗口结束后手动重试，或选择另一个连接。'],
    ['Check quota, balance, and concurrency limits in the provider’s console.', 'Wait for the rate-limit window, then retry manually or choose another connection.']);
  if (status && status >= 500) return result('upstream', '模型服务暂时不可用', 'The model service is unavailable',
    ['检查模型服务或本地反代是否正在运行。', '等待服务恢复后手动重试；如果其他模型可用，可先切换模型。'],
    ['Check whether the provider or local gateway is running.', 'Retry manually after it recovers, or switch to another available model.']);
  if (status && [400, 405, 413, 415, 422].includes(status)) return result('compatibility', '服务拒绝了请求参数', 'The provider rejected the request',
    ['核对 OpenAI 兼容 / Anthropic 协议和准确的模型 ID。', '检查输出上限、思考设置和高级 JSON 参数是否被该服务支持。连接探测最多请求 2,048 个输出 Token。'],
    ['Check the OpenAI-compatible / Anthropic protocol and exact model ID.', 'Check supported output limits, reasoning settings, and advanced JSON options. The probe requests at most 2,048 output tokens.']);
  if (/timed out|timeout/i.test(text)) return result('timeout', '模型未在等待时间内返回', 'The model did not respond in time',
    ['增加该连接的请求超时时间，或先用响应更快的模型测试。', '检查网络或代理；重试会发起一次新的模型请求。'],
    ['Increase this connection’s request timeout, or test with a faster model.', 'Check the network or proxy. Retrying starts a new model request.']);
  if (/Could not connect to the configured model API/i.test(text)) return result('network', '无法连接模型服务', 'Cannot reach the model service',
    ['检查 API Base URL、网络代理和证书配置。', '如果使用本地模型，确认它已启动且端口正确。'],
    ['Check the API base URL, proxy, and certificate configuration.', 'For a local model, confirm that it is running on the configured port.']);
  if (/Configure an API key/i.test(text)) return result('missing-key', '还没有可用的 API Key', 'No API key is configured',
    ['在当前连接中填写 API Key 后测试。', '无需 API 也可以阅读和记笔记，或通过 Codex / Claude 会话完成生成。'],
    ['Enter an API key in this connection, then test again.', 'You can read and annotate without an API, or generate content through a Codex / Claude session.']);
  if (/invalid JSON|invalid response object|returned no text|requested tools/i.test(text)) return result('response', '响应格式与聊天协议不匹配', 'The response does not match the chat protocol',
    ['确认地址指向聊天 API，而非网页或图片生成接口。', '检查连接协议，并换用兼容的聊天模型。'],
    ['Make sure the URL points to a chat API, not a website or image-generation endpoint.', 'Check the connection protocol and select a compatible chat model.']);
  if (/output token limit|incomplete response/i.test(text)) return result('output-limit', '探测回复被输出上限截断', 'The probe hit its output limit',
    ['降低思考强度或换用响应更简短的模型后再测试。', '探测输出最多为 2,048 Token；失败不等于模型完全不可用。'],
    ['Try a lower reasoning level or a model that returns a shorter response.', 'Probes allow at most 2,048 output tokens; this failure alone does not prove the model is unavailable.']);
  if (/服务暂时不可用|Failed to fetch|NetworkError|Load failed/i.test(text)) return result('local-service', '无法连接本地工作区', 'Cannot reach the local workspace',
    ['检查 Paper Workbench 服务是否已启动，然后刷新页面。', '使用「启动文库」或 npm run service:status 检查服务。'],
    ['Check that Paper Workbench is running, then reload the page.', 'Use the launcher or npm run service:status to check the service.']);
  if (error?.name === 'SyntaxError' || /must be|invalid|baseUrl|model|extraBody/i.test(text)) return result('configuration', '请检查连接配置', 'Check the connection settings',
    ['填写有效的 API Base URL 和模型 ID。', '检查高级选项是否为有效 JSON，并确认参数符合界面中的范围。'],
    ['Enter a valid API base URL and model ID.', 'Check that advanced options are valid JSON and values are within the ranges shown in the form.']);
  return result('unknown', '连接测试未完成', 'The connection test did not complete',
    ['检查本地服务和模型连接配置，然后手动重试。', '若仍失败，可换一个已知可用的模型或连接进行比较。'],
    ['Check the local service and model connection settings, then retry manually.', 'If it still fails, compare with another known-working model or connection.']);
}
