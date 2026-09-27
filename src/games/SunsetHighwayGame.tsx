import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RotateCcw, Lightbulb, Navigation, Music, Compass } from 'lucide-react';
import { sounds } from './soundFx';
import { controllerBus } from '../services/controllerBus';

interface SunsetHighwayGameProps {
  onBackToMenu: () => void;
  controllerCommand?: any;
}

// -------------------------------------------------------------
// GAMEPLAY CONFIGURATION
// -------------------------------------------------------------
const LANES_COUNT = 4;
const LANE_WIDTH = 3.6;
const ROAD_TOTAL_WIDTH = LANE_WIDTH * LANES_COUNT; // 14.4 units
const LANE_POSITIONS = [-5.4, -1.8, 1.8, 5.4];

const MAX_SPEED_KMH = 150;
const MIN_SPEED_KMH = 30;
const BASE_CRUISE_SPEED = 85;
const ACCEL_RATE = 42;
const BRAKE_RATE = 95;
const NATURAL_DECEL_RATE = 18;

const ROAD_SEGMENT_LENGTH = 360;
const TRAFFIC_COUNT = 6;
const MIN_TRAFFIC_GAP_Z = 45;

interface NPCTrafficCar {
  mesh: THREE.Group;
  wheels: THREE.Mesh[];
  x: number;
  z: number;
  lane: number;
  targetLane: number;
  speedKmh: number;
  targetSpeedKmh: number;
  isTruck: boolean;
}

export function SunsetHighwayGame({ onBackToMenu, controllerCommand }: SunsetHighwayGameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // HUD States
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    return parseInt(localStorage.getItem('sunset_drive_3d_highscore') || '0', 10);
  });
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(BASE_CRUISE_SPEED);
  const [wheelSteerVisual, setWheelSteerVisual] = useState(0); // For 60FPS steering wheel rotation
  const [nearMissAlert, setNearMissAlert] = useState<string | null>(null);
  const [isHighBeaming, setIsHighBeaming] = useState(false);

  const highScoreRef = useRef(highScore);

  // Gameplay State Ref (Maintains 60FPS physics uninterrupted)
  const gameStateRef = useRef({
    speedKmh: BASE_CRUISE_SPEED,
    playerX: LANE_POSITIONS[1], // Start in lane 1 (-1.8)
    steerAngle: 0,
    smoothSteer: 0,
    isAccelerating: false,
    isBraking: false,
    highBeamTimer: 0,
    scoreAcc: 0,
    distanceAccKm: 0,
    comboMultiplier: 1,
    comboTimer: 0,
    lastNearMissTime: 0,
    isGameOver: false,
    isPaused: false
  });

  // Three.js Scene References
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    playerCarGroup: THREE.Group;
    roadPlane: THREE.Mesh;
    laneLines: THREE.Mesh[];
    sceneryItems: THREE.Group[];
    trafficPool: NPCTrafficCar[];
    headlightSpot: THREE.SpotLight;
  } | null>(null);

  // -------------------------------------------------------------
  // BUILD 3D TRAFFIC VEHICLES (Low-poly & High performance)
  // -------------------------------------------------------------
  const createTrafficCar = (isTruck: boolean, colorHex: number) => {
    const group = new THREE.Group();

    if (isTruck) {
      // White delivery box truck
      const cabMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5, metalness: 0.2 });
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6, metalness: 0.1 });
      const darkMat = new THREE.MeshBasicMaterial({ color: 0x09090b });

      // Cab
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 1.6), cabMat);
      cab.position.set(0, 0.9, -1.8);
      cab.castShadow = true;
      group.add(cab);

      // Windshield
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.6, 0.05), darkMat);
      win.position.set(0, 1.15, -2.62);
      group.add(win);

      // Box Container
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 4.2), boxMat);
      box.position.set(0, 1.5, 0.9);
      box.castShadow = true;
      group.add(box);

      // Taillights (Glowing Red)
      const tlMat = new THREE.MeshBasicMaterial({ color: 0xff1e1e });
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tlMat);
      tlL.position.set(-0.85, 0.8, 3.02);
      group.add(tlL);

      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tlMat);
      tlR.position.set(0.85, 0.8, 3.02);
      group.add(tlR);
    } else {
      // Passenger Sedan Car
      const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.4 });
      const glassMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });

      // Body
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.0), bodyMat);
      body.position.y = 0.55;
      body.castShadow = true;
      group.add(body);

      // Cabin
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 2.1), glassMat);
      cabin.position.set(0, 1.1, -0.2);
      cabin.castShadow = true;
      group.add(cabin);

      // Taillights
      const tlMat = new THREE.MeshBasicMaterial({ color: 0xff1e1e });
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), tlMat);
      tlL.position.set(-0.65, 0.65, 2.02);
      group.add(tlL);

      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), tlMat);
      tlR.position.set(0.65, 0.65, 2.02);
      group.add(tlR);
    }

    // Heavy High-Contrast Ground Shadow
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x050508,
      transparent: true,
      opacity: 0.75
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.6), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);

    // Wheels
    const wheels: THREE.Mesh[] = [];
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8 });

    [-0.95, 0.95].forEach(wx => {
      [-1.2, 1.2].forEach(wz => {
        const w = new THREE.Mesh(wheelGeo, tireMat);
        w.position.set(wx, 0.32, wz);
        w.castShadow = true;
        group.add(w);
        wheels.push(w);
      });
    });

    return { group, wheels };
  };

  // -------------------------------------------------------------
  // INITIALIZE THREE.JS SCENE (Dark Mode Twilight Sunset Quality)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene & Rich Twilight Sunset Atmosphere (Fixes flat yellow sky)
    const scene = new THREE.Scene();

    // Create a beautiful Sunset Sky Canvas Gradient Texture (Twilight Blue to Fiery Sunset Orange)
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 512;
    skyCanvas.height = 512;
    const skyCtx = skyCanvas.getContext('2d');
    if (skyCtx) {
      const grad = skyCtx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0.0, '#090d16'); // Dark night twilight navy at top
      grad.addColorStop(0.35, '#1e1b4b'); // Deep indigo
      grad.addColorStop(0.65, '#581c87'); // Rich violet sunset transition
      grad.addColorStop(0.85, '#b45309'); // Warm golden amber
      grad.addColorStop(1.0, '#f97316'); // Horizon sunset orange
      skyCtx.fillStyle = grad;
      skyCtx.fillRect(0, 0, 512, 512);

      // Subtle evening stars in top sky
      skyCtx.fillStyle = '#ffffff';
      for (let i = 0; i < 40; i++) {
        const sx = Math.random() * 512;
        const sy = Math.random() * 200;
        const sr = Math.random() * 1.5;
        skyCtx.beginPath();
        skyCtx.arc(sx, sy, sr, 0, Math.PI * 2);
        skyCtx.fill();
      }
    }
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    scene.background = skyTexture;

    // Atmospheric Dusk Fog (Smooth gradient fade into evening horizon)
    scene.fog = new THREE.FogExp2(0x581c87, 0.0055);

    // 2. Camera Setup (Wide panoramic view centered naturally with road)
    const camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 320);
    camera.position.set(-0.35, 1.15, 0.2);
    camera.rotation.set(-0.03, 0, 0);

    // 3. Renderer with High Dynamic Range & Sharp Resolution
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05; // Balanced, non-blown-out exposure
    container.appendChild(renderer.domElement);

    // 4. Lighting (Warm Sunset Sun Low on Right Horizon Casting Dramatic Shadows)
    const sunLight = new THREE.DirectionalLight(0xffa254, 2.4); // Calibrated warmth without white glare
    sunLight.position.set(60, 20, -90);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 250;
    sunLight.shadow.camera.left = -30;
    sunLight.shadow.camera.right = 30;
    sunLight.shadow.camera.top = 25;
    sunLight.shadow.camera.bottom = -25;
    scene.add(sunLight);

    // Deep purple-indigo ambient light for Dark Mode contrast
    const ambientLight = new THREE.AmbientLight(0x4338ca, 0.85);
    scene.add(ambientLight);

    // Glowing Sunset Sun Orb on Horizon
    const sunGlowMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
    const sunGlow = new THREE.Mesh(new THREE.CircleGeometry(16, 32), sunGlowMat);
    sunGlow.position.set(70, 22, -260);
    scene.add(sunGlow);

    // 5. Player Vehicle Group
    const playerCarGroup = new THREE.Group();
    playerCarGroup.position.set(LANE_POSITIONS[1], 0, 0);
    playerCarGroup.add(camera);
    scene.add(playerCarGroup);

    // Headlight Spotlight
    const headlightSpot = new THREE.SpotLight(0xfff5ea, 5, 130, Math.PI / 4, 0.5, 1);
    headlightSpot.position.set(0, 0.4, -1.0);
    headlightSpot.target.position.set(0, 0, -45);
    playerCarGroup.add(headlightSpot);
    playerCarGroup.add(headlightSpot.target);

    // 6. Matte Dark Asphalt Highway (Eliminates blinding white glare)
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x11161d, // Dark asphalt
      roughness: 0.85, // Matte surface, no plastic-like glare
      metalness: 0.05
    });
    const roadPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_TOTAL_WIDTH + 8, ROAD_SEGMENT_LENGTH),
      roadMat
    );
    roadPlane.rotation.x = -Math.PI / 2;
    roadPlane.position.set(0, 0, -ROAD_SEGMENT_LENGTH / 2 + 20);
    roadPlane.receiveShadow = true;
    scene.add(roadPlane);

    // Guardrails Left and Right
    const guardMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4, metalness: 0.6 });
    const guardGeo = new THREE.BoxGeometry(0.45, 0.5, ROAD_SEGMENT_LENGTH);

    const guardL = new THREE.Mesh(guardGeo, guardMat);
    guardL.position.set(-ROAD_TOTAL_WIDTH / 2 - 0.5, 0.25, -ROAD_SEGMENT_LENGTH / 2 + 20);
    guardL.castShadow = true;
    guardL.receiveShadow = true;
    scene.add(guardL);

    const guardR = new THREE.Mesh(guardGeo, guardMat);
    guardR.position.set(ROAD_TOTAL_WIDTH / 2 + 0.5, 0.25, -ROAD_SEGMENT_LENGTH / 2 + 20);
    guardR.castShadow = true;
    guardR.receiveShadow = true;
    scene.add(guardR);

    // Crisp Dashed Lane Lines
    const laneLines: THREE.Mesh[] = [];
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lineGeo = new THREE.BoxGeometry(0.18, 0.02, 4.5);

    [-3.6, 0, 3.6].forEach(lx => {
      for (let z = -ROAD_SEGMENT_LENGTH + 20; z < 20; z += 9) {
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.position.set(lx, 0.02, z);
        scene.add(line);
        laneLines.push(line);
      }
    });

    // 7. Scenery Props (Lamp Posts & Low-Poly Trees)
    const sceneryItems: THREE.Group[] = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
    const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x27170a, roughness: 0.9 });
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.7 });

    for (let z = -ROAD_SEGMENT_LENGTH + 20; z < 20; z += 30) {
      const propGroup = new THREE.Group();

      // Left Lamp Post
      const lampL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7.5, 8), poleMat);
      lampL.position.set(-ROAD_TOTAL_WIDTH / 2 - 1.8, 3.75, 0);
      lampL.castShadow = true;
      propGroup.add(lampL);

      const armL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.2), poleMat);
      armL.position.set(-ROAD_TOTAL_WIDTH / 2 - 1.0, 7.4, 0);
      armL.castShadow = true;
      propGroup.add(armL);

      const bulbL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.2), lampHeadMat);
      bulbL.position.set(-ROAD_TOTAL_WIDTH / 2 - 0.3, 7.3, 0);
      propGroup.add(bulbL);

      // Right Side Low-Poly Tree
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 3.2, 8), treeTrunkMat);
      trunk.position.set(ROAD_TOTAL_WIDTH / 2 + 4.0, 1.6, 0);
      trunk.castShadow = true;
      propGroup.add(trunk);

      const leaves = new THREE.Mesh(new THREE.DodecahedronGeometry(1.7, 0), treeLeafMat);
      leaves.position.set(ROAD_TOTAL_WIDTH / 2 + 4.0, 4.2, 0);
      leaves.castShadow = true;
      propGroup.add(leaves);

      propGroup.position.set(0, 0, z);
      scene.add(propGroup);
      sceneryItems.push(propGroup);
    }

    // 8. 3D Traffic Pool
    const trafficPool: NPCTrafficCar[] = [];
    const carColors = [0xd97706, 0x2563eb, 0x16a34a, 0xe11d48, 0x0284c7, 0x9333ea];

    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const isTruck = i % 3 === 0;
      const color = carColors[i % carColors.length];
      const { group: carGroup, wheels } = createTrafficCar(isTruck, color);

      const lane = i % LANES_COUNT;
      const x = LANE_POSITIONS[lane];
      const z = -55 - i * 44;
      carGroup.position.set(x, 0, z);
      scene.add(carGroup);

      const speed = 55 + Math.random() * 20;
      trafficPool.push({
        mesh: carGroup,
        wheels,
        x,
        z,
        lane,
        targetLane: lane,
        speedKmh: speed,
        targetSpeedKmh: speed,
        isTruck
      });
    }

    threeRef.current = {
      scene,
      camera,
      renderer,
      playerCarGroup,
      roadPlane,
      laneLines,
      sceneryItems,
      trafficPool,
      headlightSpot
    };

    const handleResize = () => {
      if (!containerRef.current || !threeRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      threeRef.current.camera.aspect = w / h;
      threeRef.current.camera.updateProjectionMatrix();
      threeRef.current.renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      threeRef.current = null;
    };
  }, []);

  // -------------------------------------------------------------
  // CONTROLLER COMMAND HANDLER (Responsive & Zero Lag)
  // -------------------------------------------------------------
  const handleControllerCommand = useCallback((cmd: any) => {
    if (!cmd) return;
    const s = gameStateRef.current;

    if (cmd.type === 'stick_move' && cmd.stick) {
      s.steerAngle = Math.max(-1, Math.min(1, cmd.stick.x * 1.2));
      if (cmd.stick.y < -0.2) {
        s.isAccelerating = true;
        s.isBraking = false;
      } else if (cmd.stick.y > 0.25) {
        s.isBraking = true;
        s.isAccelerating = false;
      } else {
        s.isAccelerating = false;
        s.isBraking = false;
      }
    } else if (cmd.type === 'button_down') {
      if (cmd.button === 'LEFT') s.steerAngle = -1;
      if (cmd.button === 'RIGHT') s.steerAngle = 1;
      if (['UP', 'A', 'X', 'R1', 'R2'].includes(cmd.button)) s.isAccelerating = true;
      if (['DOWN', 'L1', 'L2'].includes(cmd.button)) s.isBraking = true;
      if (['B', 'Y'].includes(cmd.button)) triggerHighBeamStrobe();
      if (cmd.button === 'START') {
        if (s.isGameOver) restartGame();
        else {
          s.isPaused = !s.isPaused;
          setIsPaused(s.isPaused);
        }
      }
      if (cmd.button === 'SELECT') onBackToMenu();
    } else if (cmd.type === 'button_up') {
      if (['LEFT', 'RIGHT'].includes(cmd.button)) s.steerAngle = 0;
      if (['UP', 'A', 'X', 'R1', 'R2'].includes(cmd.button)) s.isAccelerating = false;
      if (['DOWN', 'L1', 'L2'].includes(cmd.button)) s.isBraking = false;
    }
  }, [onBackToMenu]);

  useEffect(() => {
    if (controllerCommand) handleControllerCommand(controllerCommand);
  }, [controllerCommand, handleControllerCommand]);

  useEffect(() => {
    const unsub = controllerBus.subscribe((cmd: any) => {
      handleControllerCommand(cmd);
    });
    return () => unsub();
  }, [handleControllerCommand]);

  // Keyboard controls
  useEffect(() => {
    const s = gameStateRef.current;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') s.steerAngle = -1;
      if (e.key === 'ArrowRight' || e.key === 'd') s.steerAngle = 1;
      if (e.key === 'ArrowUp' || e.key === 'w') s.isAccelerating = true;
      if (e.key === 'ArrowDown' || e.key === 's') s.isBraking = true;
      if (e.key === ' ' || e.key === 'b') triggerHighBeamStrobe();
      if (e.key === 'Escape') onBackToMenu();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'a', 'ArrowRight', 'd'].includes(e.key)) s.steerAngle = 0;
      if (e.key === 'ArrowUp' || e.key === 'w') s.isAccelerating = false;
      if (e.key === 'ArrowDown' || e.key === 's') s.isBraking = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onBackToMenu]);

  const triggerHighBeamStrobe = useCallback(() => {
    const s = gameStateRef.current;
    s.highBeamTimer = 0.5;
    setIsHighBeaming(true);
    sounds.playHighBeam();

    if (threeRef.current) {
      threeRef.current.trafficPool.forEach(car => {
        if (car.z < 0 && car.z > -110) {
          if (Math.abs(car.x - s.playerX) < LANE_WIDTH * 0.9) {
            car.targetLane = s.playerX < car.x ? Math.min(3, car.lane + 1) : Math.max(0, car.lane - 1);
          }
        }
      });
    }
  }, []);

  const restartGame = useCallback(() => {
    const s = gameStateRef.current;
    s.speedKmh = BASE_CRUISE_SPEED;
    s.playerX = LANE_POSITIONS[1];
    s.steerAngle = 0;
    s.smoothSteer = 0;
    s.isGameOver = false;
    s.isPaused = false;
    s.scoreAcc = 0;
    s.distanceAccKm = 0;
    s.comboMultiplier = 1;

    setIsGameOver(false);
    setIsPaused(false);
    setScore(0);
    setDistanceKm(0);
    setCurrentSpeed(BASE_CRUISE_SPEED);

    if (threeRef.current) {
      threeRef.current.playerCarGroup.position.x = s.playerX;
      threeRef.current.trafficPool.forEach((car, idx) => {
        car.lane = idx % LANES_COUNT;
        car.targetLane = car.lane;
        car.x = LANE_POSITIONS[car.lane];
        car.z = -55 - idx * 44;
        car.speedKmh = 60 + Math.random() * 15;
        car.targetSpeedKmh = car.speedKmh;
        car.mesh.position.set(car.x, 0, car.z);
      });
    }
  }, []);

  // Safe respawn calculator
  const findSafeRespawn = (pool: NPCTrafficCar[], curIdx: number) => {
    const lanes = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    for (const lane of lanes) {
      const carsInLane = pool.filter((c, i) => i !== curIdx && c.targetLane === lane);
      let minZ = -180;
      let overlap = false;
      for (const other of carsInLane) {
        if (other.z < minZ) minZ = other.z;
      }
      const candZ = Math.min(-200, minZ - MIN_TRAFFIC_GAP_Z - Math.random() * 20);
      for (const other of carsInLane) {
        if (Math.abs(other.z - candZ) < MIN_TRAFFIC_GAP_Z) {
          overlap = true;
          break;
        }
      }
      if (!overlap) return { lane, z: candZ };
    }
    return { lane: Math.floor(Math.random() * LANES_COUNT), z: -250 - curIdx * 25 };
  };

  // -------------------------------------------------------------
  // CONTINUOUS 60FPS MAIN ANIMATION LOOP
  // -------------------------------------------------------------
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();
    let hudTimer = 0;

    const animate = (now: number) => {
      animId = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const s = gameStateRef.current;
      const t3 = threeRef.current;
      if (!t3 || s.isPaused || s.isGameOver) return;

      // 1. Natural Highway Speed Dynamics
      if (s.isAccelerating) {
        s.speedKmh = Math.min(MAX_SPEED_KMH, s.speedKmh + ACCEL_RATE * dt);
      } else if (s.isBraking) {
        s.speedKmh = Math.max(MIN_SPEED_KMH, s.speedKmh - BRAKE_RATE * dt);
      } else {
        if (s.speedKmh > BASE_CRUISE_SPEED) {
          s.speedKmh = Math.max(BASE_CRUISE_SPEED, s.speedKmh - NATURAL_DECEL_RATE * dt);
        } else if (s.speedKmh < BASE_CRUISE_SPEED) {
          s.speedKmh = Math.min(BASE_CRUISE_SPEED, s.speedKmh + NATURAL_DECEL_RATE * dt);
        }
      }

      const worldSpeed = (s.speedKmh / 3.6) * 0.22;

      // 2. Smooth Steering Damping
      s.smoothSteer += (s.steerAngle - s.smoothSteer) * Math.min(1, dt * 9.0);
      const steerSpeed = 5.2 * (0.8 + s.speedKmh / 160);
      s.playerX += s.smoothSteer * steerSpeed * dt;
      s.playerX = Math.max(-ROAD_TOTAL_WIDTH / 2 + 1.2, Math.min(ROAD_TOTAL_WIDTH / 2 - 1.2, s.playerX));

      t3.playerCarGroup.position.x = s.playerX;

      // 3. High Beam Intensity
      if (s.highBeamTimer > 0) {
        s.highBeamTimer -= dt;
        t3.headlightSpot.intensity = 12;
        if (s.highBeamTimer <= 0) {
          setIsHighBeaming(false);
          t3.headlightSpot.intensity = 5;
        }
      }

      // 4. Seamless Road Markings & Scenery Scrolling
      const moveDistance = worldSpeed * dt * 25;

      t3.laneLines.forEach(line => {
        line.position.z += moveDistance;
        if (line.position.z > 20) line.position.z -= ROAD_SEGMENT_LENGTH;
      });

      t3.sceneryItems.forEach(prop => {
        prop.position.z += moveDistance;
        if (prop.position.z > 20) prop.position.z -= ROAD_SEGMENT_LENGTH;
      });

      // 5. Update NPC Traffic with Smooth Speed Interpolation
      t3.trafficPool.forEach((car, idx) => {
        car.speedKmh += (car.targetSpeedKmh - car.speedKmh) * dt * 2.0;
        const trafficWorldSpeed = (car.speedKmh / 3.6) * 0.22;
        const relativeSpeed = worldSpeed - trafficWorldSpeed;
        car.z += relativeSpeed * dt * 25;

        // Smooth Lane Transition
        const targetX = LANE_POSITIONS[car.targetLane];
        if (Math.abs(car.x - targetX) > 0.05) {
          car.x += Math.sign(targetX - car.x) * dt * 3.2;
        } else {
          car.x = targetX;
          car.lane = car.targetLane;
        }
        car.mesh.position.set(car.x, 0, car.z);

        // Rotate Wheels
        car.wheels.forEach(w => {
          w.rotation.x += trafficWorldSpeed * dt * 4;
        });

        // Safe Respawn Ahead when passing behind camera
        if (car.z > 25) {
          const safe = findSafeRespawn(t3.trafficPool, idx);
          car.lane = safe.lane;
          car.targetLane = safe.lane;
          car.x = LANE_POSITIONS[safe.lane];
          car.z = safe.z;
          car.targetSpeedKmh = 55 + Math.random() * 20;
          car.speedKmh = car.targetSpeedKmh;
          car.mesh.position.set(car.x, 0, car.z);
        }

        // Collision Check
        const dx = Math.abs(car.x - s.playerX);
        const dz = Math.abs(car.z);

        if (dx < 1.45 && dz < 2.0) {
          s.isGameOver = true;
          setIsGameOver(true);
          sounds.playAlert();

          if (s.scoreAcc > highScoreRef.current) {
            highScoreRef.current = Math.floor(s.scoreAcc);
            setHighScore(highScoreRef.current);
            localStorage.setItem('sunset_drive_3d_highscore', highScoreRef.current.toString());
          }
        }

        // Near Miss Bonus
        if (dz < 1.8 && dx > 1.45 && dx < 2.5 && now - s.lastNearMissTime > 1800) {
          s.lastNearMissTime = now;
          s.comboMultiplier = Math.min(8, s.comboMultiplier + 1);
          s.comboTimer = 3.0;
          setNearMissAlert(`تجاوز خطر! +${s.comboMultiplier * 150} نقطة`);
          setTimeout(() => setNearMissAlert(null), 1200);
          sounds.playCollect();
        }
      });

      // Metrics Accumulation
      s.distanceAccKm += (worldSpeed * dt * 0.08);
      s.scoreAcc += (s.speedKmh / 10) * dt * 15 * s.comboMultiplier;

      // Update Steering Wheel Visual Angle (60FPS smooth)
      setWheelSteerVisual(s.smoothSteer * -75);

      // Throttle React State Updates
      hudTimer += dt;
      if (hudTimer >= 0.12) {
        hudTimer = 0;
        setCurrentSpeed(Math.round(s.speedKmh));
        setDistanceKm(parseFloat(s.distanceAccKm.toFixed(1)));
        setScore(Math.floor(s.scoreAcc));
      }

      // Render 3D Scene
      t3.renderer.render(t3.scene, t3.camera);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="w-screen h-screen bg-slate-950 text-white select-none overflow-hidden relative font-sans" dir="rtl">
      {/* 3D WebGL Canvas */}
      <div ref={containerRef} className="w-full h-full absolute inset-0 z-0" />

      {/* ============================================================== */}
      {/* 2D / 2.5D LUXURY COCKPIT INTERIOR OVERLAY (Mercedes AMG / Porsche Style) */}
      {/* ============================================================== */}
      <svg
        className="w-full h-full absolute inset-0 z-10 pointer-events-none"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="none"
      >
        <defs>
          {/* Carbon Leather Dashboard Gradient */}
          <linearGradient id="luxuryDashGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#141824" />
            <stop offset="30%" stopColor="#0d111a" />
            <stop offset="100%" stopColor="#05070a" />
          </linearGradient>

          {/* Ambient LED Glow Strip (Cyan/Violet) */}
          <linearGradient id="ambientLedGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="35%" stopColor="#3b82f6" />
            <stop offset="70%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>

          {/* Metallic Bonnet Hood Reflection */}
          <linearGradient id="bonnetGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#374151" />
            <stop offset="45%" stopColor="#1f2937" />
            <stop offset="100%" stopColor="#111827" />
          </linearGradient>

          {/* A-Pillar Trim */}
          <linearGradient id="pillarGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#05070a" />
            <stop offset="100%" stopColor="#1e2433" />
          </linearGradient>

          {/* Rearview Mirror Glass with Sunset Sky Horizon Reflection */}
          <linearGradient id="rearviewGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e1b4b" />
            <stop offset="60%" stopColor="#701a75" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
        </defs>

        {/* Top Windshield Roof Trim with Sun-Visor Outline */}
        <path d="M0,0 L1920,0 L1920,55 C1200,80 720,80 0,55 Z" fill="#090d16" />

        {/* Left A-Pillar (Driver Side Windshield Pillar) */}
        <path d="M0,0 L240,0 L50,750 L0,800 Z" fill="url(#pillarGrad)" />

        {/* Hanging Rearview Mirror (Center-Right) with Horizon Sky Reflection */}
        <g transform="translate(1140, 65)">
          <line x1="130" y1="-20" x2="130" y2="15" stroke="#05070a" strokeWidth="10" />
          <rect x="0" y="15" width="260" height="76" rx="14" fill="#05070a" stroke="#334155" strokeWidth="3" />
          <rect x="8" y="22" width="244" height="62" rx="10" fill="url(#rearviewGrad)" opacity="0.85" />
          {/* Subtle reflection car silhouette in mirror */}
          <path d="M110,65 L150,65 L145,55 L115,55 Z" fill="#020617" opacity="0.6" />
        </g>

        {/* Metallic Sloped Bonnet Hood extending out front */}
        <path
          d="M50,750 L640,730 L1280,730 L1880,750 L1920,830 L0,830 Z"
          fill="url(#bonnetGrad)"
        />
        {/* Subtle center hood crease */}
        <polygon points="958,730 962,730 965,830 955,830" fill="#4b5563" opacity="0.3" />

        {/* Main Luxury Dashboard Base Across Bottom */}
        <path
          d="M0,810 Q960,780 1920,810 L1920,1080 L0,1080 Z"
          fill="url(#luxuryDashGrad)"
        />

        {/* Continuous Ambient Neon LED Light Strip along Dashboard Edge */}
        <path
          d="M0,810 Q960,780 1920,810"
          fill="none"
          stroke="url(#ambientLedGrad)"
          strokeWidth="4"
          filter="drop-shadow(0 0 8px rgba(6, 182, 212, 0.8))"
        />

        {/* Driver Cluster Curved Cowl on Left */}
        <path
          d="M140,820 C220,740 640,740 720,820 Z"
          fill="#0a0e17"
          stroke="#1e293b"
          strokeWidth="3"
        />

        {/* Center Console Air Conditioning Vents (Brushed Metal) */}
        <g transform="translate(1000, 805)">
          <rect x="0" y="0" width="130" height="32" rx="6" fill="#05070a" stroke="#334155" strokeWidth="2" />
          <line x1="10" y1="11" x2="120" y2="11" stroke="#475569" strokeWidth="2" />
          <line x1="10" y1="21" x2="120" y2="21" stroke="#475569" strokeWidth="2" />
        </g>
        <g transform="translate(1150, 805)">
          <rect x="0" y="0" width="130" height="32" rx="6" fill="#05070a" stroke="#334155" strokeWidth="2" />
          <line x1="10" y1="11" x2="120" y2="11" stroke="#475569" strokeWidth="2" />
          <line x1="10" y1="21" x2="120" y2="21" stroke="#475569" strokeWidth="2" />
        </g>
      </svg>

      {/* ============================================================== */}
      {/* DRIVER DIGITAL GAUGE CLUSTER (Integrated Behind Steering Wheel on Left) */}
      {/* ============================================================== */}
      <div
        className="absolute z-20 pointer-events-none font-mono"
        style={{
          left: '9%',
          bottom: '8.5%',
          width: '380px',
          height: '130px'
        }}
      >
        <div className="w-full h-full bg-slate-950/90 border-2 border-cyan-500/40 rounded-3xl p-3 shadow-2xl shadow-cyan-950/80 backdrop-blur-md flex flex-col justify-between">
          {/* Top Status */}
          <div className="flex items-center justify-between text-[11px] text-cyan-400 font-bold border-b border-slate-800 pb-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>CRUISE ACTIVE</span>
            </span>
            <span className="px-2 py-0.5 rounded-md bg-cyan-950/80 border border-cyan-500/30 text-cyan-300 text-[10px]">
              SPORT [D7]
            </span>
          </div>

          {/* Speed & Distance Main Display */}
          <div className="flex items-center justify-between px-2 py-1">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold tracking-wider">SPEED</span>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-white tracking-tighter drop-shadow-md">
                  {currentSpeed}
                </span>
                <span className="text-xs font-bold text-cyan-400">KM/H</span>
              </div>
            </div>

            <div className="h-10 w-px bg-slate-800"></div>

            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-400 font-bold tracking-wider">TRIP ODO</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-emerald-400">
                  {distanceKm}
                </span>
                <span className="text-xs font-bold text-slate-400">KM</span>
              </div>
            </div>
          </div>

          {/* RPM LED Arc Bar */}
          <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden flex">
            <div
              className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-amber-400 h-full transition-all duration-75"
              style={{ width: `${Math.min(100, (currentSpeed / MAX_SPEED_KMH) * 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* CENTER WIDESCREEN INFOTAINMENT DISPLAY (Google Maps GPS Navigation) */}
      {/* ============================================================== */}
      <div
        className="absolute z-20 pointer-events-none font-sans"
        style={{
          left: '46%',
          bottom: '3%',
          width: '520px',
          height: '190px'
        }}
      >
        <div className="w-full h-full bg-slate-950/95 border-2 border-slate-700/80 rounded-3xl p-3 shadow-2xl shadow-black/90 backdrop-blur-xl flex flex-col justify-between overflow-hidden relative">
          {/* Subtle Screen Bezel Glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 to-transparent pointer-events-none"></div>

          {/* GPS Header: Navigation Route Banner */}
          <div className="flex items-center justify-between z-10 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 text-xs">
            <div className="flex items-center gap-2 text-cyan-400 font-bold">
              <Navigation className="w-4 h-4 fill-cyan-400" />
              <span>بعد 2.4 كم: مخرج طريق الساحل</span>
            </div>
            <div className="flex items-center gap-2 text-slate-400 text-[11px] font-mono">
              <Compass className="w-3.5 h-3.5 text-emerald-400" />
              <span>شمال غرب • ETA 18:45</span>
            </div>
          </div>

          {/* Google Maps Stylized Dark Navigation Viewport */}
          <div className="w-full h-[85px] bg-[#0c121e] rounded-xl relative overflow-hidden border border-slate-800/80 flex items-center justify-center">
            {/* Dark City Grid Lines */}
            <svg className="absolute inset-0 w-full h-full opacity-30" viewBox="0 0 500 90">
              <line x1="0" y1="30" x2="500" y2="30" stroke="#334155" strokeWidth="1" strokeDasharray="6 6" />
              <line x1="0" y1="65" x2="500" y2="65" stroke="#334155" strokeWidth="1" strokeDasharray="6 6" />
              <line x1="80" y1="0" x2="80" y2="90" stroke="#334155" strokeWidth="1" />
              <line x1="220" y1="0" x2="220" y2="90" stroke="#334155" strokeWidth="1" />
              <line x1="380" y1="0" x2="380" y2="90" stroke="#334155" strokeWidth="1" />

              {/* Glowing Highway Route Path (Google Maps Style) */}
              <path
                d="M 20,70 Q 180,60 250,45 T 480,20"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="6"
                strokeLinecap="round"
                filter="drop-shadow(0 0 6px rgba(6, 182, 212, 0.9))"
              />
              <path
                d="M 20,70 Q 180,60 250,45 T 480,20"
                fill="none"
                stroke="#67e8f9"
                strokeWidth="2"
                strokeLinecap="round"
              />

              {/* Exit Ramp Path Branch */}
              <path
                d="M 250,45 Q 310,35 340,10"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="3"
                strokeDasharray="4 4"
                opacity="0.8"
              />

              {/* Destination Pin Marker */}
              <circle cx="480" cy="20" r="5" fill="#ef4444" stroke="#ffffff" strokeWidth="1.5" />
            </svg>

            {/* Glowing Blue Vehicle Location Arrow (Google Maps Style) */}
            <div className="absolute left-[38%] top-[40%] flex items-center justify-center">
              <div className="w-5 h-5 rounded-full bg-cyan-500/20 animate-ping absolute"></div>
              <div className="w-4 h-4 bg-cyan-400 rounded-full border-2 border-white shadow-lg shadow-cyan-400 flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-slate-950 rounded-full"></div>
              </div>
            </div>

            {/* Floating Street Badge & Speed Limit Pill */}
            <div className="absolute right-3 bottom-2 bg-slate-900/90 border border-slate-700 rounded-lg px-2.5 py-0.5 text-[11px] font-bold text-slate-200">
              طريق الغروب السريع • 140 كم/س
            </div>

            <div className="absolute left-3 bottom-2 flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-full bg-white border-2 border-rose-600 flex items-center justify-center text-[10px] font-black text-slate-950 font-mono">
                140
              </div>
            </div>
          </div>

          {/* Bottom Infotainment Bar: Synthwave Music Widget */}
          <div className="flex items-center justify-between text-xs px-2 pt-1 text-slate-400 border-t border-slate-800/80">
            <div className="flex items-center gap-2">
              <Music className="w-3.5 h-3.5 text-pink-400" />
              <span className="text-[11px] text-slate-300 font-medium">راديو الغروب: Synthwave FM</span>
            </div>
            {/* Animated Equalizer Wave Bars */}
            <div className="flex items-end gap-1 h-3">
              <div className="w-1 bg-cyan-400 h-2 animate-bounce"></div>
              <div className="w-1 bg-emerald-400 h-3 animate-pulse"></div>
              <div className="w-1 bg-pink-400 h-1.5 animate-bounce"></div>
              <div className="w-1 bg-amber-400 h-2.5 animate-pulse"></div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 3D-PERSPECTIVE HIGH-PRECISION SPORTS STEERING WHEEL */}
      {/* Positioned on Left (Driver Side) - 100% Guaranteed Visible & Rotating */}
      {/* ============================================================== */}
      <div
        className="absolute z-30 pointer-events-none"
        style={{
          left: '12%',
          bottom: '2%',
          width: '360px',
          height: '360px',
          transform: `perspective(900px) rotateX(24deg) rotate(${wheelSteerVisual}deg)`,
          transformOrigin: '50% 50%',
          transition: 'transform 0.04s ease-out'
        }}
      >
        <svg viewBox="0 0 400 400" className="w-full h-full drop-shadow-2xl">
          <defs>
            <radialGradient id="wheelRimGrad" cx="50%" cy="50%" r="50%">
              <stop offset="78%" stopColor="#1e2430" />
              <stop offset="90%" stopColor="#11151c" />
              <stop offset="98%" stopColor="#05070a" />
              <stop offset="100%" stopColor="#2a3342" />
            </radialGradient>

            <linearGradient id="metalSpokeGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#94a3b8" />
              <stop offset="50%" stopColor="#475569" />
              <stop offset="100%" stopColor="#1e293b" />
            </linearGradient>

            <radialGradient id="hubEmblemGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#334155" />
              <stop offset="75%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#020617" />
            </radialGradient>
          </defs>

          {/* Paddle Shifters Behind Wheel Rim (+ on Right, - on Left) */}
          <rect x="52" y="145" width="22" height="65" rx="6" fill="#64748b" stroke="#334155" strokeWidth="2" />
          <text x="63" y="185" fill="#ffffff" fontSize="18" fontWeight="bold" textAnchor="middle">-</text>

          <rect x="326" y="145" width="22" height="65" rx="6" fill="#64748b" stroke="#334155" strokeWidth="2" />
          <text x="337" y="185" fill="#ffffff" fontSize="18" fontWeight="bold" textAnchor="middle">+</text>

          {/* Outer Wheel Rim (Perforated Sport Leather Grip) */}
          <circle
            cx="200"
            cy="200"
            r="165"
            fill="none"
            stroke="url(#wheelRimGrad)"
            strokeWidth="38"
            filter="drop-shadow(0 15px 25px rgba(0,0,0,0.8))"
          />

          {/* Top 12 o'clock Racing Alignment Center Stripe (Cyan) */}
          <path
            d="M 194,36 A 165,165 0 0,1 206,36"
            fill="none"
            stroke="#06b6d4"
            strokeWidth="38"
          />

          {/* Inner Chrome Accent Ring */}
          <circle cx="200" cy="200" r="145" fill="none" stroke="#64748b" strokeWidth="2.5" opacity="0.6" />

          {/* 3 Brushed Metal / Carbon Fiber Wheel Spokes */}
          {/* Bottom Spoke */}
          <polygon points="186,220 214,220 208,340 192,340" fill="url(#metalSpokeGrad)" />
          {/* Left Spoke */}
          <polygon points="180,190 180,215 56,206 56,182" fill="url(#metalSpokeGrad)" />
          {/* Right Spoke */}
          <polygon points="220,190 220,215 344,206 344,182" fill="url(#metalSpokeGrad)" />

          {/* Center Hub & Horn Button */}
          <circle cx="200" cy="200" r="48" fill="url(#hubEmblemGrad)" stroke="#475569" strokeWidth="3" />

          {/* Gold Luxury Emblem Crest */}
          <polygon points="200,178 214,196 200,218 186,196" fill="#f59e0b" stroke="#fbbf24" strokeWidth="1.5" />
          <circle cx="200" cy="196" r="4" fill="#ffffff" />
        </svg>
      </div>

      {/* ============================================================== */}
      {/* TOP NOTIFICATIONS & BOTTOM CONTROLS */}
      {/* ============================================================== */}
      <div className="relative z-20 w-full h-full pointer-events-none flex flex-col justify-between p-8">
        <div className="w-full flex items-center justify-between">
          {nearMissAlert && (
            <div className="px-6 py-2.5 rounded-2xl bg-amber-500 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/40 animate-bounce border border-amber-300">
              <span>{nearMissAlert}</span>
            </div>
          )}
          {isHighBeaming && (
            <div className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-amber-400/50 animate-pulse border border-amber-200">
              <Lightbulb className="w-4 h-4 fill-current" />
              <span>تكبيس الإضاءة</span>
            </div>
          )}
        </div>

        {/* Bottom Control Bar */}
        <div className="w-full flex items-end justify-between">
          <div className="pointer-events-auto flex items-center gap-3 bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-2 text-xs text-slate-300 font-mono backdrop-blur-md">
            <span>عصا التحكم: توجيه وتسارع</span>
            <span className="text-slate-600">|</span>
            <button
              type="button"
              onClick={onBackToMenu}
              className="px-3 py-1 rounded-xl bg-rose-600/30 hover:bg-rose-600 text-rose-300 font-bold text-xs border border-rose-500/40 transition-colors"
            >
              الخروج [SELECT]
            </button>
          </div>

          {/* High Score Badge in Corner */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl px-4 py-2 text-right font-mono">
            <span className="text-[10px] text-slate-400 block">أعلى سكور</span>
            <span className="text-sm font-bold text-amber-400">{highScore}</span>
          </div>
        </div>
      </div>

      {/* PAUSE MODAL OVERLAY */}
      {isPaused && !isGameOver && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-6 text-center select-none" dir="rtl">
          <div className="max-w-md w-full bg-slate-900 border border-indigo-500/50 rounded-3xl p-8 shadow-2xl space-y-6">
            <h2 className="text-2xl font-black text-white">اللعبة متوقفة مؤقتاً</h2>
            <p className="text-xs text-slate-400">اضغط زر START للاستئناف أو خروج للعودة للقائمة الرئيسية.</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  gameStateRef.current.isPaused = false;
                  setIsPaused(false);
                }}
                className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg transition-all"
              >
                استئناف [START]
              </button>
              <button
                type="button"
                onClick={onBackToMenu}
                className="py-3 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm transition-all"
              >
                الخروج
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GAME OVER MODAL OVERLAY */}
      {isGameOver && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-lg flex items-center justify-center p-6 text-center select-none animate-in fade-in duration-300" dir="rtl">
          <div className="max-w-md w-full bg-slate-900 border-2 border-rose-500/60 rounded-3xl p-8 shadow-2xl shadow-rose-950/80 space-y-6 relative overflow-hidden">
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-white">حدث تصادم!</h2>
              <p className="text-xs text-slate-400">اصطدمت بسيارة أخرى على طريق الغروب السريع.</p>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3 font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">النقاط المحققة:</span>
                <span className="text-xl font-bold text-white">{score}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">المسافة المقطوعة:</span>
                <span className="text-lg font-bold text-emerald-400">{distanceKm} كم</span>
              </div>
              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800">
                <span className="text-slate-400">أعلى رقم قياسي:</span>
                <span className="text-lg font-bold text-amber-400">{highScore}</span>
              </div>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={restartGame}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-sm shadow-xl shadow-indigo-600/40 border border-indigo-400/40 transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>إعادة اللعب فوراً [A / X / START]</span>
              </button>

              <button
                type="button"
                onClick={onBackToMenu}
                className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
              >
                العودة لقائمة الألعاب الرئيسية
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
