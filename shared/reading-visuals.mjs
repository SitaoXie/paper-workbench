/** Model output is declarative data, never executable HTML/JavaScript. */
export function validateDiagram(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 16000 || source.split('\n').length > 180) throw new Error('Diagram is empty or too large.');
  if (!/^\s*(?:flowchart|graph|sequenceDiagram|stateDiagram-v2|classDiagram|mindmap|pie)\b/.test(source)) throw new Error('Use a flowchart, sequence, state, class, mindmap or pie diagram.');
  // Mermaid renders bare <br> markers as SVG text lines with htmlLabels=false.
  // Normalize only this attribute-free marker; all other HTML stays forbidden.
  const normalized = source.replace(/<br\s*\/?>/gi, '<br/>');
  const checked = normalized.replaceAll('<br/>', ' ');
  if (/%%\{|^\s*---|^\s*(?:click|style|classDef|linkStyle)\s|<\s*[a-z!\/]|(?:https?:|javascript:|data:)|url\s*\(|@\{/im.test(checked)) throw new Error('Diagram links, HTML, styles and configuration directives are not supported.');
  return normalized;
}
/** Preserve source order for flat, independent groups only. Invisible Mermaid
 * edges constrain placement, not the meaning of the displayed graph. Parsed
 * membership/edges are required: guessing connections from text is unsafe. */
export function orderIndependentDiagramGroups(source, {groups, edges, nodeIds}) {
  if (!/^\s*(?:flowchart|graph)\s+(?:TB|TD|LR)\b/.test(source) || groups.length < 2 || groups.length > 12 || edges.length + groups.length - 1 > 150) return source;
  const ids = new Set(groups.map(group => group.id));
  if (ids.size !== groups.length || groups.some(group => !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(group.id) || !group.nodes.length || group.nodes.some(id => ids.has(id)))) return source;
  const owner = new Map(groups.map(group => [group.id, group.id]));
  for (const group of groups) for (const node of group.nodes) {
    if (owner.has(node)) return source; // Shared membership needs the original layout.
    owner.set(node, group.id);
  }
  if (nodeIds.some(id => !owner.has(id)) || edges.some(edge => !owner.has(edge.start) || !owner.has(edge.end) || owner.get(edge.start) !== owner.get(edge.end))) return source;
  const ordered = `${source.trimEnd()}\n%% Workbench layout only: preserve independent group order.\n${groups.slice(1).map((group, index) => `${groups[index].id} ~~~ ${group.id}`).join('\n')}\n`;
  return ordered.length <= 16000 && ordered.split('\n').length <= 180 ? ordered : source;
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
export const readingVisualInstructions = `You may draw an inline explanatory visual when it materially helps understanding; do not force visuals into short answers. Use a fenced mermaid block for a small flowchart, sequenceDiagram, stateDiagram-v2, classDiagram or mindmap. Keep labels in the user's language, quote flowchart labels, and use plain Mermaid. Inside labels, bare <br/> is supported for line breaks; no other HTML, links, click actions, CSS, directives or configuration. For ordered comparisons made of independent subgraphs, use invisible ~~~ links between subgraph IDs in the intended order to constrain layout; do not add causal arrows between independent methods. Label it as a generated explanatory diagram, distinguish inference from the paper's design, and cite supporting original pages in adjacent prose. Never present it as an extracted source figure. For numeric comparisons use a fenced chart block containing strict JSON: {"type":"bar" or "line","title":"...","unit":"...","source":"paper page / explicitly illustrative assumption","data":[{"label":"...","value":1.2}]}. Use at most 24 points, preserve source units and exact values, never invent experimental measurements. Use line only for ordered data. If quantities are unavailable, draw a qualitative diagram instead. All chart and diagram content is declarative; no JavaScript, HTML other than bare diagram label line-break markers, external images or executable code. A diagram is optional and is not evidence of correctness.`;
