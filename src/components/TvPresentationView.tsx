import { useState, useEffect, useCallback } from 'react';
import { controllerBus } from '../services/controllerBus';
import { tvGameSessionService, type TvSessionState } from '../services/tvGameSessionService';
import { requestRealFullscreen } from '../services/deviceDetection';
import { SunsetHighwayGame } from '../games/SunsetHighwayGame';
import { ErrorBoundary } from './ErrorBoundary';
import { Tv, Radio, Play, Wifi, Sliders, Activity } from 'lucide-react';

interface TvPresentationViewProps {
  onExitTvMode?: () => void;
}

export function TvPresentationView({ onExitTvMode }: TvPresentationViewProps) {
  const [tvSessionState, setTvSessionState] = useState<TvSessionState>(() => tvGameSessionService.getState());
  const [latestCommand, setLatestCommand] = useState<any>(null);
  const [isDirectPlaying, setIsDirectPlaying] = useState(false);
  const [tvQuality, setTvQuality] = useState<'high' | 'low'>('high');
  const [showDebug, setShowDebug] = useState(false);

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
      requestRealFullscreen();
    };

    triggerNativeFullscreen();
    window.addEventListener('click', triggerNativeFullscreen, { once: true });
    window.addEventListener('keydown', triggerNativeFullscreen, { once: true });
    window.addEventListener('touchstart', triggerNativeFullscreen, { once: true });

    // 3. Controller input listeners from Phone (controllerBus & browser event)
    const unsubBus = controllerBus.subscribe(handleControllerInput);
    (window as any).onTvControllerInput = handleControllerInput;

    const handleBrowserInput = (e: any) => {
      handleControllerInput(e.detail);
    };
    window.addEventListener('gamingshell_control_input', handleBrowserInput);

    return () => {
      tvGameSessionService.stopTvHost();
      unsubTvSession();
      unsubBus();
      window.removeEventListener('gamingshell_control_input', handleBrowserInput);
      window.removeEventListener('click', triggerNativeFullscreen);
      window.removeEventListener('keydown', triggerNativeFullscreen);
      window.removeEventListener('touchstart', triggerNativeFullscreen);
      delete (window as any).onTvControllerInput;
    };
  }, [handleControllerInput]);

  const handleStartDirectPlay = () => {
    requestRealFullscreen();
    tvGameSessionService.forceStartTvGameDirectly();
    setIsDirectPlaying(true);
  };

  const isGameActive = tvSessionState.isControllerConnected || isDirectPlaying;

  return (
    <ErrorBoundary
      fallbackTitle="تعذر تشغيل واجهة التلفاز ثلاثية الأبعاد"
      onReset={() => {
        setIsDirectPlaying(false);
        tvGameSessionService.startTvHost();
      }}
      onEnableLowQuality={() => {
        setTvQuality('low');
        setIsDirectPlaying(true);
      }}
      onGoHome={onExitTvMode}
    >
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
                {tvSessionState.localIp && (
                  <span className="text-[11px] font-mono text-slate-400 pt-1">
                    شبكة Wi-Fi: <strong className="text-cyan-300">{tvSessionState.localIp}:{tvSessionState.localPort || 8765}</strong>
                  </span>
                )}
              </div>

              <p className="text-sm text-slate-300 leading-relaxed max-w-sm mx-auto">
                افتح التطبيق على هاتفك واضغط على زر <strong className="text-amber-400">"يد التلفاز"</strong> للبدء والتحكم باللعبة مباشرة عبر الشبكة.
              </p>

              {/* Quality & Debug Toggles */}
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setTvQuality(tvQuality === 'high' ? 'low' : 'high')}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    tvQuality === 'high'
                      ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                      : 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                  }`}
                  title="تغيير جودة الرسوميات"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>الجودة: {tvQuality === 'high' ? 'عالية (ظلال ووهج)' : 'خفيفة (أقصى سلاسة)'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowDebug(!showDebug)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    showDebug
                      ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                  title="عرض إحصائيات الأداء و FPS"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>{showDebug ? 'إخفاء FPS' : 'عرض FPS'}</span>
                </button>
              </div>

              <div className="pt-2 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleStartDirectPlay}
                  className="py-3.5 px-8 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-600 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-white font-black text-base shadow-xl shadow-orange-600/40 border border-amber-300/40 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer"
                >
                  <Play className="w-5 h-5 fill-current" />
                  <span>بدء اللعب بالريموت / لوحة المفاتيح</span>
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
          /* 100% Pure Highway Display: Zero on-screen buttons, controlled entirely by Phone Gamepad or Remote */
          <div className="w-full h-full relative">
            <SunsetHighwayGame
              showTouchControls={false}
              autoStart={true}
              controllerCommand={latestCommand}
              tvQualityMode={tvQuality}
              showDebugStats={showDebug}
              onBackToMenu={() => {
                setIsDirectPlaying(false);
                if (onExitTvMode) onExitTvMode();
              }}
            />
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

