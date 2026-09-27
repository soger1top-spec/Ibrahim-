import { useState, useRef, useCallback, useEffect } from 'react';
import { externalDisplayService } from '../services/externalDisplay';
import { tvGameSessionService } from '../services/tvGameSessionService';
import {
  Circle,
  Maximize2,
  Minimize2,
  RotateCw,
  Tv,
  Eye,
  Compass
} from 'lucide-react';

interface ControllerPadProps {
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  connectedDisplayName?: string;
  customCommandHandler?: (cmd: any) => void;
  playerTitle?: string;
}

interface TouchPoint {
  pointerId: number;
  type: 'stick' | 'rightStick' | 'button';
  targetName?: string;
}

export function ControllerPad({
  isFullscreen = false,
  onToggleFullscreen,
  connectedDisplayName,
  customCommandHandler,
  playerTitle
}: ControllerPadProps) {
  // Real active input state
  const [activeButtons, setActiveButtons] = useState<Set<string>>(new Set());
  const [stickPos, setStickPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rightStickPos, setRightStickPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isForcedLandscape, setIsForcedLandscape] = useState(false);

  // Independent multi-touch pointer tracking refs
  const activePointersRef = useRef<Map<number, TouchPoint>>(new Map());
  const buttonPointerMapRef = useRef<Map<number, string>>(new Map());
  const stickPointerIdRef = useRef<number | null>(null);
  const rightStickPointerIdRef = useRef<number | null>(null);
  const activeButtonsRef = useRef<Set<string>>(new Set());

  const stickBaseRef = useRef<HTMLDivElement>(null);
  const rightStickBaseRef = useRef<HTMLDivElement>(null);

  // Throttling refs to cap updates at ~30Hz max
  const lastStickDispatchTimeRef = useRef<number>(0);
  const lastSentStickRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastRightStickDispatchTimeRef = useRef<number>(0);
  const lastSentRightStickRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const dispatchCommand = useCallback((cmd: any) => {
    tvGameSessionService.sendTvControlCommand(cmd);
    if (customCommandHandler) {
      customCommandHandler(cmd);
    } else {
      externalDisplayService.sendControlCommand(cmd);
    }
  }, [customCommandHandler]);

  const vibrate = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(15);
      } catch {
        // ignore if not supported
      }
    }
  }, []);

  // Send button press state to game/TV
  const pressButton = useCallback((btnName: string) => {
    vibrate();
    activeButtonsRef.current.add(btnName);
    setActiveButtons(new Set(activeButtonsRef.current));
    dispatchCommand({
      type: 'button_down',
      button: btnName
    });
  }, [vibrate, dispatchCommand]);

  // Send button release state to game/TV
  const releaseButton = useCallback((btnName: string) => {
    activeButtonsRef.current.delete(btnName);
    setActiveButtons(new Set(activeButtonsRef.current));
    dispatchCommand({
      type: 'button_up',
      button: btnName
    });
  }, [dispatchCommand]);

  // -------------------------------------------------------------
  // LEFT ANALOG STICK (STEERING & ACCEL/BRAKE)
  // -------------------------------------------------------------
  const updateStickFromCoords = useCallback((clientX: number, clientY: number) => {
    if (!stickBaseRef.current) return;
    const rect = stickBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);

    if (dist < 4) {
      setStickPos({ x: 0, y: 0 });
      if (lastSentStickRef.current.x !== 0 || lastSentStickRef.current.y !== 0) {
        lastSentStickRef.current = { x: 0, y: 0 };
        dispatchCommand({
          type: 'stick_move',
          stick: { x: 0, y: 0 }
        });
      }
      return;
    }

    const angle = Math.atan2(dy, dx);
    const responsiveRadius = radius * 0.75;
    const power = Math.min(1.0, dist / responsiveRadius);

    const normX = Number((Math.cos(angle) * power).toFixed(3));
    const normY = Number((Math.sin(angle) * power).toFixed(3));

    const visualDist = Math.min(dist, radius);
    const visualX = (Math.cos(angle) * visualDist) / radius;
    const visualY = (Math.sin(angle) * visualDist) / radius;
    setStickPos({ x: visualX, y: visualY });

    const now = performance.now();
    const dxSinceLast = Math.abs(normX - lastSentStickRef.current.x);
    const dySinceLast = Math.abs(normY - lastSentStickRef.current.y);

    if (now - lastStickDispatchTimeRef.current >= 33 || dxSinceLast >= 0.04 || dySinceLast >= 0.04) {
      lastStickDispatchTimeRef.current = now;
      lastSentStickRef.current = { x: normX, y: normY };
      dispatchCommand({
        type: 'stick_move',
        stick: { x: normX, y: normY }
      });
    }
  }, [dispatchCommand]);

  const resetStick = useCallback(() => {
    setStickPos({ x: 0, y: 0 });
    lastSentStickRef.current = { x: 0, y: 0 };
    lastStickDispatchTimeRef.current = 0;
    dispatchCommand({
      type: 'stick_move',
      stick: { x: 0, y: 0 }
    });
    dispatchCommand({
      type: 'stick_release'
    });
  }, [dispatchCommand]);

  const handleStickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pid = e.pointerId;
    activePointersRef.current.set(pid, { pointerId: pid, type: 'stick' });
    stickPointerIdRef.current = pid;
    vibrate();
    try {
      e.currentTarget.setPointerCapture(pid);
    } catch {}
    updateStickFromCoords(e.clientX, e.clientY);
  };

  const handleStickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    updateStickFromCoords(e.clientX, e.clientY);
  };

  const handleStickPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    stickPointerIdRef.current = null;
    activePointersRef.current.delete(e.pointerId);
    resetStick();
  };

  // -------------------------------------------------------------
  // RIGHT ANALOG STICK (CAMERA LOOK AROUND 360° - PS5 STYLE)
  // -------------------------------------------------------------
  const updateRightStickFromCoords = useCallback((clientX: number, clientY: number) => {
    if (!rightStickBaseRef.current) return;
    const rect = rightStickBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);

    if (dist < 4) {
      setRightStickPos({ x: 0, y: 0 });
      if (lastSentRightStickRef.current.x !== 0 || lastSentRightStickRef.current.y !== 0) {
        lastSentRightStickRef.current = { x: 0, y: 0 };
        dispatchCommand({
          type: 'camera_look',
          stick: { x: 0, y: 0 }
        });
      }
      return;
    }

    const angle = Math.atan2(dy, dx);
    const responsiveRadius = radius * 0.75;
    const power = Math.min(1.0, dist / responsiveRadius);

    const normX = Number((Math.cos(angle) * power).toFixed(3));
    const normY = Number((Math.sin(angle) * power).toFixed(3));

    const visualDist = Math.min(dist, radius);
    const visualX = (Math.cos(angle) * visualDist) / radius;
    const visualY = (Math.sin(angle) * visualDist) / radius;
    setRightStickPos({ x: visualX, y: visualY });

    const now = performance.now();
    const dxSinceLast = Math.abs(normX - lastSentRightStickRef.current.x);
    const dySinceLast = Math.abs(normY - lastSentRightStickRef.current.y);

    if (now - lastRightStickDispatchTimeRef.current >= 33 || dxSinceLast >= 0.04 || dySinceLast >= 0.04) {
      lastRightStickDispatchTimeRef.current = now;
      lastSentRightStickRef.current = { x: normX, y: normY };
      dispatchCommand({
        type: 'camera_look',
        stick: { x: normX, y: normY }
      });
    }
  }, [dispatchCommand]);

  const resetRightStick = useCallback(() => {
    setRightStickPos({ x: 0, y: 0 });
    lastSentRightStickRef.current = { x: 0, y: 0 };
    lastRightStickDispatchTimeRef.current = 0;
    dispatchCommand({
      type: 'camera_look',
      stick: { x: 0, y: 0 }
    });
    dispatchCommand({
      type: 'camera_look_reset'
    });
  }, [dispatchCommand]);

  const handleRightStickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pid = e.pointerId;
    activePointersRef.current.set(pid, { pointerId: pid, type: 'rightStick' });
    rightStickPointerIdRef.current = pid;
    vibrate();
    try {
      e.currentTarget.setPointerCapture(pid);
    } catch {}
    updateRightStickFromCoords(e.clientX, e.clientY);
  };

  const handleRightStickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rightStickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    updateRightStickFromCoords(e.clientX, e.clientY);
  };

  const handleRightStickPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rightStickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    rightStickPointerIdRef.current = null;
    activePointersRef.current.delete(e.pointerId);
    resetRightStick();
  };

  // --- MULTI-TOUCH BUTTON EVENT HANDLERS ---
  const handleButtonPointerDown = (btnName: string, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const pid = e.pointerId;
    activePointersRef.current.set(pid, { pointerId: pid, type: 'button', targetName: btnName });
    buttonPointerMapRef.current.set(pid, btnName);
    try {
      e.currentTarget.setPointerCapture(pid);
    } catch {}
    pressButton(btnName);
  };

  const handleButtonPointerUp = (btnName: string, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const pid = e.pointerId;
    if (buttonPointerMapRef.current.get(pid) === btnName) {
      buttonPointerMapRef.current.delete(pid);
      activePointersRef.current.delete(pid);
      try {
        e.currentTarget.releasePointerCapture(pid);
      } catch {}
      releaseButton(btnName);
    }
  };

  useEffect(() => {
    const handleGlobalPointerUp = (e: PointerEvent) => {
      const touch = activePointersRef.current.get(e.pointerId);
      if (!touch) return;

      if (touch.type === 'stick') {
        stickPointerIdRef.current = null;
        activePointersRef.current.delete(e.pointerId);
        resetStick();
      } else if (touch.type === 'rightStick') {
        rightStickPointerIdRef.current = null;
        activePointersRef.current.delete(e.pointerId);
        resetRightStick();
      } else if (touch.type === 'button' && touch.targetName) {
        releaseButton(touch.targetName);
        buttonPointerMapRef.current.delete(e.pointerId);
        activePointersRef.current.delete(e.pointerId);
      }
    };

    window.addEventListener('pointerup', handleGlobalPointerUp);
    window.addEventListener('pointercancel', handleGlobalPointerUp);
    return () => {
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('pointercancel', handleGlobalPointerUp);
    };
  }, [releaseButton, resetStick, resetRightStick]);

  // Keyboard mapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') pressButton('UP');
      if (key === 's' || key === 'arrowdown') pressButton('DOWN');
      if (key === 'a' || key === 'arrowleft') pressButton('LEFT');
      if (key === 'd' || key === 'arrowright') pressButton('RIGHT');
      if (key === 'j') pressButton('A');
      if (key === 'k') pressButton('B');
      if (key === 'u') pressButton('X');
      if (key === 'i') pressButton('Y');
      if (key === 'q') pressButton('L1');
      if (key === 'e') pressButton('R1');
      if (key === 'enter') pressButton('START');
      if (key === ' ') pressButton('SELECT');
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') releaseButton('UP');
      if (key === 's' || key === 'arrowdown') releaseButton('DOWN');
      if (key === 'a' || key === 'arrowleft') releaseButton('LEFT');
      if (key === 'd' || key === 'arrowright') releaseButton('RIGHT');
      if (key === 'j') releaseButton('A');
      if (key === 'k') releaseButton('B');
      if (key === 'u') releaseButton('X');
      if (key === 'i') releaseButton('Y');
      if (key === 'q') releaseButton('L1');
      if (key === 'e') releaseButton('R1');
      if (key === 'enter') releaseButton('START');
      if (key === ' ') releaseButton('SELECT');
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [pressButton, releaseButton]);

  // =========================================================
  // FULLSCREEN PS5 DUALSENSE CONTROLLER LAYOUT
  // =========================================================
  if (isFullscreen) {
    return (
      <div
        className={`fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col justify-between p-3 select-none touch-none overflow-hidden ${
          isForcedLandscape ? 'rotate-90 origin-top-left w-[100vh] h-[100vw] translate-x-[100vw]' : 'w-screen h-screen'
        }`}
        dir="ltr"
      >
        {/* Fullscreen Top Navigation Bar */}
        <div className="w-full flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/90 rounded-2xl backdrop-blur-md">
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-rose-600/20 border border-rose-500/40 text-rose-300 active:bg-rose-600/40 text-xs font-semibold shadow-sm transition-all"
          >
            <Minimize2 className="w-4 h-4" />
            <span>إنهاء ملء الشاشة</span>
          </button>

          <div className="flex items-center gap-3 text-xs font-medium text-slate-300">
            <Tv className="w-4 h-4 text-cyan-400" />
            <span className="truncate max-w-[150px]">
              {connectedDisplayName ? `متصل: ${connectedDisplayName}` : (playerTitle || 'تحكم PS5 اللاسلكي')}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-mono">
              DualSense 360°
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsForcedLandscape(!isForcedLandscape)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 active:bg-slate-700 text-xs font-medium transition-all"
            title="تبديل الوضع الأفقي"
          >
            <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>{isForcedLandscape ? 'الوضع العادي' : 'الوضع المستطيل'}</span>
          </button>
        </div>

        {/* Top Triggers & Bumpers (L2, L1, Center Touchpad, R1, R2) */}
        <div className="w-full flex items-center justify-between px-6 my-2">
          {/* Left Triggers: L2 (Brake), L1 */}
          <div className="flex gap-2.5">
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('L2', e)}
              onPointerUp={e => handleButtonPointerUp('L2', e)}
              className={`w-20 h-14 text-xs font-mono font-black rounded-2xl border-2 transition-all flex flex-col items-center justify-center touch-none select-none ${
                activeButtons.has('L2')
                  ? 'bg-rose-600 border-rose-300 text-white shadow-xl shadow-rose-600/50 scale-95 ring-2 ring-rose-400'
                  : 'bg-slate-900 border-rose-900/60 text-rose-300 active:bg-slate-800 shadow-md'
              }`}
            >
              <span className="text-sm font-black">L2</span>
              <span className="text-[9px] font-sans opacity-80">فرامل</span>
            </button>
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('L1', e)}
              onPointerUp={e => handleButtonPointerUp('L1', e)}
              className={`w-18 h-14 text-xs font-mono font-black rounded-2xl border transition-all flex items-center justify-center touch-none select-none ${
                activeButtons.has('L1')
                  ? 'bg-indigo-600 border-indigo-300 text-white shadow-lg shadow-indigo-600/50 scale-95'
                  : 'bg-slate-900 border-slate-700 text-slate-300 active:bg-slate-800'
              }`}
            >
              L1
            </button>
          </div>

          {/* Center DualSense Touchpad / Lightbar */}
          <div className="flex flex-col items-center gap-1.5 px-4 py-2 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-cyan-500/40 shadow-lg shadow-cyan-950/40">
            <div className="w-32 h-1 bg-cyan-400 rounded-full shadow-[0_0_12px_rgba(6,182,212,0.9)] animate-pulse" />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onContextMenu={e => e.preventDefault()}
                onPointerDown={e => handleButtonPointerDown('SELECT', e)}
                onPointerUp={e => handleButtonPointerUp('SELECT', e)}
                className={`px-3 py-1 text-[11px] font-bold rounded-lg border transition-all ${
                  activeButtons.has('SELECT') ? 'bg-slate-700 border-slate-400 text-white' : 'bg-slate-900/80 border-slate-800 text-slate-400'
                }`}
              >
                CREATE
              </button>
              <div className="w-6 h-6 rounded-full bg-slate-800 border border-cyan-500/50 flex items-center justify-center text-[10px] font-black text-cyan-300">
                PS
              </div>
              <button
                type="button"
                onContextMenu={e => e.preventDefault()}
                onPointerDown={e => handleButtonPointerDown('START', e)}
                onPointerUp={e => handleButtonPointerUp('START', e)}
                className={`px-3 py-1 text-[11px] font-bold rounded-lg border transition-all ${
                  activeButtons.has('START') ? 'bg-slate-700 border-slate-400 text-white' : 'bg-slate-900/80 border-slate-800 text-slate-400'
                }`}
              >
                OPTIONS
              </button>
            </div>
          </div>

          {/* Right Triggers: R1 (High Beam Strobe), R2 (Gas) */}
          <div className="flex gap-2.5">
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('R1', e)}
              onPointerUp={e => handleButtonPointerUp('R1', e)}
              className={`w-18 h-14 text-xs font-mono font-black rounded-2xl border transition-all flex flex-col items-center justify-center touch-none select-none ${
                activeButtons.has('R1')
                  ? 'bg-cyan-600 border-cyan-300 text-white shadow-lg shadow-cyan-600/50 scale-95'
                  : 'bg-slate-900 border-cyan-900/60 text-cyan-300 active:bg-slate-800'
              }`}
            >
              <span className="text-sm font-black">R1</span>
              <span className="text-[9px] font-sans opacity-80">تكبيس</span>
            </button>
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('R2', e)}
              onPointerUp={e => handleButtonPointerUp('R2', e)}
              className={`w-20 h-14 text-xs font-mono font-black rounded-2xl border-2 transition-all flex flex-col items-center justify-center touch-none select-none ${
                activeButtons.has('R2')
                  ? 'bg-emerald-600 border-emerald-300 text-white shadow-xl shadow-emerald-600/50 scale-95 ring-2 ring-emerald-400'
                  : 'bg-slate-900 border-emerald-900/60 text-emerald-300 active:bg-slate-800 shadow-md'
              }`}
            >
              <span className="text-sm font-black">R2</span>
              <span className="text-[9px] font-sans opacity-80">بنزين</span>
            </button>
          </div>
        </div>

        {/* Dual PS5 Wings: Left (D-Pad + Left Stick) | Right (PS Face Buttons + Right Camera Stick) */}
        <div className="flex-1 flex items-center justify-between px-10 py-2">
          {/* LEFT WING: D-Pad (Top) and Left Analog Thumbstick (Bottom) */}
          <div className="flex flex-col items-center justify-center gap-3">
            {/* Directional D-Pad */}
            <div className="relative w-32 h-32 flex items-center justify-center">
              <button
                type="button"
                onPointerDown={e => handleButtonPointerDown('UP', e)}
                onPointerUp={e => handleButtonPointerUp('UP', e)}
                className={`absolute top-0 w-10 h-11 rounded-t-xl border border-slate-700 flex items-center justify-center text-sm font-bold ${
                  activeButtons.has('UP') ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'
                }`}
              >
                ▲
              </button>
              <button
                type="button"
                onPointerDown={e => handleButtonPointerDown('DOWN', e)}
                onPointerUp={e => handleButtonPointerUp('DOWN', e)}
                className={`absolute bottom-0 w-10 h-11 rounded-b-xl border border-slate-700 flex items-center justify-center text-sm font-bold ${
                  activeButtons.has('DOWN') ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'
                }`}
              >
                ▼
              </button>
              <button
                type="button"
                onPointerDown={e => handleButtonPointerDown('LEFT', e)}
                onPointerUp={e => handleButtonPointerUp('LEFT', e)}
                className={`absolute left-0 w-11 h-10 rounded-l-xl border border-slate-700 flex items-center justify-center text-sm font-bold ${
                  activeButtons.has('LEFT') ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'
                }`}
              >
                ◀
              </button>
              <button
                type="button"
                onPointerDown={e => handleButtonPointerDown('RIGHT', e)}
                onPointerUp={e => handleButtonPointerUp('RIGHT', e)}
                className={`absolute right-0 w-11 h-10 rounded-r-xl border border-slate-700 flex items-center justify-center text-sm font-bold ${
                  activeButtons.has('RIGHT') ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'
                }`}
              >
                ▶
              </button>
              <div className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800" />
            </div>

            {/* Left Analog Thumbstick (Steering & Movement 360°) */}
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">
                عصا التوجيه والحركة (L3)
              </span>
              <div
                ref={stickBaseRef}
                onContextMenu={e => e.preventDefault()}
                onPointerDown={handleStickPointerDown}
                onPointerMove={handleStickPointerMove}
                onPointerUp={handleStickPointerUp}
                className="relative w-36 h-36 rounded-full bg-gradient-to-b from-slate-900 to-slate-950 border-3 border-slate-800 shadow-2xl flex items-center justify-center cursor-pointer touch-none select-none"
              >
                <div className="w-24 h-24 rounded-full border border-slate-800/80 pointer-events-none" />
                <div
                  className="absolute w-18 h-18 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-2 border-slate-400 shadow-xl flex items-center justify-center pointer-events-none"
                  style={{ transform: `translate(${stickPos.x * 34}px, ${stickPos.y * 34}px)` }}
                >
                  <div className="w-8 h-8 rounded-full bg-slate-950/80 border border-slate-600 flex items-center justify-center text-cyan-400">
                    <Circle className="w-3.5 h-3.5 fill-current opacity-70" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT WING: PS Face Buttons Diamond (Top) and Right Camera Thumbstick (Bottom) */}
          <div className="flex flex-col items-center justify-center gap-3">
            {/* PlayStation 5 Action Diamond: △ (Triangle/Y - Handbrake), ▢ (Square/X - Brake), ○ (Circle/B - Horn), ✕ (Cross/A - Gas) */}
            <div className="relative w-36 h-36 rounded-full bg-slate-900/40 border border-slate-800/60 p-2 flex items-center justify-center touch-none select-none">
              {/* Triangle / Y (Top - Handbrake جلنط) */}
              <button
                type="button"
                onPointerDown={e => handleButtonPointerDown('Y', e)}
                onPointerUp={e => handleButtonPointerUp('Y', e)}
                className={`absolute top-1 w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center font-black transition-all ${
                  activeButtons.has('Y')
                    ? 'bg-amber-500 border-amber-200 text-slate-950 scale-95 shadow-lg shadow-amber-500/50'
                    : 'bg-slate-900 border-amber-500/50 text-amber-400 active:bg-slate-800'
                }`}
                title="مثلث - جلنط / تفحيط (Y)"
              >
                <span className="text-base leading-none">▲</span>
                <span className="text-[8px] font-sans font-normal opacity-90">جلنط</span>
              </button>

              {/* Square / X (Left - Brake فرامل) */}
              <button
                type="button"
                onPointerDown={e => handleButtonPointerDown('X', e)}
                onPointerUp={e => handleButtonPointerUp('X', e)}
                className={`absolute left-1 w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center font-black transition-all ${
                  activeButtons.has('X')
                    ? 'bg-rose-500 border-rose-200 text-white scale-95 shadow-lg shadow-rose-500/50'
                    : 'bg-slate-900 border-rose-500/50 text-rose-400 active:bg-slate-800'
                }`}
                title="مربع - فرامل (X)"
              >
                <span className="text-base leading-none">■</span>
                <span className="text-[8px] font-sans font-normal opacity-90">فرامل</span>
              </button>

              {/* Circle / B (Right - Horn بوري) */}
              <button
                type="button"
                onPointerDown={e => handleButtonPointerDown('B', e)}
                onPointerUp={e => handleButtonPointerUp('B', e)}
                className={`absolute right-1 w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center font-black transition-all ${
                  activeButtons.has('B')
                    ? 'bg-indigo-600 border-indigo-200 text-white scale-95 shadow-lg shadow-indigo-500/50'
                    : 'bg-slate-900 border-indigo-500/50 text-indigo-300 active:bg-slate-800'
                }`}
                title="دائرة - بوري وتنبيه (B)"
              >
                <span className="text-base leading-none">●</span>
                <span className="text-[8px] font-sans font-normal opacity-90">بوري</span>
              </button>

              {/* Cross / A (Bottom - Gas بنزين) */}
              <button
                type="button"
                onPointerDown={e => handleButtonPointerDown('A', e)}
                onPointerUp={e => handleButtonPointerUp('A', e)}
                className={`absolute bottom-1 w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center font-black transition-all ${
                  activeButtons.has('A')
                    ? 'bg-emerald-500 border-emerald-200 text-slate-950 scale-95 shadow-lg shadow-emerald-500/50'
                    : 'bg-slate-900 border-emerald-500/50 text-emerald-300 active:bg-slate-800'
                }`}
                title="إكس - بنزين وتسارع (A)"
              >
                <span className="text-base leading-none">✖</span>
                <span className="text-[8px] font-sans font-normal opacity-90">بنزين</span>
              </button>
            </div>

            {/* Right Analog Thumbstick (360° Camera Look Around - Driver Neck Motion) */}
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider mb-1 font-mono flex items-center gap-1">
                <Eye className="w-3 h-3" />
                <span>عصا الكاميرا والرؤية (R3)</span>
              </span>
              <div
                ref={rightStickBaseRef}
                onContextMenu={e => e.preventDefault()}
                onPointerDown={handleRightStickPointerDown}
                onPointerMove={handleRightStickPointerMove}
                onPointerUp={handleRightStickPointerUp}
                className="relative w-36 h-36 rounded-full bg-gradient-to-b from-slate-900 to-slate-950 border-3 border-cyan-900/60 shadow-2xl shadow-cyan-950/40 flex items-center justify-center cursor-pointer touch-none select-none"
              >
                <div className="w-24 h-24 rounded-full border border-cyan-900/40 pointer-events-none" />
                <div
                  className="absolute w-18 h-18 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-2 border-cyan-400/70 shadow-xl flex items-center justify-center pointer-events-none"
                  style={{ transform: `translate(${rightStickPos.x * 34}px, ${rightStickPos.y * 34}px)` }}
                >
                  <div className="w-8 h-8 rounded-full bg-slate-950/80 border border-cyan-500/60 flex items-center justify-center text-cyan-300">
                    <Compass className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================
  // STANDARD EMBEDDED CONTROLLER LAYOUT (PS5 DUALSENSE INSPIRED)
  // =========================================================
  return (
    <div className="w-full flex flex-col items-center select-none touch-none p-2" dir="ltr">
      {onToggleFullscreen && (
        <div className="w-full max-w-md mb-3">
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="w-full py-2.5 px-4 rounded-2xl bg-gradient-to-r from-cyan-600 via-indigo-600 to-purple-700 hover:from-cyan-500 hover:to-indigo-500 active:scale-[0.99] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all border border-cyan-400/40 cursor-pointer"
          >
            <Maximize2 className="w-4 h-4" />
            <span>ملء الشاشة ليد تحكم PS5 (عرض أفقي عريض متكامل)</span>
          </button>
        </div>
      )}

      {/* Top Triggers & Bumpers (L2, L1, Center PS Bar, R1, R2) */}
      <div className="w-full max-w-md flex items-center justify-between px-2 mb-3 gap-2">
        <div className="flex gap-1.5">
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('L2', e)}
            onPointerUp={e => handleButtonPointerUp('L2', e)}
            className={`px-3 py-2 text-xs font-mono font-black rounded-xl border transition-all flex flex-col items-center justify-center touch-none select-none ${
              activeButtons.has('L2')
                ? 'bg-rose-600 border-rose-300 text-white shadow-lg scale-95'
                : 'bg-slate-900 border-rose-950/80 text-rose-300 active:bg-slate-800'
            }`}
          >
            <span>L2</span>
            <span className="text-[8px] font-sans opacity-70">فرامل</span>
          </button>
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('L1', e)}
            onPointerUp={e => handleButtonPointerUp('L1', e)}
            className={`px-3 py-2 text-xs font-mono font-black rounded-xl border transition-all touch-none select-none ${
              activeButtons.has('L1') ? 'bg-indigo-600 border-indigo-300 text-white' : 'bg-slate-900 border-slate-700 text-slate-300'
            }`}
          >
            L1
          </button>
        </div>

        {/* Center PlayStation Touchpad Bar */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900 border border-cyan-500/30">
          <button
            type="button"
            onPointerDown={e => handleButtonPointerDown('SELECT', e)}
            onPointerUp={e => handleButtonPointerUp('SELECT', e)}
            className="text-[10px] font-bold text-slate-400 hover:text-white px-1.5 py-0.5"
          >
            SHARE
          </button>
          <div className="w-4 h-4 rounded-full bg-slate-800 border border-cyan-400/50 flex items-center justify-center text-[8px] font-black text-cyan-300">
            PS
          </div>
          <button
            type="button"
            onPointerDown={e => handleButtonPointerDown('START', e)}
            onPointerUp={e => handleButtonPointerUp('START', e)}
            className="text-[10px] font-bold text-slate-400 hover:text-white px-1.5 py-0.5"
          >
            OPTIONS
          </button>
        </div>

        <div className="flex gap-1.5">
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('R1', e)}
            onPointerUp={e => handleButtonPointerUp('R1', e)}
            className={`px-3 py-2 text-xs font-mono font-black rounded-xl border transition-all flex flex-col items-center justify-center touch-none select-none ${
              activeButtons.has('R1')
                ? 'bg-cyan-600 border-cyan-300 text-white shadow-lg scale-95'
                : 'bg-slate-900 border-cyan-950/80 text-cyan-300 active:bg-slate-800'
            }`}
          >
            <span>R1</span>
            <span className="text-[8px] font-sans opacity-70">تكبيس</span>
          </button>
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('R2', e)}
            onPointerUp={e => handleButtonPointerUp('R2', e)}
            className={`px-3 py-2 text-xs font-mono font-black rounded-xl border transition-all flex flex-col items-center justify-center touch-none select-none ${
              activeButtons.has('R2')
                ? 'bg-emerald-600 border-emerald-300 text-white shadow-lg scale-95'
                : 'bg-slate-900 border-emerald-950/80 text-emerald-300 active:bg-slate-800'
            }`}
          >
            <span>R2</span>
            <span className="text-[8px] font-sans opacity-70">بنزين</span>
          </button>
        </div>
      </div>

      {/* Main Dual Wings Grid: Left (Steer Stick + D-Pad) | Right (Action Diamond + Camera Look Stick) */}
      <div className="w-full max-w-md grid grid-cols-2 gap-3 px-2 py-1 items-start">
        {/* LEFT WING: D-Pad and Left Analog Thumbstick */}
        <div className="flex flex-col items-center gap-3 bg-slate-900/40 border border-slate-800/80 rounded-3xl p-3">
          {/* Mini D-Pad */}
          <div className="relative w-24 h-24 flex items-center justify-center">
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('UP', e)}
              onPointerUp={e => handleButtonPointerUp('UP', e)}
              className={`absolute top-0 w-8 h-8 rounded-t-lg border border-slate-700 flex items-center justify-center text-xs ${
                activeButtons.has('UP') ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'
              }`}
            >
              ▲
            </button>
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('DOWN', e)}
              onPointerUp={e => handleButtonPointerUp('DOWN', e)}
              className={`absolute bottom-0 w-8 h-8 rounded-b-lg border border-slate-700 flex items-center justify-center text-xs ${
                activeButtons.has('DOWN') ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'
              }`}
            >
              ▼
            </button>
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('LEFT', e)}
              onPointerUp={e => handleButtonPointerUp('LEFT', e)}
              className={`absolute left-0 w-8 h-8 rounded-l-lg border border-slate-700 flex items-center justify-center text-xs ${
                activeButtons.has('LEFT') ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'
              }`}
            >
              ◀
            </button>
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('RIGHT', e)}
              onPointerUp={e => handleButtonPointerUp('RIGHT', e)}
              className={`absolute right-0 w-8 h-8 rounded-r-lg border border-slate-700 flex items-center justify-center text-xs ${
                activeButtons.has('RIGHT') ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'
              }`}
            >
              ▶
            </button>
          </div>

          {/* Left Analog Stick */}
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-bold text-slate-400 mb-1 font-mono">
              عصا التوجيه والحركة
            </span>
            <div
              ref={stickBaseRef}
              onContextMenu={e => e.preventDefault()}
              onPointerDown={handleStickPointerDown}
              onPointerMove={handleStickPointerMove}
              onPointerUp={handleStickPointerUp}
              className="relative w-32 h-32 rounded-full bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-slate-700 shadow-xl flex items-center justify-center cursor-pointer touch-none select-none"
            >
              <div className="w-20 h-20 rounded-full border border-slate-800 pointer-events-none" />
              <div
                className="absolute w-16 h-16 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-2 border-slate-400 shadow-lg flex items-center justify-center pointer-events-none"
                style={{ transform: `translate(${stickPos.x * 28}px, ${stickPos.y * 28}px)` }}
              >
                <div className="w-7 h-7 rounded-full bg-slate-950/80 border border-slate-600 flex items-center justify-center text-cyan-400">
                  <Circle className="w-3 h-3 fill-current opacity-70" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT WING: Action Diamond + Right Camera Stick */}
        <div className="flex flex-col items-center gap-3 bg-slate-900/40 border border-slate-800/80 rounded-3xl p-3">
          {/* Action Diamond: △ (جلنط) ▢ (فرامل) ○ (بوري) ✕ (بنزين) */}
          <div className="relative w-28 h-28 rounded-full bg-slate-900/30 border border-slate-800/60 flex items-center justify-center touch-none select-none">
            {/* Triangle (Top / Y - جلنط) */}
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('Y', e)}
              onPointerUp={e => handleButtonPointerUp('Y', e)}
              className={`absolute top-0 w-9 h-9 rounded-full border flex flex-col items-center justify-center font-bold transition-all ${
                activeButtons.has('Y')
                  ? 'bg-amber-500 border-amber-200 text-slate-950 scale-95'
                  : 'bg-slate-900 border-amber-500/60 text-amber-400'
              }`}
              title="مثلث - جلنط / تفحيط (Y)"
            >
              <span className="text-xs leading-none">▲</span>
              <span className="text-[7px] font-sans font-normal opacity-90">جلنط</span>
            </button>
            {/* Square (Left / X - فرامل) */}
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('X', e)}
              onPointerUp={e => handleButtonPointerUp('X', e)}
              className={`absolute left-0 w-9 h-9 rounded-full border flex flex-col items-center justify-center font-bold transition-all ${
                activeButtons.has('X')
                  ? 'bg-rose-500 border-rose-200 text-white scale-95'
                  : 'bg-slate-900 border-rose-500/60 text-rose-400'
              }`}
              title="مربع - فرامل (X)"
            >
              <span className="text-xs leading-none">■</span>
              <span className="text-[7px] font-sans font-normal opacity-90">فرامل</span>
            </button>
            {/* Circle (Right / B - بوري) */}
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('B', e)}
              onPointerUp={e => handleButtonPointerUp('B', e)}
              className={`absolute right-0 w-9 h-9 rounded-full border flex flex-col items-center justify-center font-bold transition-all ${
                activeButtons.has('B')
                  ? 'bg-indigo-600 border-indigo-200 text-white scale-95'
                  : 'bg-slate-900 border-indigo-500/60 text-indigo-300'
              }`}
              title="دائرة - بوري وتنبيه (B)"
            >
              <span className="text-xs leading-none">●</span>
              <span className="text-[7px] font-sans font-normal opacity-90">بوري</span>
            </button>
            {/* Cross (Bottom / A - بنزين) */}
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('A', e)}
              onPointerUp={e => handleButtonPointerUp('A', e)}
              className={`absolute bottom-0 w-9 h-9 rounded-full border flex flex-col items-center justify-center font-bold transition-all ${
                activeButtons.has('A')
                  ? 'bg-emerald-500 border-emerald-200 text-slate-950 scale-95'
                  : 'bg-slate-900 border-emerald-500/60 text-emerald-300'
              }`}
              title="إكس - بنزين وتسارع (A)"
            >
              <span className="text-xs leading-none">✖</span>
              <span className="text-[7px] font-sans font-normal opacity-90">بنزين</span>
            </button>
          </div>

          {/* Right Analog Stick (Camera Look 360°) */}
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-bold text-cyan-400 mb-1 font-mono flex items-center gap-1">
              <Eye className="w-3 h-3" />
              <span>عصا الكاميرا (يمين/يسار/فوق/تحت)</span>
            </span>
            <div
              ref={rightStickBaseRef}
              onContextMenu={e => e.preventDefault()}
              onPointerDown={handleRightStickPointerDown}
              onPointerMove={handleRightStickPointerMove}
              onPointerUp={handleRightStickPointerUp}
              className="relative w-32 h-32 rounded-full bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-cyan-700/60 shadow-xl flex items-center justify-center cursor-pointer touch-none select-none"
            >
              <div className="w-20 h-20 rounded-full border border-cyan-900/40 pointer-events-none" />
              <div
                className="absolute w-16 h-16 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-2 border-cyan-400 shadow-lg flex items-center justify-center pointer-events-none"
                style={{ transform: `translate(${rightStickPos.x * 28}px, ${rightStickPos.y * 28}px)` }}
              >
                <div className="w-7 h-7 rounded-full bg-slate-950/80 border border-cyan-500/60 flex items-center justify-center text-cyan-300">
                  <Compass className="w-3 h-3" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
