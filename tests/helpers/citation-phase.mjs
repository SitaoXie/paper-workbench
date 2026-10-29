// Existing source/answer contract tests can stub the independent citation-only
// model phase without changing their researcher/critic/tool-round fixtures.
// Dedicated citation-grounding tests exercise ID selection and full API results.
export function isCitationPhase(options){
 const body=JSON.parse(options.body);return (body.system||body.messages?.[0]?.content||'').startsWith('You align existing source citations');
}
export function withEmptyCitationPhase(fetchImpl){
 if(!fetchImpl)return fetchImpl;
 return async(url,options)=>{
  if(!isCitationPhase(options))return fetchImpl(url,options);
  const anthropic=!!options.headers['anthropic-version'];
  return new Response(JSON.stringify(anthropic?{content:[{type:'text',text:'{"bindings":[]}'}],stop_reason:'end_turn'}:{choices:[{message:{content:'{"bindings":[]}'},finish_reason:'stop'}]}));
 };
}
