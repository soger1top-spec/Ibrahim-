import { useEffect, useRef, useState, useCallback } from 'react';
import { Trophy, RotateCcw, ArrowRight, Play, Volume2 } from 'lucide-react';
import { sounds } from './soundFx';
import { controllerBus } from '../services/controllerBus';

interface CarFootballGameProps {
  onBackToMenu: () => void;
  controllerCommand?: any;
}

interface Car {
  id: number;
  team: 'blue' | 'red';
  isHuman: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number; // in radians
  speed: number;
  boost: number; // 0 to 100
  isBoosting: boolean;
  color: string;
  name: string;
  isDestroyed?: boolean;
  respawnTimer?: number; // 180 frames = 3 seconds
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  spin: number;
}

const ARENA_WIDTH = 1200;
const ARENA_HEIGHT = 700;
const GOAL_WIDTH = 45;
const GOAL_HEIGHT = 200;
const CAR_RADIUS = 24;
const BALL_RADIUS = 20;
const CORNER_CUT = 110; // 45-degree corner barrier cut to prevent ball trapping

interface PlayerInput {
  forward: boolean;
  backward: boolean;
  steerLeft: boolean;
  steerRight: boolean;
  boost: boolean;
  handbrake: boolean;
  stickX: number;
  stickY: number;
}

const createDefaultInput = (): PlayerInput => ({
  forward: false,
  backward: false,
  steerLeft: false,
  steerRight: false,
  boost: false,
  handbrake: false,
  stickX: 0,
  stickY: 0
});

export function CarFootballGame({ onBackToMenu, controllerCommand }: CarFootballGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Game States: 'select_players' | 'kickoff' | 'playing' | 'goal' | 'game_over'
  const [gameState, setGameState] = useState<'select_players' | 'kickoff' | 'playing' | 'goal' | 'game_over'>('select_players');
  const [playerCount, setPlayerCount] = useState<number>(1);
  const [selectedPlayerOption, setSelectedPlayerOption] = useState<number>(1);
  const [score, setScore] = useState<{ blue: number; red: number }>({ blue: 0, red: 0 });
  const [matchTimer, setMatchTimer] = useState<number>(180); // 3 minutes
  const [countdown, setCountdown] = useState<number>(3);
  const [lastScorer, setLastScorer] = useState<'blue' | 'red' | null>(null);

  // Multi-player inputs mapping (Player 1, 2, 3, 4)
  const playerInputsRef = useRef<{ [pid: number]: PlayerInput }>({
    1: createDefaultInput(),
    2: createDefaultInput(),
    3: createDefaultInput(),
    4: createDefaultInput()
  });

  const connectedHumanPlayersRef = useRef<Set<number>>(new Set([1]));

  // Physics state refs to keep 60fps game loop buttery smooth
  const carsRef = useRef<Car[]>([]);
  const ballRef = useRef<Ball>({
    x: ARENA_WIDTH / 2,
    y: ARENA_HEIGHT / 2,
    vx: 0,
    vy: 0,
    radius: BALL_RADIUS,
    spin: 0
  });
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; color: string }[]>([]);
  const skidmarksRef = useRef<{ x: number; y: number; alpha: number }[]>([]);

  // Initialize or reset match
  const initMatch = useCallback((numPlayers: number) => {
    setPlayerCount(numPlayers);
    setScore({ blue: 0, red: 0 });
    setMatchTimer(180);
    resetKickoffPositions(numPlayers);
    setCountdown(3);
    setGameState('kickoff');
    sounds.playKick();
  }, []);

  // Position cars on kickoff depending on player count
  const resetKickoffPositions = (numPlayers: number) => {
    const cars: Car[] = [];
    // Team Blue (Left) - Player 1
    cars.push({
      id: 1,
      team: 'blue',
      isHuman: true,
      x: 350,
      y: ARENA_HEIGHT / 2,
      vx: 0,
      vy: 0,
      angle: 0,
      speed: 0,
      boost: 100,
      isBoosting: false,
      color: '#3b82f6',
      name: 'اللاعب 1 (المضيف)',
      isDestroyed: false,
      respawnTimer: 0
    });

    // Player 2 (or Partner / Opponent)
    const isP2Human = connectedHumanPlayersRef.current.has(2);
    if (numPlayers >= 3 || isP2Human) {
      cars.push({
        id: 2,
        team: 'blue',
        isHuman: isP2Human,
        x: 220,
        y: ARENA_HEIGHT / 2 - 160,
        vx: 0,
        vy: 0,
        angle: 0,
        speed: 0,
        boost: 100,
        isBoosting: false,
        color: '#60a5fa',
        name: isP2Human ? 'اللاعب 2 (تحكم إضافي)' : 'حليف أزرق',
        isDestroyed: false,
        respawnTimer: 0
      });
    }

    // Team Red (Right)
    const isP3Human = connectedHumanPlayersRef.current.has(3);
    cars.push({
      id: numPlayers >= 3 ? 3 : 2,
      team: 'red',
      isHuman: isP3Human,
      x: ARENA_WIDTH - 350,
      y: ARENA_HEIGHT / 2,
      vx: 0,
      vy: 0,
      angle: Math.PI,
      speed: 0,
      boost: 100,
      isBoosting: false,
      color: '#ef4444',
      name: isP3Human ? 'اللاعب 3' : 'خصم أحمر',
      isDestroyed: false,
      respawnTimer: 0
    });

    if (numPlayers >= 2) {
      cars.push({
        id: cars.length + 1,
        team: 'red',
        isHuman: false,
        x: ARENA_WIDTH - 220,
        y: ARENA_HEIGHT / 2 + 160,
        vx: 0,
        vy: 0,
        angle: Math.PI,
        speed: 0,
        boost: 100,
        isBoosting: false,
        color: '#f87171',
        name: 'مدافع أحمر',
        isDestroyed: false,
        respawnTimer: 0
      });
    }

    carsRef.current = cars;
    ballRef.current = {
      x: ARENA_WIDTH / 2,
      y: ARENA_HEIGHT / 2,
      vx: 0,
      vy: 0,
      radius: BALL_RADIUS,
      spin: 0
    };
    particlesRef.current = [];
  };

  // Controller command routing (via direct controllerBus subscription + props)
  useEffect(() => {
    const handleCommand = (cmd: any) => {
      if (!cmd) return;
      const { type, button, stick, playerId } = cmd;
      const pid = playerId || 1;

      if (type === 'player_joined') {
        connectedHumanPlayersRef.current.add(pid);
        const targetCar = carsRef.current.find(c => c.id === pid);
        if (targetCar) {
          targetCar.isHuman = true;
          targetCar.name = cmd.name || `اللاعب ${pid}`;
        }
        return;
      }

      if (type === 'player_left') {
        connectedHumanPlayersRef.current.delete(pid);
        const targetCar = carsRef.current.find(c => c.id === pid);
        if (targetCar && pid > 1) {
          targetCar.isHuman = false;
          targetCar.name = pid === 2 ? 'حليف أزرق' : 'خصم أحمر';
        }
        return;
      }

      if (!playerInputsRef.current[pid]) {
        playerInputsRef.current[pid] = createDefaultInput();
      }
      const playerInput = playerInputsRef.current[pid];

      if (type === 'button_down') {
        if (gameState === 'select_players' && pid === 1) {
          if (button === 'LEFT') {
            setSelectedPlayerOption(p => Math.max(1, p - 1));
          } else if (button === 'RIGHT') {
            setSelectedPlayerOption(p => Math.min(4, p + 1));
          } else if (button === 'A' || button === 'START') {
            initMatch(selectedPlayerOption);
          } else if (button === 'SELECT' || button === 'B') {
            onBackToMenu();
          }
        } else if (gameState === 'game_over' && pid === 1) {
          if (button === 'A' || button === 'START') {
            initMatch(playerCount);
          } else if (button === 'SELECT' || button === 'B') {
            onBackToMenu();
          }
        } else {
          // In Game controls for player
          if (button === 'UP') playerInput.forward = true;
          if (button === 'DOWN') playerInput.backward = true;
          if (button === 'LEFT') playerInput.steerLeft = true;
          if (button === 'RIGHT') playerInput.steerRight = true;
          if (button === 'A' || button === 'R1' || button === 'R2') playerInput.boost = true;
          if (button === 'B' || button === 'L1') playerInput.handbrake = true;
          if (button === 'SELECT' && pid === 1) onBackToMenu();
        }
      } else if (type === 'button_up') {
        if (button === 'UP') playerInput.forward = false;
        if (button === 'DOWN') playerInput.backward = false;
        if (button === 'LEFT') playerInput.steerLeft = false;
        if (button === 'RIGHT') playerInput.steerRight = false;
        if (button === 'A' || button === 'R1' || button === 'R2') playerInput.boost = false;
        if (button === 'B' || button === 'L1') playerInput.handbrake = false;
      } else if (type === 'stick_move' && stick) {
        playerInput.stickX = stick.x;
        playerInput.stickY = stick.y;
        if (gameState === 'select_players' && pid === 1) {
          if (stick.x > 0.5) setSelectedPlayerOption(p => Math.min(4, p + 1));
          if (stick.x < -0.5) setSelectedPlayerOption(p => Math.max(1, p - 1));
        }
      } else if (type === 'stick_release') {
        playerInput.stickX = 0;
        playerInput.stickY = 0;
        playerInput.forward = false;
        playerInput.backward = false;
        playerInput.steerLeft = false;
        playerInput.steerRight = false;
      }
    };

    if (controllerCommand) {
      handleCommand(controllerCommand);
    }

    const unsubscribe = controllerBus.subscribe(handleCommand);
    return () => unsubscribe();
  }, [controllerCommand, gameState, selectedPlayerOption, playerCount, initMatch, onBackToMenu]);

  // Keyboard fallbacks for browser testing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const p1Input = playerInputsRef.current[1];
      if (!p1Input) return;
      if (e.key === 'ArrowUp' || e.key === 'w') p1Input.forward = true;
      if (e.key === 'ArrowDown' || e.key === 's') p1Input.backward = true;
      if (e.key === 'ArrowLeft' || e.key === 'a') p1Input.steerLeft = true;
      if (e.key === 'ArrowRight' || e.key === 'd') p1Input.steerRight = true;
      if (e.key === ' ' || e.key === 'Shift') p1Input.boost = true;
      if (e.key === 'Escape') onBackToMenu();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const p1Input = playerInputsRef.current[1];
      if (!p1Input) return;
      if (e.key === 'ArrowUp' || e.key === 'w') p1Input.forward = false;
      if (e.key === 'ArrowDown' || e.key === 's') p1Input.backward = false;
      if (e.key === 'ArrowLeft' || e.key === 'a') p1Input.steerLeft = false;
      if (e.key === 'ArrowRight' || e.key === 'd') p1Input.steerRight = false;
      if (e.key === ' ' || e.key === 'Shift') p1Input.boost = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onBackToMenu]);

  // Countdown timer for kickoff
  useEffect(() => {
    if (gameState !== 'kickoff') return;
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(interval);
          setGameState('playing');
          sounds.playKick();
          return 0;
        }
        sounds.playKick();
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState]);

  // Match clock timer
  useEffect(() => {
    if (gameState !== 'playing') return;
    const timer = setInterval(() => {
      setMatchTimer(t => {
        if (t <= 1) {
          clearInterval(timer);
          setGameState('game_over');
          sounds.playWin();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [gameState]);

  // Main 60FPS Game & Physics Loop
  useEffect(() => {
    let animationFrameId: number;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gameLoop = () => {
      const ball = ballRef.current;
      const cars = carsRef.current;
      const particles = particlesRef.current;

      if (gameState === 'playing') {
        // 0. Handle Car Respawn Timers (Exactly 3.0s = 180 frames)
        cars.forEach(car => {
          if (car.isDestroyed) {
            if (car.respawnTimer && car.respawnTimer > 0) {
              car.respawnTimer--;
              if (car.respawnTimer <= 0) {
                // Respawn directly in front of own goal
                car.isDestroyed = false;
                const goalOffset = GOAL_WIDTH + CAR_RADIUS * 3.5;
                if (car.team === 'blue') {
                  car.x = goalOffset;
                  car.y = ARENA_HEIGHT / 2 + (car.id === 1 ? 0 : (car.id % 2 === 0 ? -90 : 90));
                  car.angle = 0;
                } else {
                  car.x = ARENA_WIDTH - goalOffset;
                  car.y = ARENA_HEIGHT / 2 + (car.id === 2 ? 0 : (car.id % 2 === 0 ? 90 : -90));
                  car.angle = Math.PI;
                }
                car.speed = 0;
                car.vx = 0;
                car.vy = 0;
                car.boost = 60;

                for (let i = 0; i < 20; i++) {
                  particles.push({
                    x: car.x,
                    y: car.y,
                    vx: (Math.random() - 0.5) * 6,
                    vy: (Math.random() - 0.5) * 6,
                    life: 0.9,
                    color: car.color
                  });
                }
                sounds.playKick();
              }
            }
          }
        });

        // 1. Update Active Cars
        cars.forEach(car => {
          if (car.isDestroyed) return;

          let steer = 0;
          let throttle = 0;

          const isHuman = car.isHuman || connectedHumanPlayersRef.current.has(car.id);

          if (isHuman) {
            // Human controls from Phone / Extra Controller
            if (!playerInputsRef.current[car.id]) {
              playerInputsRef.current[car.id] = createDefaultInput();
            }
            const input = playerInputsRef.current[car.id];
            const stickMag = Math.hypot(input.stickX, input.stickY);

            // Direct Analog Stick Driving
            if (stickMag > 0.15) {
              const targetAngle = Math.atan2(input.stickY, input.stickX);
              let diff = targetAngle - car.angle;
              while (diff > Math.PI) diff -= Math.PI * 2;
              while (diff < -Math.PI) diff += Math.PI * 2;
              steer = Math.max(-1, Math.min(1, diff * 3.8));
              throttle = Math.min(1, stickMag * 1.2);
            } else {
              // D-Pad Driving
              let dpadX = 0;
              let dpadY = 0;
              if (input.forward) dpadY -= 1;
              if (input.backward) dpadY += 1;
              if (input.steerLeft) dpadX -= 1;
              if (input.steerRight) dpadX += 1;

              if (dpadX !== 0 || dpadY !== 0) {
                const targetAngle = Math.atan2(dpadY, dpadX);
                let diff = targetAngle - car.angle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                steer = Math.max(-1, Math.min(1, diff * 4.5));
                throttle = 1.0;
              }
            }

            car.isBoosting = input.boost && car.boost > 0;
            if (input.handbrake) {
              throttle *= 0.2;
              steer *= 1.4;
            }
          } else {
            // Tactical AI Bot (Striker vs Defender)
            const opponentGoalX = car.team === 'red' ? 20 : ARENA_WIDTH - 20;
            const isDefender = (car.id === 4 || (car.team === 'red' && cars.filter(c => c.team === 'red').length > 1 && car.id !== 2));

            if (isDefender) {
              const anchorX = car.team === 'red' ? ARENA_WIDTH - 260 : 260;
              const targetY = Math.max(160, Math.min(ARENA_HEIGHT - 160, ball.y));
              const isBallInDangerZone = car.team === 'red' ? ball.x > ARENA_WIDTH * 0.5 : ball.x < ARENA_WIDTH * 0.5;
              const targetX = isBallInDangerZone ? ball.x : anchorX;

              const dx = targetX - car.x;
              const dy = targetY - car.y;
              const targetAngle = Math.atan2(dy, dx);
              let angleDiff = targetAngle - car.angle;
              while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
              while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

              steer = Math.max(-1, Math.min(1, angleDiff * 3.5));
              throttle = Math.hypot(dx, dy) > 30 ? 0.9 : 0.2;
              car.isBoosting = Math.abs(angleDiff) < 0.25 && Math.hypot(dx, dy) > 160 && car.boost > 30;
            } else {
              const toGoalX = opponentGoalX - ball.x;
              const toGoalY = (ARENA_HEIGHT / 2) - ball.y;
              const goalDist = Math.hypot(toGoalX, toGoalY);
              const approachX = ball.x - (toGoalX / Math.max(1, goalDist)) * 60;
              const approachY = ball.y - (toGoalY / Math.max(1, goalDist)) * 60;

              const isBehindBall = (car.team === 'red' && car.x > ball.x - 20) || (car.team === 'blue' && car.x < ball.x + 20);
              const targetX = isBehindBall ? ball.x : approachX;
              const targetY = isBehindBall ? ball.y : approachY;

              const dx = targetX - car.x;
              const dy = targetY - car.y;
              const targetAngle = Math.atan2(dy, dx);
              let angleDiff = targetAngle - car.angle;
              while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
              while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

              steer = Math.max(-1, Math.min(1, angleDiff * 3.8));
              throttle = 0.95;
              const dist = Math.hypot(dx, dy);
              car.isBoosting = Math.abs(angleDiff) < 0.25 && dist > 140 && car.boost > 15;
            }
          }

          // Steer car
          const turnSpeed = isHuman ? 0.075 : 0.055;
          car.angle += steer * turnSpeed;

          // Accelerate
          let maxSpeed = isHuman ? 5.6 : 5.0;
          let accel = isHuman ? 0.32 : 0.25;
          if (car.isBoosting && car.boost > 0) {
            maxSpeed = isHuman ? 8.2 : 7.2;
            accel = isHuman ? 0.55 : 0.45;
            car.boost = Math.max(0, car.boost - 0.4);

            particles.push({
              x: car.x - Math.cos(car.angle) * CAR_RADIUS,
              y: car.y - Math.sin(car.angle) * CAR_RADIUS,
              vx: -Math.cos(car.angle) * 2.5 + (Math.random() - 0.5) * 1.5,
              vy: -Math.sin(car.angle) * 2.5 + (Math.random() - 0.5) * 1.5,
              life: 0.8,
              color: car.team === 'blue' ? '#38bdf8' : '#fb923c'
            });
          } else if (car.boost < 100) {
            car.boost = Math.min(100, car.boost + 0.1);
          }

          car.speed += throttle * accel;
          car.speed *= 0.94; // friction
          car.speed = Math.max(-maxSpeed * 0.5, Math.min(maxSpeed, car.speed));

          car.vx = Math.cos(car.angle) * car.speed;
          car.vy = Math.sin(car.angle) * car.speed;

          car.x += car.vx;
          car.y += car.vy;

          // Arena boundary collision for cars
          const margin = CAR_RADIUS + 12;
          if (car.x < margin) {
            car.x = margin;
            car.speed *= -0.3;
          }
          if (car.x > ARENA_WIDTH - margin) {
            car.x = ARENA_WIDTH - margin;
            car.speed *= -0.3;
          }
          if (car.y < margin) {
            car.y = margin;
            car.speed *= -0.3;
          }
          if (car.y > ARENA_HEIGHT - margin) {
            car.y = ARENA_HEIGHT - margin;
            car.speed *= -0.3;
          }

          // Car vs Ball collision
          const bdx = ball.x - car.x;
          const bdy = ball.y - car.y;
          const bdist = Math.hypot(bdx, bdy);
          const minDist = CAR_RADIUS + BALL_RADIUS;

          if (bdist < minDist && bdist > 0) {
            sounds.playKick();
            const nx = bdx / bdist;
            const ny = bdy / bdist;

            // Separate
            const overlap = minDist - bdist;
            ball.x += nx * overlap;

            // Transfer momentum
            const impactSpeed = Math.min(5.2, Math.abs(car.speed) * 0.75 + 1.8);
            ball.vx = nx * impactSpeed + car.vx * 0.35;
            ball.vy = ny * impactSpeed + car.vy * 0.35;

            // Velocity cap
            const MAX_BALL_SPEED = 7.5;
            const curBallSpeed = Math.hypot(ball.vx, ball.vy);
            if (curBallSpeed > MAX_BALL_SPEED) {
              ball.vx = (ball.vx / curBallSpeed) * MAX_BALL_SPEED;
              ball.vy = (ball.vy / curBallSpeed) * MAX_BALL_SPEED;
            }

            for (let i = 0; i < 5; i++) {
              particles.push({
                x: ball.x,
                y: ball.y,
                vx: (Math.random() - 0.5) * 4,
                vy: (Math.random() - 0.5) * 4,
                life: 0.7,
                color: '#facc15'
              });
            }
          }
        });

        // 2. Car vs Car Collisions & Explosion Rules
        const triggerCarExplosion = (victim: Car) => {
          victim.isDestroyed = true;
          victim.respawnTimer = 180; // Exactly 3 seconds (180 frames at 60 FPS)
          victim.speed = 0;
          victim.vx = 0;
          victim.vy = 0;
          sounds.playAlert();

          for (let p = 0; p < 35; p++) {
            const pAngle = Math.random() * Math.PI * 2;
            const pSpeed = 2 + Math.random() * 8;
            particles.push({
              x: victim.x,
              y: victim.y,
              vx: Math.cos(pAngle) * pSpeed,
              vy: Math.sin(pAngle) * pSpeed,
              life: 1.0,
              color: Math.random() < 0.4 ? '#fb923c' : (Math.random() < 0.7 ? '#ef4444' : victim.color)
            });
          }
        };

        for (let i = 0; i < cars.length; i++) {
          for (let j = i + 1; j < cars.length; j++) {
            const c1 = cars[i];
            const c2 = cars[j];
            if (c1.isDestroyed || c2.isDestroyed) continue;

            const cdx = c2.x - c1.x;
            const cdy = c2.y - c1.y;
            const cdist = Math.hypot(cdx, cdy);

            if (cdist < CAR_RADIUS * 2 && cdist > 0) {
              const nx = cdx / cdist;
              const ny = cdy / cdist;
              const overlap = CAR_RADIUS * 2 - cdist;

              // Elastic positional separation
              c1.x -= (nx * overlap) / 2;
              c1.y -= (ny * overlap) / 2;
              c2.x += (nx * overlap) / 2;
              c2.y += (ny * overlap) / 2;

              // RULE 1: Friendly cars (same team) MUST NEVER explode each other!
              const isEnemyCollision = c1.team !== c2.team;

              // RULE 2: Meaningful collision check (high speed / boost impact required)
              const relSpeed = Math.hypot(c1.vx - c2.vx, c1.vy - c2.vy);
              const dot1 = (c1.vx * cdx + c1.vy * cdy);
              const dot2 = (c2.vx * (-cdx) + c2.vy * (-cdy));

              const isMeaningfulImpact = (c1.isBoosting && Math.abs(c1.speed) > 5.5 && dot1 > 8.0) ||
                                         (c2.isBoosting && Math.abs(c2.speed) > 5.5 && dot2 > 8.0) ||
                                         (relSpeed > 8.0);

              if (isEnemyCollision && isMeaningfulImpact) {
                if (c1.isBoosting && dot1 > dot2) {
                  triggerCarExplosion(c2);
                } else if (c2.isBoosting && dot2 > dot1) {
                  triggerCarExplosion(c1);
                } else if (Math.abs(c1.speed) >= Math.abs(c2.speed)) {
                  triggerCarExplosion(c2);
                } else {
                  triggerCarExplosion(c1);
                }
              } else {
                // Natural controlled elastic bounce
                const tempVx = c1.vx;
                c1.vx = c2.vx * 0.55;
                c2.vx = tempVx * 0.55;
                c1.speed *= -0.3;
                c2.speed *= -0.3;
              }
            }
          }
        }

        // 3. Update Ball Physics & Anti-Corner Trap System
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.vx *= 0.975;
        ball.vy *= 0.975;

        // Anti-corner trap: 45-degree bevel deflections at the 4 arena corners
        const cornerCut = CORNER_CUT;
        const bRad = BALL_RADIUS + 10;

        // Top-Left Corner Bevel
        if (ball.x + ball.y < cornerCut + bRad) {
          const normalX = 0.7071;
          const normalY = 0.7071;
          const dot = ball.vx * normalX + ball.vy * normalY;
          if (dot < 0) {
            ball.vx = (ball.vx - 2 * dot * normalX) * 0.75 + 1.2;
            ball.vy = (ball.vy - 2 * dot * normalY) * 0.75 + 1.2;
          }
          // Push out of corner
          ball.x = Math.max(ball.x, cornerCut + bRad - ball.y);
        }

        // Top-Right Corner Bevel
        const trDist = (ARENA_WIDTH - ball.x) + ball.y;
        if (trDist < cornerCut + bRad) {
          const normalX = -0.7071;
          const normalY = 0.7071;
          const dot = ball.vx * normalX + ball.vy * normalY;
          if (dot < 0) {
            ball.vx = (ball.vx - 2 * dot * normalX) * 0.75 - 1.2;
            ball.vy = (ball.vy - 2 * dot * normalY) * 0.75 + 1.2;
          }
          ball.x = Math.min(ball.x, ARENA_WIDTH - (cornerCut + bRad - ball.y));
        }

        // Bottom-Left Corner Bevel
        const blDist = ball.x + (ARENA_HEIGHT - ball.y);
        if (blDist < cornerCut + bRad) {
          const normalX = 0.7071;
          const normalY = -0.7071;
          const dot = ball.vx * normalX + ball.vy * normalY;
          if (dot < 0) {
            ball.vx = (ball.vx - 2 * dot * normalX) * 0.75 + 1.2;
            ball.vy = (ball.vy - 2 * dot * normalY) * 0.75 - 1.2;
          }
          ball.x = Math.max(ball.x, cornerCut + bRad - (ARENA_HEIGHT - ball.y));
        }

        // Bottom-Right Corner Bevel
        const brDist = (ARENA_WIDTH - ball.x) + (ARENA_HEIGHT - ball.y);
        if (brDist < cornerCut + bRad) {
          const normalX = -0.7071;
          const normalY = -0.7071;
          const dot = ball.vx * normalX + ball.vy * normalY;
          if (dot < 0) {
            ball.vx = (ball.vx - 2 * dot * normalX) * 0.75 - 1.2;
            ball.vy = (ball.vy - 2 * dot * normalY) * 0.75 - 1.2;
          }
          ball.x = Math.min(ball.x, ARENA_WIDTH - (cornerCut + bRad - (ARENA_HEIGHT - ball.y)));
        }

        // Check Goal Scoring
        const goalTop = (ARENA_HEIGHT - GOAL_HEIGHT) / 2;
        const goalBottom = goalTop + GOAL_HEIGHT;

        // Left Goal (Red scores)
        if (ball.x <= 15 && ball.y >= goalTop && ball.y <= goalBottom) {
          sounds.playGoal();
          setScore(s => ({ ...s, red: s.red + 1 }));
          setLastScorer('red');
          setGameState('goal');
          setTimeout(() => {
            resetKickoffPositions(playerCount);
            setCountdown(3);
            setGameState('kickoff');
          }, 2400);
        }
        // Right Goal (Blue scores)
        else if (ball.x >= ARENA_WIDTH - 15 && ball.y >= goalTop && ball.y <= goalBottom) {
          sounds.playGoal();
          setScore(s => ({ ...s, blue: s.blue + 1 }));
          setLastScorer('blue');
          setGameState('goal');
          setTimeout(() => {
            resetKickoffPositions(playerCount);
            setCountdown(3);
            setGameState('kickoff');
          }, 2400);
        } else {
          // Perimeter wall bounces
          const bMargin = BALL_RADIUS + 12;
          if (ball.y < bMargin) {
            ball.y = bMargin;
            ball.vy = -ball.vy * 0.65;
          }
          if (ball.y > ARENA_HEIGHT - bMargin) {
            ball.y = ARENA_HEIGHT - bMargin;
            ball.vy = -ball.vy * 0.65;
          }
          if (ball.x < bMargin && (ball.y < goalTop || ball.y > goalBottom)) {
            ball.x = bMargin;
            ball.vx = -ball.vx * 0.65;
          }
          if (ball.x > ARENA_WIDTH - bMargin && (ball.y < goalTop || ball.y > goalBottom)) {
            ball.x = ARENA_WIDTH - bMargin;
            ball.vx = -ball.vx * 0.65;
          }
        }
      }

      // Update Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.04;
        if (p.life <= 0) particles.splice(i, 1);
      }

      // 4. Render Arena
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

      // Pitch Grass / Futuristic Turf
      ctx.fillStyle = '#064e3b';
      ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

      // Pitch alternating stripes
      const stripeWidth = ARENA_WIDTH / 10;
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          ctx.fillStyle = '#047857';
          ctx.fillRect(i * stripeWidth, 0, stripeWidth, ARENA_HEIGHT);
        }
      }

      // Draw Arena Outer Border with 45-degree Beveled Corner Bumpers
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 4;
      ctx.beginPath();
      // Top line
      ctx.moveTo(CORNER_CUT, 20);
      ctx.lineTo(ARENA_WIDTH - CORNER_CUT, 20);
      // Top-Right Bevel
      ctx.lineTo(ARENA_WIDTH - 20, CORNER_CUT);
      // Right Wall
      ctx.lineTo(ARENA_WIDTH - 20, ARENA_HEIGHT - CORNER_CUT);
      // Bottom-Right Bevel
      ctx.lineTo(ARENA_WIDTH - CORNER_CUT, ARENA_HEIGHT - 20);
      // Bottom line
      ctx.lineTo(CORNER_CUT, ARENA_HEIGHT - 20);
      // Bottom-Left Bevel
      ctx.lineTo(20, ARENA_HEIGHT - CORNER_CUT);
      // Left Wall
      ctx.lineTo(20, CORNER_CUT);
      // Top-Left Bevel
      ctx.closePath();
      ctx.stroke();

      // Halfway line & center circle
      ctx.beginPath();
      ctx.moveTo(ARENA_WIDTH / 2, 20);
      ctx.lineTo(ARENA_WIDTH / 2, ARENA_HEIGHT - 20);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 110, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 8, 0, Math.PI * 2);
      ctx.fill();

      // Goal Boxes
      const goalTop = (ARENA_HEIGHT - GOAL_HEIGHT) / 2;
      // Left Goal Area
      ctx.strokeRect(20, goalTop - 40, 160, GOAL_HEIGHT + 80);
      // Right Goal Area
      ctx.strokeRect(ARENA_WIDTH - 180, goalTop - 40, 160, GOAL_HEIGHT + 80);

      // Left Goal Net
      ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
      ctx.fillRect(-GOAL_WIDTH + 20, goalTop, GOAL_WIDTH, GOAL_HEIGHT);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 6;
      ctx.strokeRect(-GOAL_WIDTH + 20, goalTop, GOAL_WIDTH, GOAL_HEIGHT);

      // Right Goal Net
      ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
      ctx.fillRect(ARENA_WIDTH - 20, goalTop, GOAL_WIDTH, GOAL_HEIGHT);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 6;
      ctx.strokeRect(ARENA_WIDTH - 20, goalTop, GOAL_WIDTH, GOAL_HEIGHT);

      // Render Particles
      particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      // Render Ball
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.arc(ball.x + 6, ball.y + 6, ball.radius, 0, Math.PI * 2);
      ctx.fill();

      const ballGrad = ctx.createRadialGradient(
        ball.x - 5,
        ball.y - 5,
        2,
        ball.x,
        ball.y,
        ball.radius
      );
      ballGrad.addColorStop(0, '#ffffff');
      ballGrad.addColorStop(0.7, '#cbd5e1');
      ballGrad.addColorStop(1, '#64748b');
      ctx.fillStyle = ballGrad;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Render Cars
      cars.forEach(car => {
        if (car.isDestroyed) {
          const goalOffset = GOAL_WIDTH + CAR_RADIUS * 3.5;
          const rx = car.team === 'blue' ? goalOffset : ARENA_WIDTH - goalOffset;
          const ry = ARENA_HEIGHT / 2 + (car.id === 1 || car.id === 2 ? 0 : (car.id % 2 === 0 ? 90 : -90));
          const remainingSec = Math.ceil((car.respawnTimer || 0) / 60);

          ctx.save();
          ctx.strokeStyle = car.color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(rx, ry, CAR_RADIUS + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`عودة: ${remainingSec}ث`, rx, ry - CAR_RADIUS - 6);
          ctx.restore();
          return;
        }

        ctx.save();
        ctx.translate(car.x, car.y);
        ctx.rotate(car.angle);

        // Car Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.roundRect(-CAR_RADIUS + 4, -CAR_RADIUS * 0.7 + 4, CAR_RADIUS * 2, CAR_RADIUS * 1.4, 8);
        ctx.fill();

        // Car Body
        ctx.fillStyle = car.color;
        ctx.beginPath();
        ctx.roundRect(-CAR_RADIUS, -CAR_RADIUS * 0.7, CAR_RADIUS * 2, CAR_RADIUS * 1.4, 8);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = car.isHuman ? 2.5 : 1.2;
        ctx.stroke();

        // Windshield
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.roundRect(0, -CAR_RADIUS * 0.5, CAR_RADIUS * 0.65, CAR_RADIUS, 4);
        ctx.fill();

        // Headlights
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(CAR_RADIUS - 3, -CAR_RADIUS * 0.6, 3, 6);
        ctx.fillRect(CAR_RADIUS - 3, CAR_RADIUS * 0.6 - 6, 3, 6);

        // Exhaust
        ctx.fillStyle = car.isBoosting ? '#f97316' : '#64748b';
        ctx.fillRect(-CAR_RADIUS - 3, -CAR_RADIUS * 0.35, 3, CAR_RADIUS * 0.7);

        ctx.restore();

        // Car Name Tag
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(car.name, car.x, car.y - CAR_RADIUS - 6);

        // Boost bar
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(car.x - 16, car.y + CAR_RADIUS + 4, 32, 4);
        ctx.fillStyle = car.team === 'blue' ? '#38bdf8' : '#f87171';
        ctx.fillRect(car.x - 16, car.y + CAR_RADIUS + 4, (car.boost / 100) * 32, 4);
      });

      ctx.restore();

      animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState, playerCount]);

  // Handle TV canvas resizing
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
      {/* Top Header Bar / Scoreboard */}
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
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
            كرة سيارات أرينا (Car Football)
          </h2>
        </div>

        {/* Center Live Scoreboard */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 bg-blue-950/70 border border-blue-500/40 px-4 py-1.5 rounded-2xl shadow">
            <span className="text-xs font-bold text-blue-300">الفريق الأزرق</span>
            <span className="text-2xl font-black text-white font-mono">{score.blue}</span>
          </div>

          <div className="text-center font-mono">
            <div className="text-xs text-slate-400">الوقت المتبقي</div>
            <div className="text-xl font-bold text-emerald-400">
              {Math.floor(matchTimer / 60)}:{(matchTimer % 60).toString().padStart(2, '0')}
            </div>
          </div>

          <div className="flex items-center gap-3 bg-red-950/70 border border-red-500/40 px-4 py-1.5 rounded-2xl shadow">
            <span className="text-2xl font-black text-white font-mono">{score.red}</span>
            <span className="text-xs font-bold text-red-300">الفريق الأحمر</span>
          </div>
        </div>

        {/* Right Info */}
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700">
            {playerCount} لاعبين
          </span>
          <button
            type="button"
            onClick={() => initMatch(playerCount)}
            className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>إعادة</span>
          </button>
        </div>
      </header>

      {/* Main Canvas Playing Field */}
      <div className="relative flex-1 w-full h-full min-h-[460px] bg-slate-950">
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* OVERLAY: PLAYER COUNT SELECTION */}
        {gameState === 'select_players' && (
          <div className="absolute inset-0 z-30 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
              <div className="space-y-2">
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  إعداد المباراة
                </span>
                <h3 className="text-2xl md:text-3xl font-black text-white">اختر عدد اللاعبين في المباراة</h3>
                <p className="text-xs text-slate-400">
                  تحكم بسيارتك عبر يد الهاتف واستمتع بالمنافسة ضد الذكاء الاصطناعي أو انضم كتحكم إضافي مع أصدقائك.
                </p>
              </div>

              {/* Functional 1 to 4 Players Options */}
              <div className="grid grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(count => {
                  const isSelected = selectedPlayerOption === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setSelectedPlayerOption(count)}
                      className={`p-4 rounded-2xl flex flex-col items-center gap-2 border transition-all ${
                        isSelected
                          ? 'bg-blue-600 border-blue-400 text-white scale-105 shadow-lg shadow-blue-600/40 ring-2 ring-blue-300'
                          : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <span className="text-3xl font-black font-mono">{count}</span>
                      <span className="text-xs font-bold">
                        {count === 1 ? 'لاعب واحد' : `${count} لاعبين`}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Start Match Confirmation Button */}
              <div className="pt-2 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => initMatch(selectedPlayerOption)}
                  className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-base shadow-xl shadow-blue-600/30 hover:scale-105 transition-all flex items-center gap-2"
                >
                  <Play className="w-5 h-5 fill-current" />
                  <span>بدء المباراة الآن [زر A]</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* OVERLAY: KICKOFF COUNTDOWN */}
        {gameState === 'kickoff' && (
          <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
            <div className="text-center animate-bounce">
              <span className="text-7xl md:text-9xl font-black text-yellow-400 drop-shadow-[0_10px_20px_rgba(0,0,0,0.8)] font-mono">
                {countdown}
              </span>
              <div className="text-xl font-bold text-white tracking-widest mt-2 uppercase">استعد للانطلاق!</div>
            </div>
          </div>
        )}

        {/* OVERLAY: GOAL CELEBRATION */}
        {gameState === 'goal' && (
          <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center bg-black/40 backdrop-blur-xs">
            <div className="text-center animate-pulse">
              <span className="text-6xl md:text-8xl font-black text-emerald-400 drop-shadow-[0_10px_25px_rgba(16,185,129,0.8)]">
                هــــدف !
              </span>
              <div className="text-xl font-bold text-white mt-2">
                {lastScorer === 'blue' ? 'نقطة لصالح الفريق الأزرق!' : 'نقطة لصالح الفريق الأحمر!'}
              </div>
            </div>
          </div>
        )}

        {/* OVERLAY: MATCH OVER / VICTORY */}
        {gameState === 'game_over' && (
          <div className="absolute inset-0 z-30 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 mx-auto flex items-center justify-center">
                <Trophy className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-white">نهاية المباراة</h3>
                <p className="text-sm font-bold text-emerald-400">
                  {score.blue > score.red
                    ? 'فوز رائع للفريق الأزرق!'
                    : score.blue < score.red
                    ? 'الفوز للفريق الأحمر! حظاً أوفر في المرة القادمة'
                    : 'تعادل مثير بين الفريقين!'}
                </p>
                <div className="text-3xl font-black text-white font-mono mt-3">
                  {score.blue} - {score.red}
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => initMatch(playerCount)}
                  className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>إعادة المباراة [A]</span>
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

      {/* Bottom TV Controller Guide */}
      <footer className="relative z-10 px-6 py-2.5 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
        <div className="flex items-center gap-4">
          <span className="text-slate-300 font-bold">طريقة التحكم بالهاتف:</span>
          <span>عصا التحكم / الأسهم: التوجيه والقيادة</span>
          <span>·</span>
          <span className="text-blue-400 font-bold">زر [A] / [R1]: تيربو سريع (Boost)</span>
          <span>·</span>
          <span>زر [B]: فرامل وانجراف</span>
        </div>
        <div>دعم الأجهزة المتعددة (Extra Controller Ready)</div>
      </footer>
    </div>
  );
}
