import { useState, useEffect, useCallback } from 'react';
import type { DisplayInfo } from '../services/externalDisplay';
import { controllerBus } from '../services/controllerBus';
import { SunsetHighwayGame } from '../games/SunsetHighwayGame';

interface TvPresentationViewProps {
  initialDisplay?: DisplayInfo | null;
}

export function TvPresentationView({ initialDisplay }: TvPresentationViewProps) {
  const [, setDisplayInfo] = useState<DisplayInfo | null>(() => {
    if (initialDisplay) return initialDisplay;
    if (typeof window !== 'undefined' && (window as any).TvNativeBridge) {
      try {
        const raw = (window as any).TvNativeBridge.getDisplayInfo();
        if (raw) return JSON.parse(raw);
      } catch (e) {
        console.error('Failed to parse TvNativeBridge display info', e);
      }
    }
    return null;
  });

  const [latestCommand, setLatestCommand] = useState<any>(null);

  // Handle incoming controller commands from the phone
  const handleControllerInput = useCallback((cmd: any) => {
    setLatestCommand(cmd);
  }, []);

  useEffect(() => {
    // 1. Notify native Android Presentation bridge that TV page is ready
    if (typeof window !== 'undefined' && (window as any).TvNativeBridge?.onTvReady) {
      try {
        (window as any).TvNativeBridge.onTvReady();
      } catch {}
    }

    // 2. Native DisplayManager updates listener
    (window as any).onTvDisplayUpdated = (info: DisplayInfo) => {
      setDisplayInfo(info);
    };

    // 3. Controller input listeners from Phone (Native bridge + Web controllerBus)
    const unsubBus = controllerBus.subscribe(handleControllerInput);
    (window as any).onTvControllerInput = handleControllerInput;

    // 4. Browser development event listener
    const handleBrowserInput = (e: any) => {
      handleControllerInput(e.detail);
    };
    window.addEventListener('gamingshell_control_input', handleBrowserInput);

    return () => {
      unsubBus();
      window.removeEventListener('gamingshell_control_input', handleBrowserInput);
      delete (window as any).onTvDisplayUpdated;
      delete (window as any).onTvControllerInput;
    };
  }, [handleControllerInput]);

  return (
    <div className="w-screen h-screen bg-slate-950 overflow-hidden relative select-none" dir="rtl">
      {/* Primary Highway Display: Direct 3D Sunset Highway Experience */}
      <SunsetHighwayGame
        controllerCommand={latestCommand}
        onBackToMenu={() => {
          // Keep active on highway
        }}
      />
    </div>
  );
}
