/**
 * Configuration and resolution for TV Game server connection.
 * Resolves the appropriate HTTP/WebSocket endpoint for both:
 * - Native Android/TV APK running in Capacitor (capacitor://localhost or http://localhost)
 * - Web TV fallback running in a Smart TV browser or desktop/mobile browser
 */

// Default Cloud Run deployment URL for remote connections
const DEFAULT_CLOUD_SERVER_URL = 'https://ais-dev-3zmjc7xgxdukxgescmq57h-23513425907.europe-west2.run.app';

export function getCustomServerUrl(): string {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('sunset_tv_server_url') || '';
  }
  return '';
}

export function setCustomServerUrl(url: string): void {
  if (typeof localStorage !== 'undefined') {
    if (url.trim()) {
      localStorage.setItem('sunset_tv_server_url', url.trim());
    } else {
      localStorage.removeItem('sunset_tv_server_url');
    }
  }
}

export function getServerBaseUrl(): string {
  // 1. User manual override stored in localStorage
  const custom = getCustomServerUrl();
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }

  // 2. Build-time environment variable VITE_TV_SERVER_URL
  if (import.meta.env.VITE_TV_SERVER_URL) {
    return (import.meta.env.VITE_TV_SERVER_URL as string).trim().replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined') {
    const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

    // 3. If running in a regular web browser (Web TV fallback or desktop/phone web):
    // Use the actual web origin (e.g. https://ais-...run.app or http://192.168.1.X:3000)
    if (!isCapacitor && !isLocalhost) {
      return window.location.origin.replace(/\/+$/, '');
    }

    // If developing locally in web browser
    if (!isCapacitor && isLocalhost) {
      return window.location.origin.replace(/\/+$/, '');
    }
  }

  // 4. Default for native Android APK to connect to the deployed cloud server
  return DEFAULT_CLOUD_SERVER_URL.replace(/\/+$/, '');
}

export function getTvWebSocketUrl(): string {
  const baseUrl = getServerBaseUrl();
  const wsBase = baseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${wsBase}/api/tv-ws`;
}

export function getTvRoomsApiUrl(): string {
  const baseUrl = getServerBaseUrl();
  return `${baseUrl}/api/tv/rooms`;
}
