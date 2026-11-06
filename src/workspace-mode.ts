/** The demo uses its own read-only API namespace; no personal library requests. */
export function isDemoWorkspace(href: string = typeof window === 'undefined' ? 'http://localhost/' : window.location.href): boolean {
  try { return new URL(href || '/', 'http://localhost/').searchParams.get('demo') === '1'; } catch { return false; }
}
export function apiUrl(path: string): string {
  return `${isDemoWorkspace() ? '/api/demo' : '/api'}${path}`;
}
