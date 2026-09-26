import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  Flame,
  Volume2,
  VolumeX,
  Zap,
  RotateCcw,
  ArrowRight,
  Gauge,
  Car as CarIcon,
  Sparkles,
  Shield,
  Lightbulb
} from 'lucide-react';
import { sounds } from './soundFx';
import { controllerBus } from '../services/controllerBus';

interface SunsetHighwayGameProps {
  onBackToMenu: () => void;
  controllerCommand?: any;
}

// -------------------------------------------------------------
// GAME CONSTANTS & CONFIGURATION
// -------------------------------------------------------------
const LANE_WIDTH = 3.6; // Width of a single highway lane in 3D units
const LANES_COUNT = 4;
const ROAD_TOTAL_WIDTH = LANE_WIDTH * LANES_COUNT; // 14.4 units
const LANE_POSITIONS = [-5.4, -1.8, 1.8, 5.4]; // X center for lanes 0, 1, 2, 3

const MAX_SPEED_KMH = 220;
const MIN_SPEED_KMH = 0;
const ACCEL_RATE = 85; // km/h per sec
const BRAKE_RATE = 140;
const NATURAL_DECEL = 28;

const ROAD_LENGTH = 400; // Visible road length in 3D units
const TRAFFIC_COUNT = 10;

interface NPCTrafficCar {
  mesh: THREE.Group;
  wheels: THREE.Mesh[];
  tailLightMaterials: THREE.MeshStandardMaterial[];
  x: number;
  z: number;
  lane: number;
  targetLane: number;
  speedKmh: number;
  type: 'sedan' | 'sport' | 'suv' | 'truck';
  color: number;
  isBraking: boolean;
  isYielding: boolean;
  active: boolean;
}

export function SunsetHighwayGame({ onBackToMenu, controllerCommand }: SunsetHighwayGameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // React HUD States
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    return parseInt(localStorage.getItem('sunset_drive_3d_highscore') || '0', 10);
  });
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(100); // km/h
  const [combo, setCombo] = useState(1);
  const [nearMissAlert, setNearMissAlert] = useState<string | null>(null);
  const [isHighBeaming, setIsHighBeaming] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Gameplay Refs for 60FPS Three.js Loop
  const gameStateRef = useRef({
    speedKmh: 100,
    targetSpeedKmh: 100,
    playerX: LANE_POSITIONS[1], // Start in lane 1 (-1.8)
    playerZ: 0,
    steerAngle: 0, // -1 (left) to 1 (right)
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

  // Three.js References
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    cockpitGroup: THREE.Group;
    steeringWheelGroup: THREE.Group;
    roadPlane: THREE.Mesh;
    laneLines: THREE.Mesh[];
    sceneryObjects: THREE.Group[];
    trafficPool: NPCTrafficCar[];
    sunLight: THREE.DirectionalLight;
    headlightBeams: THREE.SpotLight[];
    sparksParticles: THREE.Points;
  } | null>(null);

  // -------------------------------------------------------------
  // HELPER: BUILD 3D NPC CAR MESH
  // -------------------------------------------------------------
  const create3DNPCCarMesh = (type: 'sedan' | 'sport' | 'suv' | 'truck', bodyColorHex: number) => {
    const carGroup = new THREE.Group();

    // Dimensions based on car type
    let bodyW = 1.8;
    let bodyH = 0.9;
    let bodyL = 4.2;
    let cabinH = 0.65;
    let cabinL = 2.2;

    if (type === 'suv') {
      bodyW = 1.95;
      bodyH = 1.1;
      bodyL = 4.5;
      cabinH = 0.75;
      cabinL = 2.6;
    } else if (type === 'truck') {
      bodyW = 2.1;
      bodyH = 1.25;
      bodyL = 5.2;
      cabinH = 0.85;
      cabinL = 2.0;
    } else if (type === 'sport') {
      bodyW = 1.85;
      bodyH = 0.75;
      bodyL = 4.1;
      cabinH = 0.55;
      cabinL = 1.9;
    }

    // Car Paint Material (Glossy Metallic Automotive Finish with High Specular Reflection)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColorHex,
      metalness: 0.88,
      roughness: 0.12
    });

    // Windows Material (Clear Reflective Glass)
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.96,
      roughness: 0.04
    });

    // Chrome/Bumper Material (Polished Chrome)
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.95,
      roughness: 0.05
    });

    // 1. Lower Body Box
    const bodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyL);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = bodyH / 2 + 0.35; // Elevator above wheels
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    carGroup.add(bodyMesh);

    // 2. Cabin / Roof Box
    const cabinGeo = new THREE.BoxGeometry(bodyW * 0.9, cabinH, cabinL);
    const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
    cabinMesh.position.set(0, bodyH + cabinH / 2 + 0.3, -0.2);
    cabinMesh.castShadow = true;
    carGroup.add(cabinMesh);

    // Roof Cap
    const roofGeo = new THREE.BoxGeometry(bodyW * 0.88, 0.08, cabinL * 0.95);
    const roofMesh = new THREE.Mesh(roofGeo, bodyMat);
    roofMesh.position.set(0, bodyH + cabinH + 0.32, -0.2);
    carGroup.add(roofMesh);

    // 3. Front Bumper & Chrome Grill
    const grillGeo = new THREE.BoxGeometry(bodyW * 0.8, 0.22, 0.1);
    const grillMesh = new THREE.Mesh(grillGeo, chromeMat);
    grillMesh.position.set(0, bodyH * 0.4 + 0.35, -bodyL / 2 - 0.02);
    carGroup.add(grillMesh);

    // 4. Headlights (Front Glowing Yellow/White)
    const headLightMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
    const headLightGeo = new THREE.BoxGeometry(0.35, 0.15, 0.1);
    
    const hlLeft = new THREE.Mesh(headLightGeo, headLightMat);
    hlLeft.position.set(-bodyW / 2 + 0.25, bodyH * 0.6 + 0.35, -bodyL / 2 - 0.02);
    carGroup.add(hlLeft);

    const hlRight = new THREE.Mesh(headLightGeo, headLightMat);
    hlRight.position.set(bodyW / 2 - 0.25, bodyH * 0.6 + 0.35, -bodyL / 2 - 0.02);
    carGroup.add(hlRight);

    // 5. Taillights (Rear Red Brake Lights)
    const tailLightMat = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xaa0000,
      emissiveIntensity: 0.8,
      roughness: 0.3
    });
    const tailLightGeo = new THREE.BoxGeometry(0.4, 0.16, 0.1);

    const tlLeft = new THREE.Mesh(tailLightGeo, tailLightMat);
    tlLeft.position.set(-bodyW / 2 + 0.3, bodyH * 0.65 + 0.35, bodyL / 2 + 0.02);
    carGroup.add(tlLeft);

    const tlRight = new THREE.Mesh(tailLightGeo, tailLightMat);
    tlRight.position.set(bodyW / 2 - 0.3, bodyH * 0.65 + 0.35, bodyL / 2 + 0.02);
    carGroup.add(tlRight);

    // 6. Four Physical 3D Cylinder Wheels
    const wheels: THREE.Mesh[] = [];
    const wheelRadius = 0.36;
    const wheelWidth = 0.24;
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 18);
    wheelGeo.rotateZ(Math.PI / 2); // Orient cylinder horizontally

    const tireMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.8 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8, roughness: 0.2 });

    const wheelOffsets = [
      { x: -bodyW / 2 - 0.02, z: -bodyL / 2 + 0.8 }, // Front Left
      { x: bodyW / 2 + 0.02, z: -bodyL / 2 + 0.8 },  // Front Right
      { x: -bodyW / 2 - 0.02, z: bodyL / 2 - 0.8 },  // Rear Left
      { x: bodyW / 2 + 0.02, z: bodyL / 2 - 0.8 }    // Rear Right
    ];

    wheelOffsets.forEach(pos => {
      const wheelHub = new THREE.Group();
      const tireMesh = new THREE.Mesh(wheelGeo, tireMat);
      tireMesh.castShadow = true;
      wheelHub.add(tireMesh);

      // Rim Cap
      const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.6, wheelRadius * 0.6, wheelWidth + 0.01, 12);
      rimGeo.rotateZ(Math.PI / 2);
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      wheelHub.add(rimMesh);

      wheelHub.position.set(pos.x, wheelRadius, pos.z);
      carGroup.add(wheelHub);
      wheels.push(tireMesh);
    });

    return {
      carGroup,
      wheels,
      tailLightMaterials: [tailLightMat]
    };
  };

  // -------------------------------------------------------------
  // HELPER: BUILD 3D COCKPIT & STEERING WHEEL
  // -------------------------------------------------------------
  const create3DCockpitGroup = () => {
    const cockpitGroup = new THREE.Group();

    // 1. Dashboard Main Frame (Dark Leather Finish)
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a24,
      roughness: 0.7,
      metalness: 0.2
    });
    const dashAccentMat = new THREE.MeshStandardMaterial({
      color: 0x312e81,
      roughness: 0.3,
      metalness: 0.6
    });

    // Lower Dashboard Shelf
    const dashBaseGeo = new THREE.BoxGeometry(2.4, 0.45, 0.9);
    const dashBaseMesh = new THREE.Mesh(dashBaseGeo, dashMat);
    dashBaseMesh.position.set(0, 0.72, -0.65);
    cockpitGroup.add(dashBaseMesh);

    // Upper Dashboard Hood (Driver side)
    const hoodGeo = new THREE.BoxGeometry(0.85, 0.28, 0.55);
    const hoodMesh = new THREE.Mesh(hoodGeo, dashMat);
    hoodMesh.position.set(-0.4, 0.92, -0.6);
    cockpitGroup.add(hoodMesh);

    // Glowing Speedometer Instrument Panel
    const gaugeCanvas = document.createElement('canvas');
    gaugeCanvas.width = 256;
    gaugeCanvas.height = 128;
    const ctx = gaugeCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0a0a14';
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(128, 100, 70, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 24px monospace';
      ctx.fillText('SUNSET 3D', 70, 40);
    }
    const gaugeTex = new THREE.CanvasTexture(gaugeCanvas);
    const gaugeMat = new THREE.MeshBasicMaterial({ map: gaugeTex });
    const gaugeGeo = new THREE.PlaneGeometry(0.5, 0.22);
    const gaugeMesh = new THREE.Mesh(gaugeGeo, gaugeMat);
    gaugeMesh.position.set(-0.4, 0.88, -0.48);
    gaugeMesh.rotation.x = -0.2;
    cockpitGroup.add(gaugeMesh);

    // Center Console Display Screen
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
    const screenGeo = new THREE.PlaneGeometry(0.38, 0.22);
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(0.15, 0.82, -0.52);
    screenMesh.rotation.x = -0.15;
    cockpitGroup.add(screenMesh);

    // 2. 3D Steering Wheel Group
    const steeringWheelGroup = new THREE.Group();
    steeringWheelGroup.position.set(-0.4, 0.86, -0.42);

    // Leather Wheel Rim (Torus Geometry)
    const wheelRimGeo = new THREE.TorusGeometry(0.22, 0.032, 16, 36);
    const wheelRimMat = new THREE.MeshStandardMaterial({
      color: 0x111118,
      roughness: 0.6,
      metalness: 0.3
    });
    const wheelRimMesh = new THREE.Mesh(wheelRimGeo, wheelRimMat);
    steeringWheelGroup.add(wheelRimMesh);

    // Center Hub Badge
    const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 20);
    hubGeo.rotateX(Math.PI / 2);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x4338ca, metalness: 0.8, roughness: 0.2 });
    const hubMesh = new THREE.Mesh(hubGeo, hubMat);
    steeringWheelGroup.add(hubMesh);

    // 3 Spokes (Left, Right, Bottom)
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.9, roughness: 0.2 });
    const spokeGeo = new THREE.BoxGeometry(0.03, 0.16, 0.02);

    const spokeBottom = new THREE.Mesh(spokeGeo, spokeMat);
    spokeBottom.position.set(0, -0.1, 0);
    steeringWheelGroup.add(spokeBottom);

    const spokeLeft = new THREE.Mesh(spokeGeo, spokeMat);
    spokeLeft.position.set(-0.1, 0.02, 0);
    spokeLeft.rotation.z = Math.PI / 3;
    steeringWheelGroup.add(spokeLeft);

    const spokeRight = new THREE.Mesh(spokeGeo, spokeMat);
    spokeRight.position.set(0.1, 0.02, 0);
    spokeRight.rotation.z = -Math.PI / 3;
    steeringWheelGroup.add(spokeRight);

    // Tilt Steering Wheel slightly towards driver
    steeringWheelGroup.rotation.x = -0.25;
    cockpitGroup.add(steeringWheelGroup);

    // 3. A-Pillars & Windshield Frame
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
    const pillarGeo = new THREE.BoxGeometry(0.08, 1.2, 0.08);

    const pillarLeft = new THREE.Mesh(pillarGeo, pillarMat);
    pillarLeft.position.set(-1.15, 1.25, -0.3);
    pillarLeft.rotation.z = -0.35;
    cockpitGroup.add(pillarLeft);

    const pillarRight = new THREE.Mesh(pillarGeo, pillarMat);
    pillarRight.position.set(1.15, 1.25, -0.3);
    pillarRight.rotation.z = 0.35;
    cockpitGroup.add(pillarRight);

    // 4. Center Rearview Mirror (مراية وسطى 3D)
    const mirrorHousingGeo = new THREE.BoxGeometry(0.32, 0.12, 0.06);
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 });
    const mirrorMesh = new THREE.Mesh(mirrorHousingGeo, mirrorMat);
    mirrorMesh.position.set(0, 1.42, -0.42);

    const mirrorGlassGeo = new THREE.PlaneGeometry(0.3, 0.1);
    const mirrorGlassMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95, roughness: 0.05 });
    const mirrorGlassMesh = new THREE.Mesh(mirrorGlassGeo, mirrorGlassMat);
    mirrorGlassMesh.position.set(0, 1.42, -0.38);
    cockpitGroup.add(mirrorMesh);
    cockpitGroup.add(mirrorGlassMesh);

    return { cockpitGroup, steeringWheelGroup };
  };

  // -------------------------------------------------------------
  // INITIALIZE THREE.JS 3D WORLD
  // -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene Setup & Sunset Ambiance
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5653b); // Vibrant Sunset Orange Sky
    scene.fog = new THREE.FogExp2(0xe24a2d, 0.0075); // Warm Sunset Atmospheric Fog

    // 2. Camera Setup (First Person Cockpit View)
    const camera = new THREE.PerspectiveCamera(68, width / height, 0.1, 800);
    camera.position.set(-0.4, 1.18, 0.2); // First Person Driver Eye Position

    // 3. Renderer Setup (High Performance, Crisp Quality)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    // 4. Lighting (Sunset Directional Light + Shadows)
    const sunLight = new THREE.DirectionalLight(0xffb077, 2.6);
    sunLight.position.set(40, 25, -120);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 350;
    sunLight.shadow.camera.left = -30;
    sunLight.shadow.camera.right = 30;
    sunLight.shadow.camera.top = 30;
    sunLight.shadow.camera.bottom = -30;
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0x604060, 0.9);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xff7744, 0x221133, 0.8);
    scene.add(hemiLight);

    // 5. 3D Road Asphalt Plane
    const roadPlaneGeo = new THREE.PlaneGeometry(ROAD_TOTAL_WIDTH + 8, ROAD_LENGTH);
    const roadPlaneMat = new THREE.MeshStandardMaterial({
      color: 0x181a20,
      roughness: 0.45,
      metalness: 0.35
    });
    const roadPlane = new THREE.Mesh(roadPlaneGeo, roadPlaneMat);
    roadPlane.rotation.x = -Math.PI / 2;
    roadPlane.position.set(0, 0, -ROAD_LENGTH / 2 + 20);
    roadPlane.receiveShadow = true;
    scene.add(roadPlane);

    // Shoulders / Guardrails
    const shoulderGeo = new THREE.BoxGeometry(0.6, 0.5, ROAD_LENGTH);
    const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });

    const guardLeft = new THREE.Mesh(shoulderGeo, shoulderMat);
    guardLeft.position.set(-ROAD_TOTAL_WIDTH / 2 - 0.3, 0.25, -ROAD_LENGTH / 2 + 20);
    scene.add(guardLeft);

    const guardRight = new THREE.Mesh(shoulderGeo, shoulderMat);
    guardRight.position.set(ROAD_TOTAL_WIDTH / 2 + 0.3, 0.25, -ROAD_LENGTH / 2 + 20);
    scene.add(guardRight);

    // 6. Dashed White Lane Lines
    const laneLines: THREE.Mesh[] = [];
    const laneLineGeo = new THREE.BoxGeometry(0.18, 0.02, 3.5);
    const laneLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    [-1.8, 0, 1.8].forEach(lineX => {
      for (let z = -ROAD_LENGTH + 20; z < 20; z += 9) {
        const lineMesh = new THREE.Mesh(laneLineGeo, laneLineMat);
        lineMesh.position.set(lineX, 0.02, z);
        scene.add(lineMesh);
        laneLines.push(lineMesh);
      }
    });

    // 7. Scenery Objects (3D Street Lamps & Sunset Palm Trees)
    const sceneryObjects: THREE.Group[] = [];

    for (let z = -ROAD_LENGTH + 20; z < 20; z += 18) {
      // Left Streetlamp
      const lampGroup = new THREE.Group();
      const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 7, 12);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.2 });
      const poleMesh = new THREE.Mesh(poleGeo, poleMat);
      poleMesh.position.y = 3.5;
      lampGroup.add(poleMesh);

      const lampHeadGeo = new THREE.BoxGeometry(1.2, 0.2, 0.4);
      const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfcb338 });
      const lampHead = new THREE.Mesh(lampHeadGeo, lampHeadMat);
      lampHead.position.set(0.5, 7, 0);
      lampGroup.add(lampHead);

      lampGroup.position.set(-ROAD_TOTAL_WIDTH / 2 - 1.8, 0, z);
      scene.add(lampGroup);
      sceneryObjects.push(lampGroup);

      // Right Palm Tree
      const palmGroup = new THREE.Group();
      const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 8, 8);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 });
      const trunkMesh = new THREE.Mesh(trunkGeo, trunkMat);
      trunkMesh.position.y = 4;
      palmGroup.add(trunkMesh);

      // Fronds
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 });
      for (let f = 0; f < 6; f++) {
        const leafGeo = new THREE.BoxGeometry(0.4, 0.08, 3.2);
        const leafMesh = new THREE.Mesh(leafGeo, leafMat);
        leafMesh.position.set(0, 7.8, 1.2);
        leafMesh.rotation.y = (f * Math.PI) / 3;
        leafMesh.rotation.x = 0.4;
        palmGroup.add(leafMesh);
      }
      palmGroup.position.set(ROAD_TOTAL_WIDTH / 2 + 2.4, 0, z + 9);
      scene.add(palmGroup);
      sceneryObjects.push(palmGroup);
    }

    // 8. Construct Cockpit & Attach to Camera
    const { cockpitGroup, steeringWheelGroup } = create3DCockpitGroup();
    camera.add(cockpitGroup);
    scene.add(camera);

    // 9. Headlight Beams (Dual Spotlights)
    const headlightBeams: THREE.SpotLight[] = [];

    const spotLeft = new THREE.SpotLight(0xfff5ea, 6, 80, Math.PI / 6, 0.4, 1);
    spotLeft.position.set(-0.7, 0.7, -0.5);
    spotLeft.target.position.set(-0.7, 0, -40);
    cockpitGroup.add(spotLeft);
    cockpitGroup.add(spotLeft.target);
    headlightBeams.push(spotLeft);

    const spotRight = new THREE.SpotLight(0xfff5ea, 6, 80, Math.PI / 6, 0.4, 1);
    spotRight.position.set(0.7, 0.7, -0.5);
    spotRight.target.position.set(0.7, 0, -40);
    cockpitGroup.add(spotRight);
    cockpitGroup.add(spotRight.target);
    headlightBeams.push(spotRight);

    // 10. NPC Traffic Pool
    const trafficPool: NPCTrafficCar[] = [];
    const carTypes: ('sedan' | 'sport' | 'suv' | 'truck')[] = ['sedan', 'sport', 'suv', 'truck'];
    const carColors = [0xd97706, 0x2563eb, 0xd97706, 0x16a34a, 0xd946ef, 0xe11d48, 0x0284c7];

    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const type = carTypes[i % carTypes.length];
      const color = carColors[i % carColors.length];
      const { carGroup, wheels, tailLightMaterials } = create3DNPCCarMesh(type, color);

      const lane = i % LANES_COUNT;
      const x = LANE_POSITIONS[lane];
      const z = -60 - i * 35;
      carGroup.position.set(x, 0, z);
      scene.add(carGroup);

      trafficPool.push({
        mesh: carGroup,
        wheels,
        tailLightMaterials,
        x,
        z,
        lane,
        targetLane: lane,
        speedKmh: 75 + Math.random() * 45,
        type,
        color,
        isBraking: false,
        isYielding: false,
        active: true
      });
    }

    // 11. Sparks Particles for Crash Collision
    const sparkCount = 120;
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPos = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount * 3; i++) sparkPos[i] = 0;
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({ color: 0xffaa00, size: 0.25, transparent: true, opacity: 0 });
    const sparksParticles = new THREE.Points(sparkGeo, sparkMat);
    scene.add(sparksParticles);

    // Store Three.js instances
    threeRef.current = {
      scene,
      camera,
      renderer,
      cockpitGroup,
      steeringWheelGroup,
      roadPlane,
      laneLines,
      sceneryObjects,
      trafficPool,
      sunLight,
      headlightBeams,
      sparksParticles
    };

    // Window Resize Listener
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
  // CONTROLLER COMMAND LISTENER (Joystick X/Y & Buttons)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!controllerCommand) return;
    const cmd = controllerCommand;
    const s = gameStateRef.current;

    if (cmd.type === 'stick_move' && cmd.stick) {
      // Smooth Steering from Joystick X (-1 to 1)
      s.steerAngle = Math.max(-1, Math.min(1, cmd.stick.x * 1.25));

      // Acceleration / Brake from Joystick Y (-1 to 1)
      if (cmd.stick.y < -0.15) {
        s.isAccelerating = true;
        s.isBraking = false;
      } else if (cmd.stick.y > 0.18) {
        s.isBraking = true;
        s.isAccelerating = false;
      } else {
        s.isAccelerating = false;
        s.isBraking = false;
      }
    } else if (cmd.type === 'button_down') {
      if (cmd.button === 'LEFT') s.steerAngle = -1;
      if (cmd.button === 'RIGHT') s.steerAngle = 1;
      if (cmd.button === 'UP' || cmd.button === 'A' || cmd.button === 'X' || cmd.button === 'R1' || cmd.button === 'R2') {
        s.isAccelerating = true;
      }
      if (cmd.button === 'DOWN' || cmd.button === 'L1' || cmd.button === 'L2') {
        s.isBraking = true;
      }
      if (cmd.button === 'B' || cmd.button === 'Y') {
        // High beam strobe ("تكبيس")
        triggerHighBeamStrobe();
      }
      if (cmd.button === 'START') {
        if (s.isGameOver) {
          restartGame();
        } else {
          s.isPaused = !s.isPaused;
          setIsPaused(s.isPaused);
        }
      }
      if (cmd.button === 'SELECT') {
        onBackToMenu();
      }
    } else if (cmd.type === 'button_up') {
      if (cmd.button === 'LEFT' || cmd.button === 'RIGHT') s.steerAngle = 0;
      if (cmd.button === 'UP' || cmd.button === 'A' || cmd.button === 'X' || cmd.button === 'R1' || cmd.button === 'R2') {
        s.isAccelerating = false;
      }
      if (cmd.button === 'DOWN' || cmd.button === 'L1' || cmd.button === 'L2') {
        s.isBraking = false;
      }
    }
  }, [controllerCommand, onBackToMenu]);

  // -------------------------------------------------------------
  // KEYBOARD CONTROLLER FALLBACK FOR BROWSER PREVIEW
  // -------------------------------------------------------------
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
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'ArrowRight' || e.key === 'd') s.steerAngle = 0;
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

  // -------------------------------------------------------------
  // HIGH BEAM STROBE ACTION ("التكبيس")
  // -------------------------------------------------------------
  const triggerHighBeamStrobe = useCallback(() => {
    const s = gameStateRef.current;
    s.highBeamTimer = 0.5; // Strobe duration
    setIsHighBeaming(true);
    if (soundEnabled) sounds.playHighBeam();

    // AI Traffic reaction: Cars in front yield and switch lanes away!
    if (threeRef.current) {
      threeRef.current.trafficPool.forEach(car => {
        if (car.z < s.playerZ && car.z > s.playerZ - 120) {
          const distToPlayerX = Math.abs(car.x - s.playerX);
          if (distToPlayerX < LANE_WIDTH * 0.9) {
            car.isYielding = true;
            // Shift to open adjacent lane
            if (car.lane === 0) car.targetLane = 1;
            else if (car.lane === 3) car.targetLane = 2;
            else car.targetLane = s.playerX < car.x ? Math.min(3, car.lane + 1) : Math.max(0, car.lane - 1);
          }
        }
      });
    }
  }, [soundEnabled]);

  // -------------------------------------------------------------
  // RESTART GAME
  // -------------------------------------------------------------
  const restartGame = useCallback(() => {
    const s = gameStateRef.current;
    s.speedKmh = 100;
    s.playerX = LANE_POSITIONS[1];
    s.playerZ = 0;
    s.steerAngle = 0;
    s.isGameOver = false;
    s.isPaused = false;
    s.scoreAcc = 0;
    s.distanceAccKm = 0;
    s.comboMultiplier = 1;

    setIsGameOver(false);
    setIsPaused(false);
    setScore(0);
    setDistanceKm(0);
    setCombo(1);

    if (threeRef.current) {
      // Reset traffic positions
      threeRef.current.trafficPool.forEach((car, idx) => {
        car.lane = idx % LANES_COUNT;
        car.targetLane = car.lane;
        car.x = LANE_POSITIONS[car.lane];
        car.z = -60 - idx * 35;
        car.mesh.position.set(car.x, 0, car.z);
        car.isYielding = false;
      });
    }
  }, []);

  // -------------------------------------------------------------
  // MAIN THREE.JS 60FPS GAME LOOP
  // -------------------------------------------------------------
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const animate = (now: number) => {
      animationFrameId = requestAnimationFrame(animate);
      const dt = Math.min(0.1, (now - lastTime) / 1000); // Delta time in seconds
      lastTime = now;

      const s = gameStateRef.current;
      const t3 = threeRef.current;
      if (!t3 || s.isPaused || s.isGameOver) return;

      // 1. Acceleration & Speed Physics
      if (s.isAccelerating) {
        s.speedKmh = Math.min(MAX_SPEED_KMH, s.speedKmh + ACCEL_RATE * dt);
      } else if (s.isBraking) {
        s.speedKmh = Math.max(MIN_SPEED_KMH, s.speedKmh - BRAKE_RATE * dt);
      } else {
        s.speedKmh = Math.max(30, s.speedKmh - NATURAL_DECEL * dt);
      }

      // Convert speed from km/h to 3D world units per second
      const worldSpeed = (s.speedKmh / 3.6) * 0.45;

      // 2. Player Steering Physics (Smooth lateral movement)
      const steerSpeed = 11.5 * (0.6 + s.speedKmh / 200);
      s.playerX += s.steerAngle * steerSpeed * dt;
      // Clamp player X to road boundaries
      s.playerX = Math.max(-ROAD_TOTAL_WIDTH / 2 + 0.9, Math.min(ROAD_TOTAL_WIDTH / 2 - 0.9, s.playerX));

      // Update 3D Camera & Cockpit Position
      t3.camera.position.x = s.playerX - 0.4; // Camera follows car X
      t3.camera.rotation.z = -s.steerAngle * 0.06; // Cockpit roll during sharp steering

      // Rotate 3D Steering Wheel with steering input
      if (t3.steeringWheelGroup) {
        t3.steeringWheelGroup.rotation.z = -s.steerAngle * 2.2;
      }

      // 3. High Beam Timer & Spotlight Intensity
      if (s.highBeamTimer > 0) {
        s.highBeamTimer -= dt;
        t3.headlightBeams.forEach(spot => (spot.intensity = 18));
        if (s.highBeamTimer <= 0) {
          setIsHighBeaming(false);
          t3.headlightBeams.forEach(spot => (spot.intensity = 6));
        }
      }

      // 4. Update Road Markings & Scenery Scrolling
      const moveDistance = worldSpeed * dt * 25;

      t3.laneLines.forEach(line => {
        line.position.z += moveDistance;
        if (line.position.z > 20) {
          line.position.z -= ROAD_LENGTH;
        }
      });

      t3.sceneryObjects.forEach(obj => {
        obj.position.z += moveDistance;
        if (obj.position.z > 20) {
          obj.position.z -= ROAD_LENGTH;
        }
      });

      // 5. Update NPC Traffic Cars
      t3.trafficPool.forEach(car => {
        // Traffic speed relative to player
        const trafficWorldSpeed = (car.speedKmh / 3.6) * 0.45;
        const relativeSpeed = worldSpeed - trafficWorldSpeed;
        car.z += relativeSpeed * dt * 25;

        // Smooth lane change for AI traffic
        const targetX = LANE_POSITIONS[car.targetLane];
        if (Math.abs(car.x - targetX) > 0.05) {
          car.x += Math.sign(targetX - car.x) * dt * 3.5;
        } else {
          car.x = targetX;
          car.lane = car.targetLane;
        }

        car.mesh.position.set(car.x, 0, car.z);

        // Physically rotate 3D wheels as traffic car moves
        car.wheels.forEach(wheel => {
          wheel.rotation.x += trafficWorldSpeed * dt * 4;
        });

        // Respawn NPC traffic ahead when passed
        if (car.z > 30) {
          car.z -= 320 + Math.random() * 80;
          car.lane = Math.floor(Math.random() * LANES_COUNT);
          car.targetLane = car.lane;
          car.x = LANE_POSITIONS[car.lane];
          car.speedKmh = 70 + Math.random() * 50;
          car.isYielding = false;
        }

        // 6. Collision Detection with Player (First-Person Bounding Box)
        const dx = Math.abs(car.x - s.playerX);
        const dz = Math.abs(car.z - 0.2); // Player cockpit is around z=0.2

        if (dx < 1.6 && dz < 2.4) {
          // CRASH COLLISION DETECTED!
          s.isGameOver = true;
          setIsGameOver(true);
          if (soundEnabled) sounds.playAlert();

          // Save High Score
          if (s.scoreAcc > highScore) {
            setHighScore(Math.floor(s.scoreAcc));
            localStorage.setItem('sunset_drive_3d_highscore', Math.floor(s.scoreAcc).toString());
          }
        }

        // Near-Miss Overtake Detection for Bonus Combo Points
        if (dz < 1.8 && dx > 1.6 && dx < 2.8 && now - s.lastNearMissTime > 1800) {
          s.lastNearMissTime = now;
          s.comboMultiplier = Math.min(8, s.comboMultiplier + 1);
          s.comboTimer = 3.0;
          setCombo(s.comboMultiplier);
          setNearMissAlert(`تجاوز خطر! +${s.comboMultiplier * 150} نقطة`);
          setTimeout(() => setNearMissAlert(null), 1200);
          if (soundEnabled) sounds.playCollect();
        }
      });

      // Update Combo Timer
      if (s.comboTimer > 0) {
        s.comboTimer -= dt;
        if (s.comboTimer <= 0) {
          s.comboMultiplier = 1;
          setCombo(1);
        }
      }

      // Update Score & Distance Metrics
      s.distanceAccKm += (worldSpeed * dt * 0.08);
      s.scoreAcc += (s.speedKmh / 10) * dt * 15 * s.comboMultiplier;

      // Sync React State every ~6 frames for crisp HUD
      setCurrentSpeed(Math.round(s.speedKmh));
      setDistanceKm(parseFloat(s.distanceAccKm.toFixed(1)));
      setScore(Math.floor(s.scoreAcc));

      // Render 3D Scene
      t3.renderer.render(t3.scene, t3.camera);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [highScore, soundEnabled]);

  return (
    <div className="w-screen h-screen bg-slate-950 text-white select-none overflow-hidden relative font-sans" dir="rtl">
      {/* Three.js 3D Canvas Container */}
      <div ref={containerRef} className="w-full h-full absolute inset-0 z-0" />

      {/* =========================================
          3D COCKPIT HUD OVERLAY (طبلون زجاجي حديث)
         ========================================= */}
      <div className="relative z-10 w-full h-full pointer-events-none flex flex-col justify-between p-6">
        {/* Top Header Metrics Bar */}
        <div className="w-full flex items-center justify-between">
          {/* Speedometer & Gear Badge */}
          <div className="flex items-center gap-4 bg-slate-900/80 border border-slate-700/80 rounded-2xl px-5 py-3 backdrop-blur-md shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-indigo-600/30 border border-indigo-400/50 flex items-center justify-center text-indigo-300">
              <Gauge className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">السرعة الحالية</div>
              <div className="text-3xl font-black font-mono text-white flex items-baseline gap-1">
                <span>{currentSpeed}</span>
                <span className="text-xs text-indigo-400 font-bold">كم/س</span>
              </div>
            </div>
          </div>

          {/* Near Miss Combo Alert Banner */}
          {nearMissAlert && (
            <div className="px-6 py-2.5 rounded-2xl bg-amber-500 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/40 animate-bounce flex items-center gap-2 border border-amber-300">
              <Zap className="w-5 h-5 fill-current" />
              <span>{nearMissAlert}</span>
            </div>
          )}

          {/* Distance & Score Cards */}
          <div className="flex items-center gap-3">
            <div className="bg-slate-900/80 border border-slate-700/80 rounded-2xl px-4 py-2.5 backdrop-blur-md text-right">
              <div className="text-[10px] text-slate-400 font-mono">المسافة المقطوعة</div>
              <div className="text-xl font-black font-mono text-emerald-400">{distanceKm} كم</div>
            </div>

            <div className="bg-slate-900/80 border border-indigo-500/50 rounded-2xl px-5 py-2.5 backdrop-blur-md text-right shadow-lg shadow-indigo-950/50">
              <div className="text-[10px] text-indigo-300 font-mono font-bold">النقاط الكلية</div>
              <div className="text-2xl font-black font-mono text-white">{score}</div>
            </div>
          </div>
        </div>

        {/* Cockpit Status Indicators (High Beam "التكبيس" Badge & Controls Hint) */}
        <div className="w-full flex items-end justify-between">
          {/* High Beam Strobe Active Badge */}
          <div className="flex items-center gap-3">
            {isHighBeaming && (
              <div className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-amber-400/50 animate-pulse border border-amber-200">
                <Lightbulb className="w-4 h-4 fill-current" />
                <span>تكبيس الإضاءة نشط (إفساح الطريق)</span>
              </div>
            )}
          </div>

          {/* Controller Controls Guide Hint */}
          <div className="pointer-events-auto flex items-center gap-3 bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-2.5 text-xs text-slate-300 font-mono backdrop-blur-md">
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded bg-indigo-950 border border-indigo-500/50 text-indigo-300 font-bold">عصا التحكم / الأسهم</span>
              <span>توجيه وتسارع</span>
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded bg-amber-950 border border-amber-500/50 text-amber-300 font-bold">زر [B / Y]</span>
              <span>تكبيس الإضاءة</span>
            </div>
            <span className="text-slate-600">|</span>
            <button
              type="button"
              onClick={onBackToMenu}
              className="px-3 py-1 rounded-xl bg-rose-600/30 hover:bg-rose-600 text-rose-300 font-bold text-xs border border-rose-500/40 transition-colors"
            >
              الخروج [SELECT]
            </button>
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

      {/* GAME OVER CRASH OVERLAY */}
      {isGameOver && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-lg flex items-center justify-center p-6 text-center select-none animate-in fade-in duration-300" dir="rtl">
          <div className="max-w-md w-full bg-slate-900 border-2 border-rose-500/60 rounded-3xl p-8 shadow-2xl shadow-rose-950/80 space-y-6 relative overflow-hidden">
            <div className="w-16 h-16 rounded-2xl bg-rose-600/20 border border-rose-500/40 mx-auto flex items-center justify-center text-rose-400">
              <CarIcon className="w-8 h-8 animate-bounce" />
            </div>

            <div className="space-y-2">
              <h2 className="text-3xl font-black text-white">حدث تصادم!</h2>
              <p className="text-xs text-slate-400">اصطدمت بسيارة أخرى على طريق الغروب السريع.</p>
            </div>

            {/* Score Summary Box */}
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

            {/* Action Buttons */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={restartGame}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-sm shadow-xl shadow-indigo-600/40 border border-indigo-400/40 transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>إعادة اللعب فوراً [زر A / X / START]</span>
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
