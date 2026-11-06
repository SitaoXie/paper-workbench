import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionDiagnostic } from '../shared/connection-diagnostic.mjs';

const cases = [
 ['Model API returned HTTP 401. Check the API key and model access.', 'authentication'],
 ['Model API returned HTTP 403. Check the API key and model access.', 'authentication'],
 ['Model API returned HTTP 404. Verify the model identifier and API compatibility.', 'not-found'],
 ['Model API returned HTTP 429. Rate limit or quota exceeded; retry later.', 'quota'],
 ['Model API returned HTTP 503.', 'upstream'],
 ['Model API returned HTTP 422.', 'compatibility'],
 ['Model request timed out. Increase requestTimeoutSeconds in model settings.', 'timeout'],
 ['Could not connect to the configured model API. Verify its base URL and network access.', 'network'],
 ['Configure an API key in model settings first.', 'missing-key'],
 ['The model API returned invalid JSON.', 'response'],
 ['The model returned no text. Verify that this is a compatible chat model.', 'response'],
 ['The model reached its output token limit and returned an incomplete response.', 'output-limit'],
 ['服务暂时不可用，请确认本地服务已启动。', 'local-service'],
 ['Failed to fetch', 'local-service'],
 ['baseUrl must be a valid URL.', 'configuration'],
];
for(const locale of ['zh','en'])test(`connection diagnostics explain distinct failures without echoing raw secrets (${locale})`,()=>{
 for(const [message,code] of cases){
  const error=new Error(message+' unsafe-detail https://private.invalid/?api_key=never-render-this-key');
  const result=connectionDiagnostic(error,locale);
  assert.equal(result.code,code);assert.equal(result.steps.length,2);
  assert.ok(result.title);assert.doesNotMatch(JSON.stringify(result),/never-render|private.invalid|unsafe-detail/);
  assert.equal(/[\u4e00-\u9fff]/.test(result.title),locale==='zh');
 }
 assert.equal(connectionDiagnostic(new SyntaxError('hidden invalid secret')).code,'configuration');
 assert.equal(connectionDiagnostic(new Error('sensitive unknown provider text')).code,'unknown');
 assert.equal(connectionDiagnostic(null).code,'unknown');
});
test('HTTP 404 diagnostic does not falsely claim the model alone is missing',()=>{
 const result=connectionDiagnostic('Model API returned HTTP 404.');
 assert.equal(result.status,404);assert.match(result.title,/Endpoint or model/);
 assert.match(result.steps.join(' '),/base URL/);
});
