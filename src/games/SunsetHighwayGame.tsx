import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  RotateCcw,
  Play,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Flame,
  Sun,
  Pause,
  ArrowRight,
  Compass,
  Eye,
  Circle
} from 'lucide-react';
import { sounds } from './soundFx';
import { engineAudio } from './engineAudio';
import { controllerBus } from '../services/controllerBus';

interface SunsetHighwayGameProps {
  onBackToMenu: () => void;
  controllerCommand?: any;
  showTouchControls?: boolean;
}

// -------------------------------------------------------------
// GAMEPLAY CONFIGURATION (Balanced Realistic Cruising)
// -------------------------------------------------------------
const LANES_COUNT = 4;
const LANE_WIDTH = 3.6;
const ROAD_TOTAL_WIDTH = LANE_WIDTH * LANES_COUNT; // 14.4 units
const LANE_POSITIONS = [-5.4, -1.8, 1.8, 5.4];

const MAX_SPEED_KMH = 120;
const MIN_SPEED_KMH = 30;
const BASE_CRUISE_SPEED = 75;
const ACCEL_RATE = 32;
const BRAKE_RATE = 80;
const NATURAL_DECEL_RATE = 14;

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

export function SunsetHighwayGame({
  onBackToMenu,
  controllerCommand,
  showTouchControls = false
}: SunsetHighwayGameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // HUD States
  const [isWelcomeModalOpen, setIsWelcomeModalOpen] = useState(true);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    return parseInt(localStorage.getItem('sunset_drive_3d_highscore') || '0', 10);
  });
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [nearMissAlert, setNearMissAlert] = useState<string | null>(null);
  const [isHighBeaming, setIsHighBeaming] = useState(false);

  const highScoreRef = useRef(highScore);

  // Gameplay State Ref (Maintains 60FPS physics uninterrupted)
  const gameStateRef = useRef({
    isWelcomeOpen: true,
    speedKmh: 0,
    playerX: LANE_POSITIONS[1], // Start in lane 1 (-1.8)
    steerAngle: 0,
    smoothSteer: 0,
    vehicleYaw: 0,
    bodyRoll: 0,
    suspensionPitch: 0,
    cameraLookYaw: 0,
    cameraLookPitch: 0,
    targetCameraLookYaw: 0,
    targetCameraLookPitch: 0,
    isAccelerating: false,
    isBraking: false,
    isHandbraking: false,
    isHighBeamActive: false,
    highBeamTimer: 0,
    scoreAcc: 0,
    distanceAccKm: 0,
    comboMultiplier: 1,
    comboTimer: 0,
    lastNearMissTime: 0,
    isGameOver: false,
    isPaused: false,
    gear: 1,
    rpm: 950,
    targetRpm: 950,
    shiftTimer: 0,
    shiftShudder: 0,
    impactShudder: 0,
    lastCollisionTime: 0,
    totalCollisions: 0
  });

  // Three.js Scene References
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    playerCarGroup: THREE.Group;
    steeringWheelGroup: THREE.Group;
    frontWheelGroupL?: THREE.Group;
    frontWheelGroupR?: THREE.Group;
    tireMeshL?: THREE.Mesh;
    tireMeshR?: THREE.Mesh;
    clusterTexture: THREE.CanvasTexture;
    clusterCtx: CanvasRenderingContext2D | null;
    roadPlane: THREE.Mesh;
    terrainPlane: THREE.Mesh;
    laneLines: THREE.Mesh[];
    catEyes: THREE.Mesh[];
    sceneryItems: THREE.Group[];
    trafficPool: NPCTrafficCar[];
    headlightSpotL: THREE.SpotLight;
    headlightSpotR: THREE.SpotLight;
    composer?: EffectComposer;
    exhaustParticles?: THREE.Points;
  } | null>(null);

  // Init Engine Sound System
  const initAudio = useCallback(() => {
    engineAudio.init();
  }, []);

  // -------------------------------------------------------------
  // BUILD 3D TRAFFIC VEHICLES WITH REALISTIC COLORS & CONTACT SHADOWS
  // -------------------------------------------------------------
  const createTrafficCar = (isTruck: boolean, colorHex: number) => {
    const group = new THREE.Group();

    if (isTruck) {
      const cabMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4, metalness: 0.3 });
      const boxMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5, metalness: 0.2 });
      const darkMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });

      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 1.6), cabMat);
      cab.position.set(0, 0.9, -1.8);
      cab.castShadow = true;
      cab.receiveShadow = true;
      group.add(cab);

      const win = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.6, 0.05), darkMat);
      win.position.set(0, 1.15, -2.62);
      group.add(win);

      const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 4.2), boxMat);
      box.position.set(0, 1.5, 0.9);
      box.castShadow = true;
      box.receiveShadow = true;
      group.add(box);

      // Tail lights with emissive glow
      const tlMat = new THREE.MeshStandardMaterial({ color: 0xff1e1e, emissive: 0xff0000, emissiveIntensity: 2.2 });
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tlMat);
      tlL.position.set(-0.85, 0.8, 3.02);
      group.add(tlL);

      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tlMat);
      tlR.position.set(0.85, 0.8, 3.02);
      group.add(tlR);
    } else {
      const bodyMat = new THREE.MeshPhysicalMaterial({
        color: colorHex,
        roughness: 0.18,
        metalness: 0.82,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1
      });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.9 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.7, 4.0), bodyMat);
      body.position.y = 0.55;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 2.1), glassMat);
      cabin.position.set(0, 1.1, -0.2);
      cabin.castShadow = true;
      cabin.receiveShadow = true;
      group.add(cabin);

      // Tail lights
      const tlMat = new THREE.MeshStandardMaterial({ color: 0xff1e1e, emissive: 0xff0000, emissiveIntensity: 2.5 });
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), tlMat);
      tlL.position.set(-0.65, 0.65, 2.02);
      group.add(tlL);

      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), tlMat);
      tlR.position.set(0.65, 0.65, 2.02);
      group.add(tlR);
    }

    // 2.5D High-Performance Contact Shadow
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x050508,
      transparent: true,
      opacity: 0.75
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.6), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);

    const wheels: THREE.Mesh[] = [];
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshBasicMaterial({ color: 0x18181b });

    [-0.95, 0.95].forEach(wx => {
      [-1.2, 1.2].forEach(wz => {
        const w = new THREE.Mesh(wheelGeo, tireMat);
        w.position.set(wx, 0.32, wz);
        group.add(w);
        wheels.push(w);
      });
    });

    return { group, wheels };
  };

  // -------------------------------------------------------------
  // BUILD AUTHENTIC DRIVER COCKPIT (Driver on LEFT, Vivid Colors, Clear Road)
  // -------------------------------------------------------------
  const buildEnclosedLuxuryCabin = (playerCarGroup: THREE.Group, camera: THREE.PerspectiveCamera) => {
    // 1. Camera placed at authentic Driver Seat position
    // x = -0.52 places the driver's perspective directly behind the steering wheel and gauge cluster
    camera.position.set(-0.52, 1.14, 0.42);
    camera.rotation.set(-0.04, 0, 0); // Looking straight ahead through the steering wheel
    camera.up.set(0, 1, 0);
    playerCarGroup.add(camera);

    // Warm Interior Ambient Cabin Lighting (bathes leather and controls in rich luxury light - NEVER BLACK!)
    const cabinWarmLight = new THREE.PointLight(0xffedd5, 3.2, 5.0);
    cabinWarmLight.position.set(-0.2, 1.25, 0.0);
    playerCarGroup.add(cabinWarmLight);

    const cabinDashGlow = new THREE.PointLight(0x06b6d4, 1.4, 2.2);
    cabinDashGlow.position.set(-0.3, 0.75, -0.4);
    playerCarGroup.add(cabinDashGlow);

    // Luxury Material Palette: Distinct, Vivid, and Rich (NEVER blends into the asphalt!)
    const sportBonnetPaintMat = new THREE.MeshPhysicalMaterial({
      color: 0xdc2626, // Brilliant Rosso Corsa / Metallic Crimson Sport Red!
      roughness: 0.12,
      metalness: 0.88,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.5
    });
    const slateDashMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.1 }); // Slate Anthracite Upper Dash
    const cognacLeatherMat = new THREE.MeshStandardMaterial({ color: 0xc27837, roughness: 0.5, metalness: 0.1 }); // Warm Cognac / Saddle Tan Leather
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.12, metalness: 0.95 });
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.5 }); // Center Console Carbon
    const roofHeadlinerMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8, metalness: 0.05 }); // Slate Gray Headliner

    // =========================================================
    // A. VIVID METALLIC SPORT HOOD (الكبوت الرياضي الفخم - واضح ومتميز عن الشارع)
    // =========================================================
    const bonnetMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.95, 0.12, 2.2),
      sportBonnetPaintMat
    );
    bonnetMesh.position.set(0, 0.52, -1.75);
    bonnetMesh.rotation.x = -0.06;
    bonnetMesh.castShadow = true;
    bonnetMesh.receiveShadow = true;
    playerCarGroup.add(bonnetMesh);

    // Aerodynamic Power Bulges / Ridges on the hood
    const ridgeGeo = new THREE.BoxGeometry(0.06, 0.03, 1.9);
    const ridgeL = new THREE.Mesh(ridgeGeo, sportBonnetPaintMat);
    ridgeL.position.set(-0.52, 0.60, -1.75);
    ridgeL.rotation.x = -0.06;
    playerCarGroup.add(ridgeL);

    const ridgeR = new THREE.Mesh(ridgeGeo, sportBonnetPaintMat);
    ridgeR.position.set(0.52, 0.60, -1.75);
    ridgeR.rotation.x = -0.06;
    playerCarGroup.add(ridgeR);

    // Chrome Center Spear & Luxury Hood Emblem
    const bonnetSpear = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 2.0), chromeMat);
    bonnetSpear.position.set(0, 0.59, -1.75);
    bonnetSpear.rotation.x = -0.06;
    playerCarGroup.add(bonnetSpear);

    const hoodEmblem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 16), chromeMat);
    hoodEmblem.position.set(0, 0.57, -2.65);
    playerCarGroup.add(hoodEmblem);

    // Windshield Wiper Cowl (Dark Slate Tray at base of windshield)
    const cowlTray = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.25), slateDashMat);
    cowlTray.position.set(0, 0.62, -0.80);
    playerCarGroup.add(cowlTray);

    // =========================================================
    // B. CAR ROOF, WINDSHIELD HEADER & SUN VISORS
    // =========================================================
    const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 1.6), roofHeadlinerMat);
    roofPanel.position.set(0, 1.54, 0.35);
    playerCarGroup.add(roofPanel);

    const windshieldHeader = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.10, 0.22), roofHeadlinerMat);
    windshieldHeader.position.set(0, 1.48, -0.40);
    windshieldHeader.rotation.x = 0.12;
    playerCarGroup.add(windshieldHeader);

    // Sun Visors with Cognac Leather Accent
    const visorL = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.02, 0.18), cognacLeatherMat);
    visorL.position.set(-0.52, 1.43, -0.34);
    visorL.rotation.x = 0.15;
    playerCarGroup.add(visorL);

    const visorR = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.02, 0.18), cognacLeatherMat);
    visorR.position.set(0.46, 1.43, -0.34);
    visorR.rotation.x = 0.15;
    playerCarGroup.add(visorR);

    // Rearview Mirror with Reflective Glass
    const centerMirrorGroup = new THREE.Group();
    centerMirrorGroup.position.set(0, 1.40, -0.36);

    const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), slateDashMat);
    mirrorStem.position.y = 0.03;
    centerMirrorGroup.add(mirrorStem);

    const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.025), slateDashMat);
    centerMirrorGroup.add(mirrorFrame);

    const mirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.30, 0.075),
      new THREE.MeshBasicMaterial({ color: 0x64748b })
    );
    mirrorGlass.position.set(0, 0, 0.014);
    centerMirrorGroup.add(mirrorGlass);
    playerCarGroup.add(centerMirrorGroup);

    // =========================================================
    // C. PILLARS & DRIVER/PASSENGER DOORS & SEATS (أبواب ومرايا ومقاعد متكاملة يمين ويسار)
    // =========================================================
    // Left A-Pillar (قائم الزجاج الأيسر)
    const pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), roofHeadlinerMat);
    pillarL.position.set(-1.05, 1.08, -0.45);
    pillarL.rotation.z = -0.32;
    pillarL.rotation.x = 0.22;
    playerCarGroup.add(pillarL);

    // Left Driver Door (باب السائق الأيسر الكامل)
    const driverDoorTop = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.4), slateDashMat);
    driverDoorTop.position.set(-1.08, 1.44, 0.4);
    playerCarGroup.add(driverDoorTop);

    const driverDoorSill = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 1.4), cognacLeatherMat);
    driverDoorSill.position.set(-1.05, 0.72, 0.35);
    playerCarGroup.add(driverDoorSill);

    const driverDoorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 1.1), slateDashMat);
    driverDoorPanel.position.set(-0.98, 0.68, 0.35);
    playerCarGroup.add(driverDoorPanel);

    const armRestL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.45), cognacLeatherMat);
    armRestL.position.set(-0.95, 0.78, 0.32);
    playerCarGroup.add(armRestL);

    const doorHandleL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.14), chromeMat);
    doorHandleL.position.set(-0.94, 0.86, 0.15);
    playerCarGroup.add(doorHandleL);

    // Left Wing Mirror (مرآة السائق الجانبية على اليسار)
    const sideMirrorGroupL = new THREE.Group();
    sideMirrorGroupL.position.set(-1.18, 0.98, -0.42);

    const sideMountL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.04), slateDashMat);
    sideMirrorGroupL.add(sideMountL);

    const sideFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.05), sportBonnetPaintMat);
    sideFrameL.position.x = -0.06;
    sideMirrorGroupL.add(sideFrameL);

    const sideGlassL = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x475569 })
    );
    sideGlassL.position.set(-0.06, 0, 0.026);
    sideGlassL.rotation.y = 0.32;
    sideMirrorGroupL.add(sideGlassL);
    playerCarGroup.add(sideMirrorGroupL);

    // Right A-Pillar (قائم الزجاج الأيمن)
    const pillarR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), roofHeadlinerMat);
    pillarR.position.set(1.05, 1.08, -0.45);
    pillarR.rotation.z = 0.32;
    pillarR.rotation.x = 0.22;
    playerCarGroup.add(pillarR);

    // Right Passenger Door (باب الراكب الأيمن الكامل - مكسو بالجلد ومسند يد ومقبض ومرآة جانبية)
    const passengerDoorTop = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.4), slateDashMat);
    passengerDoorTop.position.set(1.08, 1.44, 0.4);
    playerCarGroup.add(passengerDoorTop);

    const passengerDoorSill = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 1.4), cognacLeatherMat);
    passengerDoorSill.position.set(1.05, 0.72, 0.35);
    playerCarGroup.add(passengerDoorSill);

    const passengerDoorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 1.1), slateDashMat);
    passengerDoorPanel.position.set(0.98, 0.68, 0.35);
    playerCarGroup.add(passengerDoorPanel);

    const armRestR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.45), cognacLeatherMat);
    armRestR.position.set(0.95, 0.78, 0.32);
    playerCarGroup.add(armRestR);

    const doorHandleR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.14), chromeMat);
    doorHandleR.position.set(0.94, 0.86, 0.15);
    playerCarGroup.add(doorHandleR);

    // Right Wing Mirror (مرآة الراكب الجانبية على اليمين)
    const sideMirrorGroupR = new THREE.Group();
    sideMirrorGroupR.position.set(1.18, 0.98, -0.42);

    const sideMountR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.04), slateDashMat);
    sideMirrorGroupR.add(sideMountR);

    const sideFrameR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.05), sportBonnetPaintMat);
    sideFrameR.position.x = 0.06;
    sideMirrorGroupR.add(sideFrameR);

    const sideGlassR = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x475569 })
    );
    sideGlassR.position.set(0.06, 0, 0.026);
    sideGlassR.rotation.y = -0.32;
    sideMirrorGroupR.add(sideGlassR);
    playerCarGroup.add(sideMirrorGroupR);

    // Luxury Passenger Sport Seat (مقعد الراكب الرياضي الأيمن)
    const seatBaseR = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.22, 0.60), cognacLeatherMat);
    seatBaseR.position.set(0.52, 0.28, 0.35);
    playerCarGroup.add(seatBaseR);

    const seatBackR = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.70, 0.14), cognacLeatherMat);
    seatBackR.position.set(0.52, 0.70, 0.62);
    seatBackR.rotation.x = -0.15;
    playerCarGroup.add(seatBackR);

    const headRestR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.10), slateDashMat);
    headRestR.position.set(0.52, 1.12, 0.70);
    playerCarGroup.add(headRestR);

    // Luxury Driver Sport Seat (مقعد السائق الرياضي الأيسر)
    const seatBaseL = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.22, 0.60), cognacLeatherMat);
    seatBaseL.position.set(-0.52, 0.28, 0.35);
    playerCarGroup.add(seatBaseL);

    const seatBackL = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.70, 0.14), cognacLeatherMat);
    seatBackL.position.set(-0.52, 0.70, 0.62);
    seatBackL.rotation.x = -0.15;
    playerCarGroup.add(seatBackL);

    const headRestL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.10), slateDashMat);
    headRestL.position.set(-0.52, 1.12, 0.70);
    playerCarGroup.add(headRestL);

    // =========================================================
    // D. TWO-TONE LUXURY DASHBOARD & CENTER CONSOLE
    // =========================================================
    // Upper Dashboard Body (Slate Gray Leather)
    const dashBodyUpper = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.24, 0.80), slateDashMat);
    dashBodyUpper.position.set(0, 0.68, -0.68);
    playerCarGroup.add(dashBodyUpper);

    // Lower Dashboard Body (Warm Cognac Leather)
    const dashBodyLower = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.26, 0.75), cognacLeatherMat);
    dashBodyLower.position.set(0, 0.44, -0.64);
    playerCarGroup.add(dashBodyLower);

    // Ambient Cyan LED Neon Strip dividing the two leather tones
    const ambientNeon = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.016, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x06b6d4 })
    );
    ambientNeon.position.set(0, 0.58, -0.55);
    playerCarGroup.add(ambientNeon);

    // Center Console between Driver & Passenger
    const centerConsole = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.48, 1.0), carbonMat);
    centerConsole.position.set(0.08, 0.32, -0.05);
    playerCarGroup.add(centerConsole);

    // Leather Console Armrest
    const consoleArmrest = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.45), cognacLeatherMat);
    consoleArmrest.position.set(0.08, 0.58, 0.22);
    playerCarGroup.add(consoleArmrest);

    // Automatic Gear Shifter with Chrome Bezel
    const shifterPlate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.20), chromeMat);
    shifterPlate.position.set(0.06, 0.56, -0.05);
    playerCarGroup.add(shifterPlate);

    const shifterStick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), chromeMat);
    shifterStick.position.set(0.06, 0.61, -0.05);
    playerCarGroup.add(shifterStick);

    const shifterKnob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 14), cognacLeatherMat);
    shifterKnob.position.set(0.06, 0.67, -0.05);
    playerCarGroup.add(shifterKnob);

    // AC Vents with Chrome Louvers
    const ventMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
    const ventL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.045, 0.02), ventMat);
    ventL.position.set(-0.06, 0.70, -0.60);
    playerCarGroup.add(ventL);

    const ventR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.045, 0.02), ventMat);
    ventR.position.set(0.06, 0.70, -0.60);
    playerCarGroup.add(ventR);

    // =========================================================
    // E. SLEEK COMPACT DRIVER DIGITAL SPEEDOMETER (عداد رياضي صغير وأنيق خلف الدركسون)
    // =========================================================
    // Compact Gauge Binnacle Housing (حاضنة العداد الرياضية المدمجة)
    const cowlMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.20), slateDashMat);
    cowlMesh.position.set(-0.52, 0.85, -0.56);
    cowlMesh.rotation.x = -0.15;
    playerCarGroup.add(cowlMesh);

    // Sleek chrome hood trim framing the gauge
    const cowlTrim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.015, 0.08), chromeMat);
    cowlTrim.position.set(-0.52, 0.93, -0.50);
    cowlTrim.rotation.x = -0.15;
    playerCarGroup.add(cowlTrim);

    // High-Definition Canvas for Compact Digital Speed & Gear Readout
    const clusterCanvas = document.createElement('canvas');
    clusterCanvas.width = 512;
    clusterCanvas.height = 256;
    const clusterCtx = clusterCanvas.getContext('2d');
    const clusterTexture = new THREE.CanvasTexture(clusterCanvas);
    clusterTexture.minFilter = THREE.LinearFilter;
    clusterTexture.magFilter = THREE.LinearFilter;

    // Compact Digital Screen positioned naturally inside the binnacle behind steering wheel
    const clusterScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.13),
      new THREE.MeshBasicMaterial({ map: clusterTexture })
    );
    clusterScreen.position.set(-0.52, 0.85, -0.48);
    clusterScreen.rotation.x = -0.20;
    playerCarGroup.add(clusterScreen);

    // =========================================================
    // F. REAL 3D STEERING WHEEL (ON THE LEFT SIDE IN FRONT OF DRIVER)
    // =========================================================
    // Steering Wheel is positioned at x = -0.52 (LEFT side of car, in front of Driver Seat!)
    const columnMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, 0.44, 14),
      slateDashMat
    );
    columnMesh.position.set(-0.52, 0.62, -0.46);
    columnMesh.rotation.x = Math.PI / 4.0;
    playerCarGroup.add(columnMesh);

    // Dedicated Spindle Group for pure, authentic steering wheel spin
    const steeringColumnGroup = new THREE.Group();
    steeringColumnGroup.position.set(-0.52, 0.72, -0.26);
    steeringColumnGroup.rotation.x = -0.20;
    playerCarGroup.add(steeringColumnGroup);

    const steeringWheelGroup = new THREE.Group();
    steeringColumnGroup.add(steeringWheelGroup);

    const rimGeo = new THREE.TorusGeometry(0.20, 0.027, 14, 30);
    const rimMat = new THREE.MeshLambertMaterial({ color: 0x1e293b });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    steeringWheelGroup.add(rimMesh);

    // Top 12 o'clock Cyan Racing Alignment Ring
    const stripeGeo = new THREE.TorusGeometry(0.20, 0.028, 8, 8, Math.PI / 10);
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
    const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
    stripeMesh.rotation.z = Math.PI / 2 - Math.PI / 20;
    steeringWheelGroup.add(stripeMesh);

    // Inner Polished Chrome Accent Ring
    const innerRingGeo = new THREE.TorusGeometry(0.155, 0.005, 8, 24);
    const innerRingMesh = new THREE.Mesh(innerRingGeo, chromeMat);
    steeringWheelGroup.add(innerRingMesh);

    // Center Horn Hub
    const hubGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.025, 20);
    const hubMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    const hubMesh = new THREE.Mesh(hubGeo, hubMat);
    hubMesh.rotation.x = Math.PI / 2;
    steeringWheelGroup.add(hubMesh);

    // Luxury Gold Crest Emblem
    const emblemGeo = new THREE.CircleGeometry(0.02, 16);
    const emblemMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const emblemMesh = new THREE.Mesh(emblemGeo, emblemMat);
    emblemMesh.position.set(0, 0, 0.014);
    steeringWheelGroup.add(emblemMesh);

    // 3 Brushed Metal Spokes
    const spokeMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });

    const spokeB = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.14, 0.01), spokeMat);
    spokeB.position.set(0, -0.075, 0);
    steeringWheelGroup.add(spokeB);

    const spokeL = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.14, 0.01), spokeMat);
    spokeL.position.set(-0.075, 0.02, 0);
    spokeL.rotation.z = Math.PI / 3;
    steeringWheelGroup.add(spokeL);

    const spokeR = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.14, 0.01), spokeMat);
    spokeR.position.set(0.075, 0.02, 0);
    spokeR.rotation.z = -Math.PI / 3;
    steeringWheelGroup.add(spokeR);

    // Paddle Shifters (+ on Right, - on Left)
    const paddleGeo = new THREE.BoxGeometry(0.025, 0.08, 0.01);
    const paddleL = new THREE.Mesh(paddleGeo, chromeMat);
    paddleL.position.set(-0.16, 0.03, -0.025);
    steeringWheelGroup.add(paddleL);

    const paddleR = new THREE.Mesh(paddleGeo, chromeMat);
    paddleR.position.set(0.16, 0.03, -0.025);
    steeringWheelGroup.add(paddleR);

    // =========================================================
    // G. REALISTIC FRONT WHEELS WITH TURNING & SPINNING PHYSICS
    // =========================================================
    const playerWheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 16);
    playerWheelGeo.rotateZ(Math.PI / 2);
    const playerTireMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
    const playerRimMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.2 });

    const frontWheelGroupL = new THREE.Group();
    frontWheelGroupL.position.set(-1.08, 0.32, -1.85);
    const tireMeshL = new THREE.Mesh(playerWheelGeo, playerTireMat);
    const rimMeshL = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.225, 12), playerRimMat);
    rimMeshL.rotation.z = Math.PI / 2;
    frontWheelGroupL.add(tireMeshL);
    frontWheelGroupL.add(rimMeshL);
    playerCarGroup.add(frontWheelGroupL);

    const frontWheelGroupR = new THREE.Group();
    frontWheelGroupR.position.set(1.08, 0.32, -1.85);
    const tireMeshR = new THREE.Mesh(playerWheelGeo, playerTireMat);
    const rimMeshR = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.225, 12), playerRimMat);
    rimMeshR.rotation.z = Math.PI / 2;
    frontWheelGroupR.add(tireMeshR);
    frontWheelGroupR.add(rimMeshR);
    playerCarGroup.add(frontWheelGroupR);

    // Muscular Front Wheel Arches / Fenders framing the front turning wheels
    const fenderGeo = new THREE.BoxGeometry(0.24, 0.16, 0.85);
    const fenderL = new THREE.Mesh(fenderGeo, sportBonnetPaintMat);
    fenderL.position.set(-1.08, 0.52, -1.85);
    playerCarGroup.add(fenderL);

    const fenderR = new THREE.Mesh(fenderGeo, sportBonnetPaintMat);
    fenderR.position.set(1.08, 0.52, -1.85);
    playerCarGroup.add(fenderR);

    // =========================================================
    // H. POWERFUL DUAL HEADLIGHT SPOTLIGHTS
    // =========================================================
    const headlightSpotL = new THREE.SpotLight(0xfff7ed, 7, 150, Math.PI / 3.8, 0.6, 1);
    headlightSpotL.position.set(-0.7, 0.45, -1.2);
    headlightSpotL.target.position.set(-0.7, 0, -45);
    playerCarGroup.add(headlightSpotL);
    playerCarGroup.add(headlightSpotL.target);

    const headlightSpotR = new THREE.SpotLight(0xfff7ed, 7, 150, Math.PI / 3.8, 0.6, 1);
    headlightSpotR.position.set(0.7, 0.45, -1.2);
    headlightSpotR.target.position.set(0.7, 0, -45);
    playerCarGroup.add(headlightSpotR);
    playerCarGroup.add(headlightSpotR.target);

    return {
      steeringWheelGroup,
      frontWheelGroupL,
      frontWheelGroupR,
      tireMeshL,
      tireMeshR,
      clusterTexture,
      clusterCtx,
      headlightSpotL,
      headlightSpotR
    };
  };

  // -------------------------------------------------------------
  // DRAW COMPACT DIGITAL SPEEDOMETER & TACHOMETER GAUGE (512x256)
  // -------------------------------------------------------------
  const updateClusterScreen = (
    ctx: CanvasRenderingContext2D,
    speed: number,
    distance: number,
    gear: number = 1,
    rpm: number = 1100
  ) => {
    ctx.clearRect(0, 0, 512, 256);

    // Deep OLED Obsidian Black Background
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, 512, 256);

    // Subtle Grid Pattern
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    for (let x = 20; x < 512; x += 36) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
    }
    for (let y = 20; y < 256; y += 36) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }

    // Outer Sleek Neon Blue Sport Frame
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 244);

    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(12, 12, 488, 232);

    // Top Status Header: Automatic Gear & Sport Mode
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`SPORT+  [ D${gear} ]`, 256, 38);

    const isBeam = gameStateRef.current.highBeamTimer > 0;
    if (isBeam) {
      ctx.fillStyle = '#06b6d4';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('☼ HIGH BEAM', 485, 38);
    }

    // Hero Digital Speed Readout (Big Glowing Numbers in Center)
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 92px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${speed}`, 210, 136);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('KM/H', 300, 128);

    // Dynamic Engine Tachometer (RPM Bar with Colored Redline)
    const rpmRatio = Math.max(0, Math.min(1.0, (rpm - 800) / 6200));
    const barX = 32;
    const barY = 165;
    const barW = 448;
    const barH = 16;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(barX, barY, barW, barH);

    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, '#06b6d4');
    grad.addColorStop(0.55, '#10b981');
    grad.addColorStop(0.82, '#f59e0b');
    grad.addColorStop(1.0, '#ef4444');
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barY, barW * rpmRatio, barH);

    // Tachometer Ticks for RPM
    ctx.strokeStyle = '#030712';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 7; i++) {
      const tx = barX + (barW / 7) * i;
      ctx.beginPath();
      ctx.moveTo(tx, barY);
      ctx.lineTo(tx, barY + barH);
      ctx.stroke();
    }

    // RPM & Engine Telemetry
    ctx.fillStyle = rpm > 5800 ? '#ef4444' : '#38bdf8';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(rpm)} RPM`, 32, 204);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('V8 PETROL TWIN-TURBO', 256, 204);

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`TRIP ${distance} KM`, 480, 204);

    // Bottom Telemetry Status
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('● SYSTEM READY · AUTO TRANSMISSION ACTIVE', 256, 232);
  };

  // -------------------------------------------------------------
  // INITIALIZE THREE.JS SCENE (Zero lag, 60 FPS guaranteed)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

    // 1. Scene & Sunset Sky Atmosphere
    const scene = new THREE.Scene();

    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 512;
    skyCanvas.height = 512;
    const skyCtx = skyCanvas.getContext('2d');
    if (skyCtx) {
      const grad = skyCtx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0.0, '#090d16');
      grad.addColorStop(0.35, '#1e1b4b');
      grad.addColorStop(0.65, '#581c87');
      grad.addColorStop(0.85, '#b45309');
      grad.addColorStop(1.0, '#ea580c');
      skyCtx.fillStyle = grad;
      skyCtx.fillRect(0, 0, 512, 512);

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
    scene.fog = new THREE.FogExp2(0x581c87, 0.0050);

    // 2. Camera Setup (Driver POV with Wide Forward Highway Framing)
    const camera = new THREE.PerspectiveCamera(66, width / height, 0.1, 320);

    // 3. Renderer with Smart Performance Options & PCFSoftShadowMap
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2.0));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    // 4. Enhanced Lighting & Soft Directional Sunlight
    const sunLight = new THREE.DirectionalLight(0xffa254, 2.6);
    sunLight.position.set(60, 45, -90);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = isMobile ? 1024 : 2048;
    sunLight.shadow.mapSize.height = isMobile ? 1024 : 2048;
    sunLight.shadow.camera.left = -60;
    sunLight.shadow.camera.right = 60;
    sunLight.shadow.camera.top = 60;
    sunLight.shadow.camera.bottom = -60;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 300;
    sunLight.shadow.bias = -0.0001;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x331a00, 0.85);
    scene.add(hemiLight);

    const sunGlowMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
    const sunGlow = new THREE.Mesh(new THREE.CircleGeometry(16, 32), sunGlowMat);
    sunGlow.position.set(70, 22, -260);
    scene.add(sunGlow);

    // 5. Player Vehicle Group & Enclosed Luxury Cabin
    const playerCarGroup = new THREE.Group();
    playerCarGroup.position.set(LANE_POSITIONS[1], 0, 0);
    scene.add(playerCarGroup);

    const {
      steeringWheelGroup,
      frontWheelGroupL,
      frontWheelGroupR,
      tireMeshL,
      tireMeshR,
      clusterTexture,
      clusterCtx,
      headlightSpotL,
      headlightSpotR
    } = buildEnclosedLuxuryCabin(playerCarGroup, camera);

    if (clusterCtx) updateClusterScreen(clusterCtx, BASE_CRUISE_SPEED, 0, 4, 2600);
    clusterTexture.needsUpdate = true;

    // Exhaust Smoke Particles for Player Car
    const particleCount = 35;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);
    const particleAges = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      particlePos[i * 3] = (Math.random() - 0.5) * 0.35;
      particlePos[i * 3 + 1] = 0.2;
      particlePos[i * 3 + 2] = 1.8 + Math.random() * 1.5;
      particleAges[i] = Math.random() * 1.5;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x94a3b8,
      size: 0.22,
      transparent: true,
      opacity: 0.30,
      depthWrite: false
    });
    const exhaustParticles = new THREE.Points(particleGeo, particleMat);
    playerCarGroup.add(exhaustParticles);

    // 6. Vast Ground Terrain
    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.05
    });
    const terrainPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(600, ROAD_SEGMENT_LENGTH),
      terrainMat
    );
    terrainPlane.rotation.x = -Math.PI / 2;
    terrainPlane.position.set(0, -0.04, -ROAD_SEGMENT_LENGTH / 2 + 20);
    terrainPlane.receiveShadow = true;
    scene.add(terrainPlane);

    // 7. Matte Dark Asphalt Highway (Contrast beautifully with crimson sports hood!)
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x181e29,
      roughness: 0.65,
      metalness: 0.08
    });
    const roadPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_TOTAL_WIDTH + 4, ROAD_SEGMENT_LENGTH),
      roadMat
    );
    roadPlane.rotation.x = -Math.PI / 2;
    roadPlane.position.set(0, 0, -ROAD_SEGMENT_LENGTH / 2 + 20);
    roadPlane.receiveShadow = true;
    scene.add(roadPlane);

    // Guardrails Left and Right
    const guardMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.3, metalness: 0.7 });
    const guardGeo = new THREE.BoxGeometry(0.45, 0.5, ROAD_SEGMENT_LENGTH);

    const guardL = new THREE.Mesh(guardGeo, guardMat);
    guardL.position.set(-ROAD_TOTAL_WIDTH / 2 - 1.2, 0.25, -ROAD_SEGMENT_LENGTH / 2 + 20);
    guardL.castShadow = true;
    guardL.receiveShadow = true;
    scene.add(guardL);

    const guardR = new THREE.Mesh(guardGeo, guardMat);
    guardR.position.set(ROAD_TOTAL_WIDTH / 2 + 1.2, 0.25, -ROAD_SEGMENT_LENGTH / 2 + 20);
    guardR.castShadow = true;
    guardR.receiveShadow = true;
    scene.add(guardR);

    // Solid Edge Lines (Vivid Amber Gold)
    const edgeLineMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const edgeLineGeo = new THREE.BoxGeometry(0.2, 0.02, ROAD_SEGMENT_LENGTH);

    const edgeLineL = new THREE.Mesh(edgeLineGeo, edgeLineMat);
    edgeLineL.position.set(-ROAD_TOTAL_WIDTH / 2, 0.015, -ROAD_SEGMENT_LENGTH / 2 + 20);
    scene.add(edgeLineL);

    const edgeLineR = new THREE.Mesh(edgeLineGeo, edgeLineMat);
    edgeLineR.position.set(ROAD_TOTAL_WIDTH / 2, 0.015, -ROAD_SEGMENT_LENGTH / 2 + 20);
    scene.add(edgeLineR);

    // Dashed Lane Lines (Bright White)
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

    // 8. Reflective Cat's Eyes
    const catEyes: THREE.Mesh[] = [];
    const catEyeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const catEyeGeo = new THREE.BoxGeometry(0.1, 0.03, 0.15);

    [-3.6, 0, 3.6].forEach(cx => {
      for (let z = -ROAD_SEGMENT_LENGTH + 20; z < 20; z += 6) {
        const stud = new THREE.Mesh(catEyeGeo, catEyeMat);
        stud.position.set(cx, 0.025, z);
        scene.add(stud);
        catEyes.push(stud);
      }
    });

    // 9. Scenery Props (Smoothly scrolling poles & roadside greenery with Street Lights)
    const sceneryItems: THREE.Group[] = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.6 });
    const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfef08a, emissiveIntensity: 2.0 });
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x27170a, roughness: 0.8, metalness: 0.1 });
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.7, metalness: 0.1 });

    let poleIndex = 0;
    for (let z = -ROAD_SEGMENT_LENGTH + 20; z < 20; z += 30) {
      poleIndex++;
      const propGroup = new THREE.Group();

      const lampL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7.5, 8), poleMat);
      lampL.position.set(-ROAD_TOTAL_WIDTH / 2 - 2.8, 3.75, 0);
      lampL.castShadow = true;
      propGroup.add(lampL);

      const armL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.2), poleMat);
      armL.position.set(-ROAD_TOTAL_WIDTH / 2 - 2.0, 7.4, 0);
      armL.castShadow = true;
      propGroup.add(armL);

      const bulbL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.2), lampHeadMat);
      bulbL.position.set(-ROAD_TOTAL_WIDTH / 2 - 1.3, 7.3, 0);
      propGroup.add(bulbL);

      if (poleIndex % 2 === 0) {
        const streetPointLight = new THREE.PointLight(0xffc87c, 1.2, 25);
        streetPointLight.position.set(-ROAD_TOTAL_WIDTH / 2 - 1.3, 7.1, 0);
        propGroup.add(streetPointLight);
      }

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 3.2, 8), treeTrunkMat);
      trunk.position.set(ROAD_TOTAL_WIDTH / 2 + 5.0, 1.6, 0);
      trunk.castShadow = true;
      propGroup.add(trunk);

      const leaves = new THREE.Mesh(new THREE.DodecahedronGeometry(1.7, 0), treeLeafMat);
      leaves.position.set(ROAD_TOTAL_WIDTH / 2 + 5.0, 4.2, 0);
      leaves.castShadow = true;
      propGroup.add(leaves);

      propGroup.position.set(0, 0, z);
      scene.add(propGroup);
      sceneryItems.push(propGroup);
    }

    // 10. Traffic Pool
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

      const speed = 48 + Math.random() * 20;
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

    // 11. Post-Processing EffectComposer with UnrealBloomPass
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.26,
      0.32,
      0.88
    );
    composer.addPass(bloomPass);

    threeRef.current = {
      scene,
      camera,
      renderer,
      playerCarGroup,
      steeringWheelGroup,
      frontWheelGroupL,
      frontWheelGroupR,
      tireMeshL,
      tireMeshR,
      clusterTexture,
      clusterCtx,
      roadPlane,
      terrainPlane,
      laneLines,
      catEyes,
      sceneryItems,
      trafficPool,
      headlightSpotL,
      headlightSpotR,
      composer,
      exhaustParticles
    };

    const handleResize = () => {
      if (!containerRef.current || !threeRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      threeRef.current.camera.aspect = w / h;
      threeRef.current.camera.updateProjectionMatrix();
      threeRef.current.renderer.setSize(w, h);
      if (threeRef.current.composer) {
        threeRef.current.composer.setSize(w, h);
      }
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
  // START GAME FROM WELCOME
  // -------------------------------------------------------------
  const startGameFromWelcome = useCallback(() => {
    initAudio();
    sounds.playButtonPress();
    setIsWelcomeModalOpen(false);
    const s = gameStateRef.current;
    s.isWelcomeOpen = false;
    s.speedKmh = BASE_CRUISE_SPEED;
    setCurrentSpeed(BASE_CRUISE_SPEED);
  }, [initAudio]);

  // Restart Game Function defined before controller handler
  const restartGame = useCallback(() => {
    const s = gameStateRef.current;
    s.isWelcomeOpen = false;
    s.speedKmh = BASE_CRUISE_SPEED;
    s.playerX = LANE_POSITIONS[1];
    s.steerAngle = 0;
    s.smoothSteer = 0;
    s.vehicleYaw = 0;
    s.bodyRoll = 0;
    s.suspensionPitch = 0;
    s.isGameOver = false;
    s.isPaused = false;
    s.scoreAcc = 0;
    s.distanceAccKm = 0;
    s.comboMultiplier = 1;
    s.gear = 4;
    s.rpm = 2600;
    s.targetRpm = 2600;
    s.shiftTimer = 0;
    s.shiftShudder = 0;
    s.impactShudder = 0;
    s.totalCollisions = 0;

    setIsWelcomeModalOpen(false);
    setIsGameOver(false);
    setIsPaused(false);
    setScore(0);
    setDistanceKm(0);
    setCurrentSpeed(BASE_CRUISE_SPEED);

    if (threeRef.current) {
      threeRef.current.playerCarGroup.position.x = s.playerX;
      threeRef.current.playerCarGroup.rotation.set(0, 0, 0);
      if (threeRef.current.steeringWheelGroup) {
        threeRef.current.steeringWheelGroup.rotation.z = 0;
      }
      if (threeRef.current.frontWheelGroupL && threeRef.current.frontWheelGroupR) {
        threeRef.current.frontWheelGroupL.rotation.y = 0;
        threeRef.current.frontWheelGroupR.rotation.y = 0;
      }
      threeRef.current.trafficPool.forEach((car, idx) => {
        car.lane = idx % LANES_COUNT;
        car.targetLane = car.lane;
        car.x = LANE_POSITIONS[car.lane];
        car.z = -55 - idx * 44;
        car.speedKmh = 48 + Math.random() * 18;
        car.targetSpeedKmh = car.speedKmh;
        car.mesh.position.set(car.x, 0, car.z);
      });
    }
  }, []);

  // -------------------------------------------------------------
  // MANUAL HEADLIGHT FLASHER / STROBE (تكبيس كشافات يدوي)
  // -------------------------------------------------------------
  const triggerManualHeadlightFlash = useCallback(() => {
    initAudio();
    sounds.playHighBeam();
    const s = gameStateRef.current;
    const t3 = threeRef.current;

    s.highBeamTimer = 0.45;
    setIsHighBeaming(true);

    if (t3) {
      t3.headlightSpotL.intensity = 18;
      t3.headlightSpotR.intensity = 18;

      t3.trafficPool.forEach(car => {
        if (car.z < 0 && car.z > -100) {
          if (Math.abs(car.x - s.playerX) < LANE_WIDTH * 0.9) {
            car.targetLane = s.playerX < car.x ? Math.min(3, car.lane + 1) : Math.max(0, car.lane - 1);
          }
        }
      });
    }
  }, [initAudio]);

  // -------------------------------------------------------------
  // PS5 DUALSENSE TOUCH CONTROLS (FOR MOBILE TOUCH PLAY)
  // -------------------------------------------------------------
  const [touchLeftStickPos, setTouchLeftStickPos] = useState({ x: 0, y: 0 });
  const [touchRightStickPos, setTouchRightStickPos] = useState({ x: 0, y: 0 });
  const [activeTouchPSButtons, setActiveTouchPSButtons] = useState<Set<string>>(new Set());

  const leftStickBaseRef = useRef<HTMLDivElement>(null);
  const leftStickPointerIdRef = useRef<number | null>(null);
  const rightStickBaseRef = useRef<HTMLDivElement>(null);
  const rightStickPointerIdRef = useRef<number | null>(null);

  // Left Thumbstick (Steering X & Throttle/Brake Y)
  const updateLeftStickCoords = useCallback((clientX: number, clientY: number) => {
    if (!leftStickBaseRef.current) return;
    const rect = leftStickBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);

    if (dist < 4) {
      setTouchLeftStickPos({ x: 0, y: 0 });
      const s = gameStateRef.current;
      s.steerAngle = 0;
      s.isAccelerating = false;
      s.isBraking = false;
      return;
    }

    const angle = Math.atan2(dy, dx);
    const power = Math.min(1.0, dist / (radius * 0.75));
    const normX = Math.cos(angle) * power;
    const normY = Math.sin(angle) * power;

    const visualDist = Math.min(dist, radius * 0.85);
    setTouchLeftStickPos({
      x: (Math.cos(angle) * visualDist) / radius,
      y: (Math.sin(angle) * visualDist) / radius
    });

    const s = gameStateRef.current;
    if (s.isWelcomeOpen) return;
    // Left Stick is exclusively for precise Left & Right front-wheel steering
    s.steerAngle = Math.max(-1, Math.min(1, normX * 1.25));
  }, []);

  const handleLeftStickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    initAudio();
    leftStickPointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    updateLeftStickCoords(e.clientX, e.clientY);
  };

  const handleLeftStickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (leftStickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    updateLeftStickCoords(e.clientX, e.clientY);
  };

  const handleLeftStickPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (leftStickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    leftStickPointerIdRef.current = null;
    setTouchLeftStickPos({ x: 0, y: 0 });
    const s = gameStateRef.current;
    s.steerAngle = 0;
  };

  // Right Thumbstick (Camera Look Yaw X & Pitch Y - 360° Driver Neck Rotation)
  const updateRightStickCoords = useCallback((clientX: number, clientY: number) => {
    if (!rightStickBaseRef.current) return;
    const rect = rightStickBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);

    if (dist < 4) {
      setTouchRightStickPos({ x: 0, y: 0 });
      const s = gameStateRef.current;
      s.targetCameraLookYaw = 0;
      s.targetCameraLookPitch = 0;
      return;
    }

    const angle = Math.atan2(dy, dx);
    const power = Math.min(1.0, dist / (radius * 0.75));
    const normX = Math.cos(angle) * power;
    const normY = Math.sin(angle) * power;

    const visualDist = Math.min(dist, radius * 0.85);
    setTouchRightStickPos({
      x: (Math.cos(angle) * visualDist) / radius,
      y: (Math.sin(angle) * visualDist) / radius
    });

    const s = gameStateRef.current;
    s.targetCameraLookYaw = Math.max(-0.95, Math.min(0.95, -normX * 0.95));
    s.targetCameraLookPitch = Math.max(-0.45, Math.min(0.38, -normY * 0.45));
  }, []);

  const handleRightStickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    initAudio();
    rightStickPointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    updateRightStickCoords(e.clientX, e.clientY);
  };

  const handleRightStickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rightStickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    updateRightStickCoords(e.clientX, e.clientY);
  };

  const handleRightStickPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rightStickPointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    rightStickPointerIdRef.current = null;
    setTouchRightStickPos({ x: 0, y: 0 });
    const s = gameStateRef.current;
    s.targetCameraLookYaw = 0;
    s.targetCameraLookPitch = 0;
  };

  // PS5 Action Buttons
  const handlePSButtonDown = useCallback((btn: string) => {
    initAudio();
    sounds.playButtonPress();
    setActiveTouchPSButtons(prev => new Set(prev).add(btn));
    const s = gameStateRef.current;
    if (s.isWelcomeOpen) {
      startGameFromWelcome();
      return;
    }
    if (btn === 'CROSS' || btn === 'R2') {
      s.isAccelerating = true;
      s.isBraking = false;
    } else if (btn === 'SQUARE' || btn === 'L2') {
      s.isBraking = true;
      s.isAccelerating = false;
    } else if (btn === 'TRIANGLE') {
      s.isHandbraking = true;
    } else if (btn === 'CIRCLE') {
      sounds.playHorn();
    } else if (btn === 'R1') {
      triggerManualHeadlightFlash();
    }
  }, [initAudio, startGameFromWelcome, triggerManualHeadlightFlash]);

  const handlePSButtonUp = useCallback((btn: string) => {
    setActiveTouchPSButtons(prev => {
      const next = new Set(prev);
      next.delete(btn);
      return next;
    });
    const s = gameStateRef.current;
    if (btn === 'CROSS' || btn === 'R2') {
      s.isAccelerating = false;
    } else if (btn === 'SQUARE' || btn === 'L2') {
      s.isBraking = false;
    } else if (btn === 'TRIANGLE') {
      s.isHandbraking = false;
    }
  }, []);

  // Quick D-Pad Nudge Buttons
  const handleTouchDpadSteer = useCallback((dir: 'left' | 'right' | null) => {
    initAudio();
    const s = gameStateRef.current;
    if (s.isWelcomeOpen) return;
    if (dir === 'left') s.steerAngle = -1;
    else if (dir === 'right') s.steerAngle = 1;
    else s.steerAngle = 0;
  }, [initAudio]);

  // -------------------------------------------------------------
  // TOUCH DRAG FREE-LOOK CAMERA (PAN NECK WITH FINGER)
  // -------------------------------------------------------------
  const isDraggingLookRef = useRef(false);
  const lookStartPosRef = useRef({ x: 0, y: 0 });

  const handlePointerDownLook = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('[data-stick]')) return;
    isDraggingLookRef.current = true;
    lookStartPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMoveLook = (e: React.PointerEvent) => {
    if (!isDraggingLookRef.current) return;
    const dx = e.clientX - lookStartPosRef.current.x;
    const dy = e.clientY - lookStartPosRef.current.y;
    lookStartPosRef.current = { x: e.clientX, y: e.clientY };

    const s = gameStateRef.current;
    // dx rotates neck left/right (yaw)
    s.targetCameraLookYaw = Math.max(-0.95, Math.min(0.95, s.targetCameraLookYaw - dx * 0.005));
    // dy tilts head up/down (pitch)
    s.targetCameraLookPitch = Math.max(-0.45, Math.min(0.38, s.targetCameraLookPitch - dy * 0.005));
  };

  const handlePointerUpLook = () => {
    isDraggingLookRef.current = false;
  };

  const handleResetCameraLook = useCallback(() => {
    const s = gameStateRef.current;
    s.targetCameraLookYaw = 0;
    s.targetCameraLookPitch = 0;
    setTouchRightStickPos({ x: 0, y: 0 });
  }, []);

  // -------------------------------------------------------------
  // CONTROLLER COMMAND HANDLER (PS5 DUALSENSE & TV REMOTE SUPPORT)
  // -------------------------------------------------------------
  const handleControllerCommand = useCallback((cmd: any) => {
    if (!cmd) return;
    initAudio();
    const s = gameStateRef.current;

    // Handle 360 Camera Look around from Right Thumbstick (يمين، يسار، فوق، تحت)
    if (cmd.type === 'camera_look' && cmd.stick) {
      s.targetCameraLookYaw = Math.max(-0.95, Math.min(0.95, -cmd.stick.x * 0.95));
      s.targetCameraLookPitch = Math.max(-0.45, Math.min(0.38, -cmd.stick.y * 0.45));
      return;
    } else if (cmd.type === 'camera_look_reset') {
      s.targetCameraLookYaw = 0;
      s.targetCameraLookPitch = 0;
      return;
    }

    // If welcome modal is active: any main button triggers "بدء"
    if (s.isWelcomeOpen) {
      if (cmd.type === 'button_down' && ['A', 'CROSS', 'X', 'SQUARE', 'B', 'CIRCLE', 'Y', 'TRIANGLE', 'START', 'ENTER', 'R2', 'L2'].includes(cmd.button)) {
        startGameFromWelcome();
      }
      return;
    }

    // Left Thumbstick: ONLY Left / Right Steering (عصا التوجيه يمين ويسار فقط)
    if (cmd.type === 'stick_move' && cmd.stick) {
      s.steerAngle = Math.max(-1, Math.min(1, cmd.stick.x * 1.15));
    } else if (cmd.type === 'stick_release') {
      s.steerAngle = 0;
    } else if (cmd.type === 'button_down') {
      if (cmd.button === 'LEFT') s.steerAngle = -1;
      if (cmd.button === 'RIGHT') s.steerAngle = 1;

      // PS5 Accelerate: R2 (بنزين) + Cross (A) + Up
      if (['R2', 'A', 'CROSS', 'UP'].includes(cmd.button)) {
        s.isAccelerating = true;
        s.isBraking = false;
      }
      // PS5 Brake / Reverse: L2 (فرامل) + Square (X) + Down
      if (['L2', 'X', 'SQUARE', 'DOWN'].includes(cmd.button)) {
        s.isBraking = true;
        s.isAccelerating = false;
      }
      // Triangle (Y / TRIANGLE) is HANDBRAKE (جلنط / تفحيط)
      if (['Y', 'TRIANGLE'].includes(cmd.button)) {
        s.isHandbraking = true;
      }
      // High Beam Flasher: R1
      if (['R1'].includes(cmd.button)) {
        triggerManualHeadlightFlash();
      }
      // Horn: Circle (B) / L1
      if (['B', 'CIRCLE', 'L1'].includes(cmd.button)) {
        sounds.playHorn();
      }
      if (['START', 'OPTIONS'].includes(cmd.button)) {
        if (s.isGameOver) restartGame();
        else {
          s.isPaused = !s.isPaused;
          setIsPaused(s.isPaused);
        }
      }
      if (['SELECT', 'SHARE', 'CREATE'].includes(cmd.button)) onBackToMenu();
    } else if (cmd.type === 'button_up') {
      if (['LEFT', 'RIGHT'].includes(cmd.button)) s.steerAngle = 0;
      if (['R2', 'A', 'CROSS', 'UP'].includes(cmd.button)) s.isAccelerating = false;
      if (['L2', 'X', 'SQUARE', 'DOWN'].includes(cmd.button)) s.isBraking = false;
      if (['Y', 'TRIANGLE'].includes(cmd.button)) s.isHandbraking = false;
    }
  }, [initAudio, onBackToMenu, startGameFromWelcome, triggerManualHeadlightFlash, restartGame]);

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
      initAudio();
      if (s.isWelcomeOpen) {
        if (['a', 'A', ' ', 'Enter'].includes(e.key)) {
          startGameFromWelcome();
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'a') s.steerAngle = -1;
      if (e.key === 'ArrowRight' || e.key === 'd') s.steerAngle = 1;
      if (e.key === 'ArrowUp' || e.key === 'w') s.isAccelerating = true;
      if (e.key === 'ArrowDown' || e.key === 's') s.isBraking = true;
      if (e.key === ' ' || e.key === 'b') triggerManualHeadlightFlash();
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
  }, [initAudio, onBackToMenu, startGameFromWelcome, triggerManualHeadlightFlash]);

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

      if (s.isWelcomeOpen) {
        t3.renderer.render(t3.scene, t3.camera);
        return;
      }

      // 1. Natural Highway Petrol Engine Speed & Automatic Gear Dynamics
      if (s.isHandbraking) {
        // Handbrake deceleration with screeching rear tire grip slide
        s.speedKmh = Math.max(MIN_SPEED_KMH, s.speedKmh - BRAKE_RATE * 1.35 * dt);
      } else if (s.isAccelerating) {
        // Petrol combustion torque surge
        const gearTorqueBonus = s.gear <= 3 ? 1.25 : 1.0;
        s.speedKmh = Math.min(MAX_SPEED_KMH, s.speedKmh + ACCEL_RATE * gearTorqueBonus * dt);
      } else if (s.isBraking) {
        s.speedKmh = Math.max(MIN_SPEED_KMH, s.speedKmh - BRAKE_RATE * dt);
      } else {
        if (s.speedKmh > BASE_CRUISE_SPEED) {
          s.speedKmh = Math.max(BASE_CRUISE_SPEED, s.speedKmh - NATURAL_DECEL_RATE * dt);
        } else if (s.speedKmh < BASE_CRUISE_SPEED) {
          s.speedKmh = Math.min(BASE_CRUISE_SPEED, s.speedKmh + NATURAL_DECEL_RATE * dt);
        }
      }

      // Automatic Gearbox logic (7 Gears with shift shudder & exhaust pop)
      const gearThresholds = [0, 26, 46, 68, 88, 106, 120, 160];
      if (s.shiftTimer > 0) {
        s.shiftTimer -= dt;
      }

      // Automatic Upshift
      if (s.gear < 7 && s.speedKmh > gearThresholds[s.gear] && s.shiftTimer <= 0) {
        s.gear += 1;
        s.shiftTimer = 0.15;
        s.shiftShudder = 0.035;
        engineAudio.playShiftPop();
      }
      // Automatic Downshift
      else if (s.gear > 1 && s.speedKmh < gearThresholds[s.gear - 1] - 3 && s.shiftTimer <= 0) {
        s.gear -= 1;
        s.shiftTimer = 0.12;
        s.shiftShudder = -0.02;
      }

      // Compute Live Engine RPM
      const currentGearMin = gearThresholds[s.gear - 1] || 0;
      const currentGearMax = gearThresholds[s.gear] || 140;
      const gearProgress = Math.max(0, Math.min(1.0, (s.speedKmh - currentGearMin) / (currentGearMax - currentGearMin + 0.1)));

      let baseRpm = 1200 + gearProgress * 4800;
      if (s.isAccelerating) baseRpm += 800;
      if (s.shiftTimer > 0) baseRpm *= 0.65; // Realistic RPM drop during shift
      s.targetRpm = Math.max(950, Math.min(6800, baseRpm));
      s.rpm += (s.targetRpm - s.rpm) * Math.min(1, dt * 12.0);

      // Real V8 Throaty Roar and Handbrake Tire Skid Screech
      engineAudio.update(s.rpm, s.isAccelerating, s.isBraking, s.shiftTimer > 0, s.isHandbraking, s.speedKmh);

      const worldSpeed = (s.speedKmh / 3.6) * 0.22;

      // 2. Realistic Vehicle Physics: Front-Wheel Direct Steering (Mechanical Grip & Balance)
      const steerResponseRate = s.steerAngle !== 0 ? 12.0 : 16.0;
      s.smoothSteer += (s.steerAngle - s.smoothSteer) * Math.min(1, dt * steerResponseRate);

      // Stable, direct lane transition guided directly by front wheels
      const laneSteerSpeed = 5.2 + (s.speedKmh / 120) * 1.4;
      s.playerX += s.smoothSteer * laneSteerSpeed * dt;
      s.playerX = Math.max(-ROAD_TOTAL_WIDTH / 2 + 1.2, Math.min(ROAD_TOTAL_WIDTH / 2 - 1.2, s.playerX));
      t3.playerCarGroup.position.x = s.playerX;

      // Realistic Vehicle Turning Heading (Yaw): Front wheels lead the turn naturally, rear slides during handbrake
      const targetYaw = s.isHandbraking
        ? -s.smoothSteer * 0.18
        : -s.smoothSteer * 0.082;
      s.vehicleYaw += (targetYaw - s.vehicleYaw) * Math.min(1, dt * (s.isHandbraking ? 14.0 : 9.0));
      t3.playerCarGroup.rotation.y = s.vehicleYaw;

      // Front Wheels Angular Steering & Rolling Physics (كفرات السيارة الأمامية تلف بدقة وتوجه المسار)
      if (t3.frontWheelGroupL && t3.frontWheelGroupR) {
        t3.frontWheelGroupL.rotation.y = s.smoothSteer * 0.52;
        t3.frontWheelGroupR.rotation.y = s.smoothSteer * 0.52;
        if (t3.tireMeshL && t3.tireMeshR) {
          t3.tireMeshL.rotation.x += worldSpeed * dt * 9;
          t3.tireMeshR.rotation.x += worldSpeed * dt * 9;
        }
      }

      // Authentic 3D Steering Wheel Turning smoothly on spindle
      if (t3.steeringWheelGroup) {
        t3.steeringWheelGroup.rotation.z = -s.smoothSteer * 1.75;
      }

      // Damping physical shudders
      s.shiftShudder += (0 - s.shiftShudder) * Math.min(1, dt * 10.0);
      s.impactShudder += (0 - s.impactShudder) * Math.min(1, dt * 8.0);

      // Suspension Pitch under Acceleration, Braking, Gear Shifts, and Impacts
      const accelSquat = s.isAccelerating ? -0.024 : 0;
      const brakeDive = s.isBraking ? 0.038 : 0;
      const targetPitch = accelSquat + brakeDive + s.shiftShudder + s.impactShudder;
      s.suspensionPitch += (targetPitch - s.suspensionPitch) * Math.min(1, dt * 9.0);
      t3.playerCarGroup.rotation.x = s.suspensionPitch;

      // Subtle, planted suspension roll (mechanical grip & body weight transfer)
      const targetRoll = -s.smoothSteer * 0.032;
      s.bodyRoll += (targetRoll - s.bodyRoll) * Math.min(1, dt * 8.0);
      t3.playerCarGroup.rotation.z = s.bodyRoll;

      // Dynamic Driver Head & Camera Physics (Free look neck rotation + road vibe + engine tremor)
      s.cameraLookYaw += (s.targetCameraLookYaw - s.cameraLookYaw) * Math.min(1, dt * 11.0);
      s.cameraLookPitch += (s.targetCameraLookPitch - s.cameraLookPitch) * Math.min(1, dt * 11.0);

      const roadVibe = Math.sin(now * 0.025) * (s.speedKmh / 120) * 0.0016;
      const engineTremor = (s.rpm / 6500) * (s.isAccelerating ? 0.0012 : 0.0004) * Math.sin(now * 0.08);
      t3.camera.position.set(
        -0.52 + Math.sin(s.cameraLookYaw) * 0.05,
        1.14 + roadVibe + engineTremor + Math.sin(s.cameraLookPitch) * 0.03,
        0.42 - Math.cos(s.cameraLookYaw) * 0.015 + (s.isBraking ? -0.018 : (s.isAccelerating ? 0.012 : 0))
      );
      t3.camera.rotation.set(
        -0.04 + s.cameraLookPitch + s.suspensionPitch * 0.35,
        s.cameraLookYaw,
        -s.bodyRoll * 0.28
      );

      // 3. Headlight Intensity Check
      if (s.highBeamTimer > 0) {
        s.highBeamTimer -= dt;
        if (s.highBeamTimer <= 0) {
          setIsHighBeaming(false);
          t3.headlightSpotL.intensity = 7;
          t3.headlightSpotR.intensity = 7;
        }
      }

      // 4. Seamless Road Markings & Cat's Eyes Scrolling
      const moveDistance = worldSpeed * dt * 25;

      t3.laneLines.forEach(line => {
        line.position.z += moveDistance;
        if (line.position.z > 20) line.position.z -= ROAD_SEGMENT_LENGTH;
      });

      t3.catEyes.forEach(stud => {
        stud.position.z += moveDistance;
        if (stud.position.z > 20) stud.position.z -= ROAD_SEGMENT_LENGTH;
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
          car.targetSpeedKmh = 48 + Math.random() * 20;
          car.speedKmh = car.targetSpeedKmh;
          car.mesh.position.set(car.x, 0, car.z);
        }

        // Collision Check: ZERO LOSS / NO GAME OVER (تصادمات لا متناهية بدون خسارة)
        const dx = Math.abs(car.x - s.playerX);
        const dz = Math.abs(car.z);

        if (dx < 1.45 && dz < 2.0) {
          if (now - s.lastCollisionTime > 650) {
            s.lastCollisionTime = now;
            s.totalCollisions += 1;
            s.impactShudder = 0.09;
            s.speedKmh = Math.max(MIN_SPEED_KMH, s.speedKmh - 14);
            sounds.playCrash();
            setNearMissAlert(`💥 اصطدام مروري #${s.totalCollisions}! واصل القيادة بدون توقف`);
            setTimeout(() => setNearMissAlert(null), 1400);

            // Displace other vehicle ahead safely
            car.z -= 6.0;
            car.speedKmh += 22;
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

      // Update In-Car Dynamic Cockpit Screens (Smooth 30fps dashboard refresh)
      hudTimer += dt;
      if (hudTimer >= 0.033) {
        hudTimer = 0;
        const spd = Math.round(s.speedKmh);
        const dist = parseFloat(s.distanceAccKm.toFixed(1));

        setCurrentSpeed(spd);
        setDistanceKm(dist);
        setScore(Math.floor(s.scoreAcc));

        if (t3.clusterCtx) {
          updateClusterScreen(t3.clusterCtx, spd, dist, s.gear, s.rpm);
          t3.clusterTexture.needsUpdate = true;
        }
      }

      // Update exhaust smoke particles
      if (t3.exhaustParticles) {
        const positions = t3.exhaustParticles.geometry.attributes.position.array as Float32Array;
        const pCount = 35;
        for (let j = 0; j < pCount; j++) {
          const idx = j * 3;
          positions[idx + 1] += 0.25 * dt;
          positions[idx + 2] += 2.4 * dt;
          if (positions[idx + 2] > 5.0) {
            positions[idx] = (Math.random() - 0.5) * 0.35;
            positions[idx + 1] = 0.2;
            positions[idx + 2] = 1.8 + Math.random() * 0.5;
          }
        }
        t3.exhaustParticles.geometry.attributes.position.needsUpdate = true;
      }

      // Render 3D Scene with Post-Processing Bloom
      if (t3.composer) {
        t3.composer.render();
      } else {
        t3.renderer.render(t3.scene, t3.camera);
      }
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="w-full h-full bg-slate-950 text-white select-none overflow-hidden relative font-sans" dir="rtl">
      {/* 3D WebGL Canvas with Touch Drag Look Around (حرّك إصبعك للنظر حولك بحرية) */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDownLook}
        onPointerMove={handlePointerMoveLook}
        onPointerUp={handlePointerUpLook}
        onPointerCancel={handlePointerUpLook}
        className="w-full h-full absolute inset-0 z-0 touch-none cursor-grab active:cursor-grabbing"
      />

      {/* ON-SCREEN TOUCH CONTROLS (ONLY RENDERED ON MOBILE TOUCH PLAY) */}
      {showTouchControls && (
        <div
          className="absolute inset-0 z-30 pointer-events-none flex flex-col justify-between p-4 md:p-6 select-none touch-none"
          dir="ltr"
        >
          {/* Top Mobile Bar: Camera Reset & Actions (Speed is displayed directly on the car's in-cabin OLED cluster) */}
          <div className="flex items-center justify-between w-full pointer-events-auto">
            {/* Camera Recenter Button (Speed is now displayed on in-car OLED gauge behind the wheel) */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetCameraLook}
                className="flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-md border border-slate-700/80 hover:border-amber-400/60 active:scale-95 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-300 shadow-lg transition-all"
                title="إعادة توجيه الكاميرا للأمام"
              >
                <Compass className="w-3.5 h-3.5 text-amber-400" />
                <span>توسيط الرؤية</span>
              </button>
            </div>

            {/* Mobile Action Controls: Pause & Back */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  initAudio();
                  const s = gameStateRef.current;
                  s.isPaused = !s.isPaused;
                  setIsPaused(s.isPaused);
                }}
                className="p-2.5 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-700/80 text-white backdrop-blur shadow-md active:scale-95"
                title="إيقاف مؤقت"
              >
                <Pause className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onBackToMenu}
                className="px-3 py-1.5 rounded-xl bg-slate-900/85 hover:bg-rose-950/70 border border-slate-700/80 hover:border-rose-500/50 text-slate-200 hover:text-rose-200 text-xs font-bold backdrop-blur shadow-md flex items-center gap-1.5 active:scale-95"
              >
                <span>خروج</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Bottom On-Screen Mobile DualSense PS5 Driving & Camera Controls */}
          <div className="w-full flex items-end justify-between pointer-events-auto pb-1 gap-2">
            {/* LEFT WING: Steering Left Analog Thumbstick & Quick Direction Arrows */}
            <div className="flex flex-col items-center gap-1.5">
              {/* Left Stick (عصا التوجيه والحركة L3) */}
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-slate-400 font-mono mb-0.5">
                  عصا التوجيه (L3)
                </span>
                <div
                  ref={leftStickBaseRef}
                  data-stick="left"
                  onPointerDown={handleLeftStickPointerDown}
                  onPointerMove={handleLeftStickPointerMove}
                  onPointerUp={handleLeftStickPointerUp}
                  onPointerCancel={handleLeftStickPointerUp}
                  className="relative w-28 h-28 md:w-32 md:h-32 rounded-full bg-gradient-to-b from-slate-900/90 to-slate-950/95 border-2 border-slate-700 shadow-2xl backdrop-blur-md flex items-center justify-center cursor-pointer touch-none select-none"
                >
                  <div className="w-18 h-18 rounded-full border border-slate-800 pointer-events-none" />
                  <div
                    className="absolute w-14 h-14 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-2 border-slate-300 shadow-xl flex items-center justify-center pointer-events-none"
                    style={{ transform: `translate(${touchLeftStickPos.x * 26}px, ${touchLeftStickPos.y * 26}px)` }}
                  >
                    <div className="w-6 h-6 rounded-full bg-slate-950/90 border border-slate-600 flex items-center justify-center text-cyan-400">
                      <Circle className="w-2.5 h-2.5 fill-current opacity-80" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Nudge Arrow Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleTouchDpadSteer('left');
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    handleTouchDpadSteer(null);
                  }}
                  onPointerLeave={() => handleTouchDpadSteer(null)}
                  onPointerCancel={() => handleTouchDpadSteer(null)}
                  className="w-9 h-7 rounded-lg bg-slate-900/80 border border-slate-700 text-slate-300 active:bg-amber-500/40 flex items-center justify-center text-xs"
                  aria-label="يسار"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleTouchDpadSteer('right');
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    handleTouchDpadSteer(null);
                  }}
                  onPointerLeave={() => handleTouchDpadSteer(null)}
                  onPointerCancel={() => handleTouchDpadSteer(null)}
                  className="w-9 h-7 rounded-lg bg-slate-900/80 border border-slate-700 text-slate-300 active:bg-amber-500/40 flex items-center justify-center text-xs"
                  aria-label="يمين"
                >
                  ▶
                </button>
              </div>
            </div>

            {/* RIGHT WING: PS5 Action Buttons Diamond (Top) & Right Camera Look Stick (Bottom) */}
            <div className="flex flex-col items-center gap-1.5">
              {/* PlayStation 5 Action Diamond: △ (Triangle/Handbrake), ▢ (Square/Brake), ○ (Circle/Horn), ✕ (Cross/Gas) */}
              <div className="relative w-28 h-28 rounded-full bg-slate-900/60 border border-slate-800 backdrop-blur-md flex items-center justify-center touch-none select-none">
                {/* Triangle (▲) - Handbrake (جلنط / تفحيط) */}
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handlePSButtonDown('TRIANGLE');
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    handlePSButtonUp('TRIANGLE');
                  }}
                  onPointerLeave={() => handlePSButtonUp('TRIANGLE')}
                  onPointerCancel={() => handlePSButtonUp('TRIANGLE')}
                  className={`absolute top-0 w-9 h-9 rounded-full border flex flex-col items-center justify-center font-bold transition-all shadow-md ${
                    activeTouchPSButtons.has('TRIANGLE')
                      ? 'bg-amber-500 border-amber-200 text-slate-950 scale-95 ring-2 ring-amber-400'
                      : 'bg-slate-900 border-amber-500/60 text-amber-400 hover:border-amber-400'
                  }`}
                  title="جلنط وتفحيط [مثلث]"
                >
                  <span className="text-xs">▲</span>
                  <span className="text-[7px] font-sans font-normal leading-none opacity-90">جلنط</span>
                </button>

                {/* Square (■) - Brake (فرامل) */}
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handlePSButtonDown('SQUARE');
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    handlePSButtonUp('SQUARE');
                  }}
                  onPointerLeave={() => handlePSButtonUp('SQUARE')}
                  onPointerCancel={() => handlePSButtonUp('SQUARE')}
                  className={`absolute left-0 w-9 h-9 rounded-full border flex flex-col items-center justify-center font-bold transition-all shadow-md ${
                    activeTouchPSButtons.has('SQUARE')
                      ? 'bg-rose-500 border-rose-200 text-white scale-95 ring-2 ring-rose-400'
                      : 'bg-slate-900 border-rose-500/60 text-rose-400 hover:border-rose-400'
                  }`}
                  title="فرامل [مربع]"
                >
                  <span className="text-xs">■</span>
                  <span className="text-[7px] font-sans font-normal leading-none opacity-90">فرامل</span>
                </button>

                {/* Circle (●) - Horn (بوري) */}
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handlePSButtonDown('CIRCLE');
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    handlePSButtonUp('CIRCLE');
                  }}
                  onPointerLeave={() => handlePSButtonUp('CIRCLE')}
                  onPointerCancel={() => handlePSButtonUp('CIRCLE')}
                  className={`absolute right-0 w-9 h-9 rounded-full border flex flex-col items-center justify-center font-bold transition-all shadow-md ${
                    activeTouchPSButtons.has('CIRCLE')
                      ? 'bg-indigo-600 border-indigo-200 text-white scale-95 ring-2 ring-indigo-400'
                      : 'bg-slate-900 border-indigo-500/60 text-indigo-300 hover:border-indigo-400'
                  }`}
                  title="بوري وتنبيه [دائرة]"
                >
                  <span className="text-xs">●</span>
                  <span className="text-[7px] font-sans font-normal leading-none opacity-90">بوري</span>
                </button>

                {/* Cross (✖) - Gas / Accelerate (بنزين) */}
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handlePSButtonDown('CROSS');
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    handlePSButtonUp('CROSS');
                  }}
                  onPointerLeave={() => handlePSButtonUp('CROSS')}
                  onPointerCancel={() => handlePSButtonUp('CROSS')}
                  className={`absolute bottom-0 w-9 h-9 rounded-full border-2 flex flex-col items-center justify-center font-black transition-all shadow-md ${
                    activeTouchPSButtons.has('CROSS')
                      ? 'bg-emerald-500 border-emerald-200 text-slate-950 scale-95 ring-2 ring-emerald-400'
                      : 'bg-slate-900 border-emerald-500/70 text-emerald-300 hover:border-emerald-400'
                  }`}
                  title="بنزين وتسارع [إكس]"
                >
                  <span className="text-xs">✖</span>
                  <span className="text-[7px] font-sans font-normal leading-none opacity-90">بنزين</span>
                </button>
              </div>

              {/* Right Stick (عصا الكاميرا والرؤية R3 - يمين يسار فوق تحت) */}
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-cyan-400 font-mono mb-0.5 flex items-center gap-1">
                  <Eye className="w-2.5 h-2.5" />
                  <span>عصا الكاميرا (R3)</span>
                </span>
                <div
                  ref={rightStickBaseRef}
                  data-stick="right"
                  onPointerDown={handleRightStickPointerDown}
                  onPointerMove={handleRightStickPointerMove}
                  onPointerUp={handleRightStickPointerUp}
                  onPointerCancel={handleRightStickPointerUp}
                  className="relative w-28 h-28 md:w-32 md:h-32 rounded-full bg-gradient-to-b from-slate-900/90 to-slate-950/95 border-2 border-cyan-700/60 shadow-2xl backdrop-blur-md flex items-center justify-center cursor-pointer touch-none select-none"
                >
                  <div className="w-18 h-18 rounded-full border border-cyan-900/50 pointer-events-none" />
                  <div
                    className="absolute w-14 h-14 rounded-full bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-2 border-cyan-400 shadow-xl flex items-center justify-center pointer-events-none"
                    style={{ transform: `translate(${touchRightStickPos.x * 26}px, ${touchRightStickPos.y * 26}px)` }}
                  >
                    <div className="w-6 h-6 rounded-full bg-slate-950/90 border border-cyan-500/70 flex items-center justify-center text-cyan-300">
                      <Compass className="w-3 h-3" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOP NOTIFICATIONS (Near Miss Alert & High Beam Indicator) */}
      <div className="relative z-20 w-full h-full pointer-events-none flex flex-col justify-between p-6">
        <div className="w-full flex items-start justify-between">
          <div>
            {nearMissAlert && (
              <div className="px-6 py-2.5 rounded-2xl bg-amber-500 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/40 animate-bounce border border-amber-300">
                <span>{nearMissAlert}</span>
              </div>
            )}
            {isHighBeaming && (
              <div className="mt-2 px-4 py-2 rounded-xl bg-cyan-400 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-cyan-400/50 animate-pulse border border-cyan-200">
                <span>تكبيس الكشافات [B / Y]</span>
              </div>
            )}
          </div>

          {/* Minimal High Score & Clean Exit Badge (Only on Touch/Mobile screen) */}
          <div className="flex items-center gap-3 pointer-events-auto">
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl px-3.5 py-1.5 text-right font-mono backdrop-blur-md">
              <span className="text-[10px] text-slate-400 block">أعلى سكور</span>
              <span className="text-xs font-bold text-amber-400">{highScore}</span>
            </div>

            {showTouchControls && (
              <button
                type="button"
                onClick={onBackToMenu}
                className="px-3.5 py-1.5 rounded-2xl bg-slate-900/80 hover:bg-rose-900/80 border border-slate-800 hover:border-rose-500/60 text-slate-300 hover:text-rose-200 font-bold text-xs transition-colors backdrop-blur-md shadow-lg"
              >
                خروج [SELECT]
              </button>
            )}
          </div>
        </div>

        <div className="w-full flex items-end justify-between"></div>
      </div>

      {/* WELCOME MODAL OVERLAY ("مرحباً بك في الغروب السريع" + زر بدء [A]) */}
      {isWelcomeModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 text-center select-none animate-in fade-in duration-300"
          dir="rtl"
        >
          <div className="max-w-lg w-full bg-slate-900/95 border-2 border-amber-500/50 rounded-3xl p-8 md:p-10 shadow-2xl shadow-amber-950/60 space-y-6 relative overflow-hidden">
            {/* Ambient orange sunset glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />

            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 text-xs font-bold font-mono">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>طريق الغروب السريع 3D</span>
            </div>

            {/* Main Welcome Message */}
            <div className="space-y-3">
              <h1 className="text-3xl md:text-4xl font-black text-white tracking-wide">
                مرحباً بك في الغروب السريع
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
                استعد لتجربة قيادة ممتعة على الطريق السريع في أجواء الشفق والغروب. انطلق وتفادَ المركبات واستمتع بالمقصورة الفاخرة.
              </p>
            </div>

            {/* Prominent Start Button with [A] shortcut */}
            <div className="pt-2">
              <button
                type="button"
                onClick={startGameFromWelcome}
                className="w-full py-4 px-8 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-600 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-white font-black text-xl shadow-2xl shadow-orange-600/50 border border-amber-300/40 transition-all transform hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3 cursor-pointer"
              >
                <Play className="w-6 h-6 fill-current" />
                <span>بدء [A]</span>
              </button>
            </div>

            {/* Control Guide */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 text-[11px] text-slate-400 font-mono border-t border-slate-800/80">
              <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-amber-400 font-bold block">التوجيه</span>
                <span>الأسهم / العصا</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-emerald-400 font-bold block">التسارع</span>
                <span>زر A / سهم فوق</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-rose-400 font-bold block">الفرامل</span>
                <span>زر L / سهم تحت</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-cyan-400 font-bold block">الكشافات</span>
                <span>زر B / مسافة</span>
              </div>
            </div>
          </div>
        </div>
      )}

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
