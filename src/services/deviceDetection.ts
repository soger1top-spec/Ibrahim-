// =============================================================
// SMART TV & DEVICE DETECTION ENGINE
// =============================================================

export interface DeviceInfo {
  isTv: boolean;
  isMobile: boolean;
  deviceType: 'tv' | 'mobile' | 'desktop';
  tvPlatform?: string;
  userAgent: string;
}

export function detectIsSmartTv(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Explicit URL parameter or hash
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === 'tv' || params.get('device') === 'tv' || params.get('tv') === '1') {
    return true;
  }
  if (window.location.hash === '#tv') {
    return true;
  }

  // 2. Native Android Presentation or TV bridge injection
  if ((window as any).TvNativeBridge || (window as any).isAndroidTv) {
    return true;
  }

  // 3. User-Agent Pattern matching for all known Smart TV platforms & Browsers
  const ua = (navigator.userAgent || navigator.vendor || (window as any).opera || '').toLowerCase();
  
  const tvPatterns = [
    'smart-tv',
    'smarttv',
    'googletv',
    'google tv',
    'android tv',
    'androidtv',
    'tizen',
    'webos',
    'web0s',
    'netcast',
    'apple tv',
    'appletv',
    'firetv',
    'fire tv',
    'aftt', // Amazon Fire TV Stick
    'aftm', // Amazon Fire TV Stick
    'aftb',
    'afts',
    'aftu',
    'roku',
    'viera', // Panasonic
    'bravia', // Sony
    'hisense',
    'philips',
    'mitv',
    'xiaomi tv',
    'mi-box',
    'boxee',
    'kylo',
    'dunehd',
    'pov_tv',
    'hbbtv',
    'ce-html',
    'playstation',
    'xbox',
    'nintendo switch',
    'smarttv201',
    'smarttv202',
    'tv safari',
    'crkey' // Chromecast
  ];

  for (const pattern of tvPatterns) {
    if (ua.includes(pattern)) {
      return true;
    }
  }

  return false;
}

export function getDeviceInfo(): DeviceInfo {
  const isTv = detectIsSmartTv();
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  const isMobile = !isTv && /mobi|android|iphone|ipad|ipod/i.test(ua);

  return {
    isTv,
    isMobile,
    deviceType: isTv ? 'tv' : isMobile ? 'mobile' : 'desktop',
    userAgent: ua
  };
}

export function requestRealFullscreen(targetElement?: Element | null): void {
  if (typeof document === 'undefined') return;
  const target = (targetElement || document.documentElement) as any;
  const doc = document as any;

  if (
    !doc.fullscreenElement &&
    !doc.webkitFullscreenElement &&
    !doc.mozFullScreenElement &&
    !doc.msFullscreenElement
  ) {
    const rfs =
      target.requestFullscreen ||
      target.webkitRequestFullscreen ||
      target.mozRequestFullScreen ||
      target.msRequestFullscreen;

    if (rfs) {
      try {
        const p = rfs.call(target);
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } catch {}
    }
  }
}

export function exitRealFullscreen(): void {
  if (typeof document === 'undefined') return;
  const doc = document as any;

  if (
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement
  ) {
    const efs =
      doc.exitFullscreen ||
      doc.webkitExitFullscreen ||
      doc.mozCancelFullScreen ||
      doc.msExitFullscreen;

    if (efs) {
      try {
        const p = efs.call(doc);
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } catch {}
    }
  }
}
