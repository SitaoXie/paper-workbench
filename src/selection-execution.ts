export type SelectionExecution = 'api' | 'agent';
export function readSelectionExecution(): SelectionExecution {
  try { return sessionStorage.getItem('paper-workbench:selection-execution') === 'agent' ? 'agent' : 'api'; } catch { return 'api'; }
}
export function saveSelectionExecution(value: SelectionExecution) {
  try { sessionStorage.setItem('paper-workbench:selection-execution',value); } catch { /* This preference is optional. */ }
}
