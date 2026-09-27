import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  Gauge,
  Car as CarIcon,
  Sparkles,
  Zap,
  RotateCcw,
  Lightbulb
} from 'lucide-react';
import { sounds } from './soundFx';

interface SunsetHighwayGameProps {
  onBackToMenu: () => void;
  controllerCommand?: any;
}

// -------------------------------------------------------------
// CONFIGURATION & CONSTANTS
// -------------------------------------------------------------
const LANE_WIDTH = 3.6; // Highway lane width in 3D units
const LANES_COUNT = 4;
const ROAD_TOTAL_WIDTH = LANE_WIDTH * LANES_COUNT; // 14.4 units
const LANE_POSITIONS = [-5.4, -1.8, 1.8, 5.4]; // Center of lanes 0, 1, 2, 3

const MAX_SPEED_KMH = 130; // Relaxed max speed
const MIN_SPEED_KMH = 0;
const ACCEL_RATE = 35; // Gentle acceleration
const BRAKE_RATE = 85;
const NATURAL_DECEL = 14;

const ROAD_LENGTH = 450; // Visible road length along Z axis
const TRAFFIC_COUNT = 10;

interface NPCTrafficCar {
  mesh: THREE.Group;
  wheels: THREE.Mesh[];
  x: number;
  z: number;
  lane: number;
  targetLane: number;
  speedKmh: number;
  type: 'sedan' | 'sport' | 'suv' | 'truck';
  color: number;
  isYielding: boolean;
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
  const [currentSpeed, setCurrentSpeed] = useState(60); // km/h
  const [combo, setCombo] = useState(1);
  const [nearMissAlert, setNearMissAlert] = useState<string | null>(null);
  const [isHighBeaming, setIsHighBeaming] = useState(false);

  // Gameplay Loop State Ref
  const gameStateRef = useRef({
    speedKmh: 60, // Starting velocity
    playerX: LANE_POSITIONS[1], // Start in lane 1 (-1.8)
    steerAngle: 0, // -1 (left) to +1 (right)
    smoothSteer: 0, // Damped smooth steering
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
    roadPlane: THREE.Mesh;
    laneLines: THREE.Mesh[];
    sceneryObjects: THREE.Group[];
    trafficPool: NPCTrafficCar[];
    headlightBeams: THREE.SpotLight[];
  } | null>(null);

  // -------------------------------------------------------------
  // HELPER: BUILD NPC 3D CAR MESH (Clean Geometry & Metallic Finish)
  // -------------------------------------------------------------
  const create3DNPCCarMesh = (type: 'sedan' | 'sport' | 'suv' | 'truck', bodyColorHex: number) => {
    const carGroup = new THREE.Group();

    let bodyW = 1.8, bodyH = 0.85, bodyL = 4.2, cabinH = 0.65, cabinL = 2.2;
    if (type === 'suv') {
      bodyW = 1.95; bodyH = 1.05; bodyL = 4.5; cabinH = 0.75; cabinL = 2.5;
    } else if (type === 'truck') {
      bodyW = 2.1; bodyH = 1.2; bodyL = 5.2; cabinH = 0.85; cabinL = 2.0;
    } else if (type === 'sport') {
      bodyW = 1.85; bodyH = 0.72; bodyL = 4.0; cabinH = 0.55; cabinL = 1.9;
    }

    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColorHex,
      metalness: 0.8,
      roughness: 0.2
    });

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.9,
      roughness: 0.1
    });

    // Lower Body
    const bodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyL);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = bodyH / 2 + 0.35;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    carGroup.add(bodyMesh);

    // Cabin / Windows
    const cabinGeo = new THREE.BoxGeometry(bodyW * 0.88, cabinH, cabinL);
    const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
    cabinMesh.position.set(0, bodyH + cabinH / 2 + 0.3, -0.2);
    carGroup.add(cabinMesh);

    // Headlights (Front - facing negative Z)
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
    const hlGeo = new THREE.BoxGeometry(0.35, 0.15, 0.1);
    const hlLeft = new THREE.Mesh(hlGeo, hlMat);
    hlLeft.position.set(-bodyW / 2 + 0.25, bodyH * 0.6 + 0.35, -bodyL / 2 - 0.02);
    carGroup.add(hlLeft);

    const hlRight = new THREE.Mesh(hlGeo, hlMat);
    hlRight.position.set(bodyW / 2 - 0.25, bodyH * 0.6 + 0.35, -bodyL / 2 - 0.02);
    carGroup.add(hlRight);

    // Taillights (Rear - facing positive Z)
    const tlMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xcc0000 });
    const tlGeo = new THREE.BoxGeometry(0.4, 0.16, 0.1);
    const tlLeft = new THREE.Mesh(tlGeo, tlMat);
    tlLeft.position.set(-bodyW / 2 + 0.3, bodyH * 0.65 + 0.35, bodyL / 2 + 0.02);
    carGroup.add(tlLeft);

    const tlRight = new THREE.Mesh(tlGeo, tlMat);
    tlRight.position.set(bodyW / 2 - 0.3, bodyH * 0.65 + 0.35, bodyL / 2 + 0.02);
    carGroup.add(tlRight);

    // 4 Wheels
    const wheels: THREE.Mesh[] = [];
    const wheelRadius = 0.35;
    const wheelWidth = 0.22;
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.8 });

    const wheelPositions = [
      { x: -bodyW / 2 - 0.02, z: -bodyL / 2 + 0.8 },
      { x: bodyW / 2 + 0.02, z: -bodyL / 2 + 0.8 },
      { x: -bodyW / 2 - 0.02, z: bodyL / 2 - 0.8 },
      { x: bodyW / 2 + 0.02, z: bodyL / 2 - 0.8 }
    ];

    wheelPositions.forEach(pos => {
      const wheelMesh = new THREE.Mesh(wheelGeo, tireMat);
      wheelMesh.position.set(pos.x, wheelRadius, pos.z);
      wheelMesh.castShadow = true;
      carGroup.add(wheelMesh);
      wheels.push(wheelMesh);
    });

    return { carGroup, wheels };
  };

  // -------------------------------------------------------------
  // BUILD LUXURY PLAYER COCKPIT (Curved Interior, LED Strip & Leather Seats)
  // -------------------------------------------------------------
  const buildPlayerCockpit = (playerCarGroup: THREE.Group, camera: THREE.PerspectiveCamera) => {
    // 1. Camera at Driver's Head Position inside playerCarGroup
    camera.position.set(-0.34, 1.18, -0.12);
    camera.rotation.set(0, 0, 0); // Looking straight forward along -Z axis
    camera.up.set(0, 1, 0);
    playerCarGroup.add(camera);

    // Luxury Leather & Metal Materials
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.75, metalness: 0.15 });
    const consoleMat = new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.4, metalness: 0.6 });
    const aluminumMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.95, roughness: 0.05 });
    const ledAmbientMat = new THREE.MeshBasicMaterial({ color: 0x818cf8 }); // Calm Indigo LED strip

    // 2. Main Dashboard (Smooth Horizontal Cylinder Surface - No Sharp Boxes)
    const dashUpperGeo = new THREE.CylinderGeometry(0.32, 0.38, 2.3, 32);
    dashUpperGeo.rotateZ(Math.PI / 2);
    const dashUpperMesh = new THREE.Mesh(dashUpperGeo, leatherMat);
    dashUpperMesh.position.set(0, 0.72, -0.78);
    playerCarGroup.add(dashUpperMesh);

    // Lower Center Console Tapering Down
    const consoleGeo = new THREE.CylinderGeometry(0.2, 0.35, 0.8, 24);
    const consoleMesh = new THREE.Mesh(consoleGeo, consoleMat);
    consoleMesh.position.set(0, 0.35, -0.7);
    playerCarGroup.add(consoleMesh);

    // Aluminum Trim Bar Running Across Dashboard
    const trimGeo = new THREE.CylinderGeometry(0.015, 0.015, 2.3, 16);
    trimGeo.rotateZ(Math.PI / 2);
    const trimMesh = new THREE.Mesh(trimGeo, aluminumMat);
    trimMesh.position.set(0, 0.68, -0.72);
    playerCarGroup.add(trimMesh);

    // Ambient LED Strip Accent Light
    const ledStripGeo = new THREE.CylinderGeometry(0.01, 0.01, 2.2, 16);
    ledStripGeo.rotateZ(Math.PI / 2);
    const ledStripMesh = new THREE.Mesh(ledStripGeo, ledAmbientMat);
    ledStripMesh.position.set(0, 0.66, -0.71);
    playerCarGroup.add(ledStripMesh);

    // Instrument Cluster Hood (Behind Steering Wheel)
    const hoodGeo = new THREE.CylinderGeometry(0.38, 0.42, 0.75, 24, 1, false, 0, Math.PI);
    hoodGeo.rotateZ(Math.PI / 2);
    const hoodMesh = new THREE.Mesh(hoodGeo, leatherMat);
    hoodMesh.position.set(-0.34, 0.82, -0.62);
    playerCarGroup.add(hoodMesh);

    // Curved Speedometer Display Screen
    const gaugeCanvas = document.createElement('canvas');
    gaugeCanvas.width = 256; gaugeCanvas.height = 128;
    const ctx = gaugeCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = '#818cf8';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(128, 95, 68, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 24px monospace';
      ctx.fillText('CRUISE 3D', 65, 42);
    }
    const gaugeTex = new THREE.CanvasTexture(gaugeCanvas);
    const gaugeMat = new THREE.MeshBasicMaterial({ map: gaugeTex });
    const gaugeMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.22), gaugeMat);
    gaugeMesh.position.set(-0.34, 0.81, -0.52);
    gaugeMesh.rotation.x = -0.2;
    playerCarGroup.add(gaugeMesh);

    // Center Infotainment Touch Screen
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
    const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.22), screenMat);
    screenMesh.position.set(0.18, 0.76, -0.55);
    screenMesh.rotation.x = -0.15;
    playerCarGroup.add(screenMesh);

    // 3. High-End Sport Steering Wheel Group
    const steeringWheelGroup = new THREE.Group();
    steeringWheelGroup.position.set(-0.34, 0.81, -0.48);
    steeringWheelGroup.rotation.x = -0.2; // Tilted toward driver

    // Leather Wheel Outer Ring
    const wheelRimGeo = new THREE.TorusGeometry(0.21, 0.035, 20, 48);
    const wheelRimMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.6, metalness: 0.3 });
    const wheelRimMesh = new THREE.Mesh(wheelRimGeo, wheelRimMat);
    steeringWheelGroup.add(wheelRimMesh);

    // Inner Polished Silver Ring
    const wheelInnerRingGeo = new THREE.TorusGeometry(0.17, 0.008, 16, 32);
    const wheelInnerRingMesh = new THREE.Mesh(wheelInnerRingGeo, aluminumMat);
    steeringWheelGroup.add(wheelInnerRingMesh);

    // Central Emblem Badge Hub
    const hubCapGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.03, 32);
    hubCapGeo.rotateX(Math.PI / 2);
    const hubCapMat = new THREE.MeshStandardMaterial({ color: 0x312e81, metalness: 0.9, roughness: 0.1 });
    const hubCapMesh = new THREE.Mesh(hubCapGeo, hubCapMat);
    steeringWheelGroup.add(hubCapMesh);

    // 3 Aluminum Spokes
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0xc0c6d4, metalness: 0.92, roughness: 0.1 });
    const spokeGeo = new THREE.BoxGeometry(0.032, 0.14, 0.015);

    const spokeBottom = new THREE.Mesh(spokeGeo, spokeMat);
    spokeBottom.position.set(0, -0.09, 0);
    steeringWheelGroup.add(spokeBottom);

    const spokeLeft = new THREE.Mesh(spokeGeo, spokeMat);
    spokeLeft.position.set(-0.09, 0.02, 0);
    spokeLeft.rotation.z = Math.PI / 3;
    steeringWheelGroup.add(spokeLeft);

    const spokeRight = new THREE.Mesh(spokeGeo, spokeMat);
    spokeRight.position.set(0.09, 0.02, 0);
    spokeRight.rotation.z = -Math.PI / 3;
    steeringWheelGroup.add(spokeRight);

    // Steering Wheel Paddle Shifters (Left & Right)
    const paddleGeo = new THREE.BoxGeometry(0.025, 0.09, 0.01);
    const paddleLeft = new THREE.Mesh(paddleGeo, aluminumMat);
    paddleLeft.position.set(-0.16, 0.02, -0.02);
    steeringWheelGroup.add(paddleLeft);

    const paddleRight = new THREE.Mesh(paddleGeo, aluminumMat);
    paddleRight.position.set(0.16, 0.02, -0.02);
    steeringWheelGroup.add(paddleRight);

    playerCarGroup.add(steeringWheelGroup);

    // 4. Smooth Aerodynamic Car Bonnet / Hood (Curved Surface)
    const bonnetGeo = new THREE.CylinderGeometry(0.9, 0.98, 2.0, 32, 1, false, 0, Math.PI);
    bonnetGeo.rotateZ(Math.PI / 2);
    const bonnetMat = new THREE.MeshStandardMaterial({ color: 0x1e1b4b, metalness: 0.92, roughness: 0.08 });
    const bonnetMesh = new THREE.Mesh(bonnetGeo, bonnetMat);
    bonnetMesh.position.set(0, 0.38, -1.8);
    playerCarGroup.add(bonnetMesh);

    // 5. Driver & Passenger Leather Sport Seats (In Peripheral View)
    const seatHeadrestGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.22, 16);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x020617, roughness: 0.8 });

    // Driver Seat Backrest
    const driverHeadrest = new THREE.Mesh(seatHeadrestGeo, seatMat);
    driverHeadrest.position.set(-0.34, 1.15, 0.25);
    playerCarGroup.add(driverHeadrest);

    // Passenger Seat Backrest
    const passengerHeadrest = new THREE.Mesh(seatHeadrestGeo, seatMat);
    passengerHeadrest.position.set(0.34, 1.15, 0.25);
    playerCarGroup.add(passengerHeadrest);

    // 6. Rearview Mirror (Center top)
    const mirrorMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.34, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.15 })
    );
    mirrorMesh.rotateZ(Math.PI / 2);
    mirrorMesh.position.set(0, 1.42, -0.45);
    playerCarGroup.add(mirrorMesh);

    // 7. Dual Headlight Beams
    const headlightBeams: THREE.SpotLight[] = [];

    const spotLeft = new THREE.SpotLight(0xfff5ea, 5, 90, Math.PI / 6, 0.4, 1);
    spotLeft.position.set(-0.7, 0.5, -1.2);
    spotLeft.target.position.set(-0.7, 0, -50);
    playerCarGroup.add(spotLeft);
    playerCarGroup.add(spotLeft.target);
    headlightBeams.push(spotLeft);

    const spotRight = new THREE.SpotLight(0xfff5ea, 5, 90, Math.PI / 6, 0.4, 1);
    spotRight.position.set(0.7, 0.5, -1.2);
    spotRight.target.position.set(0.7, 0, -50);
    playerCarGroup.add(spotRight);
    playerCarGroup.add(spotRight.target);
    headlightBeams.push(spotRight);

    return { steeringWheelGroup, headlightBeams };
  };

  // -------------------------------------------------------------
  // INITIALIZE THREE.JS SCENE
  // -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene & Sunset Fog
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf97316); // Bright Sunset Sky
    scene.fog = new THREE.FogExp2(0xe0561b, 0.007); // Warm Sunset Atmospheric Fog

    // 2. Camera Setup (First-Person Perspective)
    const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 1000);

    // 3. Renderer Setup (Clean Antialiasing & Pixel Ratio)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // 4. Player Vehicle Parent Group
    const playerCarGroup = new THREE.Group();
    playerCarGroup.position.set(LANE_POSITIONS[1], 0, 0); // Start in lane 1
    scene.add(playerCarGroup);

    // Attach Cockpit & Camera to playerCarGroup
    const { steeringWheelGroup, headlightBeams } = buildPlayerCockpit(playerCarGroup, camera);

    // 5. Lighting (Low-angle Sunset Light + Shadows)
    const sunLight = new THREE.DirectionalLight(0xffb077, 2.5);
    sunLight.position.set(35, 25, -120);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 350;
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0x604060, 0.9);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xff7744, 0x221133, 0.8);
    scene.add(hemiLight);

    // 6. 3D Highway Road Plane
    const roadPlaneGeo = new THREE.PlaneGeometry(ROAD_TOTAL_WIDTH + 8, ROAD_LENGTH);
    const roadPlaneMat = new THREE.MeshStandardMaterial({
      color: 0x1e2028,
      roughness: 0.5,
      metalness: 0.2
    });
    const roadPlane = new THREE.Mesh(roadPlaneGeo, roadPlaneMat);
    roadPlane.rotation.x = -Math.PI / 2;
    roadPlane.position.set(0, 0, -ROAD_LENGTH / 2 + 20);
    roadPlane.receiveShadow = true;
    scene.add(roadPlane);

    // Shoulder Guardrails
    const guardMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
    const guardGeo = new THREE.BoxGeometry(0.6, 0.5, ROAD_LENGTH);

    const guardLeft = new THREE.Mesh(guardGeo, guardMat);
    guardLeft.position.set(-ROAD_TOTAL_WIDTH / 2 - 0.3, 0.25, -ROAD_LENGTH / 2 + 20);
    scene.add(guardLeft);

    const guardRight = new THREE.Mesh(guardGeo, guardMat);
    guardRight.position.set(ROAD_TOTAL_WIDTH / 2 + 0.3, 0.25, -ROAD_LENGTH / 2 + 20);
    scene.add(guardRight);

    // Dashed Lane Lines
    const laneLines: THREE.Mesh[] = [];
    const laneLineGeo = new THREE.BoxGeometry(0.18, 0.02, 3.8);
    const laneLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    [-1.8, 0, 1.8].forEach(lineX => {
      for (let z = -ROAD_LENGTH + 20; z < 20; z += 9) {
        const lineMesh = new THREE.Mesh(laneLineGeo, laneLineMat);
        lineMesh.position.set(lineX, 0.02, z);
        scene.add(lineMesh);
        laneLines.push(lineMesh);
      }
    });

    // 7. Scenery (3D Palm Trees & Street Lamps)
    const sceneryObjects: THREE.Group[] = [];
    for (let z = -ROAD_LENGTH + 20; z < 20; z += 20) {
      // Left Lamp
      const lampGroup = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.14, 7, 10),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 })
      );
      pole.position.y = 3.5;
      lampGroup.add(pole);

      const lampHead = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.2, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xfcb338 })
      );
      lampHead.position.set(0.5, 7, 0);
      lampGroup.add(lampHead);

      lampGroup.position.set(-ROAD_TOTAL_WIDTH / 2 - 1.8, 0, z);
      scene.add(lampGroup);
      sceneryObjects.push(lampGroup);

      // Right Palm Tree
      const palmGroup = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.4, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 })
      );
      trunk.position.y = 4;
      palmGroup.add(trunk);

      const leafMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 });
      for (let f = 0; f < 6; f++) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 3.2), leafMat);
        leaf.position.set(0, 7.8, 1.2);
        leaf.rotation.y = (f * Math.PI) / 3;
        leaf.rotation.x = 0.4;
        palmGroup.add(leaf);
      }
      palmGroup.position.set(ROAD_TOTAL_WIDTH / 2 + 2.4, 0, z + 10);
      scene.add(palmGroup);
      sceneryObjects.push(palmGroup);
    }

    // 8. NPC Traffic Pool
    const trafficPool: NPCTrafficCar[] = [];
    const carTypes: ('sedan' | 'sport' | 'suv' | 'truck')[] = ['sedan', 'sport', 'suv', 'truck'];
    const carColors = [0xd97706, 0x2563eb, 0x16a34a, 0xd946ef, 0xe11d48, 0x0284c7];

    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const type = carTypes[i % carTypes.length];
      const color = carColors[i % carColors.length];
      const { carGroup, wheels } = create3DNPCCarMesh(type, color);

      const lane = i % LANES_COUNT;
      const x = LANE_POSITIONS[lane];
      const z = -70 - i * 38;
      carGroup.position.set(x, 0, z);
      scene.add(carGroup);

      trafficPool.push({
        mesh: carGroup,
        wheels,
        x,
        z,
        lane,
        targetLane: lane,
        speedKmh: 65 + Math.random() * 35,
        type,
        color,
        isYielding: false
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
      sceneryObjects,
      trafficPool,
      headlightBeams
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
  // CONTROLLER COMMAND LISTENERS
  // -------------------------------------------------------------
  useEffect(() => {
    if (!controllerCommand) return;
    const cmd = controllerCommand;
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
  }, [controllerCommand, onBackToMenu]);

  // Keyboard controls for browser testing
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
        if (car.z < 0 && car.z > -120) {
          if (Math.abs(car.x - s.playerX) < LANE_WIDTH * 0.9) {
            car.isYielding = true;
            if (car.lane === 0) car.targetLane = 1;
            else if (car.lane === 3) car.targetLane = 2;
            else car.targetLane = s.playerX < car.x ? Math.min(3, car.lane + 1) : Math.max(0, car.lane - 1);
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
    setCombo(1);

    if (threeRef.current) {
      threeRef.current.playerCarGroup.position.x = s.playerX;
      threeRef.current.trafficPool.forEach((car, idx) => {
        car.lane = idx % LANES_COUNT;
        car.targetLane = car.lane;
        car.x = LANE_POSITIONS[car.lane];
        car.z = -70 - idx * 38;
        car.mesh.position.set(car.x, 0, car.z);
        car.isYielding = false;
      });
    }
  }, []);

  // -------------------------------------------------------------
  // CONTINUOUS 60FPS FRAME LOOP
  // -------------------------------------------------------------
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const animate = (now: number) => {
      animationFrameId = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - lastTime) / 1000); // Clamped delta time
      lastTime = now;

      const s = gameStateRef.current;
      const t3 = threeRef.current;
      if (!t3 || s.isPaused || s.isGameOver) return;

      // 1. Velocity Physics (Smooth Acceleration/Deceleration)
      if (s.isAccelerating) {
        s.speedKmh = Math.min(MAX_SPEED_KMH, s.speedKmh + ACCEL_RATE * dt);
      } else if (s.isBraking) {
        s.speedKmh = Math.max(MIN_SPEED_KMH, s.speedKmh - BRAKE_RATE * dt);
      } else {
        s.speedKmh = Math.max(20, s.speedKmh - NATURAL_DECEL * dt);
      }

      // World movement speed (40% lower for relaxed driving)
      const worldSpeed = (s.speedKmh / 3.6) * 0.22;

      // 2. Smooth Steering Movement
      s.smoothSteer += (s.steerAngle - s.smoothSteer) * Math.min(1, dt * 6.5);
      const steerSpeed = 5.0 * (0.8 + s.speedKmh / 160);
      s.playerX += s.smoothSteer * steerSpeed * dt;
      s.playerX = Math.max(-ROAD_TOTAL_WIDTH / 2 + 1.0, Math.min(ROAD_TOTAL_WIDTH / 2 - 1.0, s.playerX));

      // Update Player Car Group Position
      t3.playerCarGroup.position.x = s.playerX;

      // Steering Wheel Rotation
      if (t3.steeringWheelGroup) {
        t3.steeringWheelGroup.rotation.z = -s.smoothSteer * 2.0;
      }

      // 3. High Beam Spotlight Intensity
      if (s.highBeamTimer > 0) {
        s.highBeamTimer -= dt;
        t3.headlightBeams.forEach(spot => (spot.intensity = 15));
        if (s.highBeamTimer <= 0) {
          setIsHighBeaming(false);
          t3.headlightBeams.forEach(spot => (spot.intensity = 5));
        }
      }

      // 4. Update Road Markings & Scenery Scroll
      const moveDistance = worldSpeed * dt * 25;

      t3.laneLines.forEach(line => {
        line.position.z += moveDistance;
        if (line.position.z > 20) line.position.z -= ROAD_LENGTH;
      });

      t3.sceneryObjects.forEach(obj => {
        obj.position.z += moveDistance;
        if (obj.position.z > 20) obj.position.z -= ROAD_LENGTH;
      });

      // 5. Update NPC Traffic Cars
      t3.trafficPool.forEach(car => {
        const trafficWorldSpeed = (car.speedKmh / 3.6) * 0.22;
        const relativeSpeed = worldSpeed - trafficWorldSpeed;
        car.z += relativeSpeed * dt * 25;

        // Smooth Lane Transition for AI
        const targetX = LANE_POSITIONS[car.targetLane];
        if (Math.abs(car.x - targetX) > 0.05) {
          car.x += Math.sign(targetX - car.x) * dt * 3.2;
        } else {
          car.x = targetX;
          car.lane = car.targetLane;
        }

        car.mesh.position.set(car.x, 0, car.z);

        // Rotate Wheels
        car.wheels.forEach(wheel => {
          wheel.rotation.x += trafficWorldSpeed * dt * 4;
        });

        // Respawn Traffic Ahead
        if (car.z > 30) {
          car.z -= 320 + Math.random() * 80;
          car.lane = Math.floor(Math.random() * LANES_COUNT);
          car.targetLane = car.lane;
          car.x = LANE_POSITIONS[car.lane];
          car.speedKmh = 60 + Math.random() * 35;
          car.isYielding = false;
        }

        // Collision Check (Player Car is at s.playerX, z = 0)
        const dx = Math.abs(car.x - s.playerX);
        const dz = Math.abs(car.z);

        if (dx < 1.55 && dz < 2.2) {
          s.isGameOver = true;
          setIsGameOver(true);
          sounds.playAlert();

          if (s.scoreAcc > highScore) {
            setHighScore(Math.floor(s.scoreAcc));
            localStorage.setItem('sunset_drive_3d_highscore', Math.floor(s.scoreAcc).toString());
          }
        }

        // Near Miss Bonus
        if (dz < 1.8 && dx > 1.55 && dx < 2.7 && now - s.lastNearMissTime > 1800) {
          s.lastNearMissTime = now;
          s.comboMultiplier = Math.min(8, s.comboMultiplier + 1);
          s.comboTimer = 3.0;
          setCombo(s.comboMultiplier);
          setNearMissAlert(`تجاوز خطر! +${s.comboMultiplier * 150} نقطة`);
          setTimeout(() => setNearMissAlert(null), 1200);
          sounds.playCollect();
        }
      });

      // Combo Decay
      if (s.comboTimer > 0) {
        s.comboTimer -= dt;
        if (s.comboTimer <= 0) {
          s.comboMultiplier = 1;
          setCombo(1);
        }
      }

      // Metrics
      s.distanceAccKm += (worldSpeed * dt * 0.08);
      s.scoreAcc += (s.speedKmh / 10) * dt * 15 * s.comboMultiplier;

      setCurrentSpeed(Math.round(s.speedKmh));
      setDistanceKm(parseFloat(s.distanceAccKm.toFixed(1)));
      setScore(Math.floor(s.scoreAcc));

      // Render 3D Scene
      t3.renderer.render(t3.scene, t3.camera);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [highScore]);

  return (
    <div className="w-screen h-screen bg-slate-950 text-white select-none overflow-hidden relative font-sans" dir="rtl">
      {/* 3D Canvas Container */}
      <div ref={containerRef} className="w-full h-full absolute inset-0 z-0" />

      {/* COCKPIT HUD OVERLAY */}
      <div className="relative z-10 w-full h-full pointer-events-none flex flex-col justify-between p-6">
        {/* Top Header Metrics Bar */}
        <div className="w-full flex items-center justify-between">
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

          {nearMissAlert && (
            <div className="px-6 py-2.5 rounded-2xl bg-amber-500 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/40 animate-bounce flex items-center gap-2 border border-amber-300">
              <Zap className="w-5 h-5 fill-current" />
              <span>{nearMissAlert}</span>
            </div>
          )}

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

        {/* Bottom Bar */}
        <div className="w-full flex items-end justify-between">
          <div className="flex items-center gap-3">
            {isHighBeaming && (
              <div className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-amber-400/50 animate-pulse border border-amber-200">
                <Lightbulb className="w-4 h-4 fill-current" />
                <span>تكبيس الإضاءة نشط</span>
              </div>
            )}
          </div>

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

      {/* GAME OVER MODAL OVERLAY */}
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
