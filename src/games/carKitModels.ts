import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface CarKitVehicleInstance {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  rearWheels: THREE.Object3D[];
  flasherLights?: THREE.Mesh[];
  tailLights?: THREE.Mesh[];
  headLights?: THREE.Mesh[];
  isEmergency?: boolean;
  modelName: string;
}

// Map of preloaded GLTF scenes for instant zero-lag cloning
const modelCache: { [key: string]: THREE.Group } = {};
let gltfLoader: GLTFLoader | null = null;

function getLoader(): GLTFLoader {
  if (!gltfLoader) {
    gltfLoader = new GLTFLoader();
  }
  return gltfLoader;
}

// Vehicle definitions in the Kenney Car Kit
export const VEHICLE_MODELS = {
  PLAYER_DEFAULT: '/models/car-kit/sedan-sports.glb',
  PLAYER_SUPER: '/models/car-kit/race-future.glb',
  PLAYER_HATCHBACK: '/models/car-kit/hatchback-sports.glb',
  PLAYER_SUV: '/models/car-kit/suv-luxury.glb',
  PLAYER_RACER: '/models/car-kit/race.glb',
  
  TRAFFIC_SEDAN: '/models/car-kit/sedan.glb',
  TRAFFIC_SPORTS: '/models/car-kit/sedan-sports.glb',
  TRAFFIC_SUV: '/models/car-kit/suv.glb',
  TRAFFIC_SUV_LUXURY: '/models/car-kit/suv-luxury.glb',
  TRAFFIC_TAXI: '/models/car-kit/taxi.glb',
  TRAFFIC_POLICE: '/models/car-kit/police.glb',
  TRAFFIC_VAN: '/models/car-kit/van.glb',
  TRAFFIC_TRUCK: '/models/car-kit/truck.glb',
  TRAFFIC_TRUCK_FLAT: '/models/car-kit/truck-flat.glb',
  TRAFFIC_DELIVERY: '/models/car-kit/delivery.glb',
  TRAFFIC_AMBULANCE: '/models/car-kit/ambulance.glb',
  TRAFFIC_FIRETRUCK: '/models/car-kit/firetruck.glb',
} as const;

export const TRAFFIC_VARIETIES = [
  { model: VEHICLE_MODELS.TRAFFIC_SEDAN, name: 'Sedan' },
  { model: VEHICLE_MODELS.TRAFFIC_POLICE, name: 'Police' },
  { model: VEHICLE_MODELS.TRAFFIC_TRUCK, name: 'Truck' },
  { model: VEHICLE_MODELS.TRAFFIC_SUV_LUXURY, name: 'Luxury SUV' },
  { model: VEHICLE_MODELS.TRAFFIC_TAXI, name: 'Taxi' },
  { model: VEHICLE_MODELS.TRAFFIC_AMBULANCE, name: 'Ambulance' },
  { model: VEHICLE_MODELS.TRAFFIC_DELIVERY, name: 'Delivery Truck' },
  { model: VEHICLE_MODELS.TRAFFIC_SPORTS, name: 'Sports Coupe' },
  { model: VEHICLE_MODELS.TRAFFIC_VAN, name: 'Van' },
  { model: VEHICLE_MODELS.TRAFFIC_FIRETRUCK, name: 'Fire Truck' }
];

/**
 * Preload all essential GLB models into memory for seamless, stutter-free instantiation
 */
export async function preloadCarKitModels(): Promise<void> {
  const loader = getLoader();
  const allUrls = Object.values(VEHICLE_MODELS);

  const loadPromises = allUrls.map(url => {
    if (modelCache[url]) return Promise.resolve();
    return new Promise<void>((resolve) => {
      loader.load(
        url,
        (gltf) => {
          // Configure shadows and PBR reflections
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              const mesh = child as THREE.Mesh;
              if (mesh.material) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                mats.forEach(m => {
                  if ('roughness' in m) (m as THREE.MeshStandardMaterial).roughness = 0.35;
                  if ('metalness' in m) (m as THREE.MeshStandardMaterial).metalness = 0.22;
                });
              }
            }
          });
          modelCache[url] = gltf.scene;
          resolve();
        },
        undefined,
        (err) => {
          console.warn(`Failed to preload GLB model ${url}:`, err);
          resolve();
        }
      );
    });
  });

  await Promise.all(loadPromises);
}

/**
 * Creates an instance of a Kenney car model with spinning wheels, lighting, and contact shadow
 */
export function createCarKitVehicle(
  modelUrl: string = VEHICLE_MODELS.TRAFFIC_SEDAN,
  scaleFactor: number = 1.42
): CarKitVehicleInstance {
  const rootGroup = new THREE.Group();
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const rearWheels: THREE.Object3D[] = [];
  const flasherLights: THREE.Mesh[] = [];
  const tailLights: THREE.Mesh[] = [];
  const headLights: THREE.Mesh[] = [];

  const isEmergency = modelUrl.includes('police') || modelUrl.includes('ambulance') || modelUrl.includes('firetruck');
  const isTruck = modelUrl.includes('truck') || modelUrl.includes('delivery') || modelUrl.includes('firetruck');
  const isDelivery = modelUrl.includes('delivery') || modelUrl.includes('van');

  const cachedScene = modelCache[modelUrl];
  let carModel: THREE.Group;

  if (cachedScene) {
    carModel = cachedScene.clone(true);
    // Deep clone materials so each car can have independent emissive/color tweaks
    carModel.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map(m => m.clone());
          } else {
            mesh.material = mesh.material.clone();
          }
        }
      }
    });
  } else {
    carModel = new THREE.Group();
    const loader = getLoader();
    loader.load(modelUrl, (gltf) => {
      gltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      modelCache[modelUrl] = gltf.scene;
      const cloned = gltf.scene.clone(true);
      carModel.add(cloned);
      extractWheelsAndParts(cloned, wheels, frontWheels, rearWheels);
    });
  }

  // In Kenney car kit: +Z is front, -Z is rear.
  // In game highway: driving direction is -Z.
  // So rotation.y = Math.PI faces the car forward down the highway.
  carModel.rotation.y = Math.PI;
  carModel.scale.set(scaleFactor, scaleFactor, scaleFactor);
  rootGroup.add(carModel);

  // Extract wheel references for physics rotation & steering
  extractWheelsAndParts(carModel, wheels, frontWheels, rearWheels);

  // High quality grounded contact shadow plane
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x050508,
    transparent: true,
    opacity: 0.75
  });
  const shadowLength = isTruck ? 5.0 : 4.0;
  const shadowWidth = isTruck ? 2.5 : 2.2;
  const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(shadowWidth, shadowLength), shadowMat);
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.02;
  rootGroup.add(contactShadow);

  // Emissive Tail Lights (facing rear / +Z in world space)
  const tailLightMat = new THREE.MeshStandardMaterial({
    color: 0xff1e1e,
    emissive: 0xff0000,
    emissiveIntensity: 2.8
  });
  const tlGeo = new THREE.BoxGeometry(0.26, 0.14, 0.05);
  const tailOffsetZ = isTruck ? 2.35 : (isDelivery ? 2.1 : 1.78);
  const tailOffsetY = isTruck ? 0.8 : 0.65;
  const tailOffsetX = isTruck ? 0.85 : 0.65;

  const tlLeft = new THREE.Mesh(tlGeo, tailLightMat);
  tlLeft.position.set(-tailOffsetX, tailOffsetY, tailOffsetZ);
  rootGroup.add(tlLeft);
  tailLights.push(tlLeft);

  const tlRight = new THREE.Mesh(tlGeo, tailLightMat);
  tlRight.position.set(tailOffsetX, tailOffsetY, tailOffsetZ);
  rootGroup.add(tlRight);
  tailLights.push(tlRight);

  // Headlights (facing forward / -Z in world space)
  const headLightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffeedd,
    emissiveIntensity: 2.2
  });
  const hlGeo = new THREE.BoxGeometry(0.24, 0.12, 0.05);
  const frontOffsetZ = isTruck ? -2.35 : (isDelivery ? -2.1 : -1.78);
  const hlOffsetY = isTruck ? 0.8 : 0.62;
  const hlOffsetX = isTruck ? 0.85 : 0.65;

  const hlLeft = new THREE.Mesh(hlGeo, headLightMat);
  hlLeft.position.set(-hlOffsetX, hlOffsetY, frontOffsetZ);
  rootGroup.add(hlLeft);
  headLights.push(hlLeft);

  const hlRight = new THREE.Mesh(hlGeo, headLightMat);
  hlRight.position.set(hlOffsetX, hlOffsetY, frontOffsetZ);
  rootGroup.add(hlRight);
  headLights.push(hlRight);

  // Emergency flashing lights for Police, Ambulance, Firetruck
  if (isEmergency) {
    const beaconGeo = new THREE.BoxGeometry(0.20, 0.12, 0.22);
    const redBeaconMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 3.5
    });
    const blueBeaconMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x3b82f6,
      emissiveIntensity: 3.5
    });

    const roofY = isTruck ? 2.35 : 1.48;
    const bLeft = new THREE.Mesh(beaconGeo, redBeaconMat);
    bLeft.position.set(-0.35, roofY, 0.05);
    rootGroup.add(bLeft);
    flasherLights.push(bLeft);

    const bRight = new THREE.Mesh(beaconGeo, blueBeaconMat);
    bRight.position.set(0.35, roofY, 0.05);
    rootGroup.add(bRight);
    flasherLights.push(bRight);
  }

  const modelName = modelUrl.split('/').pop()?.replace('.glb', '') || 'car';

  return {
    group: rootGroup,
    wheels,
    frontWheels,
    rearWheels,
    flasherLights,
    tailLights,
    headLights,
    isEmergency,
    modelName
  };
}

/**
 * Creates the high fidelity 3D player vehicle model from Kenney Car Kit
 */
export function createPlayerCarKitVehicle(
  modelUrl: string = VEHICLE_MODELS.PLAYER_DEFAULT,
  scaleFactor: number = 1.45
): CarKitVehicleInstance {
  const result = createCarKitVehicle(modelUrl, scaleFactor);
  return result;
}

function extractWheelsAndParts(
  group: THREE.Object3D,
  wheels: THREE.Object3D[],
  frontWheels: THREE.Object3D[],
  rearWheels: THREE.Object3D[]
) {
  group.traverse((child) => {
    const name = (child.name || '').toLowerCase();
    if (name.includes('wheel')) {
      if (!wheels.includes(child)) {
        wheels.push(child);
      }
      if (name.includes('front') || name.includes('fl') || name.includes('fr')) {
        if (!frontWheels.includes(child)) frontWheels.push(child);
      } else if (name.includes('back') || name.includes('rear') || name.includes('rl') || name.includes('rr')) {
        if (!rearWheels.includes(child)) rearWheels.push(child);
      }
    }
  });
}
