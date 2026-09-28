import { useState, useEffect } from 'react';
import {
  Smartphone,
  Tv,
  Gamepad2,
  Sparkles,
  Wifi,
  Settings,
  X,
  Play,
  CheckCircle,
  AlertCircle,
  Radio,
  RotateCcw
} from 'lucide-react';
import {
  tvGameSessionService,
  type TvSessionState
} from '../services/tvGameSessionService';
import {
  getServerBaseUrl,
  setCustomServerUrl,
  getCustomServerUrl
} from '../services/serverConfig';
import { ControllerPad } from './ControllerPad';
import { TvPresentationView } from './TvPresentationView';
import { SunsetHighwayGame } from '../games/SunsetHighwayGame';
import { ErrorBoundary } from './ErrorBoundary';
import { requestRealFullscreen } from '../services/deviceDetection';

type ActiveViewMode = 'menu' | 'mobile_game' | 'tv_game' | 'tv_controller';

export function PhoneView() {
  const [activeMode, setActiveMode] = useState<ActiveViewMode>('menu');
  const [tvSessionState, setTvSessionState] = useState<TvSessionState>(() => tvGameSessionService.getState());

  // Controller pairing state
  const [manualPin, setManualPin] = useState('');
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [customServerInput, setCustomServerInput] = useState(() => getCustomServerUrl());
  const [activeServerUrl, setActiveServerUrl] = useState(() => getServerBaseUrl());

  useEffect(() => {
    // Subscribe to TV Game session state updates
    const unsub = tvGameSessionService.subscribe(state => {
      setTvSessionState(state);
    });
    return () => unsub();
  }, []);

  const handleConnectToTv = () => {
    tvGameSessionService.searchAndConnectToTv(
      'يد تحكم الجوال الذكية',
      manualPin.trim() ? manualPin.trim() : undefined
    );
  };

  const handleSaveServerUrl = () => {
    setCustomServerUrl(customServerInput);
    setActiveServerUrl(getServerBaseUrl());
    setShowServerSettings(false);
    // Reconnect session with new server
    window.location.reload();
  };

  // -------------------------------------------------------------
  // 1. MOBILE GAME (لعبة الجوال - الجوال يرسم اللعبة طبيعياً)
  // -------------------------------------------------------------
  if (activeMode === 'mobile_game') {
    return (
      <ErrorBoundary onGoHome={() => setActiveMode('menu')}>
        <div className="fixed inset-0 w-screen h-screen bg-slate-950 overflow-hidden z-50">
          <SunsetHighwayGame
            showTouchControls={true}
            tvQualityMode="high"
            onBackToMenu={() => setActiveMode('menu')}
          />
        </div>
      </ErrorBoundary>
    );
  }

  // -------------------------------------------------------------
  // 2. TV GAME (لعبة التلفزيون - التلفاز يرسم اللعبة محلياً وينتظر يد التحكم)
  // -------------------------------------------------------------
  if (activeMode === 'tv_game') {
    return (
      <ErrorBoundary onGoHome={() => setActiveMode('menu')}>
        <div className="fixed inset-0 w-screen h-screen bg-slate-950 overflow-hidden z-[9999]">
          <TvPresentationView onExitTvMode={() => setActiveMode('menu')} />
        </div>
      </ErrorBoundary>
    );
  }

  // -------------------------------------------------------------
  // 3. TV CONTROLLER (يد التلفاز - الجوال يعمل كـ Controller فقط ولا يرسم اللعبة)
  // -------------------------------------------------------------
  if (activeMode === 'tv_controller') {
    return (
      <ErrorBoundary onGoHome={() => setActiveMode('menu')}>
        <div className="fixed inset-0 w-screen h-screen bg-slate-950 text-white overflow-hidden flex flex-col z-50 select-none">
          {/* Top Controller Header & Connection Bar */}
          <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between shadow-md z-40 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  tvGameSessionService.disconnectController();
                  setActiveMode('menu');
                }}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-300 transition-all cursor-pointer"
              >
                القائمة
              </button>

              <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono">
                {tvSessionState.isControllerConnected ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-emerald-400 font-bold">متصل بـ: {tvSessionState.tvName}</span>
                  </>
                ) : tvSessionState.tvStatus === 'connecting' ? (
                  <>
                    <Radio className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                    <span className="text-cyan-300">جاري الاتصال بالتلفاز...</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-amber-400">غير متصل بالتلفاز</span>
                  </>
                )}
              </div>
            </div>

            {/* Quick Connect / PIN Input */}
            <div className="flex items-center gap-2">
              {!tvSessionState.isControllerConnected ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="رمز PIN"
                    value={manualPin}
                    onChange={e => setManualPin(e.target.value.replace(/\D/g, ''))}
                    className="w-20 px-2.5 py-1 text-center font-mono text-xs rounded-lg bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    type="button"
                    onClick={handleConnectToTv}
                    className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-1"
                  >
                    <Wifi className="w-3 h-3" />
                    <span>اتصال</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => tvGameSessionService.disconnectController()}
                  className="px-3 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold transition-all cursor-pointer"
                >
                  فصل
                </button>
              )}
            </div>
          </div>

          {/* Dedicated Controller Gamepad (Zero 3D Game Rendering - Pure Controller Input) */}
          <div className="flex-1 w-full relative">
            <ControllerPad
              connectedDisplayName={tvSessionState.tvName}
              playerTitle="يد تحكم التلفاز الذكية"
            />
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  // -------------------------------------------------------------
  // MAIN MENU: 3 EXCLUSIVE CHOICES (لعبة الجوال · لعبة التلفزيون · يد التلفاز)
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-950 text-white select-none flex flex-col justify-between p-6 md:p-10 relative overflow-hidden" dir="rtl">
      {/* Background Ambient Sunset Glow */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between w-full max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-600 to-rose-600 border border-amber-300/40 flex items-center justify-center text-white shadow-xl shadow-orange-600/30">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <span>طريق الغروب السريع</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30 font-mono">
                3D
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              تجربة القيادة الواقعية على الجوال والتلفاز
            </p>
          </div>
        </div>

        {/* Server status & settings button */}
        <button
          type="button"
          onClick={() => setShowServerSettings(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 transition-all cursor-pointer backdrop-blur shadow-md"
          title="إعدادات الخادم والاتصال"
        >
          <span className={`w-2 h-2 rounded-full ${tvSessionState.wsConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
          <span className="hidden sm:inline">الخادم</span>
          <Settings className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </header>

      {/* Main 3 Action Buttons Container */}
      <main className="relative z-10 w-full max-w-4xl mx-auto my-auto py-8">
        <div className="text-center mb-8 space-y-2">
          <h2 className="text-2xl md:text-3xl font-black text-white">
            اختر طريقة اللعب
          </h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            اللعبة تعمل محلياً على التلفزيون لتفادي التعليق، أو مباشرة على الجوال.
          </p>
        </div>

        {/* The 3 Core Mode Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* 1. MOBILE GAME BUTTON */}
          <button
            type="button"
            onClick={() => setActiveMode('mobile_game')}
            className="group relative flex flex-col items-center justify-between p-7 rounded-3xl bg-slate-900/90 hover:bg-slate-850 border-2 border-slate-800 hover:border-amber-400/60 shadow-xl hover:shadow-2xl hover:shadow-amber-500/10 transition-all duration-300 transform hover:-translate-y-1 active:scale-95 cursor-pointer text-center overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all" />

            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 border border-amber-300/40 flex items-center justify-center text-white mb-5 shadow-lg shadow-amber-600/30 group-hover:scale-110 transition-transform">
              <Smartphone className="w-10 h-10" />
            </div>

            <div className="space-y-2 mb-6">
              <h3 className="text-xl font-black text-white group-hover:text-amber-300 transition-colors">
                1. لعبة الجوال
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                تشغيل اللعبة ثلاثية الأبعاد طبيعياً على هذا الجوال، ورسم كل التفاصيل بمحرك 3D مع أزرار التحكم باللمس.
              </p>
            </div>

            <div className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md">
              <Play className="w-4 h-4 fill-current" />
              <span>بدء لعب الجوال</span>
            </div>
          </button>

          {/* 2. TV GAME BUTTON (TV HOST) */}
          <button
            type="button"
            onClick={() => {
              requestRealFullscreen();
              setActiveMode('tv_game');
            }}
            className="group relative flex flex-col items-center justify-between p-7 rounded-3xl bg-slate-900/90 hover:bg-slate-850 border-2 border-slate-800 hover:border-cyan-400/60 shadow-xl hover:shadow-2xl hover:shadow-cyan-500/10 transition-all duration-300 transform hover:-translate-y-1 active:scale-95 cursor-pointer text-center overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition-all" />

            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-cyan-600 to-blue-600 border border-cyan-300/40 flex items-center justify-center text-white mb-5 shadow-lg shadow-cyan-600/30 group-hover:scale-110 transition-transform">
              <Tv className="w-10 h-10" />
            </div>

            <div className="space-y-2 mb-6">
              <h3 className="text-xl font-black text-white group-hover:text-cyan-300 transition-colors">
                2. لعبة التلفزيون
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                تحويل هذا الجهاز إلى TV Host يرسم اللعبة بنفسه على الشاشة الكبيرة، وينتظر اتصال يد التحكم من الجوال.
              </p>
            </div>

            <div className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md">
              <Tv className="w-4 h-4" />
              <span>بدء شاشة التلفاز</span>
            </div>
          </button>

          {/* 3. TV CONTROLLER BUTTON */}
          <button
            type="button"
            onClick={() => {
              setActiveMode('tv_controller');
              handleConnectToTv();
            }}
            className="group relative flex flex-col items-center justify-between p-7 rounded-3xl bg-slate-900/90 hover:bg-slate-850 border-2 border-slate-800 hover:border-rose-400/60 shadow-xl hover:shadow-2xl hover:shadow-rose-500/10 transition-all duration-300 transform hover:-translate-y-1 active:scale-95 cursor-pointer text-center overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl group-hover:bg-rose-500/20 transition-all" />

            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-rose-600 to-purple-600 border border-rose-300/40 flex items-center justify-center text-white mb-5 shadow-lg shadow-rose-600/30 group-hover:scale-110 transition-transform">
              <Gamepad2 className="w-10 h-10" />
            </div>

            <div className="space-y-2 mb-6">
              <h3 className="text-xl font-black text-white group-hover:text-rose-300 transition-colors">
                3. يد التلفاز
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                تحويل الجوال إلى يد تحكم لاسلكية للتلفاز. الجوال لا يرسم اللعبة بل يرسل أوامر الحركة والتسارع فوراً.
              </p>
            </div>

            <div className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-purple-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md">
              <Gamepad2 className="w-4 h-4" />
              <span>فتح يد التحكم</span>
            </div>
          </button>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="relative z-10 w-full max-w-4xl mx-auto text-center border-t border-slate-800/80 pt-4 text-[11px] text-slate-300 flex flex-col sm:flex-row items-center justify-between gap-2 font-mono">
        <div>
          <span>خادم الاتصال: </span>
          <span className="text-cyan-400">{activeServerUrl}</span>
        </div>
        <div className="text-slate-400">
          <span>نسخة APK الموحدة (جوال / أندرويد TV) + Web TV</span>
        </div>
      </footer>

      {/* Server Configuration Modal */}
      {showServerSettings && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-6 text-center select-none" dir="rtl">
          <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-5 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">إعدادات خادم الاتصال</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowServerSettings(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-300 block">
                عنوان الخادم السحابي أو المحلي (IP/Domain):
              </label>
              <input
                type="text"
                placeholder="https://... أو http://192.168.1.50:3000"
                value={customServerInput}
                onChange={e => setCustomServerInput(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
              />
              <p className="text-[11px] text-slate-400 leading-relaxed">
                افتراضياً يتصل التطبيق تلقائياً بالخادم السحابي. في حال تشغيل خادم محلي على نفس الشبكة، أدخل عنوان الخادم هنا.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleSaveServerUrl}
                className="flex-1 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg transition-all"
              >
                حفظ وإعادة الاتصال
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomServerInput('');
                  setCustomServerUrl('');
                  setActiveServerUrl(getServerBaseUrl());
                  setShowServerSettings(false);
                }}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all"
              >
                استعادة الافتراضي
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
