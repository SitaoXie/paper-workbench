export const BUILTIN_ASSISTANT_STYLES = Object.freeze([
  {id:'balanced',name:'均衡',nameEn:'Balanced',prompt:'Answer the actual question directly, then explain the evidence and qualifications needed to understand it. Match depth to the question. Do not repeat the same answer in separate short-answer and detailed-answer sections.'},
  {id:'concise',name:'简洁',nameEn:'Concise',prompt:'Give a direct, compact answer with the essential evidence and caveats. Avoid a second detailed version, introductory filler and tangential background. Keep necessary citations. Expand only when the question requires it; there is no fixed word limit.'},
  {id:'detailed',name:'详解',nameEn:'Detailed',prompt:'Develop one thorough, coherent explanation. Explain the central concepts, mechanism, assumptions, relevant experiments and limitations needed for this question. Use equations, worked examples or diagrams when helpful. Distinguish source evidence from inference. Do not duplicate the answer as a short version plus a long version. No fixed word limit; stop when the question is adequately explained.'},
  {id:'teaching',name:'教学',nameEn:'Teaching',prompt:'Teach the idea step by step, defining unfamiliar terms and connecting intuition to the actual method. Use a concrete example or diagram when useful. Explain where analogies stop applying. Keep the question in focus, preserve evidence and citations, and suggest a useful next question only when it helps.'},
].map(style=>Object.freeze(style)));
export const DEFAULT_ASSISTANT_PREFERENCES = Object.freeze({styleId:'balanced',pdfMode:'text',customStyles:[]});
export function assistantStyle(preferences = DEFAULT_ASSISTANT_PREFERENCES) {
  return BUILTIN_ASSISTANT_STYLES.find(s=>s.id===preferences.styleId) || preferences.customStyles?.find(s=>s.id===preferences.styleId) || BUILTIN_ASSISTANT_STYLES[0];
}
