import { useState, useRef, useCallback, useEffect } from 'react';
import { externalDisplayService } from '../services/externalDisplay';
import {
  Circle,
  Maximize2,
  Minimize2,
  RotateCw,
  Tv
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
  type: 'stick' | 'button';
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
  const [isForcedLandscape, setIsForcedLandscape] = useState(false);

  // Independent multi-touch pointer tracking refs
  const activePointersRef = useRef<Map<number, TouchPoint>>(new Map());
  const buttonPointerMapRef = useRef<Map<number, string>>(new Map());
  const stickPointerIdRef = useRef<number | null>(null);
  const activeButtonsRef = useRef<Set<string>>(new Set());

  const stickBaseRef = useRef<HTMLDivElement>(null);

  // Throttling refs to cap stick_move updates at ~30Hz max
  const lastStickDispatchTimeRef = useRef<number>(0);
  const lastSentStickRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const dispatchCommand = useCallback((cmd: any) => {
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

  // Calculate and dispatch directional stick movement (Throttled at max 30Hz)
  const updateStickFromCoords = useCallback((clientX: number, clientY: number) => {
    if (!stickBaseRef.current) return;
    const rect = stickBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);

    // Deadzone check
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

    // Update local UI position IMMEDIATELY for 60fps responsive knob feedback
    const visualDist = Math.min(dist, radius);
    const visualX = (Math.cos(angle) * visualDist) / radius;
    const visualY = (Math.sin(angle) * visualDist) / radius;
    setStickPos({ x: visualX, y: visualY });

    // Throttle remote control bridge updates (~33ms min interval or significant delta)
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

  // Reset thumbstick when its specific pointer releases (IMMEDIATE Zero Dispatch)
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

  // --- MULTI-TOUCH STICK EVENT HANDLERS (Identified by pointerId) ---
  const handleStickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pid = e.pointerId;
    activePointersRef.current.set(pid, { pointerId: pid, type: 'stick' });
    stickPointerIdRef.current = pid;
    vibrate();
    try {
      e.currentTarget.setPointerCapture(pid);
    } catch {
      // Ignore
    }
    updateStickFromCoords(e.clientX, e.clientY);
  };

  const handleStickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only process move if this event belongs to the stick pointer
    if (stickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    updateStickFromCoords(e.clientX, e.clientY);
  };

  const handleStickPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    stickPointerIdRef.current = null;
    activePointersRef.current.delete(e.pointerId);
    resetStick();
  };

  // --- MULTI-TOUCH BUTTON EVENT HANDLERS (Each button tracked by pointerId) ---
  const handleButtonPointerDown = (btnName: string, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const pid = e.pointerId;
    activePointersRef.current.set(pid, { pointerId: pid, type: 'button', targetName: btnName });
    buttonPointerMapRef.current.set(pid, btnName);
    try {
      e.currentTarget.setPointerCapture(pid);
    } catch {
      // Ignore
    }
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
      } catch {
        // Ignore
      }
      releaseButton(btnName);
    }
  };

  // Global Pointer Listeners: Guarantees that if any finger lifts outside or cancels,
  // ONLY that finger's input is released, leaving all other simultaneous touches active!
  useEffect(() => {
    const handleGlobalPointerUp = (e: PointerEvent) => {
      const touch = activePointersRef.current.get(e.pointerId);
      if (!touch) return;

      if (touch.type === 'stick') {
        stickPointerIdRef.current = null;
        activePointersRef.current.delete(e.pointerId);
        resetStick();
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
  }, [resetStick, releaseButton]);

  // Keyboard navigation fallback for browser development
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
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

  // FULLSCREEN GAMEPAD CONTROLLER LAYOUT
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
          {/* Exit Fullscreen Button */}
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-rose-600/20 border border-rose-500/40 text-rose-300 active:bg-rose-600/40 text-xs font-semibold shadow-sm transition-all"
          >
            <Minimize2 className="w-4 h-4" />
            <span>إنهاء ملء الشاشة</span>
          </button>

          {/* Controller Multi-Touch Status */}
          <div className="flex items-center gap-3 text-xs font-medium text-slate-300">
            <Tv className="w-4 h-4 text-indigo-400" />
            <span className="truncate max-w-[150px]">
              {connectedDisplayName ? `متصل: ${connectedDisplayName}` : 'يد التحكم (Multi-Touch)'}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">
              لمس متعدد نشط
            </span>
          </div>

          {/* Orientation Toggle Button */}
          <button
            type="button"
            onClick={() => setIsForcedLandscape(!isForcedLandscape)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 active:bg-slate-700 text-xs font-medium transition-all"
            title="تبديل الوضع الأفقي"
          >
            <RotateCw className="w-3.5 h-3.5 text-indigo-400" />
            <span>{isForcedLandscape ? 'الوضع العادي' : 'الوضع المستطيل'}</span>
          </button>
        </div>

        {/* Top Shoulder Trigger Bar */}
        <div className="w-full flex items-center justify-between px-6 my-2">
          {/* Left Bumpers (L2, L1) */}
          <div className="flex gap-2.5">
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('L2', e)}
              onPointerUp={e => handleButtonPointerUp('L2', e)}
              className={`w-16 h-12 text-xs font-mono font-black rounded-2xl border transition-all flex items-center justify-center touch-none select-none ${
                activeButtons.has('L2')
                  ? 'bg-indigo-600 border-indigo-300 text-white shadow-lg shadow-indigo-600/50 scale-95 ring-2 ring-indigo-400'
                  : 'bg-slate-900 border-slate-700 text-slate-300 active:bg-slate-800'
              }`}
            >
              L2
            </button>
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('L1', e)}
              onPointerUp={e => handleButtonPointerUp('L1', e)}
              className={`w-18 h-12 text-xs font-mono font-black rounded-2xl border transition-all flex items-center justify-center touch-none select-none ${
                activeButtons.has('L1')
                  ? 'bg-indigo-600 border-indigo-300 text-white shadow-lg shadow-indigo-600/50 scale-95 ring-2 ring-indigo-400'
                  : 'bg-slate-900 border-slate-700 text-slate-300 active:bg-slate-800'
              }`}
            >
              L1
            </button>
          </div>

          {/* Center System Buttons (SELECT / START) */}
          <div className="flex gap-3">
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('SELECT', e)}
              onPointerUp={e => handleButtonPointerUp('SELECT', e)}
              className={`px-4 py-2 text-xs font-bold rounded-xl border transition-all touch-none select-none ${
                activeButtons.has('SELECT')
                  ? 'bg-slate-700 border-slate-400 text-white scale-95 ring-1 ring-slate-400'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              SELECT
            </button>
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('START', e)}
              onPointerUp={e => handleButtonPointerUp('START', e)}
              className={`px-4 py-2 text-xs font-bold rounded-xl border transition-all touch-none select-none ${
                activeButtons.has('START')
                  ? 'bg-slate-700 border-slate-400 text-white scale-95 ring-1 ring-slate-400'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              START
            </button>
          </div>

          {/* Right Bumpers (R1, R2) */}
          <div className="flex gap-2.5">
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('R1', e)}
              onPointerUp={e => handleButtonPointerUp('R1', e)}
              className={`w-18 h-12 text-xs font-mono font-black rounded-2xl border transition-all flex items-center justify-center touch-none select-none ${
                activeButtons.has('R1')
                  ? 'bg-indigo-600 border-indigo-300 text-white shadow-lg shadow-indigo-600/50 scale-95 ring-2 ring-indigo-400'
                  : 'bg-slate-900 border-slate-700 text-slate-300 active:bg-slate-800'
              }`}
            >
              R1
            </button>
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('R2', e)}
              onPointerUp={e => handleButtonPointerUp('R2', e)}
              className={`w-16 h-12 text-xs font-mono font-black rounded-2xl border transition-all flex items-center justify-center touch-none select-none ${
                activeButtons.has('R2')
                  ? 'bg-indigo-600 border-indigo-300 text-white shadow-lg shadow-indigo-600/50 scale-95 ring-2 ring-indigo-400'
                  : 'bg-slate-900 border-slate-700 text-slate-300 active:bg-slate-800'
              }`}
            >
              R2
            </button>
          </div>
        </div>

        {/* Main Gamepad Dual Wings: Left (Movement Joystick) | Right (Action Diamond) */}
        <div className="flex-1 flex items-center justify-between px-10 py-2">
          {/* LEFT WING: Console Thumbstick / Movement Controller */}
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 font-mono">
              عصا التوجيه والحركة (360°)
            </span>
            <div
              ref={stickBaseRef}
              onContextMenu={e => e.preventDefault()}
              onPointerDown={handleStickPointerDown}
              onPointerMove={handleStickPointerMove}
              onPointerUp={handleStickPointerUp}
              className="relative w-48 h-48 rounded-full bg-gradient-to-b from-slate-900 to-slate-950 border-4 border-slate-800 shadow-2xl shadow-indigo-950/40 flex items-center justify-center cursor-pointer touch-none select-none"
            >
              {/* Inner Orbital Boundary */}
              <div className="w-36 h-36 rounded-full border border-slate-800/80 pointer-events-none flex items-center justify-center">
                <div className="w-24 h-24 rounded-full border border-slate-800/40" />
              </div>

              {/* 3D Ergonomic Analog Floating Thumb Cap */}
              <div
                className="absolute w-24 h-24 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-3 border-slate-500 shadow-2xl flex items-center justify-center pointer-events-none"
                style={{
                  transform: `translate(${stickPos.x * 46}px, ${stickPos.y * 46}px)`
                }}
              >
                {/* Thumb Gripping Dimple */}
                <div className="w-12 h-12 rounded-full bg-slate-950/80 border-2 border-slate-600/80 shadow-inner flex items-center justify-center text-indigo-400">
                  <Circle className="w-5 h-5 fill-current opacity-60" />
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT WING: Gamepad Action Diamond Cluster (Y, X, B, A) */}
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 font-mono">
              أزرار التحكم والأكشن
            </span>
            <div className="relative w-56 h-56 rounded-full bg-slate-900/40 border border-slate-800/60 p-4 flex items-center justify-center touch-none select-none">
              {/* Y Button (Top / Yellow) */}
              <button
                type="button"
                onContextMenu={e => e.preventDefault()}
                onPointerDown={e => handleButtonPointerDown('Y', e)}
                onPointerUp={e => handleButtonPointerUp('Y', e)}
                className={`absolute top-2 w-16 h-16 rounded-full border-3 flex items-center justify-center text-2xl font-black font-mono transition-all touch-none select-none ${
                  activeButtons.has('Y')
                    ? 'bg-amber-500 border-amber-200 text-slate-950 scale-95 shadow-xl shadow-amber-500/50 ring-4 ring-amber-400'
                    : 'bg-slate-900 border-amber-500/50 text-amber-400 active:bg-slate-800 shadow-md'
                }`}
              >
                Y
              </button>

              {/* X Button (Left / Blue) */}
              <button
                type="button"
                onContextMenu={e => e.preventDefault()}
                onPointerDown={e => handleButtonPointerDown('X', e)}
                onPointerUp={e => handleButtonPointerUp('X', e)}
                className={`absolute left-2 w-16 h-16 rounded-full border-3 flex items-center justify-center text-2xl font-black font-mono transition-all touch-none select-none ${
                  activeButtons.has('X')
                    ? 'bg-blue-500 border-blue-200 text-slate-950 scale-95 shadow-xl shadow-blue-500/50 ring-4 ring-blue-400'
                    : 'bg-slate-900 border-blue-500/50 text-blue-400 active:bg-slate-800 shadow-md'
                }`}
              >
                X
              </button>

              {/* B Button (Right / Red) */}
              <button
                type="button"
                onContextMenu={e => e.preventDefault()}
                onPointerDown={e => handleButtonPointerDown('B', e)}
                onPointerUp={e => handleButtonPointerUp('B', e)}
                className={`absolute right-2 w-16 h-16 rounded-full border-3 flex items-center justify-center text-2xl font-black font-mono transition-all touch-none select-none ${
                  activeButtons.has('B')
                    ? 'bg-rose-500 border-rose-200 text-slate-950 scale-95 shadow-xl shadow-rose-500/50 ring-4 ring-rose-400'
                    : 'bg-slate-900 border-rose-500/50 text-rose-400 active:bg-slate-800 shadow-md'
                }`}
              >
                B
              </button>

              {/* A Button (Bottom / Green - Primary Action) */}
              <button
                type="button"
                onContextMenu={e => e.preventDefault()}
                onPointerDown={e => handleButtonPointerDown('A', e)}
                onPointerUp={e => handleButtonPointerUp('A', e)}
                className={`absolute bottom-2 w-16 h-16 rounded-full border-3 flex items-center justify-center text-2xl font-black font-mono transition-all touch-none select-none ${
                  activeButtons.has('A')
                    ? 'bg-emerald-500 border-emerald-200 text-slate-950 scale-95 shadow-xl shadow-emerald-500/50 ring-4 ring-emerald-400'
                    : 'bg-slate-900 border-emerald-500/50 text-emerald-400 active:bg-slate-800 shadow-md'
                }`}
              >
                A
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // STANDARD EMBEDDED CONTROLLER LAYOUT
  return (
    <div className="w-full flex flex-col items-center select-none touch-none p-2" dir="ltr">
      {onToggleFullscreen && (
        <div className="w-full max-w-md mb-3">
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="w-full py-2.5 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 active:scale-[0.99] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all border border-indigo-400/40"
          >
            <Maximize2 className="w-4 h-4" />
            <span>ملء الشاشة ليد التحكم (عرض أفقي عريض ومريح للعب)</span>
          </button>
        </div>
      )}

      {/* Top Shoulder Buttons & System Bar */}
      <div className="w-full max-w-md flex items-center justify-between px-2 mb-4 gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('L2', e)}
            onPointerUp={e => handleButtonPointerUp('L2', e)}
            className={`px-3.5 py-2 text-xs font-mono font-black rounded-xl border transition-all touch-none select-none ${
              activeButtons.has('L2')
                ? 'bg-indigo-600 border-indigo-300 text-white shadow-lg'
                : 'bg-slate-900 border-slate-700 text-slate-300 active:bg-slate-800'
            }`}
          >
            L2
          </button>
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('L1', e)}
            onPointerUp={e => handleButtonPointerUp('L1', e)}
            className={`px-4 py-2 text-xs font-mono font-black rounded-xl border transition-all touch-none select-none ${
              activeButtons.has('L1')
                ? 'bg-indigo-600 border-indigo-300 text-white shadow-lg'
                : 'bg-slate-900 border-slate-700 text-slate-300 active:bg-slate-800'
            }`}
          >
            L1
          </button>
        </div>

        {/* Center Select / Start */}
        <div className="flex gap-2">
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('SELECT', e)}
            onPointerUp={e => handleButtonPointerUp('SELECT', e)}
            className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all touch-none select-none ${
              activeButtons.has('SELECT')
                ? 'bg-slate-700 border-slate-400 text-white'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            تحديد
          </button>
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('START', e)}
            onPointerUp={e => handleButtonPointerUp('START', e)}
            className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all touch-none select-none ${
              activeButtons.has('START')
                ? 'bg-slate-700 border-slate-400 text-white'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            بدء
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('R1', e)}
            onPointerUp={e => handleButtonPointerUp('R1', e)}
            className={`px-4 py-2 text-xs font-mono font-black rounded-xl border transition-all touch-none select-none ${
              activeButtons.has('R1')
                ? 'bg-indigo-600 border-indigo-300 text-white shadow-lg'
                : 'bg-slate-900 border-slate-700 text-slate-300 active:bg-slate-800'
            }`}
          >
            R1
          </button>
          <button
            type="button"
            onContextMenu={e => e.preventDefault()}
            onPointerDown={e => handleButtonPointerDown('R2', e)}
            onPointerUp={e => handleButtonPointerUp('R2', e)}
            className={`px-3.5 py-2 text-xs font-mono font-black rounded-xl border transition-all touch-none select-none ${
              activeButtons.has('R2')
                ? 'bg-indigo-600 border-indigo-300 text-white shadow-lg'
                : 'bg-slate-900 border-slate-700 text-slate-300 active:bg-slate-800'
            }`}
          >
            R2
          </button>
        </div>
      </div>

      {/* Main Gamepad Dual Wings: Left (Movement Joystick) | Right (Action Diamond) */}
      <div className="w-full max-w-md grid grid-cols-2 gap-4 px-2 py-1 items-center">
        {/* Left Side: Ergonomic Gamepad Analog Movement Thumbstick */}
        <div className="flex flex-col items-center">
          <span className="text-[11px] font-bold text-slate-400 mb-1 font-mono">
            عصا التوجيه والحركة (360°)
          </span>
          <div
            ref={stickBaseRef}
            onContextMenu={e => e.preventDefault()}
            onPointerDown={handleStickPointerDown}
            onPointerMove={handleStickPointerMove}
            onPointerUp={handleStickPointerUp}
            className="relative w-36 h-36 rounded-full bg-gradient-to-b from-slate-900 to-slate-950 border-3 border-slate-800 shadow-xl flex items-center justify-center cursor-pointer touch-none select-none"
          >
            {/* Inner Ring */}
            <div className="w-26 h-26 rounded-full border border-slate-800/80 pointer-events-none" />

            {/* Floating Analog Thumbstick Cap */}
            <div
              className="absolute w-18 h-18 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-2 border-slate-400 shadow-xl flex items-center justify-center pointer-events-none"
              style={{
                transform: `translate(${stickPos.x * 32}px, ${stickPos.y * 32}px)`
              }}
            >
              <div className="w-8 h-8 rounded-full bg-slate-950/80 border border-slate-600 flex items-center justify-center text-indigo-400">
                <Circle className="w-3.5 h-3.5 fill-current opacity-70" />
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Gamepad Action Diamond Cluster (Y, X, B, A) */}
        <div className="flex flex-col items-center">
          <span className="text-[11px] font-bold text-slate-400 mb-1 font-mono">
            أزرار الأكشن
          </span>
          <div className="relative w-36 h-36 rounded-full bg-slate-900/30 border border-slate-800/60 flex items-center justify-center touch-none select-none">
            {/* Y Button (Top) */}
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('Y', e)}
              onPointerUp={e => handleButtonPointerUp('Y', e)}
              className={`absolute top-0 w-12 h-12 rounded-full border-2 flex items-center justify-center text-lg font-black font-mono transition-all touch-none select-none ${
                activeButtons.has('Y')
                  ? 'bg-amber-500 border-amber-200 text-slate-950 scale-95 shadow-lg shadow-amber-500/50 ring-2 ring-amber-400'
                  : 'bg-slate-900 border-amber-500/60 text-amber-400 active:bg-slate-800'
              }`}
            >
              Y
            </button>

            {/* X Button (Left) */}
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('X', e)}
              onPointerUp={e => handleButtonPointerUp('X', e)}
              className={`absolute left-0 w-12 h-12 rounded-full border-2 flex items-center justify-center text-lg font-black font-mono transition-all touch-none select-none ${
                activeButtons.has('X')
                  ? 'bg-blue-500 border-blue-200 text-slate-950 scale-95 shadow-lg shadow-blue-500/50 ring-2 ring-blue-400'
                  : 'bg-slate-900 border-blue-500/60 text-blue-400 active:bg-slate-800'
              }`}
            >
              X
            </button>

            {/* B Button (Right) */}
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('B', e)}
              onPointerUp={e => handleButtonPointerUp('B', e)}
              className={`absolute right-0 w-12 h-12 rounded-full border-2 flex items-center justify-center text-lg font-black font-mono transition-all touch-none select-none ${
                activeButtons.has('B')
                  ? 'bg-rose-500 border-rose-200 text-slate-950 scale-95 shadow-lg shadow-rose-500/50 ring-2 ring-rose-400'
                  : 'bg-slate-900 border-rose-500/60 text-rose-400 active:bg-slate-800'
              }`}
            >
              B
            </button>

            {/* A Button (Bottom - Primary) */}
            <button
              type="button"
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => handleButtonPointerDown('A', e)}
              onPointerUp={e => handleButtonPointerUp('A', e)}
              className={`absolute bottom-0 w-12 h-12 rounded-full border-2 flex items-center justify-center text-lg font-black font-mono transition-all touch-none select-none ${
                activeButtons.has('A')
                  ? 'bg-emerald-500 border-emerald-200 text-slate-950 scale-95 shadow-lg shadow-emerald-500/50 ring-2 ring-emerald-400'
                  : 'bg-slate-900 border-emerald-500/60 text-emerald-400 active:bg-slate-800'
              }`}
            >
              A
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
