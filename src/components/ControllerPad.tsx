import { useState, useRef, useCallback, useEffect } from 'react';
import { tvGameSessionService } from '../services/tvGameSessionService';
import {
  Circle,
  Tv,
  Eye,
  Compass
} from 'lucide-react';

interface ControllerPadProps {
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
  connectedDisplayName,
  customCommandHandler,
  playerTitle
}: ControllerPadProps) {
  // Real active input state
  const [activeButtons, setActiveButtons] = useState<Set<string>>(new Set());
  const [stickPos, setStickPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rightStickPos, setRightStickPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

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
    }
  }, [customCommandHandler]);

  // Haptic feedback
  const vibrate = useCallback((ms = 18) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch {}
    }
  }, []);

  // Send button press state to game/TV
  const pressButton = useCallback((btnName: string) => {
    activeButtonsRef.current.add(btnName);
    setActiveButtons(new Set(activeButtonsRef.current));
    vibrate(btnName === 'L2' || btnName === 'R2' ? 30 : 15);
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
  // RIGHT ANALOG STICK (CAMERA LOOK AROUND)
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
    activePointersRef.current.delete(pid);
    buttonPointerMapRef.current.delete(pid);
    try {
      e.currentTarget.releasePointerCapture(pid);
    } catch {}
    releaseButton(btnName);
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
  // UNIFIED RESPONSIVE PS5 DUALSENSE CONTROLLER LAYOUT
  // Adapts naturally to screen dimensions without fake buttons or rotated coordinates
  // =========================================================
  return (
    <div className="w-full h-full flex flex-col justify-between p-2 md:p-4 select-none touch-none overflow-hidden max-w-5xl mx-auto" dir="ltr">
      {/* Top Controller Info Bar */}
      <div className="w-full flex items-center justify-between px-3 py-1.5 border-b border-slate-800 bg-slate-900/90 rounded-2xl backdrop-blur-md mb-2">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
          <Tv className="w-4 h-4 text-cyan-400" />
          <span className="truncate max-w-[200px]">
            {connectedDisplayName ? `متصل: ${connectedDisplayName}` : (playerTitle || 'يد تحكم التلفاز الذكية')}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-mono text-emerald-400 font-bold">بث أوامر مباشر</span>
        </div>
      </div>

      {/* Top Triggers & Bumpers (L2, L1, Center Touchpad, R1, R2) */}
      <div className="w-full flex items-center justify-between px-2 sm:px-6 my-1">
        {/* Left Triggers: L2 (Brake), L1 */}
        <div className="flex gap-2">
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('L2', e)}
            onPointerUp={e => handleButtonPointerUp('L2', e)}
            className={`w-18 sm:w-22 h-14 text-xs font-mono font-black rounded-2xl border-2 transition-all flex flex-col items-center justify-center touch-none select-none ${
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
            className={`w-14 sm:w-16 h-14 text-xs font-mono font-black rounded-2xl border transition-all flex items-center justify-center touch-none select-none ${
              activeButtons.has('L1')
                ? 'bg-indigo-600 border-indigo-300 text-white shadow-lg shadow-indigo-600/50 scale-95'
                : 'bg-slate-900 border-slate-700 text-slate-300 active:bg-slate-800'
            }`}
          >
            L1
          </button>
        </div>

        {/* Center: Share, Horn Touchpad, Options */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onPointerDown={e => handleButtonPointerDown('SELECT', e)}
            onPointerUp={e => handleButtonPointerUp('SELECT', e)}
            className={`px-2.5 py-1 text-[10px] font-mono rounded-lg border transition-all ${
              activeButtons.has('SELECT') ? 'bg-slate-700 border-slate-400 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            SHARE
          </button>

          {/* PS Touchpad (Horn / Horn Beeper) */}
          <button
            type="button"
            onPointerDown={e => handleButtonPointerDown('TOUCHPAD', e)}
            onPointerUp={e => handleButtonPointerUp('TOUCHPAD', e)}
            className={`w-20 sm:w-28 h-12 rounded-xl border flex flex-col items-center justify-center text-[10px] font-bold transition-all shadow-inner ${
              activeButtons.has('TOUCHPAD')
                ? 'bg-amber-600 border-amber-300 text-white shadow-amber-500/50 scale-95'
                : 'bg-slate-900/90 border-slate-700/80 text-amber-400 hover:bg-slate-850'
            }`}
          >
            <span>بوري / منبه</span>
            <span className="text-[8px] font-mono opacity-60">Touchpad</span>
          </button>

          <button
            type="button"
            onPointerDown={e => handleButtonPointerDown('START', e)}
            onPointerUp={e => handleButtonPointerUp('START', e)}
            className={`px-2.5 py-1 text-[10px] font-mono rounded-lg border transition-all ${
              activeButtons.has('START') ? 'bg-slate-700 border-slate-400 text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            OPTIONS
          </button>
        </div>

        {/* Right Triggers: R1 (High Beam Strobe), R2 (Gas) */}
        <div className="flex gap-2">
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('R1', e)}
            onPointerUp={e => handleButtonPointerUp('R1', e)}
            className={`w-14 sm:w-16 h-14 text-xs font-mono font-black rounded-2xl border transition-all flex flex-col items-center justify-center touch-none select-none ${
              activeButtons.has('R1')
                ? 'bg-cyan-600 border-cyan-300 text-white shadow-lg shadow-cyan-600/50 scale-95'
                : 'bg-slate-900 border-cyan-900/60 text-cyan-300 active:bg-slate-800'
            }`}
          >
            <span className="text-xs font-black">R1</span>
            <span className="text-[9px] font-sans opacity-80">تكبيس</span>
          </button>
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('R2', e)}
            onPointerUp={e => handleButtonPointerUp('R2', e)}
            className={`w-18 sm:w-22 h-14 text-xs font-mono font-black rounded-2xl border-2 transition-all flex flex-col items-center justify-center touch-none select-none ${
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
      <div className="flex-1 flex items-center justify-between px-2 sm:px-8 py-1 gap-2">
        {/* LEFT WING: D-Pad and Left Analog Thumbstick */}
        <div className="flex flex-col items-center justify-center gap-2">
          {/* Directional D-Pad */}
          <div className="relative w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('UP', e)}
              onPointerUp={e => handleButtonPointerUp('UP', e)}
              className={`absolute top-0 w-9 h-10 sm:w-10 sm:h-11 rounded-t-xl border border-slate-700 flex items-center justify-center text-sm font-bold ${
                activeButtons.has('UP') ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'
              }`}
            >
              ▲
            </button>
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('DOWN', e)}
              onPointerUp={e => handleButtonPointerUp('DOWN', e)}
              className={`absolute bottom-0 w-9 h-10 sm:w-10 sm:h-11 rounded-b-xl border border-slate-700 flex items-center justify-center text-sm font-bold ${
                activeButtons.has('DOWN') ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400'
              }`}
            >
              ▼
            </button>
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('LEFT', e)}
              onPointerUp={e => handleButtonPointerUp('LEFT', e)}
              className={`absolute left-0 w-10 h-9 sm:w-11 sm:h-10 rounded-l-xl border border-slate-700 flex items-center justify-center text-sm font-bold ${
                activeButtons.has('LEFT') ? 'bg-amber-600 text-white' : 'bg-slate-900 text-slate-400'
              }`}
            >
              ◀
            </button>
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('RIGHT', e)}
              onPointerUp={e => handleButtonPointerUp('RIGHT', e)}
              className={`absolute right-0 w-10 h-9 sm:w-11 sm:h-10 rounded-r-xl border border-slate-700 flex items-center justify-center text-sm font-bold ${
                activeButtons.has('RIGHT') ? 'bg-amber-600 text-white' : 'bg-slate-900 text-slate-400'
              }`}
            >
              ▶
            </button>
            <div className="w-8 h-8 rounded bg-slate-950 border border-slate-800" />
          </div>

          {/* Left Analog Thumbstick (Steering L3) */}
          <div className="flex flex-col items-center">
            <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider mb-0.5 font-mono">
              عصا التوجيه (L3)
            </span>
            <div
              ref={stickBaseRef}
              onContextMenu={e => e.preventDefault()}
              onPointerDown={handleStickPointerDown}
              onPointerMove={handleStickPointerMove}
              onPointerUp={handleStickPointerUp}
              className="relative w-28 h-28 sm:w-34 sm:h-34 rounded-full bg-gradient-to-b from-slate-900 to-slate-950 border-2 sm:border-3 border-amber-900/60 shadow-xl flex items-center justify-center cursor-pointer touch-none select-none"
            >
              <div className="w-18 h-18 sm:w-22 sm:h-22 rounded-full border border-amber-900/40 pointer-events-none" />
              <div
                className="absolute w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-2 border-amber-400/70 shadow-lg flex items-center justify-center pointer-events-none"
                style={{ transform: `translate(${stickPos.x * 28}px, ${stickPos.y * 28}px)` }}
              >
                <div className="w-6 h-6 rounded-full bg-slate-950/80 border border-amber-500/60 flex items-center justify-center text-amber-300 text-[10px] font-bold">
                  L3
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT WING: PS Face Action Buttons & Camera Look Stick */}
        <div className="flex flex-col items-center justify-center gap-2">
          {/* Action Face Buttons (Cross, Circle, Triangle, Square) */}
          <div className="relative w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
            {/* Triangle (Handbrake / Y) */}
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('TRIANGLE', e)}
              onPointerUp={e => handleButtonPointerUp('TRIANGLE', e)}
              className={`absolute top-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full border-2 flex flex-col items-center justify-center transition-all ${
                activeButtons.has('TRIANGLE')
                  ? 'bg-emerald-600 border-emerald-300 text-white shadow-lg shadow-emerald-500/40 scale-95'
                  : 'bg-slate-900 border-emerald-800 text-emerald-400'
              }`}
            >
              <span className="text-sm font-black">▲</span>
              <span className="text-[7px] font-sans">جلنط</span>
            </button>

            {/* Circle (Horn / B) */}
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('CIRCLE', e)}
              onPointerUp={e => handleButtonPointerUp('CIRCLE', e)}
              className={`absolute right-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full border-2 flex flex-col items-center justify-center transition-all ${
                activeButtons.has('CIRCLE')
                  ? 'bg-rose-600 border-rose-300 text-white shadow-lg shadow-rose-500/40 scale-95'
                  : 'bg-slate-900 border-rose-800 text-rose-400'
              }`}
            >
              <Circle className="w-3.5 h-3.5" />
              <span className="text-[7px] font-sans">بوري</span>
            </button>

            {/* Cross (Accelerate / A) */}
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('CROSS', e)}
              onPointerUp={e => handleButtonPointerUp('CROSS', e)}
              className={`absolute bottom-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full border-2 flex flex-col items-center justify-center transition-all ${
                activeButtons.has('CROSS')
                  ? 'bg-cyan-600 border-cyan-300 text-white shadow-lg shadow-cyan-500/40 scale-95'
                  : 'bg-slate-900 border-cyan-800 text-cyan-400'
              }`}
            >
              <span className="text-sm font-black">✕</span>
              <span className="text-[7px] font-sans">دعسة</span>
            </button>

            {/* Square (Brake / X) */}
            <button
              type="button"
              onPointerDown={e => handleButtonPointerDown('SQUARE', e)}
              onPointerUp={e => handleButtonPointerUp('SQUARE', e)}
              className={`absolute left-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full border-2 flex flex-col items-center justify-center transition-all ${
                activeButtons.has('SQUARE')
                  ? 'bg-pink-600 border-pink-300 text-white shadow-lg shadow-pink-500/40 scale-95'
                  : 'bg-slate-900 border-pink-800 text-pink-400'
              }`}
            >
              <span className="text-xs font-black">■</span>
              <span className="text-[7px] font-sans">فرامل</span>
            </button>
          </div>

          {/* Right Analog Thumbstick (360° Camera Look Around - Driver Neck Motion) */}
          <div className="flex flex-col items-center">
            <span className="text-[9px] font-bold text-cyan-400 uppercase tracking-wider mb-0.5 font-mono flex items-center gap-1">
              <Eye className="w-3 h-3" />
              <span>عصا الرؤية (R3)</span>
            </span>
            <div
              ref={rightStickBaseRef}
              onContextMenu={e => e.preventDefault()}
              onPointerDown={handleRightStickPointerDown}
              onPointerMove={handleRightStickPointerMove}
              onPointerUp={handleRightStickPointerUp}
              className="relative w-28 h-28 sm:w-34 sm:h-34 rounded-full bg-gradient-to-b from-slate-900 to-slate-950 border-2 sm:border-3 border-cyan-900/60 shadow-xl flex items-center justify-center cursor-pointer touch-none select-none"
            >
              <div className="w-18 h-18 sm:w-22 sm:h-22 rounded-full border border-cyan-900/40 pointer-events-none" />
              <div
                className="absolute w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-2 border-cyan-400/70 shadow-lg flex items-center justify-center pointer-events-none"
                style={{ transform: `translate(${rightStickPos.x * 28}px, ${rightStickPos.y * 28}px)` }}
              >
                <div className="w-6 h-6 rounded-full bg-slate-950/80 border border-cyan-500/60 flex items-center justify-center text-cyan-300">
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
