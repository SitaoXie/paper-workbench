import { useSyncExternalStore } from 'react';
import { api, type Settings } from './types';

// All selectors edit the same workspace setting. Lock synchronously before the
// first await, including clicks that arrive before React renders disabled UI.
let snapshot = { pending: false, error: '' };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => snapshot;
function update(pending: boolean, error = '') { snapshot = { pending, error }; for (const listener of listeners) listener(); }
export function useModelSelection() { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }
export async function writeWorkspaceSettings(load: () => Promise<Settings>, onChange: (settings: Settings) => void): Promise<{ok: true} | {ok: false; error?: string}> {
  if (snapshot.pending) return {ok: false};
  update(true);
  try {
    const result = await load();
    onChange(result);
    update(false);
    return {ok: true};
  } catch (error) {
    update(false, error instanceof Error ? error.message : String(error));
    return {ok: false, error: snapshot.error};
  }
}

export async function selectWorkspaceModel(activeProfileId: string, model: string, onChange: (settings: Settings) => void) {
  return (await writeWorkspaceSettings(() => api<Settings>("/settings", {method:"PUT",body:JSON.stringify({activeProfileId,model})}), onChange)).ok;
}
