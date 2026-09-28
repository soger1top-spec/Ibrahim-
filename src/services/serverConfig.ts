/**
 * Server Configuration for Web TV Fallback mode only.
 * No hardcoded external AI Studio or run.app URLs.
 * In Native APK mode, connection is handled 100% locally over Wi-Fi via TvLanBridgePlugin.
 */

export function getServerBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();
    if (!isCapacitor) {
      return window.location.origin.replace(/\/+$/, '');
    }
  }
  return '';
}

export function getTvWebSocketUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    if (host && !host.includes('localhost:5173')) {
      return `${protocol}//${host}/api/tv-ws`;
    }
  }
  return '';
}

export function getTvRoomsApiUrl(): string {
  const base = getServerBaseUrl();
  return base ? `${base}/api/tv/rooms` : '';
}
