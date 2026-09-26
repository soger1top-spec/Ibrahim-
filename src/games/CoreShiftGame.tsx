import { useEffect, useRef, useState, useCallback } from 'react';
import { Trophy, RotateCcw, ArrowRight, Zap, Shield, Flame, Activity } from 'lucide-react';
import { sounds } from './soundFx';
import { controllerBus } from '../services/controllerBus';

interface CoreShiftGameProps {
  onBackToMenu: () => void;
  controllerCommand?: any;
}

interface EnergyNode {
  id: number;
  x: number;
  y: number;
  value: number;
  pulseTime: number;
}

interface MovingBarrier {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  speed: number;
  angle: number;
  rotSpeed: number;
  length: number;
}

const ARENA_WIDTH = 1200;
const ARENA_HEIGHT = 700;
const TARGET_ENERGY = 100;
const MAX_CARRIED = 5;

export function CoreShiftGame({ onBackToMenu, controllerCommand }: CoreShiftGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // States: 'playing' | 'won' | 'overload'
  const [gameState, setGameState] = useState<'playing' | 'won' | 'overload'>('playing');
  const [roundScore, setRoundScore] = useState<number>(0);
  const [carriedEnergy, setCarriedEnergy] = useState<number>(0);
  const [coreHealth, setCoreHealth] = useState<number>(100);
  const [timeLeft, setTimeLeft] = useState<number>(120); // 2 minutes
  const [shiftStage, setShiftStage] = useState<number>(1);
  const [shiftAlert, setShiftAlert] = useState<string | null>(null);

  // Player physics state
  const playerRef = useRef({
    x: ARENA_WIDTH / 2,
    y: ARENA_HEIGHT / 2,
    vx: 0,
    vy: 0,
    radius: 18,
    carried: 0,
    dashCooldown: 0,
    isDashing: false,
    invincibleTimer: 0
  });

  const nodesRef = useRef<EnergyNode[]>([]);
  const barriersRef = useRef<MovingBarrier[]>([]);
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; color: string }[]>([]);

  // Input ref
  const inputRef = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
    dash: false,
    stickX: 0,
    stickY: 0
  });

  // Spawn energy nodes dynamically
  const spawnNodes = (count: number) => {
    const nodes: EnergyNode[] = [];
    for (let i = 0; i < count; i++) {
      let x = 0;
      let y = 0;
      let distFromCenter = 0;
      let attempts = 0;
      do {
        x = 80 + Math.random() * (ARENA_WIDTH - 160);
        y = 80 + Math.random() * (ARENA_HEIGHT - 160);
        distFromCenter = Math.hypot(x - ARENA_WIDTH / 2, y - ARENA_HEIGHT / 2);
        attempts++;
      } while (distFromCenter < 120 && attempts < 20); // Don't spawn inside the central deposit base

      nodes.push({
        id: Math.random(),
        x,
        y,
        value: 1,
        pulseTime: Math.random() * 5
      });
    }
    nodesRef.current = nodes;
  };

  // Reset or start new round with randomized arena layout
  const initRound = useCallback(() => {
    setGameState('playing');
    setRoundScore(0);
    setCarriedEnergy(0);
    setCoreHealth(100);
    setTimeLeft(120);
    setShiftStage(1);
    setShiftAlert('تم تفعيل وتثبيت النواة المركزية');
    setTimeout(() => setShiftAlert(null), 3000);

    playerRef.current = {
      x: ARENA_WIDTH / 2,
      y: ARENA_HEIGHT / 2,
      vx: 0,
      vy: 0,
      radius: 18,
      carried: 0,
      dashCooldown: 0,
      isDashing: false,
      invincibleTimer: 0
    };

    spawnNodes(14);

    // Dynamic rotating / moving barriers
    barriersRef.current = [
      {
        id: 1,
        x1: 300,
        y1: 200,
        x2: 300,
        y2: 400,
        speed: 1.2,
        angle: 0,
        rotSpeed: 0.015,
        length: 180
      },
      {
        id: 2,
        x1: ARENA_WIDTH - 300,
        y1: ARENA_HEIGHT - 200,
        x2: ARENA_WIDTH - 300,
        y2: ARENA_HEIGHT - 400,
        speed: 1.2,
        angle: Math.PI / 2,
        rotSpeed: -0.018,
        length: 180
      },
      {
        id: 3,
        x1: ARENA_WIDTH / 2,
        y1: 140,
        x2: ARENA_WIDTH / 2,
        y2: 240,
        speed: 1.8,
        angle: 0,
        rotSpeed: 0.022,
        length: 140
      }
    ];

    sounds.playAlert();
  }, []);

  useEffect(() => {
    initRound();
  }, [initRound]);

  // Controller command routing (via direct controllerBus subscription + props)
  useEffect(() => {
    const handleCommand = (cmd: any) => {
      if (!cmd) return;
      const { type, button, stick } = cmd;

      if (type === 'button_down') {
        if (gameState !== 'playing') {
          if (button === 'A' || button === 'START') {
            initRound();
          } else if (button === 'SELECT' || button === 'B') {
            onBackToMenu();
          }
        } else {
          if (button === 'UP') inputRef.current.up = true;
          if (button === 'DOWN') inputRef.current.down = true;
          if (button === 'LEFT') inputRef.current.left = true;
          if (button === 'RIGHT') inputRef.current.right = true;
          if (button === 'A' || button === 'R1') {
            // Dash trigger
            if (playerRef.current.dashCooldown <= 0) {
              playerRef.current.isDashing = true;
              playerRef.current.dashCooldown = 45; // 0.75s cooldown
              sounds.playKick();
            }
          }
          if (button === 'SELECT') onBackToMenu();
        }
      } else if (type === 'button_up') {
        if (button === 'UP') inputRef.current.up = false;
        if (button === 'DOWN') inputRef.current.down = false;
        if (button === 'LEFT') inputRef.current.left = false;
        if (button === 'RIGHT') inputRef.current.right = false;
      } else if (type === 'stick_move' && stick) {
        inputRef.current.stickX = stick.x;
        inputRef.current.stickY = stick.y;
      } else if (type === 'stick_release') {
        inputRef.current.stickX = 0;
        inputRef.current.stickY = 0;
        inputRef.current.up = false;
        inputRef.current.down = false;
        inputRef.current.left = false;
        inputRef.current.right = false;
      }
    };

    if (controllerCommand) {
      handleCommand(controllerCommand);
    }

    const unsubscribe = controllerBus.subscribe(handleCommand);
    return () => unsubscribe();
  }, [controllerCommand, gameState, initRound, onBackToMenu]);

  // Keyboard controls fallback
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') inputRef.current.up = true;
      if (e.key === 'ArrowDown' || e.key === 's') inputRef.current.down = true;
      if (e.key === 'ArrowLeft' || e.key === 'a') inputRef.current.left = true;
      if (e.key === 'ArrowRight' || e.key === 'd') inputRef.current.right = true;
      if (e.key === ' ' && playerRef.current.dashCooldown <= 0) {
        playerRef.current.isDashing = true;
        playerRef.current.dashCooldown = 60;
        sounds.playKick();
      }
      if (e.key === 'Escape') onBackToMenu();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') inputRef.current.up = false;
      if (e.key === 'ArrowDown' || e.key === 's') inputRef.current.down = false;
      if (e.key === 'ArrowLeft' || e.key === 'a') inputRef.current.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd') inputRef.current.right = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onBackToMenu]);

  // Round countdown timer & Core Shift Event Trigger
  useEffect(() => {
    if (gameState !== 'playing') return;
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(interval);
          setGameState('overload');
          sounds.playAlert();
          return 0;
        }

        // Trigger periodic Core Shift Events every 30 seconds
        if (t % 30 === 0) {
          setShiftStage(s => s + 1);
          setShiftAlert('تحذير: تحول ديناميكي في حقول الطاقة (Core Shift Event)!');
          sounds.playAlert();
          setTimeout(() => setShiftAlert(null), 3000);
          // Spawn extra fresh nodes
          spawnNodes(10);
        }

        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState]);

  // Check line segment to point distance for laser barrier collision
  const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  };

  // Main 60FPS Game Loop
  useEffect(() => {
    let animationFrameId: number;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const loop = () => {
      const p = playerRef.current;
      const nodes = nodesRef.current;
      const barriers = barriersRef.current;
      const particles = particlesRef.current;

      if (gameState === 'playing') {
        // 1. Move Player (Controlled, precise speed with immediate neutral stop)
        let moveX = 0;
        let moveY = 0;
        const input = inputRef.current;
        if (input.up) moveY -= 1;
        if (input.down) moveY += 1;
        if (input.left) moveX -= 1;
        if (input.right) moveX += 1;

        if (Math.abs(input.stickX) > 0.08) moveX = input.stickX;
        if (Math.abs(input.stickY) > 0.08) moveY = input.stickY;

        const baseSpeed = 4.8;
        let currentSpeed = baseSpeed;
        if (p.isDashing) {
          currentSpeed = 12.0;
          p.isDashing = false;
          // Dash smoke
          for (let i = 0; i < 6; i++) {
            particles.push({
              x: p.x,
              y: p.y,
              vx: (Math.random() - 0.5) * 5,
              vy: (Math.random() - 0.5) * 5,
              life: 0.8,
              color: '#38bdf8'
            });
          }
        }

        const len = Math.hypot(moveX, moveY);
        if (len > 0.08) {
          // Direct proportional movement matching player touch
          const normX = moveX / Math.max(1, len);
          const normY = moveY / Math.max(1, len);
          const throttle = Math.min(1.0, len);
          p.vx = normX * currentSpeed * throttle;
          p.vy = normY * currentSpeed * throttle;
        } else {
          // Immediate zero-drift neutral stop when touch is released
          p.vx = 0;
          p.vy = 0;
        }

        p.x += p.vx;
        p.y += p.vy;

        if (p.dashCooldown > 0) p.dashCooldown--;
        if (p.invincibleTimer > 0) p.invincibleTimer--;

        // Arena boundary collision
        const margin = p.radius + 20;
        p.x = Math.max(margin, Math.min(ARENA_WIDTH - margin, p.x));
        p.y = Math.max(margin, Math.min(ARENA_HEIGHT - margin, p.y));

        // 2. Collect Energy Nodes
        for (let i = nodes.length - 1; i >= 0; i--) {
          const node = nodes[i];
          const dist = Math.hypot(p.x - node.x, p.y - node.y);
          if (dist < p.radius + 14 && p.carried < MAX_CARRIED) {
            nodes.splice(i, 1);
            p.carried += 1;
            setCarriedEnergy(p.carried);
            sounds.playCollect();

            // Particles
            for (let j = 0; j < 6; j++) {
              particles.push({
                x: node.x,
                y: node.y,
                vx: (Math.random() - 0.5) * 5,
                vy: (Math.random() - 0.5) * 5,
                life: 0.8,
                color: '#38bdf8'
              });
            }
          }
        }

        // Respawn nodes if low
        if (nodes.length < 5) {
          spawnNodes(8);
        }

        // 3. Deposit at Central Core Base
        const centerDist = Math.hypot(p.x - ARENA_WIDTH / 2, p.y - ARENA_HEIGHT / 2);
        if (centerDist < 60 && p.carried > 0) {
          const depositAmount = p.carried * 10;
          p.carried = 0;
          setCarriedEnergy(0);
          sounds.playDeposit();

          setRoundScore(current => {
            const next = current + depositAmount;
            if (next >= TARGET_ENERGY) {
              setGameState('won');
              sounds.playWin();
            }
            return next;
          });

          // Deposit fountain particles
          for (let j = 0; j < 18; j++) {
            particles.push({
              x: ARENA_WIDTH / 2,
              y: ARENA_HEIGHT / 2,
              vx: (Math.random() - 0.5) * 8,
              vy: (Math.random() - 0.5) * 8,
              life: 1.2,
              color: '#34d399'
            });
          }
        }

        // 4. Update Moving Barriers and Check Collision
        barriers.forEach(b => {
          b.angle += b.rotSpeed;
          const cx = (b.x1 + b.x2) / 2;
          const cy = (b.y1 + b.y2) / 2;
          const halfLen = b.length / 2;
          b.x1 = cx + Math.cos(b.angle) * halfLen;
          b.y1 = cy + Math.sin(b.angle) * halfLen;
          b.x2 = cx - Math.cos(b.angle) * halfLen;
          b.y2 = cy - Math.sin(b.angle) * halfLen;

          // Check collision with player if not in safe center
          if (centerDist > 65 && p.invincibleTimer <= 0) {
            const d = distToSegment(p.x, p.y, b.x1, b.y1, b.x2, b.y2);
            if (d < p.radius + 6) {
              sounds.playAlert();
              p.invincibleTimer = 45; // 0.75s grace period
              // Knockback
              p.vx = -p.vx * 2;
              p.vy = -p.vy * 2;
              setCoreHealth(h => {
                const next = h - 20;
                if (next <= 0) {
                  setGameState('overload');
                }
                return Math.max(0, next);
              });
            }
          }
        });
      }

      // Update Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life -= 0.03;
        if (pt.life <= 0) particles.splice(i, 1);
      }

      // 5. Render Core Shift Arena on TV Canvas
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      const scaleX = cw / ARENA_WIDTH;
      const scaleY = ch / ARENA_HEIGHT;
      const scale = Math.min(scaleX, scaleY);
      const offsetX = (cw - ARENA_WIDTH * scale) / 2;
      const offsetY = (ch - ARENA_HEIGHT * scale) / 2;

      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      // Arena Floor
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

      // Subtle Grid Pattern
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      const step = 60;
      for (let x = 0; x < ARENA_WIDTH; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ARENA_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y < ARENA_HEIGHT; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(ARENA_WIDTH, y);
        ctx.stroke();
      }

      // Perimeter Hazard Boundaries
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.strokeRect(20, 20, ARENA_WIDTH - 40, ARENA_HEIGHT - 40);

      // Central Energy Core / Deposit Base
      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.beginPath();
      ctx.arc(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Central Base Core Core
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('محطة التفريغ', ARENA_WIDTH / 2, ARENA_HEIGHT / 2 + 4);

      // Draw Energy Nodes
      nodes.forEach(node => {
        node.pulseTime += 0.05;
        const pulse = Math.sin(node.pulseTime * 4) * 3;

        ctx.fillStyle = 'rgba(56, 189, 248, 0.3)';
        ctx.beginPath();
        ctx.arc(node.x, node.y, 14 + pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(node.x, node.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(node.x, node.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw Moving Laser Barriers
      barriers.forEach(b => {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 6;
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // End emitter nodes
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(b.x1, b.y1, 6, 0, Math.PI * 2);
        ctx.arc(b.x2, b.y2, 6, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw Particles
      particles.forEach(pt => {
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = pt.life;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      // Draw Player Energy Core
      ctx.save();
      ctx.translate(p.x, p.y);

      // Glow halo
      ctx.fillStyle = p.invincibleTimer > 0 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(129, 140, 248, 0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 10, 0, Math.PI * 2);
      ctx.fill();

      // Main core sphere
      ctx.fillStyle = '#4f46e5';
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a5b4fc';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Core nucleus
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();

      // Orbiting carried energy orbs
      for (let i = 0; i < p.carried; i++) {
        const orbAngle = (Date.now() / 300) + (i * Math.PI * 2) / p.carried;
        const orbX = Math.cos(orbAngle) * (p.radius + 12);
        const orbY = Math.sin(orbAngle) * (p.radius + 12);
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(orbX, orbY, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      ctx.restore();

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState]);

  // TV canvas resize handler
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col justify-between bg-slate-950 text-white select-none overflow-hidden" dir="rtl">
      {/* Top HUD Header */}
      <header className="relative z-20 flex items-center justify-between px-6 py-3 bg-slate-900/90 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToMenu}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 hover:text-white border border-slate-700 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة للمكتبة [SELECT]</span>
          </button>
          <div className="h-6 w-px bg-slate-800" />
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            تحول النواة (CORE SHIFT)
          </h2>
        </div>

        {/* Center Progress & Stats */}
        <div className="flex items-center gap-6">
          {/* Target Energy Quota */}
          <div className="flex items-center gap-3 bg-slate-800/80 px-4 py-1.5 rounded-2xl border border-slate-700">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-slate-300">طاقة النواة المحققة:</span>
            <span className="text-xl font-black text-emerald-400 font-mono">
              {roundScore} / {TARGET_ENERGY}
            </span>
          </div>

          {/* Carried Energy */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-indigo-950/60 border border-indigo-500/40">
            <Flame className="w-4 h-4 text-cyan-400" />
            <span className="text-xs text-indigo-200">الطاقة المحمولة:</span>
            <span className="text-base font-black text-cyan-400 font-mono">
              {carriedEnergy} / {MAX_CARRIED}
            </span>
          </div>

          {/* Core Health Shield */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-red-950/40 border border-red-500/40">
            <Shield className="w-4 h-4 text-red-400" />
            <span className="text-xs text-red-200">سلامة النواة:</span>
            <span className="text-base font-black text-red-400 font-mono">{coreHealth}%</span>
          </div>
        </div>

        {/* Time Remaining */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="text-right">
            <span className="text-slate-400 block text-[10px]">الوقت المتبقي</span>
            <span className="text-base font-bold text-yellow-400">
              {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </span>
          </div>
          <button
            type="button"
            onClick={initRound}
            className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>إعادة</span>
          </button>
        </div>
      </header>

      {/* Main Canvas Field */}
      <div className="relative flex-1 w-full h-full min-h-[460px] bg-slate-950">
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* Dynamic Shift Event Banner */}
        {shiftAlert && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-6 py-2 rounded-2xl bg-indigo-600/90 text-white font-bold text-sm shadow-xl border border-indigo-400 animate-pulse">
            {shiftAlert}
          </div>
        )}

        {/* OVERLAY: WON / CORE STABILIZED */}
        {gameState === 'won' && (
          <div className="absolute inset-0 z-30 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-md w-full bg-slate-900 border border-emerald-500/50 rounded-3xl p-8 shadow-2xl space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 mx-auto flex items-center justify-center">
                <Trophy className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-white">تم استقرار النواة بنجاح!</h3>
                <p className="text-xs text-emerald-400 font-bold">
                  نجحت في جمع وتفريغ كامل الطاقة المطلوبة وحماية النواة من الانهيار.
                </p>
                <div className="text-2xl font-black text-white font-mono mt-2">
                  النتيجة النهائية: {roundScore} نقطة
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={initRound}
                  className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>بدء جولة جديدة [A]</span>
                </button>
                <button
                  type="button"
                  onClick={onBackToMenu}
                  className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm border border-slate-700"
                >
                  الخروج للمكتبة [B]
                </button>
              </div>
            </div>
          </div>
        )}

        {/* OVERLAY: CORE OVERLOAD / COLLAPSE */}
        {gameState === 'overload' && (
          <div className="absolute inset-0 z-30 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-md w-full bg-slate-900 border border-red-500/50 rounded-3xl p-8 shadow-2xl space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-500 mx-auto flex items-center justify-center animate-bounce">
                <Flame className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-white">انهيار طاقة النواة!</h3>
                <p className="text-xs text-slate-400">
                  نفد وقت الجولة أو تعرضت النواة لاصطدامات متكررة مع حواجز الليزر المتحركة.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={initRound}
                  className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm shadow flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>إعادة المحاولة [A]</span>
                </button>
                <button
                  type="button"
                  onClick={onBackToMenu}
                  className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm border border-slate-700"
                >
                  الخروج للمكتبة [B]
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Instructions */}
      <footer className="relative z-10 px-6 py-2.5 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
        <div className="flex items-center gap-4">
          <span className="text-slate-300 font-bold">طريقة اللعب:</span>
          <span>اجمع كريستالات الطاقة الزرقاء (حد أقصى 5)</span>
          <span>·</span>
          <span className="text-emerald-400">عد إلى المحطة المركزية الخضراء لتفريغها</span>
          <span>·</span>
          <span className="text-indigo-400 font-bold">زر [A] / [R1]: اندفاع طاقة سريع (Dash)</span>
        </div>
        <div className="text-slate-400">تحول دوري للحواجز كل 30 ثانية</div>
      </footer>
    </div>
  );
}
