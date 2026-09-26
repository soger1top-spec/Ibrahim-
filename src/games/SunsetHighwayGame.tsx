import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Flame,
  Volume2,
  VolumeX,
  Zap,
  RotateCcw,
  ArrowRight
} from 'lucide-react';
import { sounds } from './soundFx';

interface SunsetHighwayGameProps {
  onBackToMenu: () => void;
  controllerCommand?: any;
}

// -------------------------------------------------------------
// TYPES & CONSTANTS
// -------------------------------------------------------------
const ROAD_WIDTH = 2200;
const SEGMENT_LENGTH = 200;
const DRAW_DISTANCE = 250;
const CAMERA_HEIGHT = 1040;
const CAMERA_DEPTH = 0.84;
const LANES_COUNT = 4;
const MAX_SPEED = 240; // km/h
const MIN_SPEED = 40;
const ACCEL = 70;
const BRAKE_DECEL = 95;
const NATURAL_DECEL = 25;

interface Segment {
  index: number;
  p1: { world: { x: number; y: number; z: number }; screen: { x: number; y: number; w: number; scale: number } };
  p2: { world: { x: number; y: number; z: number }; screen: { x: number; y: number; w: number; scale: number } };
  curve: number;
  hill: number;
  sceneryLeft: RoadsideObject | null;
  sceneryRight: RoadsideObject | null;
}

interface RoadsideObject {
  type: 'palm' | 'pine' | 'building' | 'skyscraper' | 'sign' | 'lamp' | 'billboard';
  offset: number; // -1.5 (far left), 1.5 (far right)
  width: number;
  height: number;
  color: string;
  accentColor: string;
  seed: number;
}

interface TrafficCar {
  id: number;
  z: number;
  lane: number; // 0, 1, 2, 3 (from -0.62 to +0.62 in normalized road pos)
  targetLane: number;
  x: number; // normalized road position (-1 to 1)
  speed: number;
  model: 'sedan' | 'sport' | 'suv' | 'truck';
  color: string;
  width: number;
  height: number;
  length: number;
  isBraking: boolean;
  isYielding: boolean; // reacting to high beam flashing ("تكبيس")
  laneChangeTimer: number;
}

export function SunsetHighwayGame({ onBackToMenu, controllerCommand }: SunsetHighwayGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Gameplay state
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    return parseInt(localStorage.getItem('sunset_drive_highscore') || '0', 10);
  });
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(120);
  const [nearMissCount, setNearMissCount] = useState(0);
  const [nearMissNotification, setNearMissNotification] = useState<{ text: string; id: number } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isHighBeaming, setIsHighBeaming] = useState(false);

  // Mutable Game Loop State
  const stateRef = useRef({
    playerX: 0, // -1 to 1 (center is 0)
    playerZ: 0, // distance traveled
    speed: 120, // current speed in km/h
    steerAngle: 0, // for steering wheel rotation (-1 to 1)
    targetSteer: 0, // from analog stick or dpad
    stickThrottle: 0, // analog acceleration 0..1
    stickBrake: 0, // analog brake 0..1
    cameraTilt: 0,
    suspensionBounce: 0,
    segments: [] as Segment[],
    trackLength: 0,
    traffic: [] as TrafficCar[],
    lastFrameTime: performance.now(),
    isAccelerating: false,
    isBraking: false,
    isLeftPressed: false,
    isRightPressed: false,
    lastNearMissTime: 0,
    overtakeCombo: 1,
    highBeamTimer: 0, // seconds remaining of high beam strobe
    soundOn: true,
  });

  // -------------------------------------------------------------
  // ROAD & SCENERY GENERATION
  // -------------------------------------------------------------
  const buildTrack = useCallback(() => {
    const segments: Segment[] = [];
    const TOTAL_SEGMENTS = 2000;

    let currentCurve = 0;
    let currentHill = 0;
    let curveLength = 0;

    for (let i = 0; i < TOTAL_SEGMENTS; i++) {
      // Procedural curves & hills with smooth transitions
      if (curveLength <= 0) {
        curveLength = Math.floor(50 + Math.random() * 90);
        if (Math.random() < 0.65) {
          currentCurve = (Math.random() - 0.5) * 3.6;
        } else {
          currentCurve = 0;
        }

        if (Math.random() < 0.45) {
          currentHill = (Math.random() - 0.5) * 1100;
        } else {
          currentHill = 0;
        }
      }
      curveLength--;

      // Generate roadside objects (Low-poly buildings, palm trees, streetlights, overhead signs)
      let sceneryLeft: RoadsideObject | null = null;
      let sceneryRight: RoadsideObject | null = null;

      if (i % 8 === 0) {
        // Street lamp poles
        sceneryLeft = {
          type: 'lamp',
          offset: -1.25,
          width: 80,
          height: 380,
          color: '#334155',
          accentColor: '#f59e0b',
          seed: i
        };
        sceneryRight = {
          type: 'lamp',
          offset: 1.25,
          width: 80,
          height: 380,
          color: '#334155',
          accentColor: '#f59e0b',
          seed: i + 1
        };
      } else if (i % 22 === 0) {
        // Sunset City Skyline Buildings
        const buildingColors = ['#1e1b4b', '#311042', '#18181b', '#0f172a', '#27272a'];
        const winColors = ['#fbbf24', '#f59e0b', '#fb923c', '#fdba74'];
        sceneryLeft = {
          type: 'building',
          offset: -1.85 - Math.random() * 0.5,
          width: 320 + Math.random() * 260,
          height: 550 + Math.random() * 650,
          color: buildingColors[Math.floor(Math.random() * buildingColors.length)],
          accentColor: winColors[Math.floor(Math.random() * winColors.length)],
          seed: i * 3
        };
        sceneryRight = {
          type: 'building',
          offset: 1.85 + Math.random() * 0.5,
          width: 320 + Math.random() * 260,
          height: 550 + Math.random() * 650,
          color: buildingColors[Math.floor(Math.random() * buildingColors.length)],
          accentColor: winColors[Math.floor(Math.random() * winColors.length)],
          seed: i * 4
        };
      } else if (i % 14 === 0) {
        // Palm Trees along coastal desert strip
        sceneryLeft = {
          type: 'palm',
          offset: -1.4 - Math.random() * 0.4,
          width: 180,
          height: 480,
          color: '#1c1917',
          accentColor: '#fb923c',
          seed: i * 2
        };
        sceneryRight = {
          type: 'palm',
          offset: 1.4 + Math.random() * 0.4,
          width: 180,
          height: 480,
          color: '#1c1917',
          accentColor: '#fb923c',
          seed: i * 5
        };
      } else if (i % 65 === 0) {
        // Overhead Highway Gantry Sign
        sceneryLeft = {
          type: 'sign',
          offset: 0, // spans overhead
          width: ROAD_WIDTH * 1.1,
          height: 400,
          color: '#0f766e',
          accentColor: '#38bdf8',
          seed: i
        };
      }

      const worldY = Math.sin((i / 30)) * currentHill;

      segments.push({
        index: i,
        p1: {
          world: { x: 0, y: worldY, z: i * SEGMENT_LENGTH },
          screen: { x: 0, y: 0, w: 0, scale: 0 }
        },
        p2: {
          world: { x: 0, y: worldY, z: (i + 1) * SEGMENT_LENGTH },
          screen: { x: 0, y: 0, w: 0, scale: 0 }
        },
        curve: currentCurve,
        hill: currentHill,
        sceneryLeft,
        sceneryRight
      });
    }

    stateRef.current.segments = segments;
    stateRef.current.trackLength = segments.length * SEGMENT_LENGTH;

    // Spawn Initial AI Traffic on 4 Lanes
    const traffic: TrafficCar[] = [];
    const carColors = ['#dc2626', '#2563eb', '#ca8a04', '#059669', '#475569', '#e11d48', '#d97706', '#9333ea', '#ffffff'];
    const carModels: Array<'sedan' | 'sport' | 'suv' | 'truck'> = ['sedan', 'sport', 'suv', 'truck'];

    // 4 standard lane centers (-0.62, -0.21, 0.21, 0.62)
    const laneOffsets = [-0.62, -0.21, 0.21, 0.62];

    for (let t = 0; t < 40; t++) {
      const lane = Math.floor(Math.random() * 4);
      const model = carModels[Math.floor(Math.random() * carModels.length)];
      const baseSpeed = model === 'truck' ? 75 + Math.random() * 15 : (model === 'sport' ? 110 + Math.random() * 30 : 90 + Math.random() * 20);

      traffic.push({
        id: t + 1,
        z: 1200 + t * 850 + Math.random() * 350,
        lane,
        targetLane: lane,
        x: laneOffsets[lane],
        speed: baseSpeed,
        model,
        color: carColors[Math.floor(Math.random() * carColors.length)],
        width: model === 'truck' ? 180 : (model === 'suv' ? 150 : 135),
        height: model === 'truck' ? 180 : (model === 'suv' ? 120 : 95),
        length: model === 'truck' ? 380 : 200,
        isBraking: false,
        isYielding: false,
        laneChangeTimer: 200 + Math.random() * 400
      });
    }

    stateRef.current.traffic = traffic;
  }, []);

  // -------------------------------------------------------------
  // TRIGGER HEADLIGHT FLASH ("التكبيس")
  // -------------------------------------------------------------
  const triggerHighBeamFlash = useCallback(() => {
    const s = stateRef.current;
    // Activate 0.45 second rapid strobe pulse
    s.highBeamTimer = 0.48;
    setIsHighBeaming(true);
    sounds.playHighBeam();

    // AI Traffic Reaction: Cars ahead in front of the player notice the high-beam flashing and yield lane
    for (const car of s.traffic) {
      const relZ = car.z - s.playerZ;
      // If car is ahead within 2500 units and in same or adjacent lane
      if (relZ > 0 && relZ < 2500) {
        const laneDiff = Math.abs(car.x - s.playerX);
        if (laneDiff < 0.45) {
          car.isYielding = true;
          // Change to adjacent open lane
          if (car.lane === 0) car.targetLane = 1;
          else if (car.lane === 3) car.targetLane = 2;
          else {
            // Move right if player is on left, move left if player is on right
            car.targetLane = (s.playerX < car.x) ? Math.min(3, car.lane + 1) : Math.max(0, car.lane - 1);
          }
          // Slight speed boost to yield comfortably
          car.speed = Math.min(140, car.speed + 15);
        }
      }
    }
  }, []);

  // -------------------------------------------------------------
  // CONTROLLER COMMAND LISTENER (Flexible Analog Joystick + B Button Flash)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!controllerCommand) return;
    const cmd = controllerCommand;
    const s = stateRef.current;

    if (cmd.type === 'stick_move' && cmd.stick) {
      // 1. Smooth Analog Steering from Flexible Joystick X (-1 to 1)
      s.targetSteer = Math.max(-1, Math.min(1, cmd.stick.x * 1.25));

      // 2. Analog Throttle & Brake from Flexible Joystick Y
      if (cmd.stick.y < -0.15) {
        // Pushing stick UP/Forward accelerates proportionally
        s.stickThrottle = Math.min(1.0, (-cmd.stick.y - 0.15) / 0.7);
        s.stickBrake = 0;
      } else if (cmd.stick.y > 0.18) {
        // Pulling stick DOWN/Backward brakes proportionally
        s.stickBrake = Math.min(1.0, (cmd.stick.y - 0.18) / 0.7);
        s.stickThrottle = 0;
      } else {
        s.stickThrottle = 0;
        s.stickBrake = 0;
      }
    } else if (cmd.type === 'button_down') {
      if (cmd.button === 'LEFT') s.isLeftPressed = true;
      if (cmd.button === 'RIGHT') s.isRightPressed = true;
      if (cmd.button === 'UP' || cmd.button === 'A' || cmd.button === 'R1' || cmd.button === 'R2') s.isAccelerating = true;
      if (cmd.button === 'DOWN' || cmd.button === 'L1' || cmd.button === 'L2') s.isBraking = true;
      
      // BUTTON [B] = HEADLIGHT FLASH / STROBE ("التكبيس")
      if (cmd.button === 'B') {
        triggerHighBeamFlash();
      }

      if (cmd.button === 'Y' || cmd.button === 'X') {
        // Honk horn
        sounds.playHorn();
      }
      if (cmd.button === 'START') {
        if (isGameOver) {
          restartGame();
        } else {
          setIsPaused(p => !p);
        }
      }
      if (cmd.button === 'SELECT') {
        onBackToMenu();
      }
    } else if (cmd.type === 'button_up') {
      if (cmd.button === 'LEFT') s.isLeftPressed = false;
      if (cmd.button === 'RIGHT') s.isRightPressed = false;
      if (cmd.button === 'UP' || cmd.button === 'A' || cmd.button === 'R1' || cmd.button === 'R2') s.isAccelerating = false;
      if (cmd.button === 'DOWN' || cmd.button === 'L1' || cmd.button === 'L2') s.isBraking = false;
    }
  }, [controllerCommand, isGameOver, onBackToMenu, triggerHighBeamFlash]);

  // Keyboard controls for development / testing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') s.isLeftPressed = true;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') s.isRightPressed = true;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') s.isAccelerating = true;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') s.isBraking = true;
      if (e.key === 'b' || e.key === 'B' || e.key === 'f' || e.key === 'F') triggerHighBeamFlash();
      if (e.key === 'h' || e.key === 'H') sounds.playHorn();
      if (e.key === 'p' || e.key === 'Escape') setIsPaused(p => !p);
      if (e.key === 'r' && isGameOver) restartGame();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') s.isLeftPressed = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') s.isRightPressed = false;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') s.isAccelerating = false;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') s.isBraking = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isGameOver, triggerHighBeamFlash]);

  // -------------------------------------------------------------
  // GAME INITIALIZATION & RESET
  // -------------------------------------------------------------
  const restartGame = useCallback(() => {
    buildTrack();
    stateRef.current.playerX = 0;
    stateRef.current.playerZ = 0;
    stateRef.current.speed = 110;
    stateRef.current.steerAngle = 0;
    stateRef.current.targetSteer = 0;
    stateRef.current.stickThrottle = 0;
    stateRef.current.stickBrake = 0;
    stateRef.current.highBeamTimer = 0;
    stateRef.current.lastFrameTime = performance.now();
    setScore(0);
    setDistanceKm(0);
    setNearMissCount(0);
    setIsGameOver(false);
    setIsPaused(false);
    setIsHighBeaming(false);
  }, [buildTrack]);

  useEffect(() => {
    buildTrack();
  }, [buildTrack]);

  // -------------------------------------------------------------
  // PROJECTION HELPER FUNCTION
  // -------------------------------------------------------------
  const project = (
    p: { world: { x: number; y: number; z: number }; screen: { x: number; y: number; w: number; scale: number } },
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    width: number,
    height: number,
    roadWidth: number
  ) => {
    const transX = p.world.x - cameraX;
    const transY = p.world.y - cameraY;
    const transZ = p.world.z - cameraZ;

    if (transZ <= 0) {
      p.screen.scale = 0;
      return;
    }

    p.screen.scale = CAMERA_DEPTH / transZ;
    p.screen.x = Math.round((width / 2) + (p.screen.scale * transX * width / 2));
    p.screen.y = Math.round((height / 2) - (p.screen.scale * transY * height / 2));
    p.screen.w = Math.round(p.screen.scale * roadWidth * width / 2);
  };

  // -------------------------------------------------------------
  // MAIN GAME & RENDERING LOOP
  // -------------------------------------------------------------
  useEffect(() => {
    let animationFrameId: number;

    const gameLoop = (now: number) => {
      animationFrameId = requestAnimationFrame(gameLoop);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      const dt = Math.min((now - stateRef.current.lastFrameTime) / 1000, 0.05);
      stateRef.current.lastFrameTime = now;

      if (isPaused) {
        return;
      }

      const s = stateRef.current;
      const width = canvas.width;
      const height = canvas.height;

      // Update High Beam Strobe Timer ("التكبيس")
      if (s.highBeamTimer > 0) {
        s.highBeamTimer = Math.max(0, s.highBeamTimer - dt);
        if (s.highBeamTimer <= 0) {
          setIsHighBeaming(false);
        }
      }

      // ---------------------------------------------------------
      // 1. UPDATE ROAD & VEHICLE PHYSICS
      // ---------------------------------------------------------
      if (!isGameOver) {
        // Steering input calculation (Stick + Dpad)
        let desiredSteer = s.targetSteer;
        if (s.isLeftPressed) desiredSteer = -1;
        if (s.isRightPressed) desiredSteer = 1;

        // Smooth steering response with analog damping
        s.steerAngle += (desiredSteer - s.steerAngle) * 9 * dt;

        // Acceleration & Braking (combines Button A and Analog Joystick StickThrottle/StickBrake)
        const totalAccel = s.isAccelerating ? 1.0 : s.stickThrottle;
        const totalBrake = s.isBraking ? 1.0 : s.stickBrake;

        if (totalAccel > 0.05) {
          s.speed = Math.min(MAX_SPEED, s.speed + ACCEL * totalAccel * dt);
        } else if (totalBrake > 0.05) {
          s.speed = Math.max(MIN_SPEED, s.speed - BRAKE_DECEL * totalBrake * dt);
        } else {
          // Natural coasting around 120 km/h
          if (s.speed > 120) {
            s.speed = Math.max(120, s.speed - NATURAL_DECEL * dt);
          } else if (s.speed < 100) {
            s.speed = Math.min(100, s.speed + NATURAL_DECEL * 0.5 * dt);
          }
        }

        // Steer player position on road (speed-dependent displacement)
        const steerSpeedMultiplier = (s.speed / MAX_SPEED) * 1.55 + 0.35;
        s.playerX += s.steerAngle * steerSpeedMultiplier * dt;

        // Curve Centrifugal Force: curve naturally exerts lateral pull at high speeds
        const currentSegmentIndex = Math.floor(s.playerZ / SEGMENT_LENGTH) % (s.segments.length || 1);
        const playerSeg = s.segments[currentSegmentIndex];
        if (playerSeg && Math.abs(playerSeg.curve) > 0.1) {
          const centrifugalForce = playerSeg.curve * (s.speed / MAX_SPEED) * 0.22;
          s.playerX -= centrifugalForce * dt;
        }

        // Off-road penalty if player drives on shoulder
        if (s.playerX < -1.1 || s.playerX > 1.1) {
          s.speed = Math.max(40, s.speed - 110 * dt);
          s.suspensionBounce = Math.sin(now * 0.05) * 4; // rumble bump
        } else {
          s.suspensionBounce = Math.sin(now * 0.02 * (s.speed / 100)) * 1.2;
        }

        // Clamp to prevent driving completely into the void
        s.playerX = Math.max(-1.45, Math.min(1.45, s.playerX));

        // Advance track distance
        const distanceStep = (s.speed * 1000 / 3600) * dt * 25; // in track units
        s.playerZ += distanceStep;

        if (s.trackLength > 0 && s.playerZ >= s.trackLength) {
          s.playerZ -= s.trackLength;
        }

        // Camera tilt simulation for g-force cornering
        s.cameraTilt += (s.steerAngle * 0.08 - s.cameraTilt) * 6 * dt;

        // Update Distance & Score
        const kmAdded = (s.speed / 3600) * dt;
        setDistanceKm(prev => {
          const next = prev + kmAdded;
          return parseFloat(next.toFixed(2));
        });

        setCurrentSpeedKmh(Math.round(s.speed));

        setScore(prev => {
          const points = Math.round(s.speed * 0.4 * dt * 10);
          const nextScore = prev + points;
          if (nextScore > highScore) {
            setHighScore(nextScore);
            localStorage.setItem('sunset_drive_highscore', nextScore.toString());
          }
          return nextScore;
        });

        // ---------------------------------------------------------
        // 2. UPDATE AI TRAFFIC WITH SAFE DISTANCE & HIGH-BEAM REACTION
        // ---------------------------------------------------------
        const lanePositions = [-0.62, -0.21, 0.21, 0.62];

        for (let i = 0; i < s.traffic.length; i++) {
          const car = s.traffic[i];

          // Advance AI car relative to track
          const carStep = (car.speed * 1000 / 3600) * dt * 25;
          car.z += carStep;

          // Recycle traffic car when far behind player
          if (car.z < s.playerZ - 1200) {
            car.z = s.playerZ + 8000 + Math.random() * 4000;
            car.lane = Math.floor(Math.random() * 4);
            car.targetLane = car.lane;
            car.x = lanePositions[car.lane];
            car.speed = car.model === 'truck' ? 75 + Math.random() * 15 : 90 + Math.random() * 30;
            car.isYielding = false;
          }

          // If car is way too far ahead (loop around track)
          if (s.trackLength > 0 && car.z >= s.playerZ + s.trackLength) {
            car.z -= s.trackLength;
          }

          // AI collision avoidance: check vehicle ahead in same lane
          let carAheadInLane: TrafficCar | null = null;
          let minDistanceAhead = Infinity;

          for (let j = 0; j < s.traffic.length; j++) {
            if (i === j) continue;
            const other = s.traffic[j];
            if (other.lane === car.lane && other.z > car.z) {
              const dist = other.z - car.z;
              if (dist < minDistanceAhead) {
                minDistanceAhead = dist;
                carAheadInLane = other;
              }
            }
          }

          // If close to car ahead, brake and gently change lane
          if (carAheadInLane && minDistanceAhead < 700) {
            car.isBraking = true;
            car.speed = Math.max(50, car.speed - 45 * dt);

            // Attempt lane change if timer allows
            car.laneChangeTimer -= dt * 60;
            if (car.laneChangeTimer <= 0) {
              const possibleLanes = [];
              if (car.lane > 0) possibleLanes.push(car.lane - 1);
              if (car.lane < 3) possibleLanes.push(car.lane + 1);
              if (possibleLanes.length > 0) {
                car.targetLane = possibleLanes[Math.floor(Math.random() * possibleLanes.length)];
                car.laneChangeTimer = 300 + Math.random() * 400;
              }
            }
          } else {
            car.isBraking = false;
          }

          // Smooth AI lane transition
          car.lane = car.targetLane;
          const targetX = lanePositions[car.targetLane];
          car.x += (targetX - car.x) * (car.isYielding ? 4.5 : 2.5) * dt;

          // ---------------------------------------------------------
          // PLAYER VS AI TRAFFIC COLLISION & NEAR-MISS CHECK
          // ---------------------------------------------------------
          const relZ = car.z - s.playerZ;

          // If car is right at the player's bumper (0 to 220 units ahead)
          if (relZ > -30 && relZ < 220) {
            const playerWidthNormalized = 0.32;
            const carWidthNormalized = car.model === 'truck' ? 0.36 : 0.28;

            const lateralDistance = Math.abs(s.playerX - car.x);

            if (lateralDistance < (playerWidthNormalized + carWidthNormalized) * 0.48) {
              // Direct Collision!
              sounds.playCrash();
              setIsGameOver(true);
              break;
            } else if (lateralDistance < (playerWidthNormalized + carWidthNormalized) * 0.95) {
              // Near-miss overtakes bonus!
              if (now - s.lastNearMissTime > 800) {
                s.lastNearMissTime = now;
                sounds.playNearMiss();
                setNearMissCount(n => n + 1);
                const bonusPoints = 500 * s.overtakeCombo;
                setScore(sc => sc + bonusPoints);
                setNearMissNotification({
                  text: `🔥 تفادي وتجاوز قريب! +${bonusPoints}`,
                  id: now
                });
                setTimeout(() => setNearMissNotification(null), 1200);
              }
            }
          }
        }
      }

      // ---------------------------------------------------------
      // 3. GRAPHICAL RENDERING: WARM SUNSET & GLORIOUS 3D HORIZON
      // ---------------------------------------------------------
      ctx.save();

      // Sky Gradient (Golden hour / warm sunset atmosphere matching photo style)
      const skyGradient = ctx.createLinearGradient(0, 0, 0, height * 0.65);
      skyGradient.addColorStop(0, '#1c1033'); // Deep dusk twilight violet at zenith
      skyGradient.addColorStop(0.35, '#581c87'); // Rich royal magenta
      skyGradient.addColorStop(0.65, '#c2410c'); // Warm amber orange
      skyGradient.addColorStop(0.85, '#ea580c'); // Radiant flame orange
      skyGradient.addColorStop(1, '#fde047'); // Golden solar glare at horizon
      ctx.fillStyle = skyGradient;
      ctx.fillRect(0, 0, width, height);

      // Low-poly Distant Mountains with warm rim lighting
      const horizonY = height * 0.52;
      ctx.save();
      ctx.fillStyle = '#2e1065';
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      const mtnSegments = 16;
      for (let m = 0; m <= mtnSegments; m++) {
        const mx = (width / mtnSegments) * m;
        const my = horizonY - 45 - Math.sin(m * 1.3) * 35 - Math.cos(m * 0.8) * 25;
        ctx.lineTo(mx, my);
      }
      ctx.lineTo(width, horizonY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Big Sunset Sun near the horizon
      const sunX = width * 0.52 + s.playerX * 50;
      const sunY = horizonY - 20;
      const sunRadius = Math.min(width, height) * 0.16;

      const sunGlow = ctx.createRadialGradient(sunX, sunY, sunRadius * 0.1, sunX, sunY, sunRadius * 2.8);
      sunGlow.addColorStop(0, 'rgba(255, 255, 220, 0.95)');
      sunGlow.addColorStop(0.2, 'rgba(253, 224, 71, 0.85)');
      sunGlow.addColorStop(0.45, 'rgba(249, 115, 22, 0.45)');
      sunGlow.addColorStop(0.8, 'rgba(234, 88, 12, 0.15)');
      sunGlow.addColorStop(1, 'rgba(194, 65, 12, 0)');
      ctx.fillStyle = sunGlow;
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunRadius * 2.8, 0, Math.PI * 2);
      ctx.fill();

      // Solid Sun Core
      ctx.fillStyle = '#fffbeb';
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunRadius * 0.75, 0, Math.PI * 2);
      ctx.fill();

      // Sunset Light Rays / Atmospheric Glow across Horizon
      ctx.fillStyle = 'rgba(251, 146, 60, 0.18)';
      ctx.fillRect(0, horizonY - 80, width, 120);

      // ---------------------------------------------------------
      // 4. PROCEDURAL 3D HIGHWAY PROJECTION & RENDERING
      // ---------------------------------------------------------
      if (s.segments.length > 0) {
        const startPos = s.playerZ;
        const startSegmentIndex = Math.floor(startPos / SEGMENT_LENGTH) % s.segments.length;
        const playerSegment = s.segments[startSegmentIndex];
        const cameraX = s.playerX * ROAD_WIDTH;
        const cameraY = CAMERA_HEIGHT + (playerSegment ? playerSegment.p1.world.y : 0) + s.suspensionBounce;
        const cameraZ = startPos - CAMERA_DEPTH;

        let maxy = height;
        let x = 0;
        let dx = 0;

        // Collect visible roadside scenery objects for z-sorting
        const renderQueue: Array<{
          type: 'scenery' | 'car';
          z: number;
          obj: any;
          screenX: number;
          screenY: number;
          scale: number;
          segment: Segment;
        }> = [];

        // Project road segments forward
        for (let n = 0; n < DRAW_DISTANCE; n++) {
          const segIndex = (startSegmentIndex + n) % s.segments.length;
          const segment = s.segments[segIndex];
          const looped = segment.index < startSegmentIndex;

          segment.p1.world.z = (segment.index + (looped ? s.segments.length : 0)) * SEGMENT_LENGTH;
          segment.p2.world.z = (segment.index + 1 + (looped ? s.segments.length : 0)) * SEGMENT_LENGTH;

          // Apply curve delta
          dx += segment.curve;
          x += dx;
          segment.p1.world.x = x;
          segment.p2.world.x = x + dx;

          project(segment.p1, cameraX, cameraY, cameraZ, width, height, ROAD_WIDTH);
          project(segment.p2, cameraX, cameraY, cameraZ, width, height, ROAD_WIDTH);

          if (segment.p1.screen.scale <= 0 || segment.p2.screen.scale <= 0 || segment.p2.screen.y >= maxy) {
            continue;
          }

          // Render Terrain & Asphalt with sunset tones
          const p1 = segment.p1.screen;
          const p2 = segment.p2.screen;

          // Roadside warm sand / terrain
          const terrainColor = (segment.index % 2 === 0) ? '#451a03' : '#3c1301';
          ctx.fillStyle = terrainColor;
          ctx.fillRect(0, p2.y, width, p1.y - p2.y);

          // Asphalt Road Body (Warm dark asphalt reflecting sunset tones)
          const roadColor = (segment.index % 2 === 0) ? '#1c1917' : '#221e1a';
          ctx.fillStyle = roadColor;
          ctx.beginPath();
          ctx.moveTo(p1.x - p1.w, p1.y);
          ctx.lineTo(p1.x + p1.w, p1.y);
          ctx.lineTo(p2.x + p2.w, p2.y);
          ctx.lineTo(p2.x - p2.w, p2.y);
          ctx.closePath();
          ctx.fill();

          // Outer Solid Road Borders (Left Yellow, Right White)
          const rumbleW1 = p1.w * 0.08;
          const rumbleW2 = p2.w * 0.08;

          // Left border
          ctx.fillStyle = (segment.index % 4 < 2) ? '#f59e0b' : '#b45309';
          ctx.beginPath();
          ctx.moveTo(p1.x - p1.w - rumbleW1, p1.y);
          ctx.lineTo(p1.x - p1.w, p1.y);
          ctx.lineTo(p2.x - p2.w, p2.y);
          ctx.lineTo(p2.x - p2.w - rumbleW2, p2.y);
          ctx.fill();

          // Right border
          ctx.fillStyle = (segment.index % 4 < 2) ? '#ffffff' : '#94a3b8';
          ctx.beginPath();
          ctx.moveTo(p1.x + p1.w, p1.y);
          ctx.lineTo(p1.x + p1.w + rumbleW1, p1.y);
          ctx.lineTo(p2.x + p2.w + rumbleW2, p2.y);
          ctx.lineTo(p2.x + p2.w, p2.y);
          ctx.fill();

          // Lane Separator Lines (4 lanes = 3 dashed white lines)
          if (segment.index % 6 < 3) {
            ctx.fillStyle = '#fde68a'; // Sunset-warmed white dashed lines
            for (let laneIdx = 1; laneIdx < LANES_COUNT; laneIdx++) {
              const laneFactor = (laneIdx / LANES_COUNT) * 2 - 1; // -0.5, 0, 0.5
              const laneW1 = p1.w * 0.02;
              const laneW2 = p2.w * 0.02;
              const laneX1 = p1.x + p1.w * laneFactor;
              const laneX2 = p2.x + p2.w * laneFactor;

              ctx.beginPath();
              ctx.moveTo(laneX1 - laneW1, p1.y);
              ctx.lineTo(laneX1 + laneW1, p1.y);
              ctx.lineTo(laneX2 + laneW2, p2.y);
              ctx.lineTo(laneX2 - laneW2, p2.y);
              ctx.fill();
            }
          }

          // Metallic Highway Guardrails on edges
          const railH1 = p1.scale * 140 * (width / 2);
          const railH2 = p2.scale * 140 * (width / 2);

          // Left guardrail
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.moveTo(p1.x - p1.w - rumbleW1, p1.y - railH1);
          ctx.lineTo(p1.x - p1.w - rumbleW1 + 8 * p1.scale, p1.y - railH1);
          ctx.lineTo(p2.x - p2.w - rumbleW2 + 8 * p2.scale, p2.y - railH2);
          ctx.lineTo(p2.x - p2.w - rumbleW2, p2.y - railH2);
          ctx.fill();

          // Guardrail reflective orange amber highlight
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = Math.max(1, p1.scale * 6);
          ctx.beginPath();
          ctx.moveTo(p1.x - p1.w - rumbleW1, p1.y - railH1 * 0.6);
          ctx.lineTo(p2.x - p2.w - rumbleW2, p2.y - railH2 * 0.6);
          ctx.stroke();

          // Queue roadside objects for sorted rendering
          if (segment.sceneryLeft) {
            renderQueue.push({
              type: 'scenery',
              z: segment.p1.world.z,
              obj: segment.sceneryLeft,
              screenX: p1.x + p1.w * segment.sceneryLeft.offset,
              screenY: p1.y,
              scale: p1.scale,
              segment
            });
          }
          if (segment.sceneryRight) {
            renderQueue.push({
              type: 'scenery',
              z: segment.p1.world.z,
              obj: segment.sceneryRight,
              screenX: p1.x + p1.w * segment.sceneryRight.offset,
              screenY: p1.y,
              scale: p1.scale,
              segment
            });
          }

          maxy = p2.y;
        }

        // Add Visible AI Traffic Cars to sorted render queue
        for (const car of s.traffic) {
          const relZ = car.z - startPos;
          if (relZ > 0 && relZ < DRAW_DISTANCE * SEGMENT_LENGTH) {
            const carSegIndex = Math.floor(car.z / SEGMENT_LENGTH) % s.segments.length;
            const carSegment = s.segments[carSegIndex];
            if (carSegment) {
              const scale = CAMERA_DEPTH / relZ;
              const screenX = Math.round((width / 2) + (scale * (car.x * ROAD_WIDTH - cameraX) * width / 2));
              const screenY = Math.round((height / 2) - (scale * (carSegment.p1.world.y - cameraY) * height / 2));

              renderQueue.push({
                type: 'car',
                z: car.z,
                obj: car,
                screenX,
                screenY,
                scale,
                segment: carSegment
              });
            }
          }
        }

        // Sort render queue from back to front (Far Z to Near Z)
        renderQueue.sort((a, b) => b.z - a.z);

        // ---------------------------------------------------------
        // 5. RENDER ROADSIDE SCENERY & DYNAMIC LONG SUNSET SHADOWS
        // ---------------------------------------------------------
        for (const item of renderQueue) {
          const scale = item.scale;
          const sx = item.screenX;
          const sy = item.screenY;

          if (item.type === 'scenery') {
            const obj = item.obj as RoadsideObject;
            const w = obj.width * scale * (width / 2);
            const h = obj.height * scale * (height / 2);

            // LONG DRAMATIC SUNSET SHADOWS (Low sun casts elongated diagonal shadows)
            ctx.save();
            ctx.fillStyle = 'rgba(15, 7, 26, 0.65)';
            ctx.beginPath();
            ctx.moveTo(sx - w * 0.4, sy);
            ctx.lineTo(sx + w * 0.4, sy);
            const shadowLen = h * 2.2;
            const shadowAngleOffset = (sx - sunX) * 0.8;
            ctx.lineTo(sx + shadowAngleOffset + w * 0.5, sy + shadowLen * 0.25);
            ctx.lineTo(sx + shadowAngleOffset - w * 0.5, sy + shadowLen * 0.25);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // Draw Low-Poly Scenery Object
            if (obj.type === 'skyscraper' || obj.type === 'building') {
              ctx.fillStyle = obj.color;
              ctx.fillRect(sx - w / 2, sy - h, w, h);

              ctx.fillStyle = 'rgba(251, 146, 60, 0.25)';
              ctx.fillRect(sx - w / 2, sy - h, w * 0.35, h);

              // Window glow grid
              ctx.fillStyle = obj.accentColor;
              const winRows = 8;
              const winCols = 4;
              for (let r = 0; r < winRows; r++) {
                for (let c = 0; c < winCols; c++) {
                  if ((obj.seed + r * 3 + c) % 3 === 0) {
                    const wx = sx - w / 2 + (w / winCols) * (c + 0.3);
                    const wy = sy - h + (h / winRows) * (r + 0.3);
                    ctx.fillRect(wx, wy, Math.max(1, w * 0.12), Math.max(1, h * 0.05));
                  }
                }
              }

              // Rooftop antenna
              ctx.strokeStyle = '#ef4444';
              ctx.lineWidth = Math.max(1, 2 * scale);
              ctx.beginPath();
              ctx.moveTo(sx, sy - h);
              ctx.lineTo(sx, sy - h - h * 0.15);
              ctx.stroke();
            } else if (obj.type === 'palm') {
              ctx.strokeStyle = '#292524';
              ctx.lineWidth = Math.max(2, 10 * scale * (width / 1000));
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.quadraticCurveTo(sx + 15 * scale, sy - h * 0.6, sx + 5 * scale, sy - h);
              ctx.stroke();

              ctx.fillStyle = '#1c1917';
              for (let a = 0; a < 6; a++) {
                const angle = (a / 6) * Math.PI * 2;
                const fx = sx + 5 * scale + Math.cos(angle) * (w * 0.6);
                const fy = sy - h + Math.sin(angle) * (w * 0.3);
                ctx.beginPath();
                ctx.moveTo(sx + 5 * scale, sy - h);
                ctx.lineTo(fx, fy);
                ctx.lineTo(sx + 5 * scale + Math.cos(angle + 0.3) * (w * 0.3), sy - h + 10);
                ctx.fill();
              }
            } else if (obj.type === 'lamp') {
              ctx.strokeStyle = '#475569';
              ctx.lineWidth = Math.max(1, 4 * scale * (width / 1000));
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(sx, sy - h);
              ctx.lineTo(sx + (obj.offset < 0 ? 30 : -30) * scale * (width / 500), sy - h);
              ctx.stroke();

              ctx.fillStyle = '#fbbf24';
              ctx.beginPath();
              ctx.arc(sx + (obj.offset < 0 ? 30 : -30) * scale * (width / 500), sy - h, Math.max(2, 6 * scale * (width / 500)), 0, Math.PI * 2);
              ctx.fill();
            } else if (obj.type === 'sign') {
              ctx.strokeStyle = '#334155';
              ctx.lineWidth = Math.max(2, 6 * scale * (width / 800));
              ctx.beginPath();
              ctx.moveTo(sx - w * 0.55, sy);
              ctx.lineTo(sx - w * 0.55, sy - h);
              ctx.lineTo(sx + w * 0.55, sy - h);
              ctx.lineTo(sx + w * 0.55, sy);
              ctx.stroke();

              const signW = w * 0.5;
              const signH = h * 0.45;
              ctx.fillStyle = '#065f46';
              ctx.fillRect(sx - signW / 2, sy - h + 5, signW, signH);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = Math.max(1, 2 * scale);
              ctx.strokeRect(sx - signW / 2, sy - h + 5, signW, signH);

              ctx.fillStyle = '#ffffff';
              ctx.font = `bold ${Math.max(8, Math.floor(16 * scale * (width / 500)))}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillText('طريق الساحل السريع ➔', sx, sy - h + signH * 0.6);
            }
          } else if (item.type === 'car') {
            const car = item.obj as TrafficCar;
            const carW = car.width * scale * (width / 2);
            const carH = car.height * scale * (height / 2);

            // Dynamic Elongated Sunset Shadow Under & In Front of AI Car
            ctx.save();
            ctx.fillStyle = 'rgba(15, 7, 26, 0.7)';
            ctx.beginPath();
            ctx.moveTo(sx - carW * 0.55, sy);
            ctx.lineTo(sx + carW * 0.55, sy);
            const carShadowLength = carH * 2.8;
            const shadowXShift = (sx - sunX) * 0.65;
            ctx.lineTo(sx + shadowXShift + carW * 0.6, sy + carShadowLength * 0.35);
            ctx.lineTo(sx + shadowXShift - carW * 0.6, sy + carShadowLength * 0.35);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // Vehicle Body (Low-poly 3D Sedan / SUV / Sport / Truck)
            ctx.save();

            // Lower Bumper & Wheels
            ctx.fillStyle = '#0f172a';
            const wheelW = carW * 0.22;
            const wheelH = carH * 0.3;
            ctx.fillRect(sx - carW * 0.48, sy - wheelH, wheelW, wheelH);
            ctx.fillRect(sx + carW * 0.48 - wheelW, sy - wheelH, wheelW, wheelH);

            // Main Car Chassis
            ctx.fillStyle = car.color;
            ctx.fillRect(sx - carW * 0.48, sy - carH * 0.75, carW * 0.96, carH * 0.6);

            // Sunset highlight sheen on car roof & side
            ctx.fillStyle = 'rgba(253, 224, 71, 0.35)';
            ctx.fillRect(sx - carW * 0.48, sy - carH * 0.75, carW * 0.96, carH * 0.12);

            // Car Greenhouse / Cabin / Rear Windshield
            ctx.fillStyle = '#090d16';
            ctx.beginPath();
            ctx.moveTo(sx - carW * 0.42, sy - carH * 0.75);
            ctx.lineTo(sx - carW * 0.32, sy - carH * 1.05);
            ctx.lineTo(sx + carW * 0.32, sy - carH * 1.05);
            ctx.lineTo(sx + carW * 0.42, sy - carH * 0.75);
            ctx.closePath();
            ctx.fill();

            // Rear windshield glass sunset reflection
            ctx.fillStyle = 'rgba(251, 146, 60, 0.45)';
            ctx.beginPath();
            ctx.moveTo(sx - carW * 0.36, sy - carH * 0.77);
            ctx.lineTo(sx - carW * 0.28, sy - carH * 1.02);
            ctx.lineTo(sx - carW * 0.1, sy - carH * 1.02);
            ctx.lineTo(sx - carW * 0.2, sy - carH * 0.77);
            ctx.closePath();
            ctx.fill();

            // Bright Glowing Tail Lights & Brake Lights
            const tailLightW = carW * 0.22;
            const tailLightH = carH * 0.18;
            const isBraking = car.isBraking;

            ctx.shadowColor = isBraking ? '#ff0000' : '#dc2626';
            ctx.shadowBlur = isBraking ? 18 : 8;

            ctx.fillStyle = isBraking ? '#ff2222' : '#dc2626';
            ctx.fillRect(sx - carW * 0.46, sy - carH * 0.68, tailLightW, tailLightH);
            ctx.fillRect(sx + carW * 0.46 - tailLightW, sy - carH * 0.68, tailLightW, tailLightH);

            // Turn Signal Blink when Yielding from High Beam ("تكبيس")
            if (car.isYielding && Math.floor(now / 150) % 2 === 0) {
              ctx.fillStyle = '#f59e0b';
              ctx.shadowColor = '#f59e0b';
              ctx.shadowBlur = 14;
              if (car.targetLane > car.lane) {
                // Right blinker
                ctx.fillRect(sx + carW * 0.46 - tailLightW, sy - carH * 0.68, tailLightW, tailLightH);
              } else {
                // Left blinker
                ctx.fillRect(sx - carW * 0.46, sy - carH * 0.68, tailLightW, tailLightH);
              }
            }

            if (isBraking) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(sx - carW * 0.12, sy - carH * 1.02, carW * 0.24, carH * 0.08);
            }

            // License plate
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(sx - carW * 0.15, sy - carH * 0.42, carW * 0.3, carH * 0.14);
            ctx.fillStyle = '#0f172a';
            ctx.font = `bold ${Math.max(6, Math.floor(carH * 0.1))}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillText('SUNSET', sx, sy - carH * 0.32);

            ctx.restore();
          }
        }

        // =========================================================
        // HEADLIGHT HIGH-BEAM ILLUMINATION CONES ("التكبيس")
        // Rapid strobe flashing across the asphalt ahead
        // =========================================================
        const isStrobeFlashActive = s.highBeamTimer > 0 && Math.sin(s.highBeamTimer * 50) > -0.2;

        if (isStrobeFlashActive) {
          ctx.save();
          // Dual bright high-beam projection beams extending onto road
          const beamTopY = height * 0.54;
          const beamBottomY = height * 0.72;

          // Left Headlight High Beam Cone
          const leftBeamGrad = ctx.createLinearGradient(width * 0.32, beamBottomY, width * 0.42, beamTopY);
          leftBeamGrad.addColorStop(0, 'rgba(254, 240, 138, 0.45)');
          leftBeamGrad.addColorStop(0.5, 'rgba(253, 224, 71, 0.25)');
          leftBeamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = leftBeamGrad;
          ctx.beginPath();
          ctx.moveTo(width * 0.28, beamBottomY);
          ctx.lineTo(width * 0.38, beamBottomY);
          ctx.lineTo(width * 0.46, beamTopY);
          ctx.lineTo(width * 0.38, beamTopY);
          ctx.closePath();
          ctx.fill();

          // Right Headlight High Beam Cone
          const rightBeamGrad = ctx.createLinearGradient(width * 0.68, beamBottomY, width * 0.58, beamTopY);
          rightBeamGrad.addColorStop(0, 'rgba(254, 240, 138, 0.45)');
          rightBeamGrad.addColorStop(0.5, 'rgba(253, 224, 71, 0.25)');
          rightBeamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = rightBeamGrad;
          ctx.beginPath();
          ctx.moveTo(width * 0.62, beamBottomY);
          ctx.lineTo(width * 0.72, beamBottomY);
          ctx.lineTo(width * 0.62, beamTopY);
          ctx.lineTo(width * 0.54, beamTopY);
          ctx.closePath();
          ctx.fill();

          // Full Highway Road High-Beam Flare Illumination
          const roadFlashGrad = ctx.createRadialGradient(width * 0.5, height * 0.62, 20, width * 0.5, height * 0.62, width * 0.45);
          roadFlashGrad.addColorStop(0, 'rgba(255, 255, 240, 0.35)');
          roadFlashGrad.addColorStop(0.6, 'rgba(253, 224, 71, 0.12)');
          roadFlashGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = roadFlashGrad;
          ctx.fillRect(0, beamTopY - 20, width, height * 0.25);

          ctx.restore();
        }
      }

      // ---------------------------------------------------------
      // 6. IN-CAR FIRST PERSON COCKPIT (THE SIGNATURE DASHBOARD)
      // Realistic Sports Car Cabin, Steering Wheel, Rear-view Mirror
      // ---------------------------------------------------------
      ctx.save();
      const steer = s.steerAngle; // -1 to 1

      // A-Pillars & Roof Trim (Interior Windshield Frame)
      const pillarW = width * 0.085;
      const roofH = height * 0.09;

      // Carbon-textured / matte black interior frame
      ctx.fillStyle = '#090b10';
      // Left A-Pillar
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(pillarW * 1.8, 0);
      ctx.lineTo(pillarW * 0.6, height * 0.72);
      ctx.lineTo(0, height * 0.85);
      ctx.closePath();
      ctx.fill();

      // Right A-Pillar
      ctx.beginPath();
      ctx.moveTo(width, 0);
      ctx.lineTo(width - pillarW * 1.8, 0);
      ctx.lineTo(width - pillarW * 0.6, height * 0.72);
      ctx.lineTo(width, height * 0.85);
      ctx.closePath();
      ctx.fill();

      // Top Roof Trim
      ctx.fillRect(0, 0, width, roofH);

      // Warm sunset rim lighting along windshield edges
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pillarW * 1.8, roofH);
      ctx.lineTo(pillarW * 0.6, height * 0.72);
      ctx.moveTo(width - pillarW * 1.8, roofH);
      ctx.lineTo(width - pillarW * 0.6, height * 0.72);
      ctx.stroke();

      // =========================================================
      // CENTRAL REAR-VIEW MIRROR (المراية الوسطى)
      // Mounted at top-center showing live rear highway view
      // =========================================================
      const mirrorW = width * 0.24;
      const mirrorH = height * 0.085;
      const mirrorX = width / 2 - mirrorW / 2;
      const mirrorY = roofH * 0.9;

      // Mirror Mounting Arm
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(width / 2 - 8, roofH * 0.3, 16, mirrorH * 0.8);

      // Mirror Bezel / Casing
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(mirrorX, mirrorY, mirrorW, mirrorH, 14);
      ctx.fill();
      ctx.stroke();

      // Mirror Reflective Glass Surface (Showing Sunset & Rear Highway)
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(mirrorX + 4, mirrorY + 4, mirrorW - 8, mirrorH - 8, 10);
      ctx.clip();

      // Rear Sky in Mirror
      const rearSkyGrad = ctx.createLinearGradient(mirrorX, mirrorY, mirrorX, mirrorY + mirrorH);
      rearSkyGrad.addColorStop(0, '#581c87');
      rearSkyGrad.addColorStop(0.6, '#ea580c');
      rearSkyGrad.addColorStop(1, '#fde047');
      ctx.fillStyle = rearSkyGrad;
      ctx.fillRect(mirrorX, mirrorY, mirrorW, mirrorH);

      // Rear Asphalt & Lane Lines in Mirror
      ctx.fillStyle = '#1c1917';
      ctx.beginPath();
      ctx.moveTo(mirrorX + mirrorW * 0.3, mirrorY + mirrorH);
      ctx.lineTo(mirrorX + mirrorW * 0.48, mirrorY + mirrorH * 0.5);
      ctx.lineTo(mirrorX + mirrorW * 0.52, mirrorY + mirrorH * 0.5);
      ctx.lineTo(mirrorX + mirrorW * 0.7, mirrorY + mirrorH);
      ctx.closePath();
      ctx.fill();

      // Rear lane dashed line
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(mirrorX + mirrorW * 0.49, mirrorY + mirrorH * 0.6, 2, mirrorH * 0.3);

      // Rear-view Mirror Glass Highlight
      const mirrorGlassSheen = ctx.createLinearGradient(mirrorX, mirrorY, mirrorX + mirrorW, mirrorY + mirrorH);
      mirrorGlassSheen.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      mirrorGlassSheen.addColorStop(0.3, 'rgba(255, 255, 255, 0.05)');
      mirrorGlassSheen.addColorStop(1, 'rgba(255, 255, 255, 0.15)');
      ctx.fillStyle = mirrorGlassSheen;
      ctx.fillRect(mirrorX, mirrorY, mirrorW, mirrorH);
      ctx.restore();

      // =========================================================
      // MAIN DASHBOARD (طبلون السيارة)
      // =========================================================
      const dashY = height * 0.68;

      // Dashboard Base Curved Silhouette
      ctx.fillStyle = '#0a0d14';
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, dashY + 40);
      // Instrument Binnacle Arch over Steering Wheel (Left Side)
      ctx.bezierCurveTo(
        width * 0.12, dashY - 45,
        width * 0.38, dashY - 45,
        width * 0.48, dashY + 15
      );
      // Center Infotainment Screen / Air Vents Plateau
      ctx.lineTo(width * 0.75, dashY + 25);
      // Passenger Side Gentle Slope
      ctx.bezierCurveTo(
        width * 0.85, dashY + 30,
        width * 0.95, dashY + 40,
        width, dashY + 50
      );
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      // Dashboard Top Stitching / Ambient Light Strip (Amber sunset glow)
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ea580c';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(width * 0.08, dashY - 10);
      ctx.bezierCurveTo(
        width * 0.14, dashY - 42,
        width * 0.36, dashY - 42,
        width * 0.47, dashY + 16
      );
      ctx.lineTo(width * 0.75, dashY + 26);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Air Conditioner Vents
      ctx.fillStyle = '#1e293b';
      const ventW = width * 0.045;
      const ventH = height * 0.035;
      ctx.fillRect(width * 0.52, dashY + 45, ventW, ventH);
      ctx.fillRect(width * 0.58, dashY + 45, ventW, ventH);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(width * 0.52, dashY + 45, ventW, ventH);
      ctx.strokeRect(width * 0.58, dashY + 45, ventW, ventH);

      // Center Console Infotainment Display / GPS Mini-Map
      const infoW = width * 0.16;
      const infoH = height * 0.14;
      const infoX = width * 0.64;
      const infoY = dashY + 42;

      ctx.fillStyle = '#020617';
      ctx.fillRect(infoX, infoY, infoW, infoH);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(infoX, infoY, infoW, infoH);

      // GPS Track representation in screen
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(infoX + infoW * 0.5, infoY + infoH * 0.85);
      ctx.lineTo(infoX + infoW * 0.5 - s.playerX * 20, infoY + infoH * 0.25);
      ctx.stroke();

      // GPS Player Arrow
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(infoX + infoW * 0.5, infoY + infoH * 0.85, 4, 0, Math.PI * 2);
      ctx.fill();

      // Digital Infotainment Text
      ctx.fillStyle = '#94a3b8';
      ctx.font = `bold ${Math.max(9, Math.floor(width * 0.009))}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillText('SUNSET BLVD', infoX + 8, infoY + 16);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`${currentSpeedKmh} KM/H`, infoX + 8, infoY + 32);

      // =========================================================
      // DRIVER INSTRUMENT CLUSTER (Behind Steering Wheel)
      // =========================================================
      const clusterX = width * 0.25;
      const clusterY = dashY + 10;
      const clusterR = height * 0.11;

      // Speedometer Dial Arc
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(clusterX, clusterY, clusterR, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();

      // Active Speed Arc (Glowing Orange to Crimson)
      const speedAngle = Math.PI * 0.75 + (s.speed / MAX_SPEED) * (Math.PI * 1.5);
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 6;
      ctx.shadowColor = '#f97316';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(clusterX, clusterY, clusterR, Math.PI * 0.75, speedAngle);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Big Clean Digital Speed in Cluster Center
      ctx.fillStyle = '#ffffff';
      ctx.font = `black ${Math.max(22, Math.floor(width * 0.028))}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${currentSpeedKmh}`, clusterX, clusterY + 6);
      ctx.fillStyle = '#f97316';
      ctx.font = `bold ${Math.max(9, Math.floor(width * 0.009))}px sans-serif`;
      ctx.fillText('KM/H', clusterX, clusterY + 22);

      // =========================================================
      // HIGH-BEAM STROBE DASHBOARD INDICATOR ("رمز التكبيس باللون الأزرق")
      // =========================================================
      const isHighBeamIndicatorLit = s.highBeamTimer > 0 && Math.sin(s.highBeamTimer * 50) > -0.2;
      ctx.save();
      ctx.fillStyle = isHighBeamIndicatorLit ? '#0284c7' : '#1e293b';
      ctx.shadowColor = isHighBeamIndicatorLit ? '#38bdf8' : 'transparent';
      ctx.shadowBlur = isHighBeamIndicatorLit ? 12 : 0;
      ctx.beginPath();
      ctx.arc(clusterX, clusterY - clusterR * 0.65, 8, 0, Math.PI * 2);
      ctx.fill();
      // Beam lines
      if (isHighBeamIndicatorLit) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(clusterX - 14, clusterY - clusterR * 0.65);
        ctx.lineTo(clusterX - 8, clusterY - clusterR * 0.65);
        ctx.moveTo(clusterX - 14, clusterY - clusterR * 0.65 - 4);
        ctx.lineTo(clusterX - 8, clusterY - clusterR * 0.65 - 4);
        ctx.moveTo(clusterX - 14, clusterY - clusterR * 0.65 + 4);
        ctx.lineTo(clusterX - 8, clusterY - clusterR * 0.65 + 4);
        ctx.stroke();
      }
      ctx.restore();

      // =========================================================
      // DYNAMIC 3D STEERING WHEEL (الدركسون)
      // Smooth rotation with player steering (-60deg to +60deg)
      // =========================================================
      const wheelCenterX = width * 0.26;
      const wheelCenterY = height * 0.88;
      const wheelRadius = height * 0.32;
      const rotationRad = steer * (Math.PI / 4.2); // Smooth rotational tilt

      ctx.save();
      ctx.translate(wheelCenterX, wheelCenterY);
      ctx.rotate(rotationRad);

      // Wheel Rim Outer Grip (Thick Perforated Leather Feel)
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = height * 0.052;
      ctx.beginPath();
      ctx.arc(0, 0, wheelRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Top 12 O'Clock Center Alignment Racing Stripe (Warm Sunset Orange)
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = height * 0.052;
      ctx.beginPath();
      ctx.arc(0, 0, wheelRadius, -Math.PI / 2 - 0.08, -Math.PI / 2 + 0.08);
      ctx.stroke();

      // Inner Wheel Shadow / Highlight
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, wheelRadius - height * 0.024, 0, Math.PI * 2);
      ctx.stroke();

      // 3 Spokes (Left, Right, Bottom)
      const spokeW = wheelRadius * 0.28;

      // Center Wheel Hub / Airbag Cover
      const hubRadius = wheelRadius * 0.42;
      ctx.fillStyle = '#0b0f19';
      ctx.beginPath();
      ctx.arc(0, 0, hubRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Center Brand Emblem Badge
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(0, 0, hubRadius * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `black ${Math.max(10, Math.floor(hubRadius * 0.38))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GS', 0, 0);

      // Left Spoke with thumb controls
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-wheelRadius + height * 0.02, -spokeW / 2, wheelRadius - hubRadius, spokeW);

      // Right Spoke with thumb controls
      ctx.fillRect(hubRadius - height * 0.01, -spokeW / 2, wheelRadius - hubRadius, spokeW);

      // Bottom Vertical Spoke
      ctx.fillRect(-spokeW / 2.5, hubRadius - height * 0.01, spokeW / 1.25, wheelRadius - hubRadius);

      // Paddle Shifters behind wheel
      ctx.fillStyle = '#334155';
      ctx.fillRect(-wheelRadius * 1.08, -wheelRadius * 0.4, 14, wheelRadius * 0.7);
      ctx.fillRect(wheelRadius * 1.08 - 14, -wheelRadius * 0.4, 14, wheelRadius * 0.7);

      ctx.restore(); // Restore steering wheel rotation transform
      ctx.restore(); // Restore cockpit transform

      // ---------------------------------------------------------
      // 7. CLEAN SLENDER HUD (SPEED, KM, SCORE IN SOFT SLEEK TYPOGRAPHY)
      // Exactly formatted as in high-end arcade driving games
      // ---------------------------------------------------------
      ctx.save();

      // Bottom Right: Distance KM and Digital Speed (Soft Clean Font)
      const hudRightX = width - 36;
      const hudBottomY = height - 28;

      ctx.textAlign = 'right';

      // SPEED display
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText('SPEED', hudRightX, hudBottomY - 46);

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 48px monospace';
      ctx.fillText(`${currentSpeedKmh}`, hudRightX - 48, hudBottomY - 4);

      ctx.fillStyle = '#f97316';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText('KM/H', hudRightX, hudBottomY - 14);

      // Bottom Left: KM Traveled & Near-Miss Counter
      const hudLeftX = 36;
      ctx.textAlign = 'left';

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText('DISTANCE', hudLeftX, hudBottomY - 46);

      ctx.fillStyle = '#f8fafc';
      ctx.font = '900 40px monospace';
      ctx.fillText(`${distanceKm.toFixed(1)}`, hudLeftX, hudBottomY - 4);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText('KM', hudLeftX + (distanceKm >= 10 ? 110 : 85), hudBottomY - 14);

      // Top Center: Score & Multiplier
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 24px monospace';
      ctx.fillText(`SCORE: ${score.toLocaleString()}`, width / 2, 42);

      if (nearMissCount > 0) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = '700 13px system-ui, sans-serif';
        ctx.fillText(`⚡ تفاديات وتجاوزات: ${nearMissCount}`, width / 2, 66);
      }

      ctx.restore();
    };

    animationFrameId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isGameOver, isPaused, currentSpeedKmh, distanceKm, score, highScore, nearMissCount]);

  // Keep Canvas in Full TV Resolution
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="relative w-screen h-screen bg-slate-950 overflow-hidden select-none font-sans" dir="rtl">
      {/* Real-time 60FPS Sunset Highway Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-none"
      />

      {/* Near-Miss Pop Notification */}
      {nearMissNotification && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 px-5 py-2 rounded-2xl bg-amber-500/90 text-slate-950 font-black text-lg shadow-2xl backdrop-blur-md animate-bounce">
          {nearMissNotification.text}
        </div>
      )}

      {/* High-beam "تكبيس" Active Banner Notification */}
      {isHighBeaming && (
        <div className="absolute top-20 right-8 z-30 flex items-center gap-2 px-4 py-1.5 rounded-xl bg-sky-500/80 text-white font-black text-xs shadow-xl backdrop-blur-md animate-pulse">
          <Zap className="w-4 h-4 text-yellow-300 fill-yellow-300" />
          <span>تكبيس النور العالي (High Beam) 💡</span>
        </div>
      )}

      {/* Controller Buttons Hint Bar at Top Right */}
      <div className="absolute top-5 right-5 z-20 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSoundEnabled(s => !s)}
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60 shadow-lg backdrop-blur-md"
        >
          {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
        </button>

        <button
          type="button"
          onClick={onBackToMenu}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900/85 hover:bg-slate-800 text-white font-bold text-xs border border-slate-700/70 shadow-xl backdrop-blur-md transition-all"
        >
          <span>خروج للمكتبة [SELECT]</span>
          <ArrowRight className="w-4 h-4 rotate-180" />
        </button>
      </div>

      {/* Floating Controller Status / On-Screen Guidance */}
      <div className="absolute top-5 left-5 z-20 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-300 text-xs backdrop-blur-md font-mono">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span>القيادة: عصا التحكم المرنة 🕹️ | تكبيس النور: زر [B] 💡 | البنزين: زر [A] ⚡</span>
      </div>

      {/* GAME OVER OVERLAY SCREEN */}
      {isGameOver && (
        <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur-lg flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="max-w-md w-full bg-slate-900 border-2 border-red-500/50 rounded-3xl p-8 shadow-2xl text-center space-y-6 relative overflow-hidden">
            {/* Ambient Red Alert Glow */}
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-48 h-48 bg-red-600/20 rounded-full blur-3xl pointer-events-none" />

            <div className="w-16 h-16 rounded-2xl bg-red-600/20 border border-red-500/40 text-red-400 mx-auto flex items-center justify-center">
              <Flame className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-3xl font-black text-white">انتهت الجولة (اصطدام!)</h2>
              <p className="text-xs text-slate-400">
                استخدم زر [B] للتكبيس على السيارات لتفسح لك المسار وتتفادى الاصطدام
              </p>
            </div>

            {/* Score & Distance Summary */}
            <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
              <div className="text-right">
                <span className="text-[11px] text-slate-500 font-bold block">المسافة المقطوعة:</span>
                <span className="text-xl font-mono font-black text-sky-400">{distanceKm.toFixed(1)} KM</span>
              </div>
              <div className="text-left">
                <span className="text-[11px] text-slate-500 font-bold block">النقاط:</span>
                <span className="text-xl font-mono font-black text-amber-400">{score.toLocaleString()}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3 pt-2">
              <button
                type="button"
                onClick={restartGame}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-black text-sm shadow-xl shadow-orange-600/30 transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-5 h-5" />
                <span>إعادة القيادة فوراً [زر START]</span>
              </button>

              <button
                type="button"
                onClick={onBackToMenu}
                className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
              >
                العودة لقائمة الألعاب الرئيسية [زر SELECT]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAUSE OVERLAY SCREEN */}
      {isPaused && !isGameOver && (
        <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6">
          <div className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-5">
            <h3 className="text-2xl font-black text-white">اللعبة متوقفة مؤقتاً</h3>
            <p className="text-xs text-slate-400">اضغط زر START أو انقر للمتابعة</p>
            <button
              type="button"
              onClick={() => setIsPaused(false)}
              className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/30"
            >
              استئناف القيادة
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
