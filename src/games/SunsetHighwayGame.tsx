import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RotateCcw, Lightbulb, Compass, Navigation } from 'lucide-react';
import { sounds } from './soundFx';
import { controllerBus } from '../services/controllerBus';

interface SunsetHighwayGameProps {
  onBackToMenu: () => void;
  controllerCommand?: any;
}

// -------------------------------------------------------------
// GAMEPLAY CONFIGURATION (Balanced Realistic Cruising Speed)
// -------------------------------------------------------------
const LANES_COUNT = 4;
const LANE_WIDTH = 3.6;
const ROAD_TOTAL_WIDTH = LANE_WIDTH * LANES_COUNT; // 14.4 units
const LANE_POSITIONS = [-5.4, -1.8, 1.8, 5.4];

const MAX_SPEED_KMH = 125;
const MIN_SPEED_KMH = 30;
const BASE_CRUISE_SPEED = 75; // Natural smooth cruising speed
const ACCEL_RATE = 30;
const BRAKE_RATE = 75;
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
  const [trafficPositions, setTrafficPositions] = useState<{ x: number; z: number }[]>([]);

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

  // Sound Synth References (Engine sound & ambient synthwave loop)
  const audioContextRef = useRef<AudioContext | null>(null);
  const engineOscRef = useRef<OscillatorNode | null>(null);
  const engineGainRef = useRef<GainNode | null>(null);
  const synthwaveTimerRef = useRef<number | null>(null);

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
  // AUDIO ENGINE (Engine sound revs & ambient Synthwave chords)
  // -------------------------------------------------------------
  const initAudio = useCallback(() => {
    if (audioContextRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      // Engine sound oscillator
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(45, ctx.currentTime);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);

      // Low-pass filter for engine warmth
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, ctx.currentTime);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      engineOscRef.current = osc;
      engineGainRef.current = gain;

      // Ambient Synthwave Chord Progression Generator
      const synthChords = [
        [146.83, 220.0, 261.63], // Dm
        [174.61, 220.0, 261.63], // F
        [130.81, 196.0, 261.63], // C
        [196.0, 246.94, 293.66]  // G
      ];
      let chordIndex = 0;

      const playNextChord = () => {
        if (!audioContextRef.current || audioContextRef.current.state === 'suspended') return;
        const now = audioContextRef.current.currentTime;
        const freqs = synthChords[chordIndex % synthChords.length];
        chordIndex++;

        freqs.forEach(freq => {
          if (!audioContextRef.current) return;
          const sOsc = audioContextRef.current.createOscillator();
          const sGain = audioContextRef.current.createGain();
          sOsc.type = 'sine';
          sOsc.frequency.setValueAtTime(freq, now);

          sGain.gain.setValueAtTime(0.015, now);
          sGain.gain.linearRampToValueAtTime(0.035, now + 1.2);
          sGain.gain.linearRampToValueAtTime(0.001, now + 3.8);

          sOsc.connect(sGain);
          sGain.connect(audioContextRef.current.destination);
          sOsc.start(now);
          sOsc.stop(now + 3.8);
        });
      };

      synthwaveTimerRef.current = window.setInterval(playNextChord, 4000);
      playNextChord();
    } catch {
      // Audio context might be restricted before user gesture
    }
  }, []);

  // Update engine audio pitch dynamically with speed
  const updateEngineAudio = useCallback((speed: number) => {
    if (!audioContextRef.current || !engineOscRef.current || !engineGainRef.current) return;
    try {
      const targetFreq = 42 + (speed / MAX_SPEED_KMH) * 85;
      engineOscRef.current.frequency.setTargetAtTime(targetFreq, audioContextRef.current.currentTime, 0.1);
      engineGainRef.current.gain.setTargetAtTime(0.035 + (speed / MAX_SPEED_KMH) * 0.04, audioContextRef.current.currentTime, 0.1);
    } catch {}
  }, []);

  // -------------------------------------------------------------
  // BUILD 3D TRAFFIC VEHICLES (Low-poly & High performance)
  // -------------------------------------------------------------
  const createTrafficCar = (isTruck: boolean, colorHex: number) => {
    const group = new THREE.Group();

    if (isTruck) {
      const cabMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5, metalness: 0.2 });
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6, metalness: 0.1 });
      const darkMat = new THREE.MeshBasicMaterial({ color: 0x09090b });

      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 1.6), cabMat);
      cab.position.set(0, 0.9, -1.8);
      cab.castShadow = true;
      group.add(cab);

      const win = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.6, 0.05), darkMat);
      win.position.set(0, 1.15, -2.62);
      group.add(win);

      const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 4.2), boxMat);
      box.position.set(0, 1.5, 0.9);
      box.castShadow = true;
      group.add(box);

      const tlMat = new THREE.MeshBasicMaterial({ color: 0xff1e1e });
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tlMat);
      tlL.position.set(-0.85, 0.8, 3.02);
      group.add(tlL);

      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tlMat);
      tlR.position.set(0.85, 0.8, 3.02);
      group.add(tlR);
    } else {
      const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.5 });
      const glassMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.0), bodyMat);
      body.position.y = 0.55;
      body.castShadow = true;
      group.add(body);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 2.1), glassMat);
      cabin.position.set(0, 1.1, -0.2);
      cabin.castShadow = true;
      group.add(cabin);

      const tlMat = new THREE.MeshBasicMaterial({ color: 0xff1e1e });
      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), tlMat);
      tlL.position.set(-0.65, 0.65, 2.02);
      group.add(tlL);

      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), tlMat);
      tlR.position.set(0.65, 0.65, 2.02);
      group.add(tlR);
    }

    // High-Contrast Ground Shadow
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
  // BUILD FULL LUXURY COCKPIT (Driver View: Wheel, Cluster, Shifter, Vents, Mirrors)
  // -------------------------------------------------------------
  const buildTrueDriverCockpit = (playerCarGroup: THREE.Group, camera: THREE.PerspectiveCamera) => {
    // 1. Camera situated at natural Driver Eye Level pulled back so the cockpit is fully visible
    camera.position.set(-0.36, 1.14, 0.48);
    camera.rotation.set(-0.04, 0, 0); // Gentle downward glance taking in both road and cockpit
    camera.up.set(0, 1, 0);
    playerCarGroup.add(camera);

    // Materials
    const darkLeatherMat = new THREE.MeshStandardMaterial({ color: 0x0f131a, roughness: 0.7, metalness: 0.2 });
    const dashTrimMat = new THREE.MeshStandardMaterial({ color: 0x1a202c, roughness: 0.5, metalness: 0.3 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.15, metalness: 0.9 });
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x141824, roughness: 0.4, metalness: 0.6 });
    const carBonnetPaintMat = new THREE.MeshStandardMaterial({ color: 0x272e3d, roughness: 0.2, metalness: 0.7 });

    // 2. Metallic Car Bonnet (Hood) Extending Forward in Front of Windshield
    const bonnetMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.12, 2.1),
      carBonnetPaintMat
    );
    bonnetMesh.position.set(0, 0.46, -1.8);
    bonnetMesh.rotation.x = -0.06;
    bonnetMesh.castShadow = true;
    playerCarGroup.add(bonnetMesh);

    // 3. Lower Dashboard Base
    const dashBase = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 0.35, 0.8),
      darkLeatherMat
    );
    dashBase.position.set(0, 0.52, -0.65);
    dashBase.castShadow = true;
    playerCarGroup.add(dashBase);

    // Ambient Neon LED Strip running across dashboard
    const neonGeo = new THREE.BoxGeometry(2.0, 0.015, 0.02);
    const neonMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
    const ambientNeon = new THREE.Mesh(neonGeo, neonMat);
    ambientNeon.position.set(0, 0.68, -0.55);
    playerCarGroup.add(ambientNeon);

    // 4. Center Console with Gear Shifter (القير) and Air Vents (التكييف)
    const centerConsole = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.45, 0.9),
      dashTrimMat
    );
    centerConsole.position.set(0.12, 0.30, -0.05);
    playerCarGroup.add(centerConsole);

    // Gear Shifter (قير السيارة الفاخر من الكروم والجلد)
    const shifterBase = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.02, 16), chromeMat);
    shifterBase.position.set(0.08, 0.54, 0.05);
    playerCarGroup.add(shifterBase);

    const shifterStick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 8), chromeMat);
    shifterStick.position.set(0.08, 0.59, 0.05);
    playerCarGroup.add(shifterStick);

    const shifterKnob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 16), darkLeatherMat);
    shifterKnob.position.set(0.08, 0.65, 0.05);
    playerCarGroup.add(shifterKnob);

    // AC Air Vents (فتحات التكييف الأنيقة)
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x090d14, metalness: 0.8, roughness: 0.3 });
    const ventL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.02), ventMat);
    ventL.position.set(-0.06, 0.65, -0.58);
    playerCarGroup.add(ventL);

    const ventR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.02), ventMat);
    ventR.position.set(0.06, 0.65, -0.58);
    playerCarGroup.add(ventR);

    // 5. Driver Instrument Cowl & Hood
    const cowlMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.24, 0.36),
      dashTrimMat
    );
    cowlMesh.position.set(-0.36, 0.76, -0.65);
    cowlMesh.rotation.x = -0.15;
    playerCarGroup.add(cowlMesh);

    // 6. Driver Digital Gauge Cluster (Seamlessly Framed Behind Steering Wheel)
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
    clusterScreen.position.set(-0.36, 0.76, -0.58);
    clusterScreen.rotation.x = -0.16;
    playerCarGroup.add(clusterScreen);

    // 7. Center Infotainment Screen (GPS Navigation Display)
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
    gpsHousing.position.set(0.24, 0.72, -0.62);
    gpsHousing.rotation.y = 0.25; // Angled cleanly towards driver
    gpsHousing.rotation.x = -0.12;
    playerCarGroup.add(gpsHousing);

    const gpsScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.35, 0.19),
      new THREE.MeshBasicMaterial({ map: gpsTexture })
    );
    gpsScreen.position.set(0, 0, 0.024);
    gpsHousing.add(gpsScreen);

    // 8. Steering Column (Solid connection from dashboard to wheel)
    const columnMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.048, 0.058, 0.42, 16),
      darkLeatherMat
    );
    columnMesh.position.set(-0.36, 0.64, -0.42);
    columnMesh.rotation.x = Math.PI / 3.8;
    columnMesh.castShadow = true;
    playerCarGroup.add(columnMesh);

    // 9. REAL 3D STEERING WHEEL (Full 3D Torus, Spokes, Hub, Paddle Shifters)
    const steeringWheelGroup = new THREE.Group();
    steeringWheelGroup.position.set(-0.36, 0.76, -0.22);
    steeringWheelGroup.rotation.x = -0.24; // Ergonomic tilt facing driver
    steeringWheelGroup.castShadow = true;

    // Outer Thick Leather Rim (Torus)
    const rimGeo = new THREE.TorusGeometry(0.20, 0.027, 16, 36);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.6,
      metalness: 0.2
    });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.castShadow = true;
    steeringWheelGroup.add(rimMesh);

    // Top 12 o'clock Racing Alignment Ring
    const stripeGeo = new THREE.TorusGeometry(0.20, 0.028, 8, 8, Math.PI / 10);
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
    const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
    stripeMesh.rotation.z = Math.PI / 2 - Math.PI / 20;
    steeringWheelGroup.add(stripeMesh);

    // Inner Polished Chrome Accent Ring
    const innerRingGeo = new THREE.TorusGeometry(0.155, 0.005, 8, 32);
    const innerRingMesh = new THREE.Mesh(innerRingGeo, chromeMat);
    steeringWheelGroup.add(innerRingMesh);

    // Center Hub (Cylinder)
    const hubGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.025, 24);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x222733, roughness: 0.3, metalness: 0.5 });
    const hubMesh = new THREE.Mesh(hubGeo, hubMat);
    hubMesh.rotation.x = Math.PI / 2;
    hubMesh.castShadow = true;
    steeringWheelGroup.add(hubMesh);

    // Golden Luxury Crest Emblem
    const emblemGeo = new THREE.CircleGeometry(0.02, 16);
    const emblemMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const emblemMesh = new THREE.Mesh(emblemGeo, emblemMat);
    emblemMesh.position.set(0, 0, 0.014);
    steeringWheelGroup.add(emblemMesh);

    // 3 Brushed Metal / Carbon Fiber Spokes
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x52525b, roughness: 0.3, metalness: 0.8 });

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

    // Dual Paddle Shifters
    const paddleGeo = new THREE.BoxGeometry(0.025, 0.08, 0.01);
    const paddleL = new THREE.Mesh(paddleGeo, chromeMat);
    paddleL.position.set(-0.16, 0.03, -0.025);
    steeringWheelGroup.add(paddleL);

    const paddleR = new THREE.Mesh(paddleGeo, chromeMat);
    paddleR.position.set(0.16, 0.03, -0.025);
    steeringWheelGroup.add(paddleR);

    playerCarGroup.add(steeringWheelGroup);

    // 10. Tucked Left A-Pillar (Shifted far left to frame window naturally without blocking sky)
    const leftPillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 1.2, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x090d14, roughness: 0.9 })
    );
    leftPillar.position.set(-1.18, 1.15, -0.15);
    leftPillar.rotation.z = -0.32;
    playerCarGroup.add(leftPillar);

    // Left Wing Mirror (مرآة جانبية عاكسة للطريق خلفك)
    const sideMirrorGroup = new THREE.Group();
    sideMirrorGroup.position.set(-1.12, 0.98, -0.30);
    const sideMirrorHousing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.06), darkLeatherMat);
    sideMirrorGroup.add(sideMirrorHousing);
    const sideMirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x1e293b })
    );
    sideMirrorGlass.position.set(0, 0, 0.032);
    sideMirrorGlass.rotation.y = 0.35;
    sideMirrorGroup.add(sideMirrorGlass);
    playerCarGroup.add(sideMirrorGroup);

    // 11. Center Rearview Mirror (Hanging above)
    const mirrorGroup = new THREE.Group();
    mirrorGroup.position.set(0.08, 1.40, -0.25);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 8), darkLeatherMat);
    stem.position.y = 0.04;
    mirrorGroup.add(stem);

    const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.02), darkLeatherMat);
    mirrorGroup.add(mirrorFrame);

    const mirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.065),
      new THREE.MeshBasicMaterial({ color: 0x334155 })
    );
    mirrorGlass.position.set(0, 0, 0.011);
    mirrorGroup.add(mirrorGlass);

    playerCarGroup.add(mirrorGroup);

    // 12. DUAL POWERFUL HEADLIGHT SPOTLIGHTS (إضاءة كشافات واقعية تنير الأسفلت بوضوح)
    const headlightSpotL = new THREE.SpotLight(0xfff7ed, 6, 140, Math.PI / 3.8, 0.6, 1);
    headlightSpotL.position.set(-0.7, 0.45, -1.2);
    headlightSpotL.target.position.set(-0.7, 0, -45);
    playerCarGroup.add(headlightSpotL);
    playerCarGroup.add(headlightSpotL.target);

    const headlightSpotR = new THREE.SpotLight(0xfff7ed, 6, 140, Math.PI / 3.8, 0.6, 1);
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

    // Ambient Cyan Border
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 504, 248);

    // Top Indicators
    ctx.fillStyle = '#06b6d4';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('● CRUISE AUTO', 24, 38);

    ctx.fillStyle = '#10b981';
    ctx.fillText('SPORT [D7]', 370, 38);

    // Speed Digital Readout
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('SPEED', 24, 85);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 84px monospace';
    ctx.fillText(`${speed}`, 20, 168);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 24px monospace';
    ctx.fillText('KM/H', 185, 160);

    // Trip Odometer
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('TRIP ODO', 340, 85);

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 44px monospace';
    ctx.fillText(`${distance}`, 330, 140);
    ctx.font = 'bold 20px monospace';
    ctx.fillText('KM', 445, 140);

    // Dynamic RPM LED Arc Bar
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

    // Map Grid Lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    for (let x = 0; x < 512; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
    }
    for (let y = 0; y < 256; y += 45) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }

    // Glowing Cyan GPS Highway Route Path
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(30, 200);
    ctx.quadraticCurveTo(220, 160, 280, 120);
    ctx.quadraticCurveTo(340, 80, 480, 50);
    ctx.stroke();

    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Glowing Vehicle Blue Location Pin
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(220, 150, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(220, 150, 5, 0, Math.PI * 2);
    ctx.fill();

    // Top Navigation Banner Pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(16, 12, 480, 44);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(16, 12, 480, 44);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('↱ بعد 2.4 كم: مخرج طريق الساحل', 32, 42);

    // Speed Limit Circular Badge
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

    // Bottom Status Bar
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(16, 215, 480, 32);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('طريق الغروب السريع • ETA 18:45', 28, 237);

    ctx.fillStyle = '#ec4899';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('♫ Synthwave Beats', 330, 237);
  };

  // -------------------------------------------------------------
  // INITIALIZE THREE.JS SCENE
  // -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene & Sunset Atmosphere
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

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(62, width / height, 0.1, 320);

    // 3. Renderer with High Dynamic Range & Sharp Resolution
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.appendChild(renderer.domElement);

    // 4. Lighting
    const sunLight = new THREE.DirectionalLight(0xffa254, 2.2);
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

    const ambientLight = new THREE.AmbientLight(0x4338ca, 0.85);
    scene.add(ambientLight);

    const sunGlowMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
    const sunGlow = new THREE.Mesh(new THREE.CircleGeometry(16, 32), sunGlowMat);
    sunGlow.position.set(70, 22, -260);
    scene.add(sunGlow);

    // 5. Player Vehicle Group & 3D Cockpit
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
    } = buildTrueDriverCockpit(playerCarGroup, camera);

    if (clusterCtx) updateClusterScreen(clusterCtx, BASE_CRUISE_SPEED, 0);
    if (gpsCtx) updateGpsScreen(gpsCtx, BASE_CRUISE_SPEED);
    clusterTexture.needsUpdate = true;
    gpsTexture.needsUpdate = true;

    // 6. Vast Ground Terrain (Fills the missing ground void outside the highway)
    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Dark twilight desert sands
      roughness: 0.95,
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

    // 7. Matte Dark Asphalt Highway with Road Shoulders
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x11161f,
      roughness: 0.85,
      metalness: 0.05
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
    const guardMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4, metalness: 0.6 });
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

    // Solid Edge Lines (خطوط كتف الطريق الصفراء والبيضاء)
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

    // 8. Reflective Cat's Eyes (عيون القطط العاكسة على مسارات الطريق)
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

    // 9. Scenery Props (Lamp Posts & Low-Poly Trees)
    const sceneryItems: THREE.Group[] = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
    const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x27170a, roughness: 0.9 });
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.7 });

    for (let z = -ROAD_SEGMENT_LENGTH + 20; z < 20; z += 30) {
      const propGroup = new THREE.Group();

      // Left Lamp Post
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

      // Right Side Low-Poly Tree
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

    // 10. 3D Traffic Pool
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

      const speed = 48 + Math.random() * 22; // Smooth traffic pace (48-70 km/h)
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
      if (synthwaveTimerRef.current) clearInterval(synthwaveTimerRef.current);
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      threeRef.current = null;
    };
  }, []);

  // -------------------------------------------------------------
  // MANUAL HEADLIGHT FLASHER / STROBE (تكبيس يدوي كشافات السيارة)
  // -------------------------------------------------------------
  const triggerManualHeadlightFlash = useCallback(() => {
    initAudio();
    sounds.playHighBeam();
    const s = gameStateRef.current;
    const t3 = threeRef.current;

    s.highBeamTimer = 0.45;
    setIsHighBeaming(true);

    if (t3) {
      t3.headlightSpotL.intensity = 16;
      t3.headlightSpotR.intensity = 16;

      // Yield traffic ahead
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
  // CONTROLLER COMMAND HANDLER (Responsive & Zero Lag)
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
        car.speedKmh = 50 + Math.random() * 18;
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

      // 1. Natural Highway Speed Dynamics (Smooth, realistic, no FPS spikes)
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

      // Update engine audio pitch with speed
      updateEngineAudio(s.speedKmh);

      const worldSpeed = (s.speedKmh / 3.6) * 0.22;

      // 2. Smooth Steering Damping & 3D Wheel Rotation
      s.smoothSteer += (s.steerAngle - s.smoothSteer) * Math.min(1, dt * 8.0);
      const steerSpeed = 4.2 * (0.85 + s.speedKmh / 160);
      s.playerX += s.smoothSteer * steerSpeed * dt;
      s.playerX = Math.max(-ROAD_TOTAL_WIDTH / 2 + 1.2, Math.min(ROAD_TOTAL_WIDTH / 2 - 1.2, s.playerX));

      t3.playerCarGroup.position.x = s.playerX;

      // Rotate 3D Steering Wheel with hands smoothly
      if (t3.steeringWheelGroup) {
        t3.steeringWheelGroup.rotation.z = -s.smoothSteer * 2.2;
      }

      // 3. Headlight Intensity Check
      if (s.highBeamTimer > 0) {
        s.highBeamTimer -= dt;
        if (s.highBeamTimer <= 0) {
          setIsHighBeaming(false);
          t3.headlightSpotL.intensity = 6;
          t3.headlightSpotR.intensity = 6;
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
          car.targetSpeedKmh = 48 + Math.random() * 22;
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

      // Update In-Car Dynamic Cockpit Screens & Minimap
      hudTimer += dt;
      if (hudTimer >= 0.1) {
        hudTimer = 0;
        const spd = Math.round(s.speedKmh);
        const dist = parseFloat(s.distanceAccKm.toFixed(1));

        setCurrentSpeed(spd);
        setDistanceKm(dist);
        setScore(Math.floor(s.scoreAcc));

        // Update Minimap positions of traffic cars
        const tPositions = t3.trafficPool
          .filter(c => c.z < 10 && c.z > -160)
          .map(c => ({ x: c.x, z: c.z }));
        setTrafficPositions(tPositions);

        if (t3.clusterCtx) {
          updateClusterScreen(t3.clusterCtx, spd, dist);
          t3.clusterTexture.needsUpdate = true;
        }
        if (t3.gpsCtx) {
          updateGpsScreen(t3.gpsCtx, spd);
          t3.gpsTexture.needsUpdate = true;
        }
      }

      // Render 3D Scene
      t3.renderer.render(t3.scene, t3.camera);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [updateEngineAudio]);

  // Motion blur vignette intensity calculation based on speed
  const motionBlurOpacity = Math.max(0, (currentSpeed - 85) / (MAX_SPEED_KMH - 85)) * 0.35;

  return (
    <div className="w-screen h-screen bg-slate-950 text-white select-none overflow-hidden relative font-sans" dir="rtl">
      {/* 3D WebGL Canvas */}
      <div ref={containerRef} className="w-full h-full absolute inset-0 z-0" />

      {/* MOTION BLUR / SPEED EDGE VIGNETTE (تأثير ضبابية السرعة على الأطراف) */}
      <div
        className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-150"
        style={{
          opacity: motionBlurOpacity,
          background: 'radial-gradient(ellipse at center, transparent 60%, rgba(6, 182, 212, 0.25) 100%)'
        }}
      />

      {/* TOP NOTIFICATIONS & HUD CONTROLS */}
      <div className="relative z-20 w-full h-full pointer-events-none flex flex-col justify-between p-6">
        <div className="w-full flex items-start justify-between">
          {/* Near miss alert badge */}
          <div>
            {nearMissAlert && (
              <div className="px-6 py-2.5 rounded-2xl bg-amber-500 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/40 animate-bounce border border-amber-300">
                <span>{nearMissAlert}</span>
              </div>
            )}
            {isHighBeaming && (
              <div className="mt-2 px-4 py-2 rounded-xl bg-cyan-400 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-cyan-400/50 animate-pulse border border-cyan-200">
                <Lightbulb className="w-4 h-4 fill-current" />
                <span>تكبيس الكشافات [B / Y]</span>
              </div>
            )}
          </div>

          {/* TOP RIGHT: MODERN HUD MINIMAP (خريطة مصغرة توضح الطريق والمخرج وحركة السيارات) */}
          <div className="pointer-events-auto flex flex-col items-end gap-2">
            <div className="w-44 h-44 bg-slate-950/85 border-2 border-cyan-500/50 rounded-3xl p-2.5 shadow-2xl shadow-cyan-950/80 backdrop-blur-md relative overflow-hidden flex flex-col justify-between">
              {/* Minimap Header */}
              <div className="flex items-center justify-between text-[10px] font-bold text-cyan-400 border-b border-slate-800 pb-1">
                <span className="flex items-center gap-1">
                  <Compass className="w-3 h-3 text-emerald-400" />
                  <span>طريق الغروب</span>
                </span>
                <span className="text-amber-400">120 KM</span>
              </div>

              {/* Minimap Radar Highway View */}
              <div className="w-full h-24 relative bg-[#090d16] rounded-xl border border-slate-800/80 overflow-hidden flex items-center justify-center">
                {/* Highway lanes */}
                <div className="w-16 h-full border-x border-slate-700 bg-slate-900/60 relative">
                  <div className="w-px h-full bg-slate-700 border-dashed absolute left-1/3"></div>
                  <div className="w-px h-full bg-slate-700 border-dashed absolute left-2/3"></div>

                  {/* Upcoming Exit Ramp Curved Branch */}
                  <div className="absolute right-[-10px] top-3 w-8 h-8 border-t-2 border-r-2 border-cyan-400/80 rounded-tr-full"></div>

                  {/* Player Dot */}
                  <div
                    className="w-2.5 h-2.5 bg-cyan-400 rounded-full border border-white shadow-lg shadow-cyan-400 absolute bottom-3 transition-all"
                    style={{ left: `${((gameStateRef.current.playerX + 5.4) / 10.8) * 80 + 10}%` }}
                  ></div>

                  {/* Traffic Dots on Minimap */}
                  {trafficPositions.map((tp, idx) => {
                    const normY = Math.max(4, Math.min(85, (tp.z / -160) * 80 + 10));
                    const normX = Math.max(5, Math.min(85, ((tp.x + 5.4) / 10.8) * 80 + 10));
                    return (
                      <div
                        key={idx}
                        className="w-2 h-2 bg-amber-400 rounded-full absolute shadow-sm shadow-amber-400"
                        style={{ left: `${normX}%`, top: `${100 - normY}%` }}
                      ></div>
                    );
                  })}
                </div>
              </div>

              {/* Minimap Footer */}
              <div className="flex items-center justify-between text-[9px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Navigation className="w-2.5 h-2.5 text-cyan-400" />
                  <span>المخرج بعد 2.4 كم</span>
                </span>
                <span className="text-emerald-400 font-bold">{highScore} PTS</span>
              </div>
            </div>

            {/* Quick Manual Headlight Strobe Button on UI */}
            <button
              type="button"
              onClick={triggerManualHeadlightFlash}
              className="px-3.5 py-1.5 rounded-xl bg-slate-900/90 border border-cyan-500/40 text-cyan-300 text-xs font-bold flex items-center gap-1.5 shadow-lg hover:bg-cyan-950 transition-all active:scale-95"
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
              <span>تكبيس الكشافات [B / Y]</span>
            </button>
          </div>
        </div>

        {/* Top-Left Tiny Back Button Only (Clean, no floating bottom bar covering controls) */}
        <div className="w-full flex items-end justify-between pointer-events-none">
          <button
            type="button"
            onClick={onBackToMenu}
            className="pointer-events-auto px-4 py-2 rounded-xl bg-slate-900/80 hover:bg-rose-600 text-slate-300 hover:text-white font-bold text-xs border border-slate-800 transition-colors backdrop-blur-md"
          >
            خروج للقائمة [SELECT]
          </button>
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
