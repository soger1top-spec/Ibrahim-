import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RotateCcw } from 'lucide-react';
import { sounds } from './soundFx';
import { controllerBus } from '../services/controllerBus';

interface SunsetHighwayGameProps {
  onBackToMenu: () => void;
  controllerCommand?: any;
}

// -------------------------------------------------------------
// GAMEPLAY CONFIGURATION (Balanced Smooth Cruising & Stable FPS)
// -------------------------------------------------------------
const LANES_COUNT = 4;
const LANE_WIDTH = 3.6;
const ROAD_TOTAL_WIDTH = LANE_WIDTH * LANES_COUNT; // 14.4 units
const LANE_POSITIONS = [-5.4, -1.8, 1.8, 5.4];

const MAX_SPEED_KMH = 120;
const MIN_SPEED_KMH = 30;
const BASE_CRUISE_SPEED = 75; // Comfortable highway cruising speed
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
    isHighBeamActive: false,
    highBeamTimer: 0,
    scoreAcc: 0,
    distanceAccKm: 0,
    comboMultiplier: 1,
    comboTimer: 0,
    lastNearMissTime: 0,
    isGameOver: false,
    isPaused: false
  });

  // Sound Synth References (Engine sound ONLY - Music completely removed as requested)
  const audioContextRef = useRef<AudioContext | null>(null);
  const engineOscRef = useRef<OscillatorNode | null>(null);
  const engineGainRef = useRef<GainNode | null>(null);

  // Three.js Scene References
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    playerCarGroup: THREE.Group;
    steeringWheelGroup: THREE.Group;
    clusterTexture: THREE.CanvasTexture;
    clusterCtx: CanvasRenderingContext2D | null;
    gpsTexture: THREE.CanvasTexture;
    gpsCtx: CanvasRenderingContext2D | null;
    roadPlane: THREE.Mesh;
    terrainPlane: THREE.Mesh;
    laneLines: THREE.Mesh[];
    catEyes: THREE.Mesh[];
    sceneryItems: THREE.Group[];
    trafficPool: NPCTrafficCar[];
    headlightSpotL: THREE.SpotLight;
    headlightSpotR: THREE.SpotLight;
  } | null>(null);

  // -------------------------------------------------------------
  // REALISTIC ENGINE AUDIO (No background music, pure car revs)
  // -------------------------------------------------------------
  const initAudio = useCallback(() => {
    if (audioContextRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(45, ctx.currentTime);
      gain.gain.setValueAtTime(0.035, ctx.currentTime);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, ctx.currentTime);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      engineOscRef.current = osc;
      engineGainRef.current = gain;
    } catch {}
  }, []);

  const updateEngineAudio = useCallback((speed: number) => {
    if (!audioContextRef.current || !engineOscRef.current || !engineGainRef.current) return;
    try {
      const targetFreq = 42 + (speed / MAX_SPEED_KMH) * 80;
      engineOscRef.current.frequency.setTargetAtTime(targetFreq, audioContextRef.current.currentTime, 0.1);
      engineGainRef.current.gain.setTargetAtTime(0.03 + (speed / MAX_SPEED_KMH) * 0.035, audioContextRef.current.currentTime, 0.1);
    } catch {}
  }, []);

  // -------------------------------------------------------------
  // BUILD 3D TRAFFIC VEHICLES WITH 2.5D CONTACT SHADOWS (Zero GPU shadow-map overhead)
  // -------------------------------------------------------------
  const createTrafficCar = (isTruck: boolean, colorHex: number) => {
    const group = new THREE.Group();

    if (isTruck) {
      const cabMat = new THREE.MeshLambertMaterial({ color: 0xf1f5f9 });
      const boxMat = new THREE.MeshLambertMaterial({ color: 0xe2e8f0 });
      const darkMat = new THREE.MeshBasicMaterial({ color: 0x09090b });

      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 1.6), cabMat);
      cab.position.set(0, 0.9, -1.8);
      group.add(cab);

      const win = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.6, 0.05), darkMat);
      win.position.set(0, 1.15, -2.62);
      group.add(win);

      const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 4.2), boxMat);
      box.position.set(0, 1.5, 0.9);
      group.add(box);

      const tlMat = new THREE.MeshBasicMaterial({ color: 0xff1e1e });
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tlMat);
      tlL.position.set(-0.85, 0.8, 3.02);
      group.add(tlL);

      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tlMat);
      tlR.position.set(0.85, 0.8, 3.02);
      group.add(tlR);
    } else {
      const bodyMat = new THREE.MeshLambertMaterial({ color: colorHex });
      const glassMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.0), bodyMat);
      body.position.y = 0.55;
      group.add(body);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 2.1), glassMat);
      cabin.position.set(0, 1.1, -0.2);
      group.add(cabin);

      const tlMat = new THREE.MeshBasicMaterial({ color: 0xff1e1e });
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), tlMat);
      tlL.position.set(-0.65, 0.65, 2.02);
      group.add(tlL);

      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), tlMat);
      tlR.position.set(0.65, 0.65, 2.02);
      group.add(tlR);
    }

    // High-Contrast 2.5D Ground Contact Shadow (Extremely light & crisp)
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x050508,
      transparent: true,
      opacity: 0.8
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
  // BUILD FULLY ENCLOSED LUXURY CAR CABIN WITH OPEN WIDE DRIVER PERSPECTIVE
  // -------------------------------------------------------------
  const buildEnclosedLuxuryCabin = (playerCarGroup: THREE.Group, camera: THREE.PerspectiveCamera) => {
    // 1. Camera placed back at natural Driver Headrest position (Wider cabin breathing room)
    camera.position.set(-0.35, 1.14, 0.52);
    camera.rotation.set(-0.04, 0, 0); // Gentle downward glance taking in both road and cockpit
    camera.up.set(0, 1, 0);
    playerCarGroup.add(camera);

    // Optimized High-End Materials (Fast Lambert & Basic materials for locked 60FPS)
    const darkLeatherMat = new THREE.MeshLambertMaterial({ color: 0x0c0f17 });
    const roofHeadlinerMat = new THREE.MeshLambertMaterial({ color: 0x151821 });
    const dashTrimMat = new THREE.MeshLambertMaterial({ color: 0x181e2b });
    const chromeMat = new THREE.MeshLambertMaterial({ color: 0xd4d4d8 });
    const carbonMat = new THREE.MeshLambertMaterial({ color: 0x111622 });
    const carBonnetPaintMat = new THREE.MeshLambertMaterial({ color: 0x272e3d });

    // =========================================================
    // A. CAR ROOF & OVERHEAD CEILING (سقف السيارة المغطى بالكامل)
    // =========================================================
    const roofPanel = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.08, 1.8),
      roofHeadlinerMat
    );
    roofPanel.position.set(0, 1.50, 0.3);
    playerCarGroup.add(roofPanel);

    const windshieldHeader = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.12, 0.24),
      roofHeadlinerMat
    );
    windshieldHeader.position.set(0, 1.44, -0.42);
    windshieldHeader.rotation.x = 0.12;
    playerCarGroup.add(windshieldHeader);

    // Overhead Console
    const domeConsole = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.03, 0.22),
      dashTrimMat
    );
    domeConsole.position.set(0, 1.44, -0.15);
    playerCarGroup.add(domeConsole);

    const domeLight = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.015, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xffedd5 })
    );
    domeLight.position.set(0, 1.425, -0.15);
    playerCarGroup.add(domeLight);

    // Sun Visors (Driver & Passenger)
    const visorL = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.02, 0.18),
      roofHeadlinerMat
    );
    visorL.position.set(-0.45, 1.40, -0.35);
    visorL.rotation.x = 0.15;
    playerCarGroup.add(visorL);

    const visorR = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.02, 0.18),
      roofHeadlinerMat
    );
    visorR.position.set(0.45, 1.40, -0.35);
    visorR.rotation.x = 0.15;
    playerCarGroup.add(visorR);

    // =========================================================
    // B. WINDSHIELD PILLARS & WINDOWS (قوائم ودرايش السيارة)
    // =========================================================
    const pillarL = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.1, 0.09),
      roofHeadlinerMat
    );
    pillarL.position.set(-1.02, 1.06, -0.45);
    pillarL.rotation.z = -0.34;
    pillarL.rotation.x = 0.24;
    playerCarGroup.add(pillarL);

    const driverDoorTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 1.4),
      darkLeatherMat
    );
    driverDoorTop.position.set(-1.05, 1.44, 0.4);
    playerCarGroup.add(driverDoorTop);

    const driverDoorSill = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.55, 1.4),
      darkLeatherMat
    );
    driverDoorSill.position.set(-1.02, 0.72, 0.35);
    playerCarGroup.add(driverDoorSill);

    const pillarR = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.1, 0.09),
      roofHeadlinerMat
    );
    pillarR.position.set(1.02, 1.06, -0.45);
    pillarR.rotation.z = 0.34;
    pillarR.rotation.x = 0.24;
    playerCarGroup.add(pillarR);

    const passDoorTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 1.4),
      darkLeatherMat
    );
    passDoorTop.position.set(1.05, 1.44, 0.4);
    playerCarGroup.add(passDoorTop);

    // =========================================================
    // C. MIRRORS (المرآة الوسطية والجانبية)
    // =========================================================
    const centerMirrorGroup = new THREE.Group();
    centerMirrorGroup.position.set(0, 1.38, -0.38);

    const mirrorStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.07, 8),
      darkLeatherMat
    );
    mirrorStem.position.y = 0.035;
    centerMirrorGroup.add(mirrorStem);

    const mirrorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.09, 0.02),
      darkLeatherMat
    );
    centerMirrorGroup.add(mirrorFrame);

    const mirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.075),
      new THREE.MeshBasicMaterial({ color: 0x334155 })
    );
    mirrorGlass.position.set(0, 0, 0.011);
    centerMirrorGroup.add(mirrorGlass);
    playerCarGroup.add(centerMirrorGroup);

    // Left Wing Mirror
    const sideMirrorGroup = new THREE.Group();
    sideMirrorGroup.position.set(-1.14, 0.98, -0.42);

    const sideMount = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.04), darkLeatherMat);
    sideMirrorGroup.add(sideMount);

    const sideFrame = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.05), darkLeatherMat);
    sideFrame.position.x = -0.06;
    sideMirrorGroup.add(sideFrame);

    const sideGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x1e293b })
    );
    sideGlass.position.set(-0.06, 0, 0.026);
    sideGlass.rotation.y = 0.32;
    sideMirrorGroup.add(sideGlass);
    playerCarGroup.add(sideMirrorGroup);

    // =========================================================
    // D. DASHBOARD & CONSOLE (طبلون السيارة والقير والتكييف)
    // =========================================================
    const dashBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.44, 0.9),
      darkLeatherMat
    );
    dashBody.position.set(0, 0.55, -0.72);
    playerCarGroup.add(dashBody);

    // Metallic Car Bonnet extending forward
    const bonnetMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.95, 0.14, 2.3),
      carBonnetPaintMat
    );
    bonnetMesh.position.set(0, 0.46, -2.0);
    bonnetMesh.rotation.x = -0.065;
    playerCarGroup.add(bonnetMesh);

    // Ambient Neon Light Strip
    const ambientNeon = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.014, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x06b6d4 })
    );
    ambientNeon.position.set(0, 0.72, -0.62);
    playerCarGroup.add(ambientNeon);

    // Center Console
    const centerConsole = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.45, 1.0),
      dashTrimMat
    );
    centerConsole.position.set(0.08, 0.32, -0.05);
    playerCarGroup.add(centerConsole);

    // Automatic Gear Shifter
    const shifterPlate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.18), chromeMat);
    shifterPlate.position.set(0.06, 0.55, 0.05);
    playerCarGroup.add(shifterPlate);

    const shifterStick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), chromeMat);
    shifterStick.position.set(0.06, 0.60, 0.05);
    playerCarGroup.add(shifterStick);

    const shifterKnob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 14), darkLeatherMat);
    shifterKnob.position.set(0.06, 0.66, 0.05);
    playerCarGroup.add(shifterKnob);

    // AC Vents
    const ventMat = new THREE.MeshBasicMaterial({ color: 0x090d14 });
    const ventL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.02), ventMat);
    ventL.position.set(-0.06, 0.68, -0.64);
    playerCarGroup.add(ventL);

    const ventR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.02), ventMat);
    ventR.position.set(0.06, 0.68, -0.64);
    playerCarGroup.add(ventR);

    // =========================================================
    // E. DRIVER GAUGE CLUSTER (مدمج وراء الدركسون على اليسار)
    // =========================================================
    const cowlMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.24, 0.38),
      dashTrimMat
    );
    cowlMesh.position.set(-0.35, 0.78, -0.72);
    cowlMesh.rotation.x = -0.15;
    playerCarGroup.add(cowlMesh);

    const clusterCanvas = document.createElement('canvas');
    clusterCanvas.width = 512;
    clusterCanvas.height = 256;
    const clusterCtx = clusterCanvas.getContext('2d');
    const clusterTexture = new THREE.CanvasTexture(clusterCanvas);
    clusterTexture.minFilter = THREE.LinearFilter;

    const clusterScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.20),
      new THREE.MeshBasicMaterial({ map: clusterTexture })
    );
    clusterScreen.position.set(-0.35, 0.78, -0.65);
    clusterScreen.rotation.x = -0.16;
    playerCarGroup.add(clusterScreen);

    // Center Infotainment GPS Screen
    const gpsCanvas = document.createElement('canvas');
    gpsCanvas.width = 512;
    gpsCanvas.height = 256;
    const gpsCtx = gpsCanvas.getContext('2d');
    const gpsTexture = new THREE.CanvasTexture(gpsCanvas);
    gpsTexture.minFilter = THREE.LinearFilter;

    const gpsHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.22, 0.04),
      carbonMat
    );
    gpsHousing.position.set(0.24, 0.74, -0.68);
    gpsHousing.rotation.y = 0.24;
    gpsHousing.rotation.x = -0.12;
    playerCarGroup.add(gpsHousing);

    const gpsScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.35, 0.19),
      new THREE.MeshBasicMaterial({ map: gpsTexture })
    );
    gpsScreen.position.set(0, 0, 0.024);
    gpsHousing.add(gpsScreen);

    // =========================================================
    // F. REAL 3D STEERING WHEEL (دركسون 3D حقيقي على اليسار)
    // =========================================================
    const columnMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.048, 0.058, 0.45, 14),
      darkLeatherMat
    );
    columnMesh.position.set(-0.35, 0.65, -0.46);
    columnMesh.rotation.x = Math.PI / 3.8;
    playerCarGroup.add(columnMesh);

    const steeringWheelGroup = new THREE.Group();
    steeringWheelGroup.position.set(-0.35, 0.78, -0.25);
    steeringWheelGroup.rotation.x = -0.24;

    const rimGeo = new THREE.TorusGeometry(0.20, 0.027, 14, 30);
    const rimMat = new THREE.MeshLambertMaterial({ color: 0x18181b });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    steeringWheelGroup.add(rimMesh);

    const stripeGeo = new THREE.TorusGeometry(0.20, 0.028, 8, 8, Math.PI / 10);
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
    const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
    stripeMesh.rotation.z = Math.PI / 2 - Math.PI / 20;
    steeringWheelGroup.add(stripeMesh);

    const innerRingGeo = new THREE.TorusGeometry(0.155, 0.005, 8, 24);
    const innerRingMesh = new THREE.Mesh(innerRingGeo, chromeMat);
    steeringWheelGroup.add(innerRingMesh);

    const hubGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.025, 20);
    const hubMat = new THREE.MeshLambertMaterial({ color: 0x222733 });
    const hubMesh = new THREE.Mesh(hubGeo, hubMat);
    hubMesh.rotation.x = Math.PI / 2;
    steeringWheelGroup.add(hubMesh);

    const emblemGeo = new THREE.CircleGeometry(0.02, 16);
    const emblemMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const emblemMesh = new THREE.Mesh(emblemGeo, emblemMat);
    emblemMesh.position.set(0, 0, 0.014);
    steeringWheelGroup.add(emblemMesh);

    const spokeMat = new THREE.MeshLambertMaterial({ color: 0x52525b });

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

    const paddleGeo = new THREE.BoxGeometry(0.025, 0.08, 0.01);
    const paddleL = new THREE.Mesh(paddleGeo, chromeMat);
    paddleL.position.set(-0.16, 0.03, -0.025);
    steeringWheelGroup.add(paddleL);

    const paddleR = new THREE.Mesh(paddleGeo, chromeMat);
    paddleR.position.set(0.16, 0.03, -0.025);
    steeringWheelGroup.add(paddleR);

    playerCarGroup.add(steeringWheelGroup);

    // =========================================================
    // G. DUAL HEADLIGHT SPOTLIGHTS
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
      clusterTexture,
      clusterCtx,
      gpsTexture,
      gpsCtx,
      headlightSpotL,
      headlightSpotR
    };
  };

  // -------------------------------------------------------------
  // DRAW DYNAMIC CLUSTER & GPS CANVASES
  // -------------------------------------------------------------
  const updateClusterScreen = (ctx: CanvasRenderingContext2D, speed: number, distance: number) => {
    ctx.clearRect(0, 0, 512, 256);

    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, 512, 256);

    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 504, 248);

    ctx.fillStyle = '#06b6d4';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('● CRUISE AUTO', 24, 38);

    ctx.fillStyle = '#10b981';
    ctx.fillText('SPORT [D7]', 370, 38);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('SPEED', 24, 85);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 84px monospace';
    ctx.fillText(`${speed}`, 20, 168);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 24px monospace';
    ctx.fillText('KM/H', 185, 160);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('TRIP ODO', 340, 85);

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 44px monospace';
    ctx.fillText(`${distance}`, 330, 140);
    ctx.font = 'bold 20px monospace';
    ctx.fillText('KM', 445, 140);

    const rpmPercent = Math.min(1.0, speed / MAX_SPEED_KMH);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(24, 205, 464, 18);

    const grad = ctx.createLinearGradient(24, 0, 488, 0);
    grad.addColorStop(0, '#06b6d4');
    grad.addColorStop(0.6, '#10b981');
    grad.addColorStop(1.0, '#f59e0b');
    ctx.fillStyle = grad;
    ctx.fillRect(24, 205, 464 * rpmPercent, 18);
  };

  const updateGpsScreen = (ctx: CanvasRenderingContext2D, speed: number) => {
    ctx.clearRect(0, 0, 512, 256);

    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, 512, 256);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    for (let x = 0; x < 512; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
    }
    for (let y = 0; y < 256; y += 45) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }

    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(30, 200);
    ctx.quadraticCurveTo(220, 160, 280, 120);
    ctx.quadraticCurveTo(340, 80, 480, 50);
    ctx.stroke();

    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(220, 150, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(220, 150, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(16, 12, 480, 44);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(16, 12, 480, 44);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('↱ بعد 2.4 كم: مخرج طريق الساحل', 32, 42);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(455, 34, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('120', 455, 40);
    ctx.textAlign = 'left';

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(16, 215, 480, 32);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('طريق الغروب السريع • ETA 18:45', 28, 237);
  };

  // -------------------------------------------------------------
  // INITIALIZE THREE.JS SCENE (Optimized for locked 60FPS on TV GPU)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

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
    scene.fog = new THREE.FogExp2(0x581c87, 0.0055);

    // 2. Camera Setup (Wide panoramic view centered naturally with road)
    const camera = new THREE.PerspectiveCamera(66, width / height, 0.1, 320);

    // 3. Renderer with Smart Performance Options (No dynamic shadow map stall)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.appendChild(renderer.domElement);

    // 4. Lighting (Warm sunset sun + deep twilight ambient fill)
    const sunLight = new THREE.DirectionalLight(0xffa254, 2.2);
    sunLight.position.set(60, 20, -90);
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0x4338ca, 0.85);
    scene.add(ambientLight);

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
      clusterTexture,
      clusterCtx,
      gpsTexture,
      gpsCtx,
      headlightSpotL,
      headlightSpotR
    } = buildEnclosedLuxuryCabin(playerCarGroup, camera);

    if (clusterCtx) updateClusterScreen(clusterCtx, BASE_CRUISE_SPEED, 0);
    if (gpsCtx) updateGpsScreen(gpsCtx, BASE_CRUISE_SPEED);
    clusterTexture.needsUpdate = true;
    gpsTexture.needsUpdate = true;

    // 6. Vast Ground Terrain
    const terrainMat = new THREE.MeshLambertMaterial({
      color: 0x0f172a
    });
    const terrainPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(600, ROAD_SEGMENT_LENGTH),
      terrainMat
    );
    terrainPlane.rotation.x = -Math.PI / 2;
    terrainPlane.position.set(0, -0.04, -ROAD_SEGMENT_LENGTH / 2 + 20);
    scene.add(terrainPlane);

    // 7. Matte Dark Asphalt Highway
    const roadMat = new THREE.MeshLambertMaterial({
      color: 0x11161f
    });
    const roadPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_TOTAL_WIDTH + 4, ROAD_SEGMENT_LENGTH),
      roadMat
    );
    roadPlane.rotation.x = -Math.PI / 2;
    roadPlane.position.set(0, 0, -ROAD_SEGMENT_LENGTH / 2 + 20);
    scene.add(roadPlane);

    // Guardrails Left and Right
    const guardMat = new THREE.MeshLambertMaterial({ color: 0x475569 });
    const guardGeo = new THREE.BoxGeometry(0.45, 0.5, ROAD_SEGMENT_LENGTH);

    const guardL = new THREE.Mesh(guardGeo, guardMat);
    guardL.position.set(-ROAD_TOTAL_WIDTH / 2 - 1.2, 0.25, -ROAD_SEGMENT_LENGTH / 2 + 20);
    scene.add(guardL);

    const guardR = new THREE.Mesh(guardGeo, guardMat);
    guardR.position.set(ROAD_TOTAL_WIDTH / 2 + 1.2, 0.25, -ROAD_SEGMENT_LENGTH / 2 + 20);
    scene.add(guardR);

    // Solid Edge Lines
    const edgeLineMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const edgeLineGeo = new THREE.BoxGeometry(0.2, 0.02, ROAD_SEGMENT_LENGTH);

    const edgeLineL = new THREE.Mesh(edgeLineGeo, edgeLineMat);
    edgeLineL.position.set(-ROAD_TOTAL_WIDTH / 2, 0.015, -ROAD_SEGMENT_LENGTH / 2 + 20);
    scene.add(edgeLineL);

    const edgeLineR = new THREE.Mesh(edgeLineGeo, edgeLineMat);
    edgeLineR.position.set(ROAD_TOTAL_WIDTH / 2, 0.015, -ROAD_SEGMENT_LENGTH / 2 + 20);
    scene.add(edgeLineR);

    // Dashed Lane Lines
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

    // 9. Scenery Props
    const sceneryItems: THREE.Group[] = [];
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x1e293b });
    const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const treeTrunkMat = new THREE.MeshLambertMaterial({ color: 0x27170a });
    const treeLeafMat = new THREE.MeshLambertMaterial({ color: 0x14532d });

    for (let z = -ROAD_SEGMENT_LENGTH + 20; z < 20; z += 30) {
      const propGroup = new THREE.Group();

      const lampL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7.5, 8), poleMat);
      lampL.position.set(-ROAD_TOTAL_WIDTH / 2 - 2.8, 3.75, 0);
      propGroup.add(lampL);

      const armL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.2), poleMat);
      armL.position.set(-ROAD_TOTAL_WIDTH / 2 - 2.0, 7.4, 0);
      propGroup.add(armL);

      const bulbL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.2), lampHeadMat);
      bulbL.position.set(-ROAD_TOTAL_WIDTH / 2 - 1.3, 7.3, 0);
      propGroup.add(bulbL);

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 3.2, 8), treeTrunkMat);
      trunk.position.set(ROAD_TOTAL_WIDTH / 2 + 5.0, 1.6, 0);
      propGroup.add(trunk);

      const leaves = new THREE.Mesh(new THREE.DodecahedronGeometry(1.7, 0), treeLeafMat);
      leaves.position.set(ROAD_TOTAL_WIDTH / 2 + 5.0, 4.2, 0);
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

    threeRef.current = {
      scene,
      camera,
      renderer,
      playerCarGroup,
      steeringWheelGroup,
      clusterTexture,
      clusterCtx,
      gpsTexture,
      gpsCtx,
      roadPlane,
      terrainPlane,
      laneLines,
      catEyes,
      sceneryItems,
      trafficPool,
      headlightSpotL,
      headlightSpotR
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
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      threeRef.current = null;
    };
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
  // CONTROLLER COMMAND HANDLER
  // -------------------------------------------------------------
  const handleControllerCommand = useCallback((cmd: any) => {
    if (!cmd) return;
    initAudio();
    const s = gameStateRef.current;

    if (cmd.type === 'stick_move' && cmd.stick) {
      s.steerAngle = Math.max(-1, Math.min(1, cmd.stick.x * 1.15));
      if (cmd.stick.y < -0.22) {
        s.isAccelerating = true;
        s.isBraking = false;
      } else if (cmd.stick.y > 0.28) {
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
      if (['B', 'Y'].includes(cmd.button)) triggerManualHeadlightFlash();
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
  }, [initAudio, onBackToMenu, triggerManualHeadlightFlash]);

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
  }, [initAudio, onBackToMenu, triggerManualHeadlightFlash]);

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
        car.speedKmh = 48 + Math.random() * 18;
        car.targetSpeedKmh = car.speedKmh;
        car.mesh.position.set(car.x, 0, car.z);
      });
    }
  }, []);

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

      updateEngineAudio(s.speedKmh);

      const worldSpeed = (s.speedKmh / 3.6) * 0.22;

      // 2. Smooth Steering Damping & 3D Wheel Rotation
      s.smoothSteer += (s.steerAngle - s.smoothSteer) * Math.min(1, dt * 8.0);
      const steerSpeed = 4.2 * (0.85 + s.speedKmh / 160);
      s.playerX += s.smoothSteer * steerSpeed * dt;
      s.playerX = Math.max(-ROAD_TOTAL_WIDTH / 2 + 1.2, Math.min(ROAD_TOTAL_WIDTH / 2 - 1.2, s.playerX));

      t3.playerCarGroup.position.x = s.playerX;

      // Real 3D Steering Wheel Turning smoothly with driver hands
      if (t3.steeringWheelGroup) {
        t3.steeringWheelGroup.rotation.z = -s.smoothSteer * 2.2;
      }

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

      // Update In-Car Dynamic Cockpit Screens (Throttled for zero GPU stall)
      hudTimer += dt;
      if (hudTimer >= 0.1) {
        hudTimer = 0;
        const spd = Math.round(s.speedKmh);
        const dist = parseFloat(s.distanceAccKm.toFixed(1));

        setCurrentSpeed(spd);
        setDistanceKm(dist);
        setScore(Math.floor(s.scoreAcc));

        if (t3.clusterCtx) {
          updateClusterScreen(t3.clusterCtx, spd, dist);
          t3.clusterTexture.needsUpdate = true;
        }
        if (t3.gpsCtx) {
          updateGpsScreen(t3.gpsCtx, spd);
          t3.gpsTexture.needsUpdate = true;
        }
      }

      // Render 3D Scene (Smooth, lightweight, zero lag)
      t3.renderer.render(t3.scene, t3.camera);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [updateEngineAudio]);

  return (
    <div className="w-screen h-screen bg-slate-950 text-white select-none overflow-hidden relative font-sans" dir="rtl">
      {/* 3D WebGL Canvas (Hosts the Highway and Full Enclosed Luxury Cockpit) */}
      <div ref={containerRef} className="w-full h-full absolute inset-0 z-0" />

      {/* TOP NOTIFICATIONS (Near Miss Alert & High Beam indicator) */}
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

          {/* Minimal High Score & Clean Exit Badge (Unobtrusive) */}
          <div className="flex items-center gap-3 pointer-events-auto">
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl px-3.5 py-1.5 text-right font-mono backdrop-blur-md">
              <span className="text-[10px] text-slate-400 block">أعلى سكور</span>
              <span className="text-xs font-bold text-amber-400">{highScore}</span>
            </div>

            <button
              type="button"
              onClick={onBackToMenu}
              className="px-3.5 py-1.5 rounded-2xl bg-slate-900/80 hover:bg-rose-900/80 border border-slate-800 hover:border-rose-500/60 text-slate-300 hover:text-rose-200 font-bold text-xs transition-colors backdrop-blur-md shadow-lg"
            >
              خروج [SELECT]
            </button>
          </div>
        </div>

        {/* Minimal Bottom Space */}
        <div className="w-full flex items-end justify-between"></div>
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
