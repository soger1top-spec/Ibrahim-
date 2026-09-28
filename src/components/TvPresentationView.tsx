import { useState, useEffect, useCallback } from 'react';
import type { DisplayInfo } from '../services/externalDisplay';
import { controllerBus } from '../services/controllerBus';
import { tvGameSessionService, type TvSessionState } from '../services/tvGameSessionService';
import { SunsetHighwayGame } from '../games/SunsetHighwayGame';
import { Tv, Radio, Play, Wifi, Sparkles } from 'lucide-react';

interface TvPresentationViewProps {
  initialDisplay?: DisplayInfo | null;
  onExitTvMode?: () => void;
}

export function TvPresentationView({ initialDisplay, onExitTvMode }: TvPresentationViewProps) {
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

  const [tvSessionState, setTvSessionState] = useState<TvSessionState>(() => tvGameSessionService.getState());
  const [latestCommand, setLatestCommand] = useState<any>(null);
  const [isDirectPlaying, setIsDirectPlaying] = useState(false);

  // Handle incoming controller commands from the phone
  const handleControllerInput = useCallback((cmd: any) => {
    setLatestCommand(cmd);
    if (cmd && cmd.type) {
      // Any controller activity unlocks game immediately
      setIsDirectPlaying(true);
    }
  }, []);

  useEffect(() => {
    // 1. Automatically register as TV host and start searching for controller
    tvGameSessionService.startTvHost('شاشة التلفاز الرئيسية (طريق الغروب)');

    const unsubTvSession = tvGameSessionService.subscribe((state) => {
      setTvSessionState(state);
      if (state.isControllerConnected) {
        setIsDirectPlaying(true);
      }
    });

    // 2. Attempt Automatic Fullscreen for TV Display to fit exact TV screen
    const triggerNativeFullscreen = () => {
      if (typeof document !== 'undefined') {
        try {
          if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
        } catch {}
      }
    };

    triggerNativeFullscreen();
    window.addEventListener('click', triggerNativeFullscreen, { once: true });
    window.addEventListener('keydown', triggerNativeFullscreen, { once: true });

    // 3. Notify native Android Presentation bridge that TV page is ready
    if (typeof window !== 'undefined' && (window as any).TvNativeBridge?.onTvReady) {
      try {
        (window as any).TvNativeBridge.onTvReady();
      } catch {}
    }

    // 4. Native DisplayManager updates listener
    (window as any).onTvDisplayUpdated = (info: DisplayInfo) => {
      setDisplayInfo(info);
    };

    // 5. Controller input listeners from Phone (Native bridge + Web controllerBus)
    const unsubBus = controllerBus.subscribe(handleControllerInput);
    (window as any).onTvControllerInput = handleControllerInput;

    // 6. Browser development event listener
    const handleBrowserInput = (e: any) => {
      handleControllerInput(e.detail);
    };
    window.addEventListener('gamingshell_control_input', handleBrowserInput);

    return () => {
      unsubTvSession();
      unsubBus();
      window.removeEventListener('gamingshell_control_input', handleBrowserInput);
      window.removeEventListener('click', triggerNativeFullscreen);
      window.removeEventListener('keydown', triggerNativeFullscreen);
      delete (window as any).onTvDisplayUpdated;
      delete (window as any).onTvControllerInput;
    };
  }, [handleControllerInput]);

  const handleStartDirectPlay = () => {
    tvGameSessionService.forceStartTvGameDirectly();
    setIsDirectPlaying(true);
  };

  const isGameActive = tvSessionState.isControllerConnected || isDirectPlaying;

  return (
    <div className="fixed inset-0 w-screen h-screen bg-slate-950 text-white overflow-hidden select-none z-[9999]" dir="rtl">
      {!isGameActive ? (
        /* Standby & Searching Screen when waiting for Controller on TV */
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-radial from-slate-900 via-slate-950 to-slate-950 relative overflow-hidden">
          {/* Background Ambient Lights */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Radar Scanning Ring */}
          <div className="relative w-32 h-32 flex items-center justify-center mb-6">
            <div className="absolute inset-0 rounded-full bg-cyan-500/20 animate-ping opacity-75" />
            <div className="absolute inset-2 rounded-full bg-cyan-500/20 border-2 border-cyan-400/50 animate-pulse" />
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 border-2 border-cyan-300 flex items-center justify-center shadow-2xl shadow-cyan-500/40 z-10">
              <Tv className="w-10 h-10 text-white" />
            </div>
          </div>

          <div className="space-y-4 max-w-md z-10">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 text-xs font-mono font-semibold">
              <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
              <span>جاري البحث والاقتران التلقائي بيد التحكم...</span>
            </div>

            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
              لعبة طريق الغروب 3D - واجهة التلفاز
            </h1>

            {/* Prominent PIN Code Display */}
            <div className="p-4 bg-slate-900/90 border-2 border-cyan-500/40 rounded-3xl flex flex-col items-center justify-center gap-1 shadow-2xl backdrop-blur-md">
              <span className="text-xs text-cyan-300 font-bold flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-cyan-400" />
                <span>رمز اقتران شاشة التلفاز</span>
              </span>
              <span className="text-4xl md:text-5xl font-black font-mono tracking-widest text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]">
                {tvSessionState.roomPin || '----'}
              </span>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed max-w-sm mx-auto">
              افتح التطبيق على هاتفك واضغط على تبويب <strong className="text-amber-400">"يد التلفاز"</strong> ثم اضغط على زر <strong className="text-cyan-400">"اتصال التلفاز"</strong> للبدء فوراً.
            </p>

            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleStartDirectPlay}
                className="py-3.5 px-8 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-600 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-white font-black text-base shadow-xl shadow-orange-600/40 border border-amber-300/40 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>بدء اللعب مباشرة / بالريموت</span>
              </button>

              {onExitTvMode && (
                <button
                  type="button"
                  onClick={onExitTvMode}
                  className="py-3.5 px-5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-sm transition-all"
                >
                  خروج
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* 100% Pure Highway Display: Zero on-screen buttons, controlled entirely by Phone Gamepad */
        <div className="w-full h-full relative">
          <SunsetHighwayGame
            showTouchControls={false}
            controllerCommand={latestCommand}
            onBackToMenu={() => {
              setIsDirectPlaying(false);
              if (onExitTvMode) onExitTvMode();
            }}
          />
        </div>
      )}
    </div>
  );
}
