import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RotateCcw, Lightbulb } from 'lucide-react';
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
const MIN_SPEED_KMH = 30; // Prevents car from coming to a dead crawl during normal driving
const BASE_CRUISE_SPEED = 85; // Natural highway cruising speed when no pedal is pressed
const ACCEL_RATE = 42;
const BRAKE_RATE = 95;
const NATURAL_DECEL_RATE = 20;

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
    steeringWheelGroup: THREE.Group;
    roadPlane: THREE.Mesh;
    laneLines: THREE.Mesh[];
    sceneryItems: THREE.Group[];
    trafficPool: NPCTrafficCar[];
    headlightSpot: THREE.SpotLight;
    sunLight: THREE.DirectionalLight;
  } | null>(null);

  // -------------------------------------------------------------
  // BUILD 3D TRAFFIC VEHICLES (Low-poly & High performance)
  // -------------------------------------------------------------
  const createTrafficCar = (isTruck: boolean, colorHex: number) => {
    const group = new THREE.Group();

    if (isTruck) {
      // White delivery box truck
      const cabMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4, metalness: 0.3 });
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.1 });
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
      const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.6 });
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
      opacity: 0.65
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
  // BUILD ONLY THE 3D STEERING WHEEL ON THE LEFT (DRIVER SIDE)
  // -------------------------------------------------------------
  const buildPlayer3DSteeringWheel = (playerCarGroup: THREE.Group, camera: THREE.PerspectiveCamera) => {
    // 1. Move camera slightly back for realistic driver eye perspective
    // Position: Left side (x: -0.45), comfortable height (y: 1.08), pulled back (z: 0.22)
    camera.position.set(-0.45, 1.08, 0.22);
    camera.rotation.set(-0.02, 0, 0); // Slight downward glance towards the highway
    camera.up.set(0, 1, 0);
    playerCarGroup.add(camera);

    // 2. High-Fidelity 3D Steering Wheel Group (Shifted to Left Side directly in front of driver)
    const steeringWheelGroup = new THREE.Group();
    steeringWheelGroup.position.set(-0.45, 0.72, -0.40);
    steeringWheelGroup.rotation.x = -0.26; // Ergonomic tilt towards driver

    // Leather Outer Rim
    const wheelRimGeo = new THREE.TorusGeometry(0.20, 0.028, 16, 32);
    const wheelRimMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.6,
      metalness: 0.2
    });
    const wheelRimMesh = new THREE.Mesh(wheelRimGeo, wheelRimMat);
    wheelRimMesh.castShadow = true;
    steeringWheelGroup.add(wheelRimMesh);

    // Inner Polished Chrome Ring
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe4e4e7, metalness: 0.9, roughness: 0.1 });
    const chromeRing = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.007, 10, 28), chromeMat);
    steeringWheelGroup.add(chromeRing);

    // Center Hub Cap
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.4, metalness: 0.5 });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.026, 24), hubMat);
    hub.rotation.x = Math.PI / 2;
    hub.castShadow = true;
    steeringWheelGroup.add(hub);

    // 3 Brushed Metal Spokes
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x71717a, metalness: 0.85, roughness: 0.2 });

    const spokeBottom = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.012), spokeMat);
    spokeBottom.position.set(0, -0.075, 0);
    steeringWheelGroup.add(spokeBottom);

    const spokeLeft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.012), spokeMat);
    spokeLeft.position.set(-0.075, 0.02, 0);
    spokeLeft.rotation.z = Math.PI / 3;
    steeringWheelGroup.add(spokeLeft);

    const spokeRight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.012), spokeMat);
    spokeRight.position.set(0.075, 0.02, 0);
    spokeRight.rotation.z = -Math.PI / 3;
    steeringWheelGroup.add(spokeRight);

    // Paddle Shifters
    const paddleGeo = new THREE.BoxGeometry(0.02, 0.08, 0.01);
    const paddleL = new THREE.Mesh(paddleGeo, chromeMat);
    paddleL.position.set(-0.15, 0.02, -0.02);
    steeringWheelGroup.add(paddleL);

    const paddleR = new THREE.Mesh(paddleGeo, chromeMat);
    paddleR.position.set(0.15, 0.02, -0.02);
    steeringWheelGroup.add(paddleR);

    playerCarGroup.add(steeringWheelGroup);

    // 3. Headlight Spotlight
    const headlightSpot = new THREE.SpotLight(0xfff5ea, 5, 130, Math.PI / 4, 0.5, 1);
    headlightSpot.position.set(0, 0.4, -1.0);
    headlightSpot.target.position.set(0, 0, -45);
    playerCarGroup.add(headlightSpot);
    playerCarGroup.add(headlightSpot.target);

    return { steeringWheelGroup, headlightSpot };
  };

  // -------------------------------------------------------------
  // INITIALIZE THREE.JS SCENE (Enhanced Quality & Deep Sunset Shadows)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene & Sunset Sky Fog
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf59e0b); // Rich warm sunset orange
    scene.fog = new THREE.FogExp2(0xf59e0b, 0.0065);

    // 2. Camera Setup (Wide panoramic view)
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 300);

    // 3. Renderer with Optimized Sharpness & Shadows
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Clean soft shadows
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    // 4. Lighting (Strong Sunset Sun on Right Horizon Casting Long Shadows)
    const sunLight = new THREE.DirectionalLight(0xffb366, 3.6);
    sunLight.position.set(55, 18, -85);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 240;
    sunLight.shadow.camera.left = -30;
    sunLight.shadow.camera.right = 30;
    sunLight.shadow.camera.top = 25;
    sunLight.shadow.camera.bottom = -25;
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0x6366f1, 0.7); // Deep contrast purple-blue ambient shadow fill
    scene.add(ambientLight);

    // Sun Disc on Horizon
    const sunDiscMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(18, 24), sunDiscMat);
    sunDisc.position.set(70, 22, -240);
    scene.add(sunDisc);

    // 5. Player Vehicle Group
    const playerCarGroup = new THREE.Group();
    playerCarGroup.position.set(LANE_POSITIONS[1], 0, 0);
    scene.add(playerCarGroup);

    // Attach Only the 3D Steering Wheel (No heavy 3D cockpit meshes)
    const { steeringWheelGroup, headlightSpot } = buildPlayer3DSteeringWheel(playerCarGroup, camera);

    // 6. Asphalt Highway Road
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x1e242d,
      roughness: 0.6,
      metalness: 0.2
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
    const guardMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.3, metalness: 0.7 });
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

    // Dashed Lane Lines
    const laneLines: THREE.Mesh[] = [];
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lineGeo = new THREE.BoxGeometry(0.18, 0.02, 4.2);

    [-3.6, 0, 3.6].forEach(lx => {
      for (let z = -ROAD_SEGMENT_LENGTH + 20; z < 20; z += 9) {
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.position.set(lx, 0.02, z);
        scene.add(line);
        laneLines.push(line);
      }
    });

    // 7. Scenery Props (Lamp Posts with Shadows & Low-Poly Trees)
    const sceneryItems: THREE.Group[] = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
    const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 });
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.7 });

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

      // Traffic travels at a steady 55 - 75 km/h so player cruises past naturally
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
      steeringWheelGroup,
      roadPlane,
      laneLines,
      sceneryItems,
      trafficPool,
      headlightSpot,
      sunLight
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
      // Only accelerate if stick pushed forward, brake if pulled backward
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
        // Accelerate up to MAX_SPEED
        s.speedKmh = Math.min(MAX_SPEED_KMH, s.speedKmh + ACCEL_RATE * dt);
      } else if (s.isBraking) {
        // Brake down to MIN_SPEED
        s.speedKmh = Math.max(MIN_SPEED_KMH, s.speedKmh - BRAKE_RATE * dt);
      } else {
        // Natural Highway Cruising (Gently returns towards BASE_CRUISE_SPEED instead of stalling at 20km/h!)
        if (s.speedKmh > BASE_CRUISE_SPEED) {
          s.speedKmh = Math.max(BASE_CRUISE_SPEED, s.speedKmh - NATURAL_DECEL_RATE * dt);
        } else if (s.speedKmh < BASE_CRUISE_SPEED) {
          s.speedKmh = Math.min(BASE_CRUISE_SPEED, s.speedKmh + NATURAL_DECEL_RATE * dt);
        }
      }

      const worldSpeed = (s.speedKmh / 3.6) * 0.22;

      // 2. Smooth Steering Damping
      s.smoothSteer += (s.steerAngle - s.smoothSteer) * Math.min(1, dt * 8.0);
      const steerSpeed = 5.2 * (0.8 + s.speedKmh / 160);
      s.playerX += s.smoothSteer * steerSpeed * dt;
      s.playerX = Math.max(-ROAD_TOTAL_WIDTH / 2 + 1.2, Math.min(ROAD_TOTAL_WIDTH / 2 - 1.2, s.playerX));

      t3.playerCarGroup.position.x = s.playerX;

      // Rotate Steering Wheel on Left Driver Side smoothly
      if (t3.steeringWheelGroup) {
        t3.steeringWheelGroup.rotation.z = -s.smoothSteer * 2.2;
      }

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

      {/* 2D / 2.5D SLEEK VEHICLE INTERIOR OVERLAY (Zero GPU overhead, ultra-sharp on 4K TV) */}
      <svg
        className="w-full h-full absolute inset-0 z-10 pointer-events-none"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="none"
      >
        <defs>
          {/* Dashboard dark leather gradient */}
          <linearGradient id="dashLeather" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e222b" />
            <stop offset="35%" stopColor="#13161c" />
            <stop offset="100%" stopColor="#090a0d" />
          </linearGradient>

          {/* Instrument cluster hood gradient */}
          <linearGradient id="hoodGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a303c" />
            <stop offset="100%" stopColor="#111317" />
          </linearGradient>

          {/* Metallic bonnet hood glow */}
          <linearGradient id="bonnetPaint" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#52525b" />
            <stop offset="50%" stopColor="#3f3f46" />
            <stop offset="100%" stopColor="#27272a" />
          </linearGradient>

          {/* Windshield frame pillars */}
          <linearGradient id="pillarGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#090a0d" />
            <stop offset="100%" stopColor="#181a20" />
          </linearGradient>

          {/* Rearview mirror glass */}
          <linearGradient id="mirrorGlass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#272a34" />
            <stop offset="100%" stopColor="#0f1115" />
          </linearGradient>
        </defs>

        {/* Top Windshield Roof Trim */}
        <path d="M0,0 L1920,0 L1920,65 C1200,85 720,85 0,65 Z" fill="url(#dashLeather)" />

        {/* Left A-Pillar (Driver Side Windshield Frame) */}
        <path d="M0,0 L260,0 L70,720 L0,780 Z" fill="url(#pillarGrad)" />

        {/* Hanging Center-Right Rearview Mirror */}
        <g transform="translate(1180, 75)">
          <line x1="120" y1="-20" x2="120" y2="15" stroke="#090a0d" strokeWidth="10" />
          <rect x="0" y="15" width="240" height="72" rx="12" fill="#090a0d" stroke="#272a34" strokeWidth="3" />
          <rect x="8" y="22" width="224" height="58" rx="8" fill="url(#mirrorGlass)" opacity="0.9" />
          {/* Subtle reflection line */}
          <line x1="20" y1="35" x2="200" y2="65" stroke="#f59e0b" strokeWidth="2" opacity="0.4" />
        </g>

        {/* Smooth Metallic Car Bonnet Extending Forward */}
        {/* Begins naturally at base of windshield and slopes forward */}
        <path
          d="M70,720 L680,695 L1240,695 L1850,720 L1920,820 L0,820 Z"
          fill="url(#bonnetPaint)"
          opacity="0.95"
        />
        {/* Bonnet aerodynamic center crease */}
        <polygon points="955,695 965,695 970,820 950,820" fill="#71717a" opacity="0.4" />

        {/* Main Dashboard Body across bottom */}
        <path
          d="M0,770 Q960,740 1920,770 L1920,1080 L0,1080 Z"
          fill="url(#dashLeather)"
        />

        {/* Driver Instrument Cluster Hood (Elevated specifically on the left side) */}
        <path
          d="M260,780 C320,690 620,690 680,780 Z"
          fill="url(#hoodGrad)"
          stroke="#3f3f46"
          strokeWidth="3"
        />

        {/* Air Vent Accents (Center and Right) */}
        <rect x="980" y="790" width="130" height="35" rx="6" fill="#090a0d" stroke="#272a34" strokeWidth="2" />
        <line x1="990" y1="802" x2="1100" y2="802" stroke="#272a34" strokeWidth="2" />
        <line x1="990" y1="812" x2="1100" y2="812" stroke="#272a34" strokeWidth="2" />

        <rect x="1140" y="790" width="130" height="35" rx="6" fill="#090a0d" stroke="#272a34" strokeWidth="2" />
        <line x1="1150" y1="802" x2="1260" y2="802" stroke="#272a34" strokeWidth="2" />
        <line x1="1150" y1="812" x2="1260" y2="812" stroke="#272a34" strokeWidth="2" />
      </svg>

      {/* DRIVER DIGITAL GAUGE CLUSTER SCREEN (Built directly INSIDE the dashboard on the LEFT side) */}
      <div
        className="absolute z-20 pointer-events-none font-mono"
        style={{
          left: '16.5%',
          bottom: '12%',
          width: '320px',
          height: '110px'
        }}
      >
        <div className="w-full h-full bg-slate-950/95 border-2 border-cyan-500/50 rounded-2xl p-3 shadow-xl shadow-cyan-950/60 backdrop-blur-md flex flex-col justify-between">
          {/* Top Status Indicators inside car screen */}
          <div className="flex items-center justify-between text-[11px] text-cyan-400 font-bold border-b border-cyan-900/60 pb-1">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>CRUISE AUTO</span>
            </span>
            <span className="text-amber-400">HIGHWAY 4-LANE</span>
          </div>

          {/* Speed & Distance Main Display */}
          <div className="flex items-center justify-between px-1">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold">SPEED</span>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-black text-white tracking-tight drop-shadow-md">
                  {currentSpeed}
                </span>
                <span className="text-[11px] font-bold text-cyan-300">KM/H</span>
              </div>
            </div>

            <div className="h-8 w-px bg-slate-800"></div>

            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-400 font-bold">TRIP ODO</span>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-emerald-400">
                  {distanceKm}
                </span>
                <span className="text-[11px] font-bold text-slate-400">KM</span>
              </div>
            </div>
          </div>

          {/* Bottom RPM / Combo LED Gauge */}
          <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden flex">
            <div
              className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-amber-400 h-full transition-all duration-100"
              style={{ width: `${Math.min(100, (currentSpeed / MAX_SPEED_KMH) * 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* TOP NOTIFICATIONS & BOTTOM CONTROLS */}
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
