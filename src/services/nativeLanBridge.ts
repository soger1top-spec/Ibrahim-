/**
 * Native LAN Bridge client for Capacitor.
 * Interacts with Android Native TvLanBridgePlugin (RFC 6455 WebSocket Server + NSD mDNS Discovery).
 */

export interface DiscoveredTv {
  id: string;
  name: string;
  ip: string;
  port: number;
  pin: string;
  wsUrl: string;
}

export interface TvHostStartResult {
  success: boolean;
  port: number;
  ip: string;
  tvName: string;
  pin: string;
  wsUrl: string;
}

function getPlugin(): any {
  if (typeof window !== 'undefined') {
    const cap = (window as any).Capacitor;
    if (cap?.Plugins?.TvLanBridge) {
      return cap.Plugins.TvLanBridge;
    }
  }
  return null;
}

export function isNativeLanAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return !!(cap?.isNativePlatform?.() && cap?.Plugins?.TvLanBridge);
}

export async function startNativeTvHost(
  tvName = 'شاشة التلفاز الذكية',
  pin = '',
  port = 8765
): Promise<TvHostStartResult | null> {
  const plugin = getPlugin();
  if (!plugin) return null;

  try {
    const res = await plugin.startTvHost({ tvName, pin, port });
    return res as TvHostStartResult;
  } catch (err) {
    console.error('Failed to start native TV host:', err);
    return null;
  }
}

export async function stopNativeTvHost(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;

  try {
    await plugin.stopTvHost();
    return true;
  } catch (err) {
    console.warn('Error stopping native TV host:', err);
    return false;
  }
}

export async function startNativeTvDiscovery(
  onDiscovered: (tv: DiscoveredTv) => void,
  onLost?: (id: string) => void
): Promise<() => void> {
  const plugin = getPlugin();
  if (!plugin) return () => {};

  let discoveredListener: any = null;
  let lostListener: any = null;

  try {
    if (plugin.addListener) {
      discoveredListener = await plugin.addListener('tvDiscovered', (data: any) => {
        if (data && data.ip && data.port) {
          onDiscovered({
            id: data.id || `${data.ip}:${data.port}`,
            name: data.name || 'شاشة التلفاز',
            ip: data.ip,
            port: data.port,
            pin: data.pin || '',
            wsUrl: data.wsUrl || `ws://${data.ip}:${data.port}`
          });
        }
      });

      if (onLost) {
        lostListener = await plugin.addListener('tvLost', (data: any) => {
          if (data && data.id) {
            onLost(data.id);
          }
        });
      }
    }

    await plugin.startDiscovery();
  } catch (err) {
    console.error('Error starting native TV discovery:', err);
  }

  return () => {
    try {
      if (discoveredListener?.remove) discoveredListener.remove();
      if (lostListener?.remove) lostListener.remove();
      plugin.stopDiscovery?.();
    } catch (e) {
      console.warn('Error cleaning up discovery listeners:', e);
    }
  };
}

export async function getNativeLocalIp(): Promise<string> {
  const plugin = getPlugin();
  if (!plugin) return '';
  try {
    const res = await plugin.getLocalIp();
    return res?.ip || '';
  } catch {
    return '';
  }
}
