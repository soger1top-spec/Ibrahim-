import { useState, useEffect } from 'react';
import { PhoneView } from './components/PhoneView';
import { TvPresentationView } from './components/TvPresentationView';

export default function App() {
  const [isTvMode, setIsTvMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'tv') {
        return true;
      }
      if (window.location.hash === '#tv') {
        return true;
      }
      // If injected by native Android Presentation WebView
      if ((window as any).TvNativeBridge) {
        return true;
      }
    }
    return false;
  });

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#tv') {
        setIsTvMode(true);
      } else if (window.location.hash === '#phone') {
        setIsTvMode(false);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // When running on the TV Presentation secondary display
  if (isTvMode) {
    return (
      <div className="relative min-h-screen bg-slate-950 text-slate-100">
        {/* TV Presentation UI (NO Phone Controller, NO Connection buttons) */}
        <TvPresentationView />

        {/* Small floating dev switcher for browser development only */}
        {process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && !(window as any).TvNativeBridge && (
          <button
            type="button"
            onClick={() => {
              window.location.hash = '#phone';
              setIsTvMode(false);
            }}
            className="fixed bottom-2 left-2 z-50 text-[11px] px-2.5 py-1 rounded bg-slate-800/85 text-slate-300 hover:text-white border border-slate-700/60 shadow"
          >
            التبديل إلى واجهة الهاتف
          </button>
        )}
      </div>
    );
  }

  // When running on the Phone (Host & Controller)
  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100">
      <PhoneView />

      {/* Small floating dev switcher for browser development only */}
      {process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && !(window as any).TvNativeBridge && (
        <button
          type="button"
          onClick={() => {
            window.location.hash = '#tv';
            setIsTvMode(true);
          }}
          className="fixed bottom-2 left-2 z-50 text-[11px] px-2.5 py-1 rounded bg-slate-800/85 text-slate-300 hover:text-white border border-slate-700/60 shadow"
        >
          معاينة واجهة التلفاز الخارجية
        </button>
      )}
    </div>
  );
}
