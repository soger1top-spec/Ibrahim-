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
// GAME CONFIGURATION & CONSTANTS
// -------------------------------------------------------------
const LANES_COUNT = 4;
const LANE_WIDTH = 3.6;
const ROAD_TOTAL_WIDTH = LANE_WIDTH * LANES_COUNT; // 14.4 units
const LANE_POSITIONS = [-5.4, -1.8, 1.8, 5.4]; // 4 Lanes

const MAX_SPEED_KMH = 140;
const MIN_SPEED_KMH = 0;
const ACCEL_RATE = 35;
const BRAKE_RATE = 85;
const NATURAL_DECEL = 14;

const ROAD_LENGTH = 280;
const TRAFFIC_COUNT = 7;
const MIN_TRAFFIC_GAP_Z = 35; // Minimum safe Z distance between traffic vehicles in same lane

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

  // React HUD States (Updated throttled to avoid re-render stutter)
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    return parseInt(localStorage.getItem('sunset_drive_3d_highscore') || '0', 10);
  });
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(60); // km/h
  const [nearMissAlert, setNearMissAlert] = useState<string | null>(null);
  const [isHighBeaming, setIsHighBeaming] = useState(false);

  // High score ref to decouple render loop from React state changes
  const highScoreRef = useRef(highScore);

  // Gameplay State Ref (Mutable for 60FPS physics loop)
  const gameStateRef = useRef({
    speedKmh: 60,
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

  // Three.js Core Ref
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    playerCarGroup: THREE.Group;
    steeringWheelGroup: THREE.Group;
    bonnetMesh: THREE.Mesh;
    roadPlane: THREE.Mesh;
    laneLinesGroup: THREE.Group;
    lampsInstancedMesh: THREE.InstancedMesh;
    treesInstancedMesh: THREE.InstancedMesh;
    lampZPositions: number[];
    treeZPositions: number[];
    trafficPool: NPCTrafficCar[];
    headlightSpot: THREE.SpotLight;
  } | null>(null);

  // -------------------------------------------------------------
  // HELPER: BUILD 3D NPC TRAFFIC (Box Trucks & Sedans)
  // -------------------------------------------------------------
  const create3DNPCCarMesh = (isTruck: boolean, bodyColorHex: number) => {
    const carGroup = new THREE.Group();

    if (isTruck) {
      // White Delivery Box Truck
      const cabMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.5 });
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6, metalness: 0.1 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1 });

      const cabMesh = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 1.6), cabMat);
      cabMesh.position.set(0, 0.9, -1.8);
      carGroup.add(cabMesh);

      const winMesh = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.6, 0.1), glassMat);
      winMesh.position.set(0, 1.2, -2.55);
      carGroup.add(winMesh);

      const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 4.2), boxMat);
      boxMesh.position.set(0, 1.5, 0.9);
      boxMesh.castShadow = true;
      carGroup.add(boxMesh);

      const tlMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      const tlLeft = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tlMat);
      tlLeft.position.set(-0.85, 0.8, 3.02);
      carGroup.add(tlLeft);

      const tlRight = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tlMat);
      tlRight.position.set(0.85, 0.8, 3.02);
      carGroup.add(tlRight);
    } else {
      // Low-Poly Sedan Car
      const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColorHex, roughness: 0.3, metalness: 0.7 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1 });

      const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.75, 4.0), bodyMat);
      bodyMesh.position.y = 0.55;
      bodyMesh.castShadow = true;
      carGroup.add(bodyMesh);

      const cabinMesh = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.65, 2.1), glassMat);
      cabinMesh.position.set(0, 1.15, -0.2);
      carGroup.add(cabinMesh);

      const tlMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      const tlLeft = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), tlMat);
      tlLeft.position.set(-0.65, 0.7, 2.02);
      carGroup.add(tlLeft);

      const tlRight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), tlMat);
      tlRight.position.set(0.65, 0.7, 2.02);
      carGroup.add(tlRight);
    }

    // 4 Wheels
    const wheels: THREE.Mesh[] = [];
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.22, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.8 });

    [-0.95, 0.95].forEach(wx => {
      [-1.2, 1.2].forEach(wz => {
        const w = new THREE.Mesh(wheelGeo, tireMat);
        w.position.set(wx, 0.35, wz);
        carGroup.add(w);
        wheels.push(w);
      });
    });

    return { carGroup, wheels };
  };

  // -------------------------------------------------------------
  // BUILD 3D COCKPIT MODEL (Pure Three.js 3D Interior)
  // -------------------------------------------------------------
  const buildPlayer3DElements = (playerCarGroup: THREE.Group, camera: THREE.PerspectiveCamera) => {
    // 1. Position Camera inside Driver Seat
    camera.position.set(-0.35, 1.15, 0);
    camera.rotation.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    playerCarGroup.add(camera);

    // High-Quality Interior Materials
    const darkInteriorMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.7, metalness: 0.2 });
    const dashLeatherMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8, metalness: 0.1 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.9, roughness: 0.1 });
    const mirrorGlassMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.1, metalness: 0.9 });

    // 2. 3D Windshield Frame & Roof Interior
    const roofMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.15, 0.8),
      darkInteriorMat
    );
    roofMesh.position.set(0, 1.48, -0.2);
    playerCarGroup.add(roofMesh);

    // Left A-Pillar (Driver side)
    const leftPillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.9, 0.08),
      darkInteriorMat
    );
    leftPillar.position.set(-0.9, 1.05, -0.4);
    leftPillar.rotation.z = -0.38;
    leftPillar.rotation.y = 0.15;
    playerCarGroup.add(leftPillar);

    // Right A-Pillar (Passenger side)
    const rightPillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.9, 0.08),
      darkInteriorMat
    );
    rightPillar.position.set(0.9, 1.05, -0.4);
    rightPillar.rotation.z = 0.38;
    rightPillar.rotation.y = -0.15;
    playerCarGroup.add(rightPillar);

    // 3. 3D Side Wing Mirrors
    const leftMirrorGroup = new THREE.Group();
    leftMirrorGroup.position.set(-0.98, 0.95, -0.45);
    const leftMirrorHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.12, 0.08),
      darkInteriorMat
    );
    leftMirrorHousing.rotation.y = -0.3;
    leftMirrorGroup.add(leftMirrorHousing);

    const leftMirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.1),
      mirrorGlassMat
    );
    leftMirrorGlass.position.set(0.02, 0, 0.042);
    leftMirrorGlass.rotation.y = Math.PI - 0.2;
    leftMirrorGroup.add(leftMirrorGlass);
    playerCarGroup.add(leftMirrorGroup);

    // 4. 3D Rearview Mirror (Hanging from roof center)
    const centerMirrorGroup = new THREE.Group();
    centerMirrorGroup.position.set(0.2, 1.35, -0.45);

    const mirrorStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8),
      darkInteriorMat
    );
    mirrorStem.position.set(0, 0.05, 0);
    centerMirrorGroup.add(mirrorStem);

    const mirrorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.1, 0.04),
      darkInteriorMat
    );
    centerMirrorGroup.add(mirrorFrame);

    const mirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.08),
      mirrorGlassMat
    );
    mirrorGlass.position.set(0, 0, 0.021);
    centerMirrorGroup.add(mirrorGlass);
    playerCarGroup.add(centerMirrorGroup);

    // 5. 3D Dashboard Assembly
    const dashMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.35, 0.7),
      dashLeatherMat
    );
    dashMesh.position.set(0, 0.55, -0.65);
    playerCarGroup.add(dashMesh);

    // Instrument Cluster Hood
    const hoodMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.35, 0.5, 16, 1, false, 0, Math.PI),
      dashLeatherMat
    );
    hoodMesh.rotateZ(Math.PI / 2);
    hoodMesh.position.set(-0.35, 0.72, -0.58);
    playerCarGroup.add(hoodMesh);

    // 6. 3D Steering Wheel Group
    const steeringWheelGroup = new THREE.Group();
    steeringWheelGroup.position.set(-0.35, 0.68, -0.55);
    steeringWheelGroup.rotation.x = -0.22; // Tilt slightly toward driver

    // Wheel Outer Rim (Torus)
    const wheelRimGeo = new THREE.TorusGeometry(0.22, 0.035, 20, 36);
    const wheelRimMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.6, metalness: 0.2 });
    const wheelRimMesh = new THREE.Mesh(wheelRimGeo, wheelRimMat);
    steeringWheelGroup.add(wheelRimMesh);

    // Inner Chrome Ring Accent
    const chromeRingGeo = new THREE.TorusGeometry(0.18, 0.007, 12, 32);
    const chromeRingMesh = new THREE.Mesh(chromeRingGeo, chromeMat);
    steeringWheelGroup.add(chromeRingMesh);

    // Wheel Hub Cap
    const hubCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 0.03, 32),
      darkInteriorMat
    );
    hubCap.rotation.x = Math.PI / 2;
    steeringWheelGroup.add(hubCap);

    // 3 Aluminum Spokes
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x71717a, metalness: 0.85, roughness: 0.15 });

    const spokeBottom = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.15, 0.015), spokeMat);
    spokeBottom.position.set(0, -0.09, 0);
    steeringWheelGroup.add(spokeBottom);

    const spokeLeft = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.15, 0.015), spokeMat);
    spokeLeft.position.set(-0.09, 0.02, 0);
    spokeLeft.rotation.z = Math.PI / 3;
    steeringWheelGroup.add(spokeLeft);

    const spokeRight = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.15, 0.015), spokeMat);
    spokeRight.position.set(0.09, 0.02, 0);
    spokeRight.rotation.z = -Math.PI / 3;
    steeringWheelGroup.add(spokeRight);

    // Paddle Shifters
    const paddleGeo = new THREE.BoxGeometry(0.022, 0.08, 0.01);
    const paddleLeft = new THREE.Mesh(paddleGeo, chromeMat);
    paddleLeft.position.set(-0.16, 0.02, -0.02);
    steeringWheelGroup.add(paddleLeft);

    const paddleRight = new THREE.Mesh(paddleGeo, chromeMat);
    paddleRight.position.set(0.16, 0.02, -0.02);
    steeringWheelGroup.add(paddleRight);

    playerCarGroup.add(steeringWheelGroup);

    // 7. Metallic Car Bonnet / Hood
    const bonnetGeo = new THREE.BoxGeometry(1.95, 0.28, 2.2);
    const bonnetMat = new THREE.MeshStandardMaterial({
      color: 0x3f3f46,
      metalness: 0.9,
      roughness: 0.1
    });
    const bonnetMesh = new THREE.Mesh(bonnetGeo, bonnetMat);
    bonnetMesh.position.set(0, 0.38, -1.65);
    bonnetMesh.castShadow = true;
    bonnetMesh.receiveShadow = true;
    playerCarGroup.add(bonnetMesh);

    // 8. Headlight Spotlight
    const headlightSpot = new THREE.SpotLight(0xfff5ea, 5, 120, Math.PI / 5, 0.5, 1);
    headlightSpot.position.set(0, 0.5, -1.2);
    headlightSpot.target.position.set(0, 0, -50);
    playerCarGroup.add(headlightSpot);
    playerCarGroup.add(headlightSpot.target);

    return { steeringWheelGroup, bonnetMesh, headlightSpot };
  };

  // -------------------------------------------------------------
  // TRAFFIC RECYCLING SAFETY & MINIMUM DISTANCE CHECK
  // -------------------------------------------------------------
  const findSafeRespawnPosition = (
    trafficPool: NPCTrafficCar[],
    currentCarIndex: number
  ) => {
    // Try candidate lanes
    const candidateLanes = [0, 1, 2, 3].sort(() => Math.random() - 0.5);

    for (const lane of candidateLanes) {
      // Find cars in this lane
      const carsInLane = trafficPool.filter(
        (c, idx) => idx !== currentCarIndex && c.targetLane === lane
      );

      // Find the furthest car back in this lane (smallest Z value)
      let minZInLane = -180;
      let hasOverlap = false;

      for (const otherCar of carsInLane) {
        if (otherCar.z < minZInLane) {
          minZInLane = otherCar.z;
        }
      }

      // Candidate Z position ahead of camera
      const candidateZ = Math.min(-200, minZInLane - MIN_TRAFFIC_GAP_Z - Math.random() * 20);

      // Verify no other car is within MIN_TRAFFIC_GAP_Z
      for (const otherCar of carsInLane) {
        if (Math.abs(otherCar.z - candidateZ) < MIN_TRAFFIC_GAP_Z) {
          hasOverlap = true;
          break;
        }
      }

      if (!hasOverlap) {
        return { lane, z: candidateZ };
      }
    }

    // Fallback if all lanes busy: place far back
    const fallbackLane = Math.floor(Math.random() * LANES_COUNT);
    return { lane: fallbackLane, z: -250 - currentCarIndex * 25 };
  };

  // -------------------------------------------------------------
  // INITIALIZE THREE.JS SCENE
  // -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene & Sunset Sky Fog
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf97316); // Golden Orange Sunset
    scene.fog = new THREE.FogExp2(0xf97316, 0.006); // Soft atmospheric fog

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 220);

    // 3. WebGL Renderer with Smart Pixel Ratio (Limits rendering overhead on TV/weaker devices)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // 4. Player Vehicle Group
    const playerCarGroup = new THREE.Group();
    playerCarGroup.position.set(LANE_POSITIONS[1], 0, 0); // Start in lane 1
    scene.add(playerCarGroup);

    // Attach 3D Steering Wheel & Camera
    const { steeringWheelGroup, bonnetMesh, headlightSpot } = buildPlayer3DElements(playerCarGroup, camera);

    // 5. Lighting (Sunset Sun on Right Horizon)
    const sunLight = new THREE.DirectionalLight(0xffbe76, 2.8);
    sunLight.position.set(45, 12, -90);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 200;
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0x7c3aed, 0.7);
    scene.add(ambientLight);

    // 6. Multi-Lane Asphalt Highway
    const roadPlaneGeo = new THREE.PlaneGeometry(ROAD_TOTAL_WIDTH + 8, ROAD_LENGTH);
    const roadPlaneMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.5,
      metalness: 0.15
    });
    const roadPlane = new THREE.Mesh(roadPlaneGeo, roadPlaneMat);
    roadPlane.rotation.x = -Math.PI / 2;
    roadPlane.position.set(0, 0, -ROAD_LENGTH / 2 + 20);
    roadPlane.receiveShadow = true;
    scene.add(roadPlane);

    // Guardrails
    const guardMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.2 });
    const guardGeo = new THREE.BoxGeometry(0.5, 0.45, ROAD_LENGTH);

    const guardLeft = new THREE.Mesh(guardGeo, guardMat);
    guardLeft.position.set(-ROAD_TOTAL_WIDTH / 2 - 0.4, 0.22, -ROAD_LENGTH / 2 + 20);
    guardLeft.castShadow = true;
    scene.add(guardLeft);

    const guardRight = new THREE.Mesh(guardGeo, guardMat);
    guardRight.position.set(ROAD_TOTAL_WIDTH / 2 + 0.4, 0.22, -ROAD_LENGTH / 2 + 20);
    guardRight.castShadow = true;
    scene.add(guardRight);

    // Dashed White Lane Lines
    const laneLinesGroup = new THREE.Group();
    const laneLineGeo = new THREE.BoxGeometry(0.18, 0.015, 3.8);
    const laneLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    [-3.6, 0, 3.6].forEach(lineX => {
      for (let z = -ROAD_LENGTH + 20; z < 20; z += 9) {
        const lineMesh = new THREE.Mesh(laneLineGeo, laneLineMat);
        lineMesh.position.set(lineX, 0.02, z);
        laneLinesGroup.add(lineMesh);
      }
    });
    scene.add(laneLinesGroup);

    // 7. PERFORMANCE OPTIMIZATION: INSTANCED MESHES FOR ROAD PROPS
    const lampCount = 12;
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 8, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3f3f46, metalness: 0.85, roughness: 0.2 });
    const lampsInstancedMesh = new THREE.InstancedMesh(poleGeo, poleMat, lampCount);
    lampsInstancedMesh.castShadow = true;

    const lampZPositions: number[] = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < lampCount; i++) {
      const z = -ROAD_LENGTH + 20 + i * 22;
      lampZPositions.push(z);
      const isLeft = i % 2 === 0;
      dummy.position.set(
        isLeft ? -ROAD_TOTAL_WIDTH / 2 - 1.8 : ROAD_TOTAL_WIDTH / 2 + 1.8,
        4,
        z
      );
      dummy.updateMatrix();
      lampsInstancedMesh.setMatrixAt(i, dummy.matrix);
    }
    lampsInstancedMesh.instanceMatrix.needsUpdate = true;
    scene.add(lampsInstancedMesh);

    // Instanced Trees
    const treeCount = 12;
    const treeGeo = new THREE.DodecahedronGeometry(1.6, 0);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.7 });
    const treesInstancedMesh = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
    treesInstancedMesh.castShadow = true;

    const treeZPositions: number[] = [];

    for (let i = 0; i < treeCount; i++) {
      const z = -ROAD_LENGTH + 20 + i * 22;
      treeZPositions.push(z);
      dummy.position.set(ROAD_TOTAL_WIDTH / 2 + 4.2, 4.0, z);
      dummy.updateMatrix();
      treesInstancedMesh.setMatrixAt(i, dummy.matrix);
    }
    treesInstancedMesh.instanceMatrix.needsUpdate = true;
    scene.add(treesInstancedMesh);

    // 8. 3D Traffic Pool
    const trafficPool: NPCTrafficCar[] = [];
    const carColors = [0xd97706, 0x2563eb, 0x16a34a, 0xe11d48, 0x0284c7, 0x9333ea];

    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const isTruck = i % 3 === 0;
      const color = carColors[i % carColors.length];
      const { carGroup, wheels } = create3DNPCCarMesh(isTruck, color);

      const lane = i % LANES_COUNT;
      const x = LANE_POSITIONS[lane];
      const z = -45 - i * 36;
      carGroup.position.set(x, 0, z);
      scene.add(carGroup);

      const speed = 60 + Math.random() * 30;
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
      bonnetMesh,
      roadPlane,
      laneLinesGroup,
      lampsInstancedMesh,
      treesInstancedMesh,
      lampZPositions,
      treeZPositions,
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
  // CONTROLLER & INPUT COMMAND LISTENERS
  // -------------------------------------------------------------
  const handleControllerCommand = useCallback((cmd: any) => {
    if (!cmd) return;
    const s = gameStateRef.current;

    if (cmd.type === 'stick_move' && cmd.stick) {
      s.steerAngle = Math.max(-1, Math.min(1, cmd.stick.x * 1.2));
      if (cmd.stick.y < -0.15) {
        s.isAccelerating = true; s.isBraking = false;
      } else if (cmd.stick.y > 0.18) {
        s.isBraking = true; s.isAccelerating = false;
      } else {
        s.isAccelerating = false; s.isBraking = false;
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

  // Handle prop controllerCommand
  useEffect(() => {
    if (controllerCommand) handleControllerCommand(controllerCommand);
  }, [controllerCommand, handleControllerCommand]);

  // Subscribe directly to controllerBus to guarantee zero dropped input commands
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
        if (car.z < 0 && car.z > -100) {
          if (Math.abs(car.x - s.playerX) < LANE_WIDTH * 0.9) {
            car.targetLane = s.playerX < car.x ? Math.min(3, car.lane + 1) : Math.max(0, car.lane - 1);
          }
        }
      });
    }
  }, []);

  const restartGame = useCallback(() => {
    const s = gameStateRef.current;
    s.speedKmh = 60;
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

    if (threeRef.current) {
      threeRef.current.playerCarGroup.position.x = s.playerX;
      threeRef.current.trafficPool.forEach((car, idx) => {
        car.lane = idx % LANES_COUNT;
        car.targetLane = car.lane;
        car.x = LANE_POSITIONS[car.lane];
        car.z = -45 - idx * 36;
        car.speedKmh = 65;
        car.targetSpeedKmh = 65;
        car.mesh.position.set(car.x, 0, car.z);
      });
    }
  }, []);

  // -------------------------------------------------------------
  // CONTINUOUS 60FPS FRAME LOOP (Rock Solid Dependency Free)
  // -------------------------------------------------------------
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();
    let hudUpdateTimer = 0;

    const animate = (now: number) => {
      animationFrameId = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const s = gameStateRef.current;
      const t3 = threeRef.current;
      if (!t3 || s.isPaused || s.isGameOver) return;

      // 1. Acceleration Physics
      if (s.isAccelerating) {
        s.speedKmh = Math.min(MAX_SPEED_KMH, s.speedKmh + ACCEL_RATE * dt);
      } else if (s.isBraking) {
        s.speedKmh = Math.max(MIN_SPEED_KMH, s.speedKmh - BRAKE_RATE * dt);
      } else {
        s.speedKmh = Math.max(20, s.speedKmh - NATURAL_DECEL * dt);
      }

      const worldSpeed = (s.speedKmh / 3.6) * 0.22;

      // 2. Smooth Steering Physics & Wheel Return
      s.smoothSteer += (s.steerAngle - s.smoothSteer) * Math.min(1, dt * 8.0);
      const steerSpeed = 5.2 * (0.8 + s.speedKmh / 160);
      s.playerX += s.smoothSteer * steerSpeed * dt;
      s.playerX = Math.max(-ROAD_TOTAL_WIDTH / 2 + 1.0, Math.min(ROAD_TOTAL_WIDTH / 2 - 1.0, s.playerX));

      t3.playerCarGroup.position.x = s.playerX;

      // Rotate Steering Wheel smoothly with steering input
      if (t3.steeringWheelGroup) {
        t3.steeringWheelGroup.rotation.z = -s.smoothSteer * 2.2;
      }

      // 3. High Beam Spotlight
      if (s.highBeamTimer > 0) {
        s.highBeamTimer -= dt;
        t3.headlightSpot.intensity = 12;
        if (s.highBeamTimer <= 0) {
          setIsHighBeaming(false);
          t3.headlightSpot.intensity = 5;
        }
      }

      // 4. Scroll Road Markings & Instanced Scenery
      const moveDistance = worldSpeed * dt * 25;

      t3.laneLinesGroup.children.forEach(line => {
        line.position.z += moveDistance;
        if (line.position.z > 20) line.position.z -= ROAD_LENGTH;
      });

      // Update Instanced Lamp Posts
      const dummy = new THREE.Object3D();
      for (let i = 0; i < t3.lampZPositions.length; i++) {
        t3.lampZPositions[i] += moveDistance;
        if (t3.lampZPositions[i] > 20) t3.lampZPositions[i] -= ROAD_LENGTH;
        const isLeft = i % 2 === 0;
        dummy.position.set(
          isLeft ? -ROAD_TOTAL_WIDTH / 2 - 1.8 : ROAD_TOTAL_WIDTH / 2 + 1.8,
          4,
          t3.lampZPositions[i]
        );
        dummy.updateMatrix();
        t3.lampsInstancedMesh.setMatrixAt(i, dummy.matrix);
      }
      t3.lampsInstancedMesh.instanceMatrix.needsUpdate = true;

      // Update Instanced Trees
      for (let i = 0; i < t3.treeZPositions.length; i++) {
        t3.treeZPositions[i] += moveDistance;
        if (t3.treeZPositions[i] > 20) t3.treeZPositions[i] -= ROAD_LENGTH;
        dummy.position.set(ROAD_TOTAL_WIDTH / 2 + 4.2, 4.0, t3.treeZPositions[i]);
        dummy.updateMatrix();
        t3.treesInstancedMesh.setMatrixAt(i, dummy.matrix);
      }
      t3.treesInstancedMesh.instanceMatrix.needsUpdate = true;

      // 5. Update NPC Traffic with Smooth Speed Interpolation & Safe Spawning
      t3.trafficPool.forEach((car, idx) => {
        // Smoothly interpolate traffic speed towards target speed
        car.speedKmh += (car.targetSpeedKmh - car.speedKmh) * dt * 2.0;

        const trafficWorldSpeed = (car.speedKmh / 3.6) * 0.22;
        const relativeSpeed = worldSpeed - trafficWorldSpeed;
        car.z += relativeSpeed * dt * 25;

        // Smooth Lane Change Interpolation
        const targetX = LANE_POSITIONS[car.targetLane];
        if (Math.abs(car.x - targetX) > 0.05) {
          car.x += Math.sign(targetX - car.x) * dt * 3.2;
        } else {
          car.x = targetX;
          car.lane = car.targetLane;
        }

        car.mesh.position.set(car.x, 0, car.z);

        // Wheel Rotation
        car.wheels.forEach(wheel => {
          wheel.rotation.x += trafficWorldSpeed * dt * 4;
        });

        // Safe Respawn Ahead when passing behind camera
        if (car.z > 25) {
          const safePos = findSafeRespawnPosition(t3.trafficPool, idx);
          car.lane = safePos.lane;
          car.targetLane = safePos.lane;
          car.x = LANE_POSITIONS[safePos.lane];
          car.z = safePos.z;
          car.targetSpeedKmh = 60 + Math.random() * 35;
          car.speedKmh = car.targetSpeedKmh;
          car.mesh.position.set(car.x, 0, car.z);
        }

        // Collision Check
        const dx = Math.abs(car.x - s.playerX);
        const dz = Math.abs(car.z);

        if (dx < 1.5 && dz < 2.2) {
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
        if (dz < 1.8 && dx > 1.5 && dx < 2.6 && now - s.lastNearMissTime > 1800) {
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

      // Throttle React State HUD Updates to 6-7 times/sec (150ms) to avoid 60FPS re-render overhead
      hudUpdateTimer += dt;
      if (hudUpdateTimer >= 0.15) {
        hudUpdateTimer = 0;
        setCurrentSpeed(Math.round(s.speedKmh));
        setDistanceKm(parseFloat(s.distanceAccKm.toFixed(1)));
        setScore(Math.floor(s.scoreAcc));
      }

      // Render 3D Scene
      t3.renderer.render(t3.scene, t3.camera);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, []); // NO highScore dependency -> Stable, non-restarting 60FPS loop!

  return (
    <div className="w-screen h-screen bg-slate-950 text-white select-none overflow-hidden relative font-sans" dir="rtl">
      {/* 3D Canvas Container */}
      <div ref={containerRef} className="w-full h-full absolute inset-0 z-0" />

      {/* COCKPIT HUD OVERLAY */}
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

        {/* Bottom Bar: Speedometer & Distance */}
        <div className="w-full flex items-end justify-between">
          <div className="pointer-events-auto flex items-center gap-3 bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-2 text-xs text-slate-300 font-mono backdrop-blur-md">
            <span>عصا التحكم / الأسهم: توجيه</span>
            <span className="text-slate-600">|</span>
            <button
              type="button"
              onClick={onBackToMenu}
              className="px-3 py-1 rounded-xl bg-rose-600/30 hover:bg-rose-600 text-rose-300 font-bold text-xs border border-rose-500/40 transition-colors"
            >
              الخروج [SELECT]
            </button>
          </div>

          <div className="flex flex-col items-end text-right font-mono pr-4 pb-2">
            <div className="text-slate-300 text-2xl mb-1 drop-shadow">✦</div>
            <div className="text-xl font-bold tracking-wider text-slate-200 drop-shadow">
              KM: {distanceKm}
            </div>
            <div className="text-2xl font-black tracking-widest text-white drop-shadow-md">
              SPEED: {currentSpeed} KM/H
            </div>
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
