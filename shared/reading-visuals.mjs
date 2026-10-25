/** Model output is declarative data, never executable HTML/JavaScript. */
export function validateDiagram(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 16000 || source.split('\n').length > 180) throw new Error('Diagram is empty or too large.');
  if (!/^\s*(?:flowchart|graph|sequenceDiagram|stateDiagram-v2|classDiagram|mindmap|pie)\b/.test(source)) throw new Error('Use a flowchart, sequence, state, class, mindmap or pie diagram.');
  if (/%%\{|^\s*---|^\s*(?:click|style|classDef|linkStyle)\s|<\s*[a-z!\/]|(?:https?:|javascript:|data:)|url\s*\(|@\{/im.test(source)) throw new Error('Diagram links, HTML, styles and configuration directives are not supported.');
  return source;
}
export function parseChart(source) {
  if (typeof source !== 'string' || source.length > 20000) throw new Error('Chart is too large.');
  const data = JSON.parse(source);
  const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
  if (!data || !['bar','line'].includes(data.type) || !label(data.title) || !label(data.unit) || !label(data.source) || !Array.isArray(data.data) || !data.data.length || data.data.length > 24) throw new Error('Chart needs type, title, unit, source and 1–24 data points.');
  if (data.data.some(point => !point || !label(point.label) || typeof point.value !== 'number' || !Number.isFinite(point.value) || Math.abs(point.value) > 1e12)) throw new Error('Chart data must have labels and finite numeric values.');
  if (new Set(data.data.map(point=>point.label)).size !== data.data.length) throw new Error('Chart labels must be unique.');
  return {type:data.type,title:data.title,unit:data.unit,source:data.source,data:data.data.map(({label,value})=>({label,value}))};
}
export const readingVisualInstructions = `You may draw an inline explanatory visual when it materially helps understanding; do not force visuals into short answers. Use a fenced mermaid block for a small flowchart, sequenceDiagram, stateDiagram-v2, classDiagram or mindmap. Keep labels in the user's language, quote flowchart labels, and use plain Mermaid without HTML, links, click actions, CSS, directives or configuration. Label it as a generated explanatory diagram, distinguish inference from the paper's design, and cite supporting original pages in adjacent prose. Never present it as an extracted source figure. For numeric comparisons use a fenced chart block containing strict JSON: {"type":"bar" or "line","title":"...","unit":"...","source":"paper page / explicitly illustrative assumption","data":[{"label":"...","value":1.2}]}. Use at most 24 points, preserve source units and exact values, never invent experimental measurements. Use line only for ordered data. If quantities are unavailable, draw a qualitative diagram instead. All chart and diagram content is declarative; no JavaScript, HTML, external images or executable code. A diagram is optional and is not evidence of correctness.`;
