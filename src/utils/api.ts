const rawBackendUrl = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim() || '';
export const BACKEND_BASE_URL = rawBackendUrl.replace(/\/+$/, '');

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return BACKEND_BASE_URL ? `${BACKEND_BASE_URL}${normalized}` : normalized;
}

export function getSocketNamespaceUrl(): string {
  return BACKEND_BASE_URL ? `${BACKEND_BASE_URL}/telemetry` : '/telemetry';
}
