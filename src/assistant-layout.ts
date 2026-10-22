export type CompanionMode = 'assistant' | 'notebook' | null;
export const ASSISTANT_DESKTOP_MIN = 1000;
export const ASSISTANT_MIN_WIDTH = 420;
export const ASSISTANT_MAX_WIDTH = 960;
const layoutKey = 'paper-workbench:companion-layout-v1';
const widthKey = 'paper-workbench:assistant-width';
const viewportWidth = () => typeof window === 'undefined' ? 1440 : window.innerWidth;
const mode = (value: unknown): CompanionMode => value === 'assistant' || value === 'notebook' ? value : null;
function layouts(): { desktop: CompanionMode; narrow: CompanionMode } {
  try {
    const raw = localStorage.getItem(layoutKey);
    const value = raw && raw.length < 256 ? JSON.parse(raw) : {};
    return { desktop: mode(value?.desktop), narrow: mode(value?.narrow) };
  } catch { return { desktop: null, narrow: null }; }
}
/** Separate overlay and dock preferences: a desktop-open panel never hides a
 * phone's reading page on its first visit. No paper, conversation or draft data. */
export function readCompanionMode(viewport = viewportWidth()): CompanionMode {
  return layouts()[viewport >= ASSISTANT_DESKTOP_MIN ? 'desktop' : 'narrow'];
}
export function saveCompanionMode(value: CompanionMode, viewport = viewportWidth()) {
  const next = layouts(); next[viewport >= ASSISTANT_DESKTOP_MIN ? 'desktop' : 'narrow'] = mode(value);
  try { localStorage.setItem(layoutKey, JSON.stringify(next)); } catch { /* Current layout still works if storage is disabled. */ }
}
export function maximumAssistantWidth(viewport: number) {
  return Math.max(ASSISTANT_MIN_WIDTH, Math.min(ASSISTANT_MAX_WIDTH, viewport - 408));
}
export function savedAssistantWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(widthKey));
    return Number.isFinite(value) && value >= ASSISTANT_MIN_WIDTH && value <= ASSISTANT_MAX_WIDTH ? value : null;
  } catch { return null; }
}
export function saveAssistantWidth(value: number) {
  if (!Number.isFinite(value) || value < ASSISTANT_MIN_WIDTH || value > ASSISTANT_MAX_WIDTH) return;
  try { localStorage.setItem(widthKey, String(Math.round(value))); } catch { /* Session state retains the width. */ }
}
export function responsiveAssistantWidth(viewport: number) {
  const desktopViewport = viewport < ASSISTANT_DESKTOP_MIN ? 1440 : viewport;
  return Math.round(Math.max(ASSISTANT_MIN_WIDTH, Math.min(maximumAssistantWidth(desktopViewport), desktopViewport * .5)));
}
export function initialAssistantWidth(viewport = viewportWidth()) {
  const preferred = savedAssistantWidth() ?? responsiveAssistantWidth(viewport);
  return viewport < ASSISTANT_DESKTOP_MIN ? preferred : Math.min(maximumAssistantWidth(viewport), preferred);
}
