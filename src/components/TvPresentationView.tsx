import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Tv,
  Gamepad2,
  Monitor,
  Activity,
  Layers,
  CheckCircle2,
  Cpu,
  Sparkles,
  Sliders,
  Maximize,
  Play,
  Compass,
  Zap,
  Users,
  X,
  Smartphone,
  KeyRound,
  Check
} from 'lucide-react';
import type { DisplayInfo } from '../services/externalDisplay';
import { controllerBus } from '../services/controllerBus';
import { multiControllerService, ConnectedPlayer } from '../services/multiControllerService';
import { CarFootballGame } from '../games/CarFootballGame';
import { SunsetHighwayGame } from '../games/SunsetHighwayGame';

interface TvPresentationViewProps {
  initialDisplay?: DisplayInfo | null;
}

type TvSection = 'library' | 'controller' | 'specs';
type ActiveGame = 'car_football' | 'sunset_highway' | null;

export function TvPresentationView({ initialDisplay }: TvPresentationViewProps) {
  const [displayInfo, setDisplayInfo] = useState<DisplayInfo | null>(() => {
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

  const [activeSection, setActiveSection] = useState<TvSection>('library');
  const [focusedFocusArea, setFocusedFocusArea] = useState<'tabs' | 'cards'>('cards');
  const [focusedTabIndex, setFocusedTabIndex] = useState<number>(0);
  const [focusedCardIndex, setFocusedCardIndex] = useState<number>(0);
  const [activeGame, setActiveGame] = useState<ActiveGame>(null);
  const [latestCommand, setLatestCommand] = useState<any>(null);

  // Extra Controller Modal State
  const [showExtraControllerModal, setShowExtraControllerModal] = useState<boolean>(false);
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [connectedExtraPlayers, setConnectedExtraPlayers] = useState<ConnectedPlayer[]>([]);

  const [lastInput, setLastInput] = useState<{
    type: string;
    button?: string;
    stick?: { x: number; y: number };
    timestamp: number;
  } | null>(null);

  const [currentTime, setCurrentTime] = useState<string>('');

  // Handle Extra Controller Host Session
  const handleOpenExtraController = async () => {
    let code = sessionCode;
    if (!code) {
      code = await multiControllerService.createHostSession();
      setSessionCode(code);
    }
    setShowExtraControllerModal(true);
  };

  useEffect(() => {
    const unsubMulti = multiControllerService.subscribe((state) => {
      if (state.sessionCode) setSessionCode(state.sessionCode);
      setConnectedExtraPlayers(state.players);
    });
    return () => unsubMulti();
  }, []);

  // Stick navigation throttle and direction refs
  const lastStickTimeRef = useRef<number>(0);
  const lastStickDirRef = useRef<string>('');

  // Handle controller navigation commands from Phone
  const handleControllerInput = useCallback((cmd: any) => {
    setLastInput({
      ...cmd,
      timestamp: Date.now()
    });
    setLatestCommand(cmd);

    // If a game is active, let the game handle inputs exclusively unless SELECT or B is pressed to return to library
    if (activeGame !== null) {
      if (cmd.type === 'button_down' && (cmd.button === 'SELECT' || cmd.button === 'B')) {
        setActiveGame(null);
      }
      return;
    }

    // MAIN PAGE 2D D-PAD & ANALOG STICK NAVIGATION
    if (cmd.type === 'button_down') {
      const btn = cmd.button;

      // Quick shoulder tabs switching (L1 / R1)
      if (btn === 'L1') {
        setActiveSection('library');
        setFocusedTabIndex(0);
        setFocusedFocusArea('tabs');
      } else if (btn === 'R1') {
        setActiveSection('specs');
        setFocusedTabIndex(2);
        setFocusedFocusArea('tabs');
      }

      // Vertical Up / Down Navigation
      else if (btn === 'UP') {
        if (focusedFocusArea === 'cards') {
          setFocusedFocusArea('tabs');
        }
      } else if (btn === 'DOWN') {
        if (focusedFocusArea === 'tabs') {
          setFocusedFocusArea('cards');
        }
      }

      // Horizontal Left / Right Navigation
      else if (btn === 'LEFT') {
        if (focusedFocusArea === 'tabs') {
          setFocusedTabIndex(t => {
            const nextTab = (t - 1 + 3) % 3;
            if (nextTab === 0) setActiveSection('library');
            if (nextTab === 1) setActiveSection('controller');
            if (nextTab === 2) setActiveSection('specs');
            return nextTab;
          });
        } else if (activeSection === 'library') {
          setFocusedCardIndex(i => (i - 1 + 2) % 2);
        }
      } else if (btn === 'RIGHT') {
        if (focusedFocusArea === 'tabs') {
          setFocusedTabIndex(t => {
            const nextTab = (t + 1) % 3;
            if (nextTab === 0) setActiveSection('library');
            if (nextTab === 1) setActiveSection('controller');
            if (nextTab === 2) setActiveSection('specs');
            return nextTab;
          });
        } else if (activeSection === 'library') {
          setFocusedCardIndex(i => (i + 1) % 2);
        }
      }

      // Select / Launch with X, A, Y, START or ENTER
      else if (btn === 'X' || btn === 'A' || btn === 'Y' || btn === 'START' || btn === 'ENTER') {
        if (focusedFocusArea === 'tabs') {
          if (focusedTabIndex === 0) setActiveSection('library');
          if (focusedTabIndex === 1) setActiveSection('controller');
          if (focusedTabIndex === 2) setActiveSection('specs');
          setFocusedFocusArea('cards');
        } else if (activeSection === 'library') {
          if (focusedCardIndex === 0) setActiveGame('car_football');
          else if (focusedCardIndex === 1) setActiveGame('sunset_highway');
        }
      }
    } else if (cmd.type === 'stick_move' && cmd.stick) {
      const { x, y } = cmd.stick;
      const now = Date.now();

      // Deadzone check: Reset direction lock when joystick returns near center
      if (Math.abs(x) < 0.25 && Math.abs(y) < 0.25) {
        lastStickDirRef.current = '';
        return;
      }

      // Determine active cardinal direction from analog stick
      let dir = '';
      if (y < -0.45) dir = 'UP';
      else if (y > 0.45) dir = 'DOWN';
      else if (x < -0.45) dir = 'LEFT';
      else if (x > 0.45) dir = 'RIGHT';

      if (dir !== '') {
        // Trigger movement if it's a new flick OR if held continuously for >= 220ms
        if (dir !== lastStickDirRef.current || now - lastStickTimeRef.current >= 220) {
          lastStickDirRef.current = dir;
          lastStickTimeRef.current = now;

          if (dir === 'UP') {
            if (focusedFocusArea === 'cards') setFocusedFocusArea('tabs');
          } else if (dir === 'DOWN') {
            if (focusedFocusArea === 'tabs') setFocusedFocusArea('cards');
          } else if (dir === 'LEFT') {
            if (focusedFocusArea === 'tabs') {
              setFocusedTabIndex(t => {
                const nextTab = (t - 1 + 3) % 3;
                if (nextTab === 0) setActiveSection('library');
                if (nextTab === 1) setActiveSection('controller');
                if (nextTab === 2) setActiveSection('specs');
                return nextTab;
              });
            } else if (activeSection === 'library') {
              setFocusedCardIndex(i => (i - 1 + 2) % 2);
            }
          } else if (dir === 'RIGHT') {
            if (focusedFocusArea === 'tabs') {
              setFocusedTabIndex(t => {
                const nextTab = (t + 1) % 3;
                if (nextTab === 0) setActiveSection('library');
                if (nextTab === 1) setActiveSection('controller');
                if (nextTab === 2) setActiveSection('specs');
                return nextTab;
              });
            } else if (activeSection === 'library') {
              setFocusedCardIndex(i => (i + 1) % 2);
            }
          }
        }
      }
    }
  }, [activeGame, activeSection, focusedFocusArea, focusedTabIndex, focusedCardIndex]);

  useEffect(() => {
    // Notify native bridge that TV page is ready
    if (typeof window !== 'undefined' && (window as any).TvNativeBridge?.onTvReady) {
      (window as any).TvNativeBridge.onTvReady();
    }

    // Native Presentation updates listener
    (window as any).onTvDisplayUpdated = (info: DisplayInfo) => {
      setDisplayInfo(info);
    };

    // Controller input listener from Phone
    const unsubBus = controllerBus.subscribe(handleControllerInput);
    (window as any).onTvControllerInput = handleControllerInput;

    // Browser development event listener
    const handleBrowserInput = (e: any) => {
      handleControllerInput(e.detail);
    };
    window.addEventListener('gamingshell_control_input', handleBrowserInput);

    // Live Clock
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);

    return () => {
      unsubBus();
      clearInterval(timer);
      window.removeEventListener('gamingshell_control_input', handleBrowserInput);
      delete (window as any).onTvDisplayUpdated;
      delete (window as any).onTvControllerInput;
    };
  }, [handleControllerInput]);

  // Modal Render for "Extra Controller" Pairing Code
  const renderExtraControllerModal = () => {
    if (!showExtraControllerModal) return null;

    return (
      <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-6 text-right select-none animate-in fade-in duration-200" dir="rtl">
        <div className="max-w-lg w-full bg-slate-900 border-2 border-indigo-500/50 rounded-3xl p-8 shadow-2xl space-y-6 relative overflow-hidden">
          {/* Ambient glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/10 rounded-full blur-2xl pointer-events-none" />

          {/* Close button */}
          <button
            type="button"
            onClick={() => setShowExtraControllerModal(false)}
            className="absolute top-6 left-6 p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black text-white">تحكم إضافي (Extra Controller)</h3>
              <p className="text-xs text-slate-400">
                انضمام هاتف ثانٍ كيد تحكم إضافية للعب معاً في نفس الجلسة
              </p>
            </div>
          </div>

          {/* Big Join Code Display */}
          <div className="bg-slate-950 border border-indigo-500/30 rounded-2xl p-6 text-center space-y-3 shadow-inner">
            <span className="text-xs uppercase tracking-widest text-indigo-400 font-bold font-mono">
              رمز الانضمام ليد التحكم (Join Code)
            </span>
            <div className="text-5xl font-black tracking-widest font-mono text-white flex items-center justify-center gap-3">
              <span className="bg-indigo-950/80 px-5 py-2.5 rounded-2xl border border-indigo-500/50 shadow-xl text-indigo-300">
                {sessionCode || '....'}
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              افتح التطبيق من هاتفك الثاني، اختر <b className="text-indigo-300">"تحكم إضافي"</b> واكتب هذا الرمز للانضمام فوراً.
            </p>
          </div>

          {/* Connected Extra Players List */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-400 block font-mono">
              الأجهزة وأيادي التحكم المتصلة ({1 + connectedExtraPlayers.length}):
            </span>
            <div className="space-y-2 max-h-36 overflow-y-auto">
              {/* Host Main Controller */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-bold text-white">اللاعب 1 (الهاتف الرئيسي المضيف)</span>
                </div>
                <span className="text-emerald-400 font-mono text-[11px] bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30 font-bold">
                  الجهاز الأساسي
                </span>
              </div>

              {/* Additional Joined Players */}
              {connectedExtraPlayers.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-indigo-500/30 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />
                    <span className="font-bold text-indigo-200">{p.name}</span>
                  </div>
                  <span className="text-indigo-400 font-mono text-[11px] bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-500/30 font-bold">
                    تحكم إضافي نشط
                  </span>
                </div>
              ))}

              {connectedExtraPlayers.length === 0 && (
                <div className="text-center py-2 text-xs text-slate-500 italic">
                  في انتظار انضمام هاتف ثانٍ عبر الرمز أعلاه...
                </div>
              )}
            </div>
          </div>

          {/* Modal Action Button */}
          <button
            type="button"
            onClick={() => setShowExtraControllerModal(false)}
            className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
          >
            <span>متابعة اللعب وإبقاء الجلسة مفتوحة</span>
          </button>
        </div>
      </div>
    );
  };

  // IF A GAME IS ACTIVE: Render Game in Full TV Display View
  if (activeGame === 'car_football') {
    return (
      <div className="w-screen h-screen bg-slate-950 overflow-hidden relative">
        <CarFootballGame
          onBackToMenu={() => setActiveGame(null)}
          controllerCommand={latestCommand}
        />

        {/* Floating Quick "Extra Controller" Badge on TV Screen */}
        <div className="fixed top-4 left-4 z-40 flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenExtraController}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-white border border-indigo-500/40 shadow-xl backdrop-blur-md text-xs font-bold transition-all"
            dir="rtl"
          >
            <Users className="w-4 h-4 text-indigo-400" />
            <span>تحكم إضافي:</span>
            <span className="font-mono text-indigo-300 font-black">{sessionCode || 'فتح الرمز'}</span>
            {connectedExtraPlayers.length > 0 && (
              <span className="px-1.5 py-0.2 rounded bg-emerald-500 text-slate-950 text-[10px] font-bold">
                +{connectedExtraPlayers.length}
              </span>
            )}
          </button>
        </div>

        {renderExtraControllerModal()}
      </div>
    );
  }

  if (activeGame === 'sunset_highway') {
    return (
      <div className="w-screen h-screen bg-slate-950 overflow-hidden relative">
        <SunsetHighwayGame
          onBackToMenu={() => setActiveGame(null)}
          controllerCommand={latestCommand}
        />
        {renderExtraControllerModal()}
      </div>
    );
  }

  // MAIN TV SHELL CONSOLE DASHBOARD
  return (
    <div
      className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col justify-between p-6 md:p-10 select-none overflow-hidden font-sans relative"
      dir="rtl"
    >
      {/* Background Ambience / Subtle Console Glow */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* =========================================
          TV CONSOLE HEADER BAR
         ========================================= */}
      <header className="relative z-10 flex items-center justify-between border-b border-slate-800/80 pb-5">
        {/* Console Branding */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 border border-indigo-400/40 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
            <Tv className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-black tracking-wide text-white">منصة الألعاب</h1>
              <span className="text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 px-3 py-1 rounded-full font-bold uppercase tracking-wider">
                شاشة العرض الرئيسية
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
              <span>عرض مخصص للشاشات الكبيرة والتلفاز</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400 flex items-center gap-1.5 font-medium">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                مخرج مرئي نشط عبر أندرويد Presentation
              </span>
            </div>
          </div>
        </div>

        {/* Center: "Extra Controller" Action Button */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleOpenExtraController}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 border border-indigo-400/40 transition-all scale-105 active:scale-95"
          >
            <Users className="w-4 h-4 text-indigo-200" />
            <span>تحكم إضافي (Extra Controller)</span>
            {sessionCode && (
              <span className="px-2 py-0.5 rounded-lg bg-slate-950/60 font-mono text-indigo-300 text-[11px] font-black border border-indigo-400/30">
                {sessionCode}
              </span>
            )}
            {connectedExtraPlayers.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-emerald-400 text-slate-950 font-black text-[10px] flex items-center justify-center">
                {connectedExtraPlayers.length}
              </span>
            )}
          </button>

          {/* Live Controller Status Indicator */}
          <div className="hidden lg:flex items-center gap-3 px-4 py-2 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-md">
            <Gamepad2 className="w-5 h-5 text-indigo-400" />
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                <span>يد تحكم الهاتف</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              </div>
              <div className="text-[11px] font-mono text-emerald-400">
                {lastInput ? (
                  lastInput.type === 'button_down' ? (
                    <span>زر [{lastInput.button}]</span>
                  ) : lastInput.type === 'stick_move' ? (
                    <span>عصا نشطة</span>
                  ) : (
                    <span>جاهز للاستقبال</span>
                  )
                ) : (
                  <span className="text-slate-400">متصل وجاهز</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Hardware Specs & Time */}
        <div className="text-left font-mono">
          <div className="text-2xl md:text-3xl font-black text-white tracking-wider">
            {currentTime || '--:--:--'}
          </div>
          <div className="text-xs text-indigo-300/80 mt-0.5 flex items-center gap-2 justify-end">
            <Monitor className="w-3.5 h-3.5" />
            <span>
              {displayInfo
                ? `${displayInfo.width}×${displayInfo.height} · ${Math.round(displayInfo.refreshRate || 60)}Hz`
                : 'دقة الشاشة التلقائية'}
            </span>
          </div>
        </div>
      </header>

      {/* =========================================
          NAVIGATION CATEGORY TABS
         ========================================= */}
      <nav className="relative z-10 flex items-center gap-3 my-4">
        <button
          type="button"
          onClick={() => {
            setActiveSection('library');
            setFocusedTabIndex(0);
            setFocusedFocusArea('tabs');
          }}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
            activeSection === 'library'
              ? (focusedFocusArea === 'tabs' && focusedTabIndex === 0
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 scale-105 ring-2 ring-indigo-300 border border-indigo-300'
                  : 'bg-indigo-600 text-white shadow-md border border-indigo-400/40')
              : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>مكتبة الألعاب (4 ألعاب جاهزة)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveSection('controller');
            setFocusedTabIndex(1);
            setFocusedFocusArea('tabs');
          }}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
            activeSection === 'controller'
              ? (focusedFocusArea === 'tabs' && focusedTabIndex === 1
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 scale-105 ring-2 ring-indigo-300 border border-indigo-300'
                  : 'bg-indigo-600 text-white shadow-md border border-indigo-400/40')
              : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>لوحة استقبال التحكم</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveSection('specs');
            setFocusedTabIndex(2);
            setFocusedFocusArea('tabs');
          }}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
            activeSection === 'specs'
              ? (focusedFocusArea === 'tabs' && focusedTabIndex === 2
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 scale-105 ring-2 ring-indigo-300 border border-indigo-300'
                  : 'bg-indigo-600 text-white shadow-md border border-indigo-400/40')
              : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>معلومات الشاشة والنظام</span>
        </button>
      </nav>

      {/* =========================================
          MAIN INTERFACE BODY
         ========================================= */}
      <main className="relative z-10 flex-1 flex flex-col justify-center my-2">
        {/* VIEW 1: GAMES LIBRARY */}
        {activeSection === 'library' && (
          <div className="w-full max-w-6xl mx-auto space-y-6">
            {/* Section Overview Banner */}
            <div className="flex items-center justify-between px-2">
              <div>
                <h2 className="text-xl md:text-2xl font-black text-white">منصة تشغيل الألعاب الرئيسية</h2>
                <p className="text-xs md:text-sm text-slate-400 mt-1">
                  اختر أي لعبة لتشغيلها فوراً على شاشة التلفاز والتحكم الكامل بها عبر الهاتف.
                </p>
              </div>
              <div className="text-xs text-slate-400 font-mono flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                <span>استخدم الأسهم أو انقر لبدء اللعبة [زر X / A]</span>
              </div>
            </div>

            {/* TWO INDEPENDENT GAMES CARDS SIDE BY SIDE */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              {/* GAME 1: CAR FOOTBALL */}
              <div
                onClick={() => {
                  setFocusedCardIndex(0);
                  setFocusedFocusArea('cards');
                  setActiveGame('car_football');
                }}
                className={`rounded-3xl p-7 transition-all duration-300 cursor-pointer flex flex-col justify-between min-h-[340px] border ${
                  focusedFocusArea === 'cards' && focusedCardIndex === 0
                    ? 'bg-gradient-to-b from-blue-950/90 to-slate-900/95 border-blue-400 shadow-2xl shadow-blue-600/40 scale-[1.04] ring-4 ring-blue-400/50'
                    : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="px-3.5 py-1 rounded-xl text-xs font-mono font-bold bg-blue-950/80 text-blue-300 border border-blue-800/60">
                    لعبة #1
                  </span>
                  <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-blue-500 text-white uppercase tracking-wider">
                    لاعبين متعددين
                  </span>
                </div>

                <div className="my-6 flex flex-col items-center text-center space-y-4">
                  <div
                    className={`w-20 h-20 rounded-2xl flex items-center justify-center border transition-all ${
                      focusedFocusArea === 'cards' && focusedCardIndex === 0
                        ? 'bg-blue-600/30 border-blue-400/60 text-blue-300 scale-110 shadow-lg'
                        : 'bg-slate-800/40 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Gamepad2 className="w-10 h-10" />
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="text-xl font-black text-white">كرة سيارات أرينا</h3>
                    <p className="text-xs text-slate-300 leading-relaxed px-2">
                      منافسة سيارات سريعة وتصادمات واقعية لتسجيل الأهداف مع تيربو ودعم تحكم متعدد.
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400 flex items-center gap-1.5 font-medium text-[11px]">
                    <Sparkles className="w-4 h-4 text-blue-400" />
                    تحكم إضافي متعدد
                  </span>
                  <span className="text-blue-300 font-bold flex items-center gap-1.5">
                    <Play className="w-4 h-4 fill-current" />
                    تشغيل [A / X]
                  </span>
                </div>
              </div>

              {/* GAME 2: SUNSET HIGHWAY DRIVE 3D */}
              <div
                onClick={() => {
                  setFocusedCardIndex(1);
                  setFocusedFocusArea('cards');
                  setActiveGame('sunset_highway');
                }}
                className={`rounded-3xl p-7 transition-all duration-300 cursor-pointer flex flex-col justify-between min-h-[340px] border ${
                  focusedFocusArea === 'cards' && focusedCardIndex === 1
                    ? 'bg-gradient-to-b from-amber-950/90 to-slate-900/95 border-amber-400 shadow-2xl shadow-amber-600/40 scale-[1.04] ring-4 ring-amber-400/50'
                    : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="px-3.5 py-1 rounded-xl text-xs font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800/60">
                    لعبة #2
                  </span>
                  <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 uppercase tracking-wider font-extrabold">
                    محرك 3D حقيقي
                  </span>
                </div>

                <div className="my-6 flex flex-col items-center text-center space-y-4">
                  <div
                    className={`w-20 h-20 rounded-2xl flex items-center justify-center border transition-all ${
                      focusedFocusArea === 'cards' && focusedCardIndex === 1
                        ? 'bg-amber-600/30 border-amber-400/60 text-amber-300 scale-110 shadow-lg'
                        : 'bg-slate-800/40 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Sparkles className="w-10 h-10 text-amber-400 animate-pulse" />
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="text-xl font-black text-white">طريق الغروب السريع 3D</h3>
                    <p className="text-xs text-slate-300 leading-relaxed px-2">
                      كابينة قيادة 3D تفاعلية مع دركسون متحرك ورؤية حقيقية وانعكاسات مرئية مصممة بمحرك Three.js.
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400 flex items-center gap-1.5 font-medium text-[11px]">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    انعكاسات حقيقية 3D
                  </span>
                  <span className="text-amber-300 font-bold flex items-center gap-1.5">
                    <Play className="w-4 h-4 fill-current" />
                    تشغيل [A / X]
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: CONTROLLER LINK & TELEMETRY */}
        {activeSection === 'controller' && (
          <div className="w-full max-w-4xl mx-auto rounded-3xl border border-slate-800 bg-slate-900/60 p-8 space-y-6 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-xl font-black text-white">لوحة استقبال أوامر التحكم</h2>
                <p className="text-xs text-slate-400 mt-1">
                  مرآة حية فورية لكافة إشارات الأزرار وعصا التحكم المرسلة من الهاتف.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                استجابة فورية (Zero-Latency Bridge)
              </span>
            </div>

            {/* Controller Input Mirror Display */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                <span className="text-xs text-slate-400 font-mono">حالة المستشعر:</span>
                <div className="text-lg font-bold text-white flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse"></div>
                  <span>متصل وجاهز للاستقبال</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                <span className="text-xs text-slate-400 font-mono">آخر أمر تم استقباله:</span>
                <div className="text-lg font-mono font-bold text-indigo-400">
                  {lastInput ? `${lastInput.type} ${lastInput.button ? `[${lastInput.button}]` : ''}` : 'لا توجد أوامر بعد'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: HARDWARE & SPECS */}
        {activeSection === 'specs' && (
          <div className="w-full max-w-4xl mx-auto rounded-3xl border border-slate-800 bg-slate-900/60 p-8 space-y-6 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-xl font-black text-white">معلومات الشاشة والنظام التقديمي</h2>
                <p className="text-xs text-slate-400 mt-1">
                  بيانات تقنية مباشرة مستخرجة من محرك العرض التقديمي.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                أندرويد Presentation
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
                <span className="text-xs text-slate-400">اسم الشاشة</span>
                <div className="text-sm font-bold text-white truncate">
                  {displayInfo?.name || 'شاشة التلفاز الرئيسية'}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
                <span className="text-xs text-slate-400">معرّف الشاشة</span>
                <div className="text-sm font-bold text-white font-mono">
                  #{displayInfo?.displayId || '0'}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
                <span className="text-xs text-slate-400">الدقة الحالية</span>
                <div className="text-sm font-bold text-white font-mono">
                  {displayInfo ? `${displayInfo.width} × ${displayInfo.height}` : 'تلقائي'}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
                <span className="text-xs text-slate-400">معدل التحديث</span>
                <div className="text-sm font-bold text-white font-mono">
                  {Math.round(displayInfo?.refreshRate || 60)} هرتز
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Presentation Bottom Status Bar */}
      <footer className="relative z-10 flex items-center justify-between border-t border-slate-800/80 pt-4 text-xs text-slate-400 font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>منظومة الألعاب والتلفاز نشطة بالكامل</span>
        </div>
        <div>نظام العرض التقديمي لأندرويد (DisplayManager Engine)</div>
      </footer>

      {/* Render Extra Controller Modal */}
      {renderExtraControllerModal()}
    </div>
  );
}
