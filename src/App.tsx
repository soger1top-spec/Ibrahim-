import { useState, useEffect } from 'react';
import { PhoneView } from './components/PhoneView';
import { TvPresentationView } from './components/TvPresentationView';
import { detectIsSmartTv } from './services/deviceDetection';

export default function App() {
  const [isTvMode, setIsTvMode] = useState<boolean>(() => {
    return detectIsSmartTv();
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

  // When running on Smart TV: Display pure 3D game immediately with ZERO on-screen buttons
  if (isTvMode) {
    return (
      <div className="fixed inset-0 w-screen h-screen bg-slate-950 text-slate-100 overflow-hidden select-none z-[9999]">
        <TvPresentationView />
      </div>
    );
  }

  // When running on Mobile Phone
  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100">
      <PhoneView />
    </div>
  );
}
