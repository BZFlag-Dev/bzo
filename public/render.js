/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/BZFlag-Dev/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { AnaglyphEffect } from './anaglyph.js';
import { xrState } from './webxr.js';
import {
  createShootBuffer,
  createExplosionBuffer,
  createJumpBuffer,
  createLandBuffer,
  createProjectilePopBuffer,
} from './audio.js';
import {
  createBoundaryTexture,
  createBoxWallTexture,
  createPyramidTexture,
  createRoofTexture,
  createGroundTexture,
} from './texture.js';

const DEFAULT_MUZZLE_FORWARD = 3.0;
const DEFAULT_MUZZLE_HEIGHT = 1.57;
const MUZZLE_TIP_EPSILON = 0.03;
const BZFlag_DEFAULT_HORIZONTAL_FOV = 60;
const TANK_PART_ALIASES = {
  body: ['body'],
  turret: ['turret'],
  barrel: ['barrel'],
  leftTreadMiddle: ['leftTreadMiddle', 'tread_belt_left', 'leftTrack', 'ltread'],
  leftTreadFrontCap: ['leftTreadFrontCap', 'tread_cap_left_front', 'leftTrack', 'ltread'],
  leftTreadRearCap: ['leftTreadRearCap', 'tread_cap_left_rear', 'leftTrack', 'ltread'],
  rightTreadMiddle: ['rightTreadMiddle', 'tread_belt_right', 'rightTrack', 'rtread'],
  rightTreadFrontCap: ['rightTreadFrontCap', 'tread_cap_right_front', 'rightTrack', 'rtread'],
  rightTreadRearCap: ['rightTreadRearCap', 'tread_cap_right_rear', 'rightTrack', 'rtread'],
};
const TANK_WHEEL_PREFIX_ALIASES = {
  left: ['leftWheel', 'wheel_left'],
  right: ['rightWheel', 'wheel_right'],
};

const TANK_WHEEL_OUTWARD_NUDGE = 0.02;
const MOUNTAIN_TEXTURE_PATHS = [
  '/textures/mountain1.png',
  '/textures/mountain2.png',
  '/textures/mountain3.png',
  '/textures/mountain4.png',
  '/textures/mountain5.png',
];
const BZFLAG_MOUNTAIN_FACE_COUNT = 16;
const BZFLAG_NIGHT_ELEVATION = -0.25;
const BZFLAG_DUSK_ELEVATION = -0.17;
const BZFLAG_TWILIGHT_ELEVATION = -0.087;
const BZFLAG_DAWN_ELEVATION = 0.0;
const BZFLAG_DAY_ELEVATION = 0.087;

class RenderManager {
  _getVerticalFovForAspect(aspect) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : (16 / 9);
    const halfHorizontalRadians = THREE.MathUtils.degToRad(BZFlag_DEFAULT_HORIZONTAL_FOV * 0.5);
    const halfVerticalRadians = Math.atan(Math.tan(halfHorizontalRadians) / safeAspect);
    return THREE.MathUtils.radToDeg(halfVerticalRadians * 2);
  }

  _computeMuzzleFromBarrel(barrel) {
    if (!barrel || !barrel.geometry) {
      return { forward: DEFAULT_MUZZLE_FORWARD, height: DEFAULT_MUZZLE_HEIGHT };
    }

    const position = barrel.geometry.getAttribute('position');
    if (!position || position.count === 0) {
      return { forward: DEFAULT_MUZZLE_FORWARD, height: DEFAULT_MUZZLE_HEIGHT };
    }

    barrel.updateMatrix();
    const transformed = new THREE.Vector3();
    let minZ = Number.POSITIVE_INFINITY;
    const points = [];

    for (let i = 0; i < position.count; i += 1) {
      transformed.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(barrel.matrix);
      points.push({ x: transformed.x, y: transformed.y, z: transformed.z });
      if (transformed.z < minZ) minZ = transformed.z;
    }

    const tipPoints = points.filter((point) => point.z <= (minZ + MUZZLE_TIP_EPSILON));
    if (tipPoints.length === 0) {
      return { forward: DEFAULT_MUZZLE_FORWARD, height: DEFAULT_MUZZLE_HEIGHT };
    }

    const avg = tipPoints.reduce((acc, point) => {
      acc.y += point.y;
      acc.z += point.z;
      return acc;
    }, { y: 0, z: 0 });

    const avgY = avg.y / tipPoints.length;
    const avgZ = avg.z / tipPoints.length;
    const forward = Number.isFinite(avgZ) ? Math.max(0.5, -avgZ) : DEFAULT_MUZZLE_FORWARD;
    const height = Number.isFinite(avgY) ? avgY : DEFAULT_MUZZLE_HEIGHT;

    return { forward, height };
  }

  _setTankMuzzleData(tankGroup, barrel) {
    const muzzle = this._computeMuzzleFromBarrel(barrel);
    tankGroup.userData.muzzleForward = muzzle.forward;
    tankGroup.userData.muzzleHeight = muzzle.height;
    tankGroup.userData.cameraHeight = muzzle.height;
  }

  _getViewportSize() {
    const body = document.body;
    const doc = document.documentElement;
    const visualViewport = window.visualViewport;
    const containerBounds = this.container && typeof this.container.getBoundingClientRect === 'function'
      ? this.container.getBoundingClientRect()
      : null;
    const width = Math.max(
      0,
      Number(window.innerWidth) || 0,
      Number(visualViewport && visualViewport.width) || 0,
      Number(doc && doc.clientWidth) || 0,
      Number(body && body.clientWidth) || 0,
      Number(this.container && this.container.clientWidth) || 0,
      Number(containerBounds && containerBounds.width) || 0,
    );
    const height = Math.max(
      0,
      Number(window.innerHeight) || 0,
      Number(visualViewport && visualViewport.height) || 0,
      Number(doc && doc.clientHeight) || 0,
      Number(body && body.clientHeight) || 0,
      Number(this.container && this.container.clientHeight) || 0,
      Number(containerBounds && containerBounds.height) || 0,
    );

    const fallbackWidth = Math.max(320, Number(window.screen && window.screen.availWidth) || 1280);
    const fallbackHeight = Math.max(200, Number(window.screen && window.screen.availHeight) || 720);
    return {
      width: Math.max(1, width >= 32 ? Math.floor(width) : fallbackWidth),
      height: Math.max(1, height >= 32 ? Math.floor(height) : fallbackHeight),
    };
  }

  _applyFogConfig(gameConfig = null) {
    if (!this.scene) return;

    const fogMode = typeof gameConfig?.FOG_MODE === 'string' ? gameConfig.FOG_MODE.toLowerCase() : 'none';
    const fogDensity = Number.isFinite(gameConfig?.FOG_DENSITY) ? gameConfig.FOG_DENSITY : 0.001;
    const fogStart = Number.isFinite(gameConfig?.FOG_START) ? gameConfig.FOG_START : 50;
    const fogEnd = Number.isFinite(gameConfig?.FOG_END) ? gameConfig.FOG_END : 100;
    const baseFogColor = this.scene.background?.clone?.() || new THREE.Color(0x87ceeb);

    if (fogMode === 'linear') {
      this.scene.fog = new THREE.Fog(baseFogColor, fogStart, fogEnd);
    } else if (fogMode === 'exp' || fogMode === 'exp2') {
      this.scene.fog = new THREE.FogExp2(baseFogColor, fogDensity);
    } else {
      this.scene.fog = null;
    }
  }

  // Set world time (0-23999, like Minecraft)
  setWorldTime(worldTime) {
    this._worldTime = worldTime;
    if (!this.dynamicLightingEnabled) return;
    // Compute sun/moon positions
    // Minecraft: 0 = 6:00, 6000 = noon, 12000 = 18:00, 18000 = midnight
    // We'll use a circle in the X/Y plane for sun/moon
    const MAP_SIZE = this.ground ? this.ground.geometry.parameters.width / 3 : 100;
    const sunDistance = MAP_SIZE;
    const moonDistance = sunDistance;
    const sunAngle = ((worldTime / 24000) * 2 * Math.PI) - Math.PI / 2; // 0 at sunrise, pi at sunset
    const moonAngle = sunAngle + Math.PI;
    // Sun position
    const sunX = Math.cos(sunAngle) * sunDistance;
    const sunY = Math.sin(sunAngle) * sunDistance * 0.8; // Lower arc for realism
    const sunZ = 0;
    // Moon position
    const moonX = Math.cos(moonAngle) * moonDistance;
    const moonY = Math.sin(moonAngle) * moonDistance * 0.8;
    const moonZ = 0;
    const sunElevation = Math.max(-1, Math.min(1, sunY / (sunDistance * 0.8 || 1)));
    const moonElevation = Math.max(-1, Math.min(1, moonY / (moonDistance * 0.8 || 1)));
    const lerpTriplet = (from, to, t) => from.map((value, index) => value + (to[index] - value) * t);
    const toThreeColor = (triplet) => new THREE.Color().setRGB(triplet[0], triplet[1], triplet[2]);

    const highSunColor = [1.75, 1.75, 1.4];
    const lowSunColor = [0.75, 0.27, 0.0];
    const moonColor = [0.4, 0.4, 0.4];
    const nightAmbient = [0.3, 0.3, 0.3];
    const dayAmbient = [0.35, 0.5, 0.5];
    const nightSky = [0.04, 0.04, 0.08];
    const zenithSky = [0.25, 0.55, 0.86];
    const horizonSky = [0.43, 0.75, 0.95];
    const sunrise1 = [0.30, 0.12, 0.08];
    const sunrise2 = [0.47, 0.12, 0.08];

    let directColor = highSunColor;
    let directBrightness = 1.0;
    if (sunElevation <= -0.009) {
      directColor = moonColor;
      directBrightness = 0.35;
    } else if (sunElevation < BZFLAG_DAY_ELEVATION) {
      const t = Math.max(0, Math.min(1, (sunElevation - BZFLAG_DAWN_ELEVATION) / (BZFLAG_DAY_ELEVATION - BZFLAG_DAWN_ELEVATION)));
      directColor = lerpTriplet(lowSunColor, highSunColor, t);
      directBrightness = t;
    }

    let ambientColor = dayAmbient;
    if (sunElevation < BZFLAG_DUSK_ELEVATION) {
      ambientColor = nightAmbient;
    } else if (sunElevation < BZFLAG_DAY_ELEVATION) {
      const t = Math.max(0, Math.min(1, (sunElevation - BZFLAG_DUSK_ELEVATION) / (BZFLAG_DAY_ELEVATION - BZFLAG_DUSK_ELEVATION)));
      ambientColor = lerpTriplet(nightAmbient, dayAmbient, t);
    }

    let skyZenithColor = zenithSky;
    let skySunDirColor = horizonSky;
    if (sunElevation < BZFLAG_NIGHT_ELEVATION) {
      skyZenithColor = nightSky;
      skySunDirColor = nightSky;
    } else if (sunElevation < BZFLAG_TWILIGHT_ELEVATION) {
      const t = Math.max(0, Math.min(1, (sunElevation - BZFLAG_NIGHT_ELEVATION) / (BZFLAG_TWILIGHT_ELEVATION - BZFLAG_NIGHT_ELEVATION)));
      skyZenithColor = nightSky;
      skySunDirColor = lerpTriplet(nightSky, sunrise1, t);
    } else if (sunElevation < BZFLAG_DAWN_ELEVATION) {
      const t = Math.max(0, Math.min(1, (sunElevation - BZFLAG_TWILIGHT_ELEVATION) / (BZFLAG_DAWN_ELEVATION - BZFLAG_TWILIGHT_ELEVATION)));
      skyZenithColor = nightSky;
      skySunDirColor = lerpTriplet(sunrise1, sunrise2, t);
    } else if (sunElevation < BZFLAG_DAY_ELEVATION) {
      const t = Math.max(0, Math.min(1, (sunElevation - BZFLAG_DAWN_ELEVATION) / (BZFLAG_DAY_ELEVATION - BZFLAG_DAWN_ELEVATION)));
      skyZenithColor = lerpTriplet(nightSky, zenithSky, t);
      skySunDirColor = lerpTriplet(sunrise2, horizonSky, t);
    }

    const ambientThreeColor = toThreeColor(ambientColor);
    const directThreeColor = toThreeColor(directColor);
    const backgroundColor = toThreeColor(lerpTriplet(skySunDirColor, skyZenithColor, 0.35));

    if (this.ambientLight) {
      this.ambientLight.color.copy(ambientThreeColor);
      this.ambientLight.intensity = 1.0;
    }

    if (this.sunLight) {
      this.sunLight.position.set(sunX, sunY, sunZ);
      this.sunLight.target.position.set(0, 0, 0);
      this.worldGroup.add(this.sunLight.target);
      this.sunLight.color.copy(directThreeColor);
      this.sunLight.intensity = sunElevation >= -0.009 ? Math.max(0.35, directBrightness) : 0.0;
      this.sunLight.castShadow = sunElevation > (0.5 * BZFLAG_DAY_ELEVATION);
    }

    if (this.moonLight) {
      this.moonLight.position.set(moonX, moonY, moonZ);
      this.moonLight.target.position.set(0, 0, 0);
      this.worldGroup.add(this.moonLight.target);
      this.moonLight.color.copy(toThreeColor(moonColor));
      this.moonLight.intensity = sunElevation < -0.009 && moonElevation > -0.009 ? 0.35 : 0.0;
      this.moonLight.castShadow = this.moonLight.intensity > 0;
    }

    this.scene.background.copy(backgroundColor);
    if (this.scene.fog) {
      this.scene.fog.color.copy(backgroundColor);
    }

    this._updateCelestialBodies({
      sunX,
      sunY,
      sunZ,
      moonX,
      moonY,
      moonZ,
      sunColor: directThreeColor,
    });
    // Optionally: add/update sun/moon meshes for visuals (not just lighting)
    // ...
  }
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.labelRenderer = null;
    this.audioListener = null;
    // Shared audio buffers
    this.shootBuffer = null;
    this.explosionBuffer = null;
    this.jumpBuffer = null;
    this.landBuffer = null;
    this.container = null;

    this.ground = null;
    this.gridHelper = null;
    this.obstacleMeshes = [];
    this.mountainMeshes = [];
    this.celestialMeshes = [];
    this.sunMesh = null;
    this.sunGlowMesh = null;
    this.moonMesh = null;
    this.clouds = [];

    this.compassMarkers = [];
    this.maxObstacleHeight = 0;

    this.debugLabels = [];
    this.debugLabelsEnabled = true;

    this.anaglyphEffect = null;
    this.anaglyphEnabled = false;
    this.activeExplosions = [];
    this.activeLandingEffects = [];
    this.activeSpawnEffects = [];

    // Dynamic lighting toggle (default true)
    this.dynamicLightingEnabled = true;

    // Tank geometry loaded from public/obj/simple.obj (keyed by object name)
    this._tankGeoCache = null;
    this._tankTemplate = null;
    this._tankGeoCacheByPath = new Map();
    this._tankTemplateByPath = new Map();
    this._tankModelLoadsInFlight = new Set();
    this._tankModelReadyPromisesByPath = new Map();
    this._tankModelReadyResolversByPath = new Map();
    this._tankModelPath = '/obj/bzflag.obj';
    this.deathFollowTarget = null;
    this.deathFollowAnchor = null;
    this.deathCameraLogged = false;
    this._preloadTankModel('/obj/bzflag.obj');
    this._preloadTankModel('/obj/modern.obj');
    this._preloadTankModel('/obj/simple.obj');
    this._preloadTankModel('/obj/wheeled6.obj');
  }

  init({ container = document.body } = {}) {
    if (this.scene) {
      return {
        scene: this.scene,
        camera: this.camera,
        renderer: this.renderer,
        labelRenderer: this.labelRenderer,
      };
    }

    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = null;

    // World group - translates all game content for XR positioning
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);

    const viewport = this._getViewportSize();

    const verticalFov = this._getVerticalFovForAspect(viewport.width / viewport.height);
    this.camera = new THREE.PerspectiveCamera(verticalFov, viewport.width / viewport.height, 0.1, 1000);
    this.camera.position.set(0, 15, 20);
    this.camera.lookAt(0, 0, 0);

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, xrCompatible: true });
    } catch (error) {
      const probeCanvas = document.createElement('canvas');
      const hasWebGL = !!(
        probeCanvas.getContext('webgl2') ||
        probeCanvas.getContext('webgl') ||
        probeCanvas.getContext('experimental-webgl')
      );
      const message = hasWebGL
        ? 'WebGL renderer initialization failed in this browser context'
        : 'WebGL is unavailable in this browser context';
      const wrappedError = new Error(message);
      wrappedError.cause = error;
      throw wrappedError;
    }

    this.renderer.xr.enabled = true;
    this.renderer.setSize(viewport.width, viewport.height);
    // Disable real-time shadow mapping for performance
    this.renderer.shadowMap.enabled = false;
    //this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(viewport.width, viewport.height);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);

    // Anaglyph effect setup (not enabled by default)
    this.anaglyphEffect = new AnaglyphEffect(this.renderer);
    this.anaglyphEffect.setSize(viewport.width, viewport.height);

    this.handleResize();
    window.setTimeout(() => this.handleResize(), 50);
    window.setTimeout(() => this.handleResize(), 250);

    this.audioListener = new THREE.AudioListener();
    this.camera.add(this.audioListener);
    const audioContext = this.audioListener.context;
    // Create and store shared buffers
    this.shootBuffer = createShootBuffer(audioContext);
    this.explosionBuffer = createExplosionBuffer(audioContext);
    this.jumpBuffer = createJumpBuffer(audioContext);
    this.landBuffer = createLandBuffer(audioContext);
    this.projectilePopBuffer = createProjectilePopBuffer(audioContext);

    this._initDynamicLights();

    return {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      labelRenderer: this.labelRenderer,
    };
  }

  _initDynamicLights() {
    if (!this.scene) return;
    // Ambient, sun, and moon light will be updated dynamically
    this.ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    this.worldGroup.add(this.ambientLight);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sunLight.castShadow = false;
    this.worldGroup.add(this.sunLight);
    this.moonLight = new THREE.DirectionalLight(0xffffff, 0.0);
    this.moonLight.castShadow = false;
    this.worldGroup.add(this.moonLight);
  }

  _getWorldGroupLocalMatrix(object) {
    if (!this.worldGroup || !object) return null;

    this.worldGroup.updateMatrixWorld(true);
    object.updateMatrixWorld(true);

    return new THREE.Matrix4()
      .copy(this.worldGroup.matrixWorld)
      .invert()
      .multiply(object.matrixWorld);
  }

  // --- Projected Planar Shadows (Stencil-style) ---
  // Build each shadow in worldGroup-local space so XR can move the whole world
  // without applying the camera transform to the shadow twice.
  _createProjectedShadowMesh(sourceMesh, lightDirection) {
    if (!sourceMesh.geometry) return null;

    const localMatrix = this._getWorldGroupLocalMatrix(sourceMesh);
    if (!localMatrix) return null;

    const shadowGeo = sourceMesh.geometry.clone();
    const posAttr = shadowGeo.getAttribute('position');
    const dir = lightDirection.clone().normalize();
    const temp = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; ++i) {
      temp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      temp.applyMatrix4(localMatrix);
      // Project to ground (y=0) along -dir
      const t = temp.y / (dir.y !== 0 ? dir.y : 1e-6);
      temp.x = temp.x - t * dir.x;
      temp.y = 0.01; // Slightly above ground to avoid z-fighting
      temp.z = temp.z - t * dir.z;
      // Set back to geometry in worldGroup-local space
      posAttr.setXYZ(i, temp.x, temp.y, temp.z);
    }

    posAttr.needsUpdate = true;
    shadowGeo.computeVertexNormals();

    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);

    // Place shadow mesh at origin because vertices are already in worldGroup-local space.
    shadowMesh.position.set(0, 0, 0);
    shadowMesh.rotation.set(0, 0, 0);
    shadowMesh.scale.set(1, 1, 1);
    shadowMesh.matrixAutoUpdate = false;
    shadowMesh.renderOrder = 1; // Draw after ground
    shadowMesh.frustumCulled = false; // Always render shadow
    return shadowMesh;
  }

  // Call this after creating each obstacle/tank mesh
  _addProjectedShadowForMesh(mesh, lightDirection) {
    if (!mesh || mesh.visible === false) {
      // Remove shadow if mesh is hidden or gone
      if (mesh && mesh.userData.shadowMesh) {
        this.worldGroup.remove(mesh.userData.shadowMesh);
        mesh.userData.shadowMesh.geometry.dispose();
        mesh.userData.shadowMesh.material.dispose();
        mesh.userData.shadowMesh = null;
      }
      return;
    }
    // Remove any previous shadow
    if (mesh.userData.shadowMesh) {
      this.worldGroup.remove(mesh.userData.shadowMesh);
      mesh.userData.shadowMesh.geometry.dispose();
      mesh.userData.shadowMesh.material.dispose();
      mesh.userData.shadowMesh = null;
    }
    // Always set transform to match mesh, even if at origin
    if (mesh.position && mesh.rotation && mesh.scale) {
      const shadowMesh = this._createProjectedShadowMesh(mesh, lightDirection);
      if (shadowMesh) {
        // shadowMesh geometry is already in worldGroup-local coordinates.
        this.worldGroup.add(shadowMesh);
        mesh.userData.shadowMesh = shadowMesh;
      }
    }
  }

  // Update all projected shadows (call each frame or when light/objects move)
  updateProjectedShadows(tankMeshes = []) {
    // Use sun or moon depending on which is visible
    const light = (this.sunLight && this.sunLight.intensity > 0.5) ? this.sunLight : this.moonLight;
    const dir = light ? light.position.clone().normalize() : new THREE.Vector3(1, -2, 1).normalize();

    // --- Obstacles: only update if light direction changed ---
    if (!this._lastObstacleShadowDir || !dir.equals(this._lastObstacleShadowDir)) {
      for (const mesh of this.obstacleMeshes) {
        this._addProjectedShadowForMesh(mesh, dir);
      }
      // Store a copy of the direction
      this._lastObstacleShadowDir = dir.clone();
    }

    // --- Tanks: update every frame ---
    for (const tank of tankMeshes) {
      if (!tank || tank.visible === false) continue;
      // If tank is a group, project for all visible mesh children
      if (tank.isGroup && tank.children && tank.children.length > 0) {
        tank.traverse((child) => {
          if (child.isMesh && child.visible !== false && child.geometry) {
            this._addProjectedShadowForMesh(child, dir);
          }
        });
      } else if (tank.isMesh && tank.geometry) {
        this._addProjectedShadowForMesh(tank, dir);
      }
    }
  }

  updateSunLighting() {
    // Deprecated: use setWorldTime instead
    return;
  }

  getScene() {
    return this.scene;
  }

  getWorldGroup() {
    return this.worldGroup;
  }

  getCamera() {
    return this.camera;
  }

  getRenderer() {
    return this.renderer;
  }

  getLabelRenderer() {
    return this.labelRenderer;
  }

  handleResize() {
    if (!this.camera || !this.renderer || !this.labelRenderer) return;
    const viewport = this._getViewportSize();
    this.camera.aspect = viewport.width / viewport.height;
    this.camera.fov = this._getVerticalFovForAspect(this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(viewport.width, viewport.height);
    this.labelRenderer.setSize(viewport.width, viewport.height);
    if (this.anaglyphEffect) {
      this.anaglyphEffect.setSize(viewport.width, viewport.height);
    }
  }

  renderFrame() {
    if (!this.renderer || !this.scene || !this.camera || !this.labelRenderer) return;

    // Debug XR rendering (log rarely to avoid spam)
    if (xrState.enabled) {
      if (!this.xrFrameCount) this.xrFrameCount = 0;
      this.xrFrameCount++;

      if (!this.xrDebugLogged) {
        this.xrDebugLogged = true;
        //debugLog(`[Render] Entered XR mode, scene children: ${this.scene.children.length}, worldGroup children: ${this.worldGroup ? this.worldGroup.children.length : 'NULL'}`);
      }

      // Log first frame, then every 60 frames to verify rendering is working
      if (this.xrFrameCount === 1 || this.xrFrameCount % 60 === 0) {
        //debugLog(`[Render] XR frame ${this.xrFrameCount}, worldGroup pos: (${this.worldGroup.position.x.toFixed(1)}, ${this.worldGroup.position.y.toFixed(1)}, ${this.worldGroup.position.z.toFixed(1)}), children: ${this.worldGroup.children.length}`);
      }
    } else {
      this.xrDebugLogged = false;
      this.xrFrameCount = 0;
    }

    if (this.projectileLights) {
      for (const [projectile, light] of this.projectileLights.entries()) {
        if (projectile && light) {
          light.position.copy(projectile.position);
        }
      }
    }

    if (this.anaglyphEnabled && this.anaglyphEffect) {
      this.anaglyphEffect.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
    } else {
      // In XR mode, Three.js handles stereo automatically when we call renderer.render()
      if (xrState.enabled && this.xrFrameCount === 1) {
        //debugLog(`[Render] About to call renderer.render(), scene=${!!this.scene}, camera=${!!this.camera}, renderer.xr.enabled=${this.renderer.xr.enabled}, renderer.xr.isPresenting=${this.renderer.xr.isPresenting}`);
      }
      this.renderer.render(this.scene, this.camera);
      // Note: labelRenderer may not work properly in XR; skip it for now
      if (!xrState.enabled) {
        this.labelRenderer.render(this.scene, this.camera);
      }
    }
  }

  setAnaglyphEnabled(enabled) {
    this.anaglyphEnabled = !!enabled;
  }

  getAnaglyphEnabled() {
    return this.anaglyphEnabled;
  }

  clearGround() {
    if (this.ground && this.scene) {
      this.worldGroup.remove(this.ground);
      this.ground.geometry.dispose();
      this.ground.material.dispose();
      this.ground = null;
    }
    if (this.gridHelper && this.scene) {
      this.worldGroup.remove(this.gridHelper);
      this.gridHelper = null;
    }
  }

  _createBoxFaceMaterials(width, height, depth, sideTextureFactory, topTextureFactory) {
    const sideTextureScale = 8;
    const topTextureScale = 2;
    const materials = [
      new THREE.MeshLambertMaterial({ map: sideTextureFactory() }),
      new THREE.MeshLambertMaterial({ map: sideTextureFactory() }),
      new THREE.MeshLambertMaterial({ map: topTextureFactory() }),
      new THREE.MeshLambertMaterial({ map: topTextureFactory() }),
      new THREE.MeshLambertMaterial({ map: sideTextureFactory() }),
      new THREE.MeshLambertMaterial({ map: sideTextureFactory() }),
    ];

    materials[0].map.repeat.set(depth / sideTextureScale, height / sideTextureScale);
    materials[1].map.repeat.set(depth / sideTextureScale, height / sideTextureScale);
    materials[4].map.repeat.set(width / sideTextureScale, height / sideTextureScale);
    materials[5].map.repeat.set(width / sideTextureScale, height / sideTextureScale);
    materials[2].map.repeat.set(width / topTextureScale, depth / topTextureScale);
    materials[3].map.repeat.set(width / topTextureScale, depth / topTextureScale);

    return materials;
  }

  buildGround(mapSize) {
    if (!this.scene) return;
    this.clearGround();

    const groundExtent = mapSize * 10;
    const groundRepeat = 0.05;
    const groundGeometry = new THREE.PlaneGeometry(groundExtent * 2, groundExtent * 2);
    const groundTexture = createGroundTexture();
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(groundExtent * 2 * groundRepeat, groundExtent * 2 * groundRepeat);

    const groundMaterial = new THREE.MeshStandardMaterial({
      map: groundTexture,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.1,
    });

    this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.worldGroup.add(this.ground);

    const gridSpacing = 5;
    const gridDivisions = Math.max(1, Math.round(mapSize / gridSpacing));
    this.gridHelper = new THREE.GridHelper(mapSize, gridDivisions, 0x000000, 0x555555);
    this.gridHelper.position.y = 0.02;
    this.worldGroup.add(this.gridHelper);
  }


  createMapBoundaries(mapSize = 100) {
    if (!this.scene) return;

    // Remove old boundary meshes and debug labels if present
    if (!this.boundaryMeshes) this.boundaryMeshes = [];
    this.boundaryMeshes.forEach(mesh => {
      this.worldGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(mat => mat.dispose());
      } else if (mesh.material) {
        mesh.material.dispose();
      }
    });
    this.boundaryMeshes = [];
    this._clearDebugLabels('boundary');

    const wallHeight = 5;
    const wallThickness = 1;

    // Create and track boundary meshes
    const boundaryMeshes = [];

    // Remove old compass markers if present
    if (!this.compassMarkers) this.compassMarkers = [];
    this.compassMarkers.forEach(marker => {
      this.worldGroup.remove(marker);
      if (marker.material && marker.material.map) marker.material.map.dispose();
      if (marker.material) marker.material.dispose();
    });
    this.compassMarkers = [];

    const northWall = new THREE.Mesh(
      new THREE.BoxGeometry(mapSize + wallThickness * 2, wallHeight, wallThickness),
      this._createBoxFaceMaterials(mapSize + wallThickness * 2, wallHeight, wallThickness, createBoundaryTexture, createBoundaryTexture),
    );
    northWall.position.set(0, wallHeight / 2, -mapSize / 2 - wallThickness / 2);
    northWall.castShadow = true;
    northWall.receiveShadow = true;
    northWall.name = 'North Wall';
    this.worldGroup.add(northWall);
    boundaryMeshes.push(northWall);
    const markerHeight = Math.max(wallHeight + 8, this.maxObstacleHeight + 5);
    this._addCompassMarker('N', 0xB20000, new THREE.Vector3(0, markerHeight, -mapSize / 2));
    this._addDebugLabel(northWall, 'boundary');


    const southWall = new THREE.Mesh(
      new THREE.BoxGeometry(mapSize + wallThickness * 2, wallHeight, wallThickness),
      this._createBoxFaceMaterials(mapSize + wallThickness * 2, wallHeight, wallThickness, createBoundaryTexture, createBoundaryTexture),
    );
    southWall.position.set(0, wallHeight / 2, mapSize / 2 + wallThickness / 2);
    southWall.castShadow = true;
    southWall.receiveShadow = true;
    this.worldGroup.add(southWall);
    southWall.name = 'South Wall';
    boundaryMeshes.push(southWall);
    this._addCompassMarker('S', 0x1976D2, new THREE.Vector3(0, markerHeight, mapSize / 2));
    this._addDebugLabel(southWall, 'boundary');


    const eastWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, mapSize),
      this._createBoxFaceMaterials(wallThickness, wallHeight, mapSize, createBoundaryTexture, createBoundaryTexture),
    );
    eastWall.position.set(mapSize / 2 + wallThickness / 2, wallHeight / 2, 0);
    eastWall.castShadow = true;
    eastWall.receiveShadow = true;
    this.worldGroup.add(eastWall);
    eastWall.name = 'East Wall';
    boundaryMeshes.push(eastWall);
    this._addCompassMarker('E', 0x388E3C, new THREE.Vector3(mapSize / 2, markerHeight, 0));
    this._addDebugLabel(eastWall, 'boundary');


    const westWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, mapSize),
      this._createBoxFaceMaterials(wallThickness, wallHeight, mapSize, createBoundaryTexture, createBoundaryTexture),
    );
    westWall.position.set(-mapSize / 2 - wallThickness / 2, wallHeight / 2, 0);
    westWall.castShadow = true;
    westWall.receiveShadow = true;
    this.worldGroup.add(westWall);
    westWall.name = 'West Wall';
    boundaryMeshes.push(westWall);
    this._addCompassMarker('W', 0xFBC02D, new THREE.Vector3(-mapSize / 2, markerHeight, 0));
    this._addDebugLabel(westWall, 'boundary');

    this.boundaryMeshes = boundaryMeshes;
  }

  _addCompassMarker(letter, color, position) {
    if (!this.scene) return;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = 'bold 200px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.strokeText(letter, 128, 128);
    ctx.fillText(letter, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      alphaTest: 0.1,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(20, 20, 1);
    sprite.userData = { letter, initialY: position.y }; // Store metadata
    this.worldGroup.add(sprite);
    if (!this.compassMarkers) this.compassMarkers = [];
    this.compassMarkers.push(sprite);
  }

  _updateCompassMarkerHeights() {
    if (!this.compassMarkers || this.compassMarkers.length === 0) return;
    const wallHeight = 5;
    const markerHeight = Math.max(wallHeight + 8, this.maxObstacleHeight + 5);
    this.compassMarkers.forEach(marker => {
      marker.position.y = markerHeight;
    });
  }

  clearObstacles() {
    if (!this.scene) return;
    this.obstacleMeshes.forEach((mesh) => {
      // Remove and dispose shadow mesh if present
      if (mesh.userData && mesh.userData.shadowMesh) {
        this.worldGroup.remove(mesh.userData.shadowMesh);
        mesh.userData.shadowMesh.geometry?.dispose();
        mesh.userData.shadowMesh.material?.dispose();
        mesh.userData.shadowMesh = null;
      }
      this.worldGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => mat.dispose());
      } else if (mesh.material) {
        mesh.material.dispose();
      }
    });
    this.obstacleMeshes = [];
    this._clearDebugLabels('obstacle');
  }

  setObstacles(obstacles = []) {
    if (!this.scene) return;
    this.clearObstacles();

    // Track max obstacle height for cardinal marker positioning
    this.maxObstacleHeight = 0;
    obstacles.forEach((obs) => {
      const h = obs.h || 4;
      const baseY = obs.baseY || 0;
      const topY = baseY + h;
      if (topY > this.maxObstacleHeight) {
        this.maxObstacleHeight = topY;
      }
    });

    obstacles.forEach((obs, i) => {
      const h = obs.h || 4;
      const baseY = obs.baseY || 0;
      let mesh = null;

      if (obs.type === 'pyramid') {
        const geometry = new THREE.ConeGeometry(0.5 / Math.SQRT2, h, 4, 1);
        geometry.clearGroups();
        geometry.addGroup(0, geometry.index.count - 12, 0);
        geometry.addGroup(geometry.index.count - 12, 12, 1);
        geometry.rotateY(-Math.PI / 4);
        if (obs.w > obs.d) {
          geometry.rotateY(Math.PI / 2);
        }
        geometry.scale(2 * obs.w, 1, 2 * obs.d);
        if (obs.inverted) {
          geometry.rotateX(Math.PI);
        }

        const pyramidTexture = createPyramidTexture();
        const pyramidBaseSpan = Math.max(obs.w, obs.d);
        const pyramidSlantHeight = Math.hypot(h, pyramidBaseSpan / 2);
        pyramidTexture.repeat.set(pyramidBaseSpan / 8, pyramidSlantHeight / 8);

        const roofTexture = createRoofTexture();
        roofTexture.repeat.set(obs.w / 2, obs.d / 2);
        if (obs.inverted) {
          roofTexture.rotation = Math.PI;
          roofTexture.center.set(0.5, 0.5);
        }

        mesh = new THREE.Mesh(
          geometry,
          [
            new THREE.MeshLambertMaterial({ map: pyramidTexture, flatShading: true }),
            new THREE.MeshLambertMaterial({ map: roofTexture, flatShading: true }),
          ],
        );
        mesh.position.set(obs.x, baseY + h / 2, obs.z);
        mesh.rotation.y = obs.rotation || 0;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.name = obs.name || `Pyramid ${i + 1}`;
        if (mesh.geometry && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        this.worldGroup.add(mesh);
        this._addDebugLabel(mesh, 'obstacle');
      } else {
        const materials = this._createBoxFaceMaterials(obs.w, h, obs.d, createBoxWallTexture, createRoofTexture);

        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(obs.w, h, obs.d),
          materials,
        );
        mesh.position.set(obs.x, baseY + h / 2, obs.z);
        mesh.rotation.y = obs.rotation || 0;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.name = obs.name || `Box ${i + 1}`;
        if (mesh.geometry && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        this.worldGroup.add(mesh);
        this._addDebugLabel(mesh, 'obstacle');
      }

      if (mesh) {
        this.obstacleMeshes.push(mesh);
      }
    });

    // Update compass marker heights now that we know maxObstacleHeight
    this._updateCompassMarkerHeights();
  }

  setDebugLabelsEnabled(enabled) {
    this.debugLabelsEnabled = enabled;
    this._updateDebugLabelsVisibility();
  }

  _addDebugLabel(object3D, type) {
    if (!object3D) return;
    const labelMaterial = new THREE.SpriteMaterial({
      depthTest: true,
      depthWrite: false,
      transparent: true,
      alphaTest: 0.1,
    });
    const label = new THREE.Sprite(labelMaterial);
    label.scale.set(4, 1, 1);
    this.updateSpriteLabel(label, object3D.name || '', '#ffffff');
    // Ensure boundingBox is computed for label placement
    if (object3D.geometry && !object3D.geometry.boundingBox) object3D.geometry.computeBoundingBox();
    const y = (object3D.geometry && object3D.geometry.boundingBox ? object3D.geometry.boundingBox.max.y : object3D.position.y) + 2;
    label.position.set(0, y, 0);
    object3D.add(label);
    label.visible = this.debugLabelsEnabled;
    this.debugLabels.push({ label, object3D, type });
  }

  _clearDebugLabels(type = null) {
    this.debugLabels = this.debugLabels.filter(({ label, object3D, type: t }) => {
      if (!type || t === type) {
        if (object3D && label) {
          object3D.remove(label);
        }
        if (label && label.material) {
          if (label.material.map) {
            label.material.map.dispose();
          }
          label.material.dispose();
        }
        return false;
      }
      return true;
    });
  }

  _updateDebugLabelsVisibility() {
    this.debugLabels.forEach(({ label }) => {
        if (label) {
          label.visible = this.debugLabelsEnabled;
        }
    });
  }

  clearMountains() {
    if (!this.scene) return;
    this.mountainMeshes.forEach((mesh) => {
      this.worldGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });
    this.mountainMeshes = [];
  }

  _createSharedImageTexture(path) {
    const source = this._getSharedImage(path);
    const texture = new THREE.Texture();
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    const applyImage = (image) => {
      if (!image) return;
      texture.image = image;
      texture.needsUpdate = true;
    };

    if (source.loaded) {
      applyImage(source.image);
    } else if (!source.error) {
      source.listeners.push((image) => {
        applyImage(image);
      });
    }

    return texture;
  }

  _createMountainStripGeometry(radius, height, startAngle, angleLength, segmentCount, textureWidth = 512) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const angleStep = angleLength / segmentCount;

    for (let i = 0; i <= segmentCount; i += 1) {
      const angle = startAngle + angleStep * i;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      const nx = -Math.SQRT1_2 * Math.cos(angle);
      const nz = -Math.SQRT1_2 * Math.sin(angle);
      let u = i / segmentCount;
      if (MOUNTAIN_TEXTURE_PATHS.length !== 1) {
        u = (u * (textureWidth - 2) + 1) / textureWidth;
      }

      positions.push(x, 0, z);
      positions.push(x, height, z);

      normals.push(nx, Math.SQRT1_2, nz);
      normals.push(nx, Math.SQRT1_2, nz);

      uvs.push(u, 0.02);
      uvs.push(u, 0.99);
    }

    for (let i = 0; i < segmentCount; i += 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return geometry;
  }

  createMountains(mapSize) {
    if (!this.scene) return;
    this.clearMountains();

    const mountainDistance = 2.25 * mapSize;
    const mountainHeight = 0.9 * mapSize;
    const numMountainTextures = MOUNTAIN_TEXTURE_PATHS.length;
    const numFacesPerTexture = Math.ceil(BZFLAG_MOUNTAIN_FACE_COUNT / numMountainTextures);
    const angleScale = Math.PI / (numMountainTextures * numFacesPerTexture);
    const segmentAngle = angleScale * numFacesPerTexture;

    for (let textureIndex = 0, n = Math.floor(numFacesPerTexture / 2);
      textureIndex < numMountainTextures;
      textureIndex += 1, n += numFacesPerTexture) {
      const texture = this._createSharedImageTexture(MOUNTAIN_TEXTURE_PATHS[textureIndex]);
      const material = new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.02,
        side: THREE.DoubleSide,
      });

      const frontGeometry = this._createMountainStripGeometry(
        mountainDistance,
        mountainHeight,
        angleScale * n,
        segmentAngle,
        numFacesPerTexture,
      );
      const frontMountain = new THREE.Mesh(frontGeometry, material);
      frontMountain.receiveShadow = false;
      frontMountain.castShadow = false;
      this.worldGroup.add(frontMountain);
      this.mountainMeshes.push(frontMountain);

      const backGeometry = this._createMountainStripGeometry(
        mountainDistance,
        mountainHeight,
        Math.PI + angleScale * n,
        segmentAngle,
        numFacesPerTexture,
      );
      const backMountain = new THREE.Mesh(backGeometry, material.clone());
      backMountain.receiveShadow = false;
      backMountain.castShadow = false;
      this.worldGroup.add(backMountain);
      this.mountainMeshes.push(backMountain);
    }
  }

  clearCelestialBodies() {
    if (!this.scene) return;
    this.celestialMeshes.forEach((mesh) => {
      this.worldGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    });
    this.celestialMeshes = [];
    this.sunMesh = null;
    this.sunGlowMesh = null;
    this.moonMesh = null;
  }

  _updateCelestialBodies({ sunX, sunY, sunZ, moonX, moonY, moonZ, sunColor, sunVisible = true, moonVisible = true }) {
    if (!this.scene || !this.worldGroup) return;

    if (!this.sunMesh || !this.sunGlowMesh || !this.moonMesh) {
      this.clearCelestialBodies();

      const sunGeometry = new THREE.SphereGeometry(8, 32, 32);
      const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, fog: false, depthTest: true, depthWrite: false, toneMapped: false });
      this.sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
      this.sunMesh.renderOrder = 1000;
      this.worldGroup.add(this.sunMesh);
      this.celestialMeshes.push(this.sunMesh);

      const glowGeometry = new THREE.SphereGeometry(12, 32, 32);
      const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.3, fog: false, depthTest: true, depthWrite: false, toneMapped: false });
      this.sunGlowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
      this.sunGlowMesh.renderOrder = 999;
      this.worldGroup.add(this.sunGlowMesh);
      this.celestialMeshes.push(this.sunGlowMesh);

      const moonGeometry = new THREE.SphereGeometry(6, 32, 32);
      const moonMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc, fog: false, depthTest: true, depthWrite: false, toneMapped: false });
      this.moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
      this.moonMesh.renderOrder = 1000;
      this.worldGroup.add(this.moonMesh);
      this.celestialMeshes.push(this.moonMesh);
    }

    this.sunMesh.visible = !!sunVisible;
    this.sunGlowMesh.visible = !!sunVisible;
    this.moonMesh.visible = !!moonVisible;

    this.sunMesh.position.set(sunX, sunY, sunZ);
    this.sunGlowMesh.position.set(sunX, sunY, sunZ);
    this.moonMesh.position.set(moonX, moonY, moonZ);

    if (sunColor) {
      this.sunMesh.material.color.copy(sunColor);
      this.sunGlowMesh.material.color.copy(sunColor).lerp(new THREE.Color(0xffffff), 0.2);
    }
  }

  createCelestialBodies(celestialData) {
    if (!this.scene || !celestialData) return;
    const sun = celestialData.sun || {};
    const moon = celestialData.moon || {};
    this._updateCelestialBodies({
      sunX: sun.x || 0,
      sunY: sun.y || 0,
      sunZ: sun.z || 0,
      moonX: moon.x || 0,
      moonY: moon.y || 0,
      moonZ: moon.z || 0,
      sunVisible: sun.visible !== false,
      moonVisible: moon.visible !== false,
    });
  }

  clearClouds() {
    if (!this.scene) return;
    this.clouds.forEach((cloud) => {
      this.worldGroup.remove(cloud);
    });
    this.clouds = [];
  }

  createClouds(cloudsData = []) {
    if (!this.scene) return;
    this.clearClouds();

    cloudsData.forEach((cloudData) => {
      const cloudGroup = new THREE.Group();

      cloudData.puffs.forEach((puff) => {
        const geometry = new THREE.SphereGeometry(puff.radius, 8, 8);
        const material = new THREE.MeshLambertMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.7,
        });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.set(puff.offsetX, puff.offsetY, puff.offsetZ);
        cloudGroup.add(sphere);
      });

      cloudGroup.position.set(cloudData.x, cloudData.y, cloudData.z);
      cloudGroup.userData.velocity = 0.5 + Math.random() * 1.0;
      cloudGroup.userData.startX = cloudData.x;

      this.worldGroup.add(cloudGroup);
      this.clouds.push(cloudGroup);
    });
  }

  getClouds() {
    return this.clouds;
  }

  _preloadTankModel(modelPath = this._tankModelPath) {
    const loadPath = modelPath || '/obj/bzflag.obj';
    if (this._tankTemplateByPath.has(loadPath) || this._tankModelLoadsInFlight.has(loadPath)) {
      return;
    }

    const loader = new OBJLoader();
    this._tankModelLoadsInFlight.add(loadPath);
    const onLoad = (obj) => {
      const cache = {};
      obj.traverse((child) => {
        if (child.isMesh) cache[child.name] = child.geometry;
      });
      this._tankTemplateByPath.set(loadPath, obj);
      this._tankGeoCacheByPath.set(loadPath, cache);
      if (loadPath === this._tankModelPath) {
        this._tankTemplate = obj;
        this._tankGeoCache = cache;
      }
      const readyResolver = this._tankModelReadyResolversByPath.get(loadPath);
      if (readyResolver) {
        readyResolver.resolve(obj);
        this._tankModelReadyResolversByPath.delete(loadPath);
      }
      this._tankModelLoadsInFlight.delete(loadPath);
    };

    loader.load(loadPath, onLoad, undefined, () => {
      const readyResolver = this._tankModelReadyResolversByPath.get(loadPath);
      if (readyResolver) {
        readyResolver.reject(new Error(`Failed to load tank model: ${loadPath}`));
        this._tankModelReadyResolversByPath.delete(loadPath);
        this._tankModelReadyPromisesByPath.delete(loadPath);
      }
      this._tankModelLoadsInFlight.delete(loadPath);
      if (loadPath !== '/obj/simple.obj') {
        this._preloadTankModel('/obj/simple.obj');
      }
    });
  }

  setTankModel(modelPath = '/obj/bzflag.obj') {
    const normalizedPath = modelPath || '/obj/bzflag.obj';
    if (this._tankModelPath === normalizedPath && this._tankTemplateByPath.has(normalizedPath)) return;
    this._tankModelPath = normalizedPath;
    const template = this._tankTemplateByPath.get(normalizedPath) || null;
    const cache = this._tankGeoCacheByPath.get(normalizedPath) || null;
    this._tankTemplate = template;
    this._tankGeoCache = cache;
    this._preloadTankModel(normalizedPath);
  }

  preloadTankModel(modelPath) {
    this._preloadTankModel(modelPath);
  }

  whenTankModelReady(modelPath = this._tankModelPath) {
    const loadPath = modelPath || '/obj/bzflag.obj';
    if (this._tankTemplateByPath.has(loadPath)) {
      return Promise.resolve(this._tankTemplateByPath.get(loadPath));
    }

    if (!this._tankModelReadyPromisesByPath.has(loadPath)) {
      this._tankModelReadyPromisesByPath.set(loadPath, new Promise((resolve, reject) => {
        this._tankModelReadyResolversByPath.set(loadPath, { resolve, reject });
      }));
    }

    this._preloadTankModel(loadPath);
    return this._tankModelReadyPromisesByPath.get(loadPath);
  }

  getTankModel() {
    return this._tankModelPath;
  }

  _findTankTemplateMesh(name, modelPath = this._tankModelPath) {
    const template = this._tankTemplateByPath.get(modelPath);
    if (!template) return null;
    let found = null;
    template.traverse((child) => {
      if (!found && child.isMesh && child.name === name) {
        found = child;
      }
    });
    return found;
  }

  _findFirstTankTemplateMesh(names, modelPath = this._tankModelPath) {
    for (const name of names) {
      const mesh = this._findTankTemplateMesh(name, modelPath);
      if (mesh) return mesh;
    }
    return null;
  }

  _cloneTemplateMesh(templateMesh, material) {
    let geometry = templateMesh.geometry;
    let resolvedMaterial = material;
    if (Array.isArray(material) && (!geometry.groups || geometry.groups.length === 0)) {
      if (material.length >= 6) {
        geometry = geometry.clone();
        geometry.clearGroups();

        const position = geometry.attributes.position;
        const index = geometry.index ? geometry.index.array : null;
        const triangleCount = index ? index.length / 3 : position.count / 3;

        const getVertex = (vertexIndex, target) => {
          target.set(
            position.getX(vertexIndex),
            position.getY(vertexIndex),
            position.getZ(vertexIndex),
          );
          return target;
        };

        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const ab = new THREE.Vector3();
        const ac = new THREE.Vector3();
        const normal = new THREE.Vector3();

        for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
          const base = triangleIndex * 3;
          const ia = index ? index[base] : base;
          const ib = index ? index[base + 1] : base + 1;
          const ic = index ? index[base + 2] : base + 2;

          getVertex(ia, a);
          getVertex(ib, b);
          getVertex(ic, c);

          ab.subVectors(b, a);
          ac.subVectors(c, a);
          normal.crossVectors(ab, ac).normalize();

          let materialIndex = 0;
          if (Math.abs(normal.y) >= Math.abs(normal.x) && Math.abs(normal.y) >= Math.abs(normal.z)) {
            materialIndex = normal.y >= 0 ? 2 : 3;
          }

          geometry.addGroup(base, 3, materialIndex);
        }
      } else {
        resolvedMaterial = material[0];
      }
    }
    const mesh = new THREE.Mesh(geometry, resolvedMaterial);
    mesh.name = templateMesh.name;
    mesh.position.copy(templateMesh.position);
    mesh.rotation.copy(templateMesh.rotation);
    mesh.scale.copy(templateMesh.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  _nudgeWheelMeshOutward(mesh, directionHint = 0) {
    if (!mesh || !mesh.geometry) return;

    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox();
    }

    const box = mesh.geometry.boundingBox;
    const centerX = box ? (box.min.x + box.max.x) * 0.5 : 0;
    const direction = directionHint || Math.sign(centerX);
    if (!direction) return;

    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.translate(direction * TANK_WHEEL_OUTWARD_NUDGE, 0, 0);
  }

  _getTemplateMeshesByPrefix(prefix, modelPath = this._tankModelPath) {
    const template = this._tankTemplateByPath.get(modelPath);
    if (!template) return [];
    const meshes = [];
    template.traverse((child) => {
      if (child.isMesh && child.name && child.name.startsWith(prefix)) {
        meshes.push(child);
      }
    });
    meshes.sort((a, b) => {
      const ai = parseInt(a.name.slice(prefix.length), 10);
      const bi = parseInt(b.name.slice(prefix.length), 10);
      const aNum = Number.isFinite(ai) ? ai : 0;
      const bNum = Number.isFinite(bi) ? bi : 0;
      return aNum - bNum;
    });
    return meshes;
  }

  _getTemplateMeshesByPrefixes(prefixes, modelPath = this._tankModelPath) {
    const seen = new Set();
    const meshes = [];

    prefixes.forEach((prefix) => {
      this._getTemplateMeshesByPrefix(prefix, modelPath).forEach((mesh) => {
        if (seen.has(mesh.uuid)) return;
        seen.add(mesh.uuid);
        meshes.push(mesh);
      });
    });

    meshes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return meshes;
  }

  _createTankFromTemplate(color = 0x4caf50, name = '', modelPath = this._tankModelPath) {
    const template = this._tankTemplateByPath.get(modelPath);
    if (!template) {
      this._preloadTankModel(modelPath);
      return null;
    }

    const templateParts = {
      body: this._findFirstTankTemplateMesh(TANK_PART_ALIASES.body, modelPath),
      leftTreadMiddle: this._findFirstTankTemplateMesh(TANK_PART_ALIASES.leftTreadMiddle, modelPath),
      leftTreadFrontCap: this._findFirstTankTemplateMesh(TANK_PART_ALIASES.leftTreadFrontCap, modelPath),
      leftTreadRearCap: this._findFirstTankTemplateMesh(TANK_PART_ALIASES.leftTreadRearCap, modelPath),
      rightTreadMiddle: this._findFirstTankTemplateMesh(TANK_PART_ALIASES.rightTreadMiddle, modelPath),
      rightTreadFrontCap: this._findFirstTankTemplateMesh(TANK_PART_ALIASES.rightTreadFrontCap, modelPath),
      rightTreadRearCap: this._findFirstTankTemplateMesh(TANK_PART_ALIASES.rightTreadRearCap, modelPath),
      turret: this._findFirstTankTemplateMesh(TANK_PART_ALIASES.turret, modelPath),
      barrel: this._findFirstTankTemplateMesh(TANK_PART_ALIASES.barrel, modelPath),
    };
    const leftWheelParts = this._getTemplateMeshesByPrefixes(TANK_WHEEL_PREFIX_ALIASES.left, modelPath);
    const rightWheelParts = this._getTemplateMeshesByPrefixes(TANK_WHEEL_PREFIX_ALIASES.right, modelPath);

    const hasLeftTread = !!(templateParts.leftTreadMiddle && templateParts.leftTreadFrontCap && templateParts.leftTreadRearCap);
    const hasRightTread = !!(templateParts.rightTreadMiddle && templateParts.rightTreadFrontCap && templateParts.rightTreadRearCap);
    const hasWheelPairs = leftWheelParts.length > 0 && rightWheelParts.length > 0;

    if (!templateParts.body || !templateParts.turret || !templateParts.barrel) {
      return null;
    }

    if ((!hasLeftTread || !hasRightTread) && !hasWheelPairs) {
      return null;
    }

    const tankGroup = new THREE.Group();

    if (name) {
      const spriteMaterial = new THREE.SpriteMaterial({
        depthTest: true,
        depthWrite: false,
        transparent: true,
        alphaTest: 0.1,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.set(0, 3, 0);
      sprite.scale.set(2, 0.5, 1);
      tankGroup.add(sprite);
      tankGroup.userData.nameLabel = sprite;
      this.updateSpriteLabel(sprite, name, color);
    }

    const bodyTexture = this._createTankTexture(color);
    const treadTexture = this._createTreadTexture();
    const treadTextureRotated = treadTexture.clone();
    treadTextureRotated.rotation = Math.PI / 2;
    treadTextureRotated.center.set(0.5, 0.5);
    treadTextureRotated.needsUpdate = true;
    const treadCapTexture = this._createTreadCapTexture(color);

    const treadCapTextureSide = treadCapTexture.clone();
    treadCapTextureSide.repeat.set(3.0, 1.0);
    treadCapTextureSide.wrapS = THREE.RepeatWrapping;
    treadCapTextureSide.wrapT = THREE.RepeatWrapping;
    treadCapTextureSide.needsUpdate = true;

    const bodyMaterial = new THREE.MeshLambertMaterial({ map: bodyTexture });
    const body = this._cloneTemplateMesh(templateParts.body, bodyMaterial);
    tankGroup.add(body);
    tankGroup.userData.body = body;

    tankGroup.userData.leftTreadTextures = [];
    tankGroup.userData.rightTreadTextures = [];
    tankGroup.userData.leftWheelTextures = [];
    tankGroup.userData.rightWheelTextures = [];
    tankGroup.userData.leftWheelSideTextures = [];
    tankGroup.userData.rightWheelSideTextures = [];

    const treadCapMat = new THREE.MeshLambertMaterial({ map: treadCapTexture });
    const treadCapMatSide = new THREE.MeshLambertMaterial({ map: treadCapTextureSide });

    const leftTreadGroup = hasLeftTread ? new THREE.Group() : null;
    const rightTreadGroup = hasRightTread ? new THREE.Group() : null;

    if (hasLeftTread) {
      const leftTreadRotatedTex = treadTextureRotated.clone();
      leftTreadRotatedTex.wrapS = THREE.RepeatWrapping;
      leftTreadRotatedTex.wrapT = THREE.RepeatWrapping;
      const leftTreadRotatedMat = new THREE.MeshLambertMaterial({ map: leftTreadRotatedTex });
      const leftTreadMiddle = this._cloneTemplateMesh(templateParts.leftTreadMiddle, [
        treadCapMatSide,
        treadCapMatSide,
        leftTreadRotatedMat,
        leftTreadRotatedMat,
        treadCapMatSide,
        treadCapMatSide,
      ]);
      leftTreadGroup.add(leftTreadMiddle);
      tankGroup.userData.leftTreadTextures.push(leftTreadRotatedTex);

      const leftCapGroups = templateParts.leftTreadFrontCap.geometry.groups.length;
      const leftTreadFrontTex = treadTexture.clone();
      leftTreadFrontTex.wrapS = THREE.RepeatWrapping;
      leftTreadFrontTex.wrapT = THREE.RepeatWrapping;
      const leftTreadFrontMat = new THREE.MeshLambertMaterial({ map: leftTreadFrontTex });
      const leftTreadFront = this._cloneTemplateMesh(
        templateParts.leftTreadFrontCap,
        leftCapGroups === 2
          ? [leftTreadFrontMat, treadCapMat]
          : [leftTreadFrontMat, treadCapMat, treadCapMat],
      );
      leftTreadGroup.add(leftTreadFront);
      tankGroup.userData.leftTreadTextures.push(leftTreadFrontTex);

      const leftTreadRearTex = treadTexture.clone();
      leftTreadRearTex.wrapS = THREE.RepeatWrapping;
      leftTreadRearTex.wrapT = THREE.RepeatWrapping;
      const leftTreadRearMat = new THREE.MeshLambertMaterial({ map: leftTreadRearTex });
      const leftTreadRear = this._cloneTemplateMesh(
        templateParts.leftTreadRearCap,
        leftCapGroups === 2
          ? [leftTreadRearMat, treadCapMat]
          : [leftTreadRearMat, treadCapMat, treadCapMat],
      );
      leftTreadGroup.add(leftTreadRear);
      tankGroup.userData.leftTreadTextures.push(leftTreadRearTex);
    }

    if (hasRightTread) {
      const rightTreadRotatedTex = treadTextureRotated.clone();
      rightTreadRotatedTex.wrapS = THREE.RepeatWrapping;
      rightTreadRotatedTex.wrapT = THREE.RepeatWrapping;
      const rightTreadRotatedMat = new THREE.MeshLambertMaterial({ map: rightTreadRotatedTex });
      const rightTreadMiddle = this._cloneTemplateMesh(templateParts.rightTreadMiddle, [
        treadCapMatSide,
        treadCapMatSide,
        rightTreadRotatedMat,
        rightTreadRotatedMat,
        treadCapMatSide,
        treadCapMatSide,
      ]);
      rightTreadGroup.add(rightTreadMiddle);
      tankGroup.userData.rightTreadTextures.push(rightTreadRotatedTex);

      const rightCapGroups = templateParts.rightTreadFrontCap.geometry.groups.length;
      const rightTreadFrontTex = treadTexture.clone();
      rightTreadFrontTex.wrapS = THREE.RepeatWrapping;
      rightTreadFrontTex.wrapT = THREE.RepeatWrapping;
      const rightTreadFrontMat = new THREE.MeshLambertMaterial({ map: rightTreadFrontTex });
      const rightTreadFront = this._cloneTemplateMesh(
        templateParts.rightTreadFrontCap,
        rightCapGroups === 2
          ? [rightTreadFrontMat, treadCapMat]
          : [rightTreadFrontMat, treadCapMat, treadCapMat],
      );
      rightTreadGroup.add(rightTreadFront);
      tankGroup.userData.rightTreadTextures.push(rightTreadFrontTex);

      const rightTreadRearTex = treadTexture.clone();
      rightTreadRearTex.wrapS = THREE.RepeatWrapping;
      rightTreadRearTex.wrapT = THREE.RepeatWrapping;
      const rightTreadRearMat = new THREE.MeshLambertMaterial({ map: rightTreadRearTex });
      const rightTreadRear = this._cloneTemplateMesh(
        templateParts.rightTreadRearCap,
        rightCapGroups === 2
          ? [rightTreadRearMat, treadCapMat]
          : [rightTreadRearMat, treadCapMat, treadCapMat],
      );
      rightTreadGroup.add(rightTreadRear);
      tankGroup.userData.rightTreadTextures.push(rightTreadRearTex);
    }

    tankGroup.userData.leftWheels = [];
    tankGroup.userData.rightWheels = [];
    leftWheelParts.forEach((templateWheel, index) => {
      const wheelSideTexture = this._createWheelTexture();
      const wheelFaceTexture = this._createWheelTreadTexture();
      wheelFaceTexture.rotation = (index * 0.17) * Math.PI * 2;
      wheelFaceTexture.center.set(0.5, 0.5);
      wheelFaceTexture.needsUpdate = true;
      wheelSideTexture.offset.x = index * 0.17;
      wheelSideTexture.needsUpdate = true;
      const wheel = this._cloneTemplateMesh(templateWheel, [
        new THREE.MeshLambertMaterial({ map: wheelSideTexture }),
        new THREE.MeshLambertMaterial({ map: wheelFaceTexture }),
        new THREE.MeshLambertMaterial({ map: wheelFaceTexture }),
      ]);
      this._nudgeWheelMeshOutward(wheel, -1);
      tankGroup.add(wheel);
      tankGroup.userData.leftWheels.push(wheel);
      tankGroup.userData.leftWheelTextures.push(wheelFaceTexture);
      tankGroup.userData.leftWheelSideTextures.push(wheelSideTexture);
    });
    rightWheelParts.forEach((templateWheel, index) => {
      const wheelSideTexture = this._createWheelTexture();
      const wheelFaceTexture = this._createWheelTreadTexture();
      wheelFaceTexture.rotation = (index * 0.17) * Math.PI * 2;
      wheelFaceTexture.center.set(0.5, 0.5);
      wheelFaceTexture.needsUpdate = true;
      wheelSideTexture.offset.x = index * 0.17;
      wheelSideTexture.needsUpdate = true;
      const wheel = this._cloneTemplateMesh(templateWheel, [
        new THREE.MeshLambertMaterial({ map: wheelSideTexture }),
        new THREE.MeshLambertMaterial({ map: wheelFaceTexture }),
        new THREE.MeshLambertMaterial({ map: wheelFaceTexture }),
      ]);
      this._nudgeWheelMeshOutward(wheel, 1);
      tankGroup.add(wheel);
      tankGroup.userData.rightWheels.push(wheel);
      tankGroup.userData.rightWheelTextures.push(wheelFaceTexture);
      tankGroup.userData.rightWheelSideTextures.push(wheelSideTexture);
    });

    const sampleWheel = tankGroup.userData.leftWheels[0] || tankGroup.userData.rightWheels[0];
    if (sampleWheel && sampleWheel.geometry) {
      if (!sampleWheel.geometry.boundingBox) sampleWheel.geometry.computeBoundingBox();
      const box = sampleWheel.geometry.boundingBox;
      const radiusY = (box.max.y - box.min.y) * 0.5;
      const radiusZ = (box.max.z - box.min.z) * 0.5;
      tankGroup.userData.wheelRadius = Math.max(0.05, Math.max(radiusY, radiusZ));
    } else {
      tankGroup.userData.wheelRadius = 0.42;
    }

    if (leftTreadGroup) tankGroup.add(leftTreadGroup);
    if (rightTreadGroup) tankGroup.add(rightTreadGroup);
    tankGroup.userData.treadGroups = [leftTreadGroup, rightTreadGroup].filter(Boolean);

    const turretTexture = bodyTexture.clone();
    turretTexture.wrapS = THREE.RepeatWrapping;
    turretTexture.wrapT = THREE.RepeatWrapping;
    turretTexture.repeat.set(6.28 / 4, 0.8 / 4);
    turretTexture.needsUpdate = true;
    const turretMaterial = new THREE.MeshLambertMaterial({ map: turretTexture });
    const turret = this._cloneTemplateMesh(templateParts.turret, turretMaterial);
    tankGroup.add(turret);
    tankGroup.userData.turret = turret;

    const barrelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const barrel = this._cloneTemplateMesh(templateParts.barrel, barrelMaterial);
    tankGroup.add(barrel);
    tankGroup.userData.barrel = barrel;
    this._setTankMuzzleData(tankGroup, barrel);

    tankGroup.userData.explodableParts = [
      body,
      turret,
      barrel,
      ...tankGroup.userData.treadGroups,
      ...tankGroup.userData.leftWheels,
      ...tankGroup.userData.rightWheels,
    ];

    return tankGroup;
  }

  createTank(color = 0x4caf50, name = '', modelPath = this._tankModelPath) {
    const templateTank = this._createTankFromTemplate(color, name, modelPath);
    if (templateTank) {
      return templateTank;
    }

    const tankGroup = new THREE.Group();

    if (name) {
      const spriteMaterial = new THREE.SpriteMaterial({
        depthTest: true,
        depthWrite: false,
        transparent: true,
        alphaTest: 0.1,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.set(0, 3, 0);
      sprite.scale.set(2, 0.5, 1);
      tankGroup.add(sprite);
      tankGroup.userData.nameLabel = sprite;
      this.updateSpriteLabel(sprite, name, color);
    }

    const bodyTexture = this._createTankTexture(color);
    const treadTexture = this._createTreadTexture();
    const treadTextureRotated = treadTexture.clone();
    treadTextureRotated.rotation = Math.PI / 2;
    treadTextureRotated.center.set(0.5, 0.5);
    treadTextureRotated.needsUpdate = true;
    const treadCapTexture = this._createTreadCapTexture(color);

    const treadCapTextureSide = treadCapTexture.clone();
    treadCapTextureSide.repeat.set(3.0, 1.0);
    treadCapTextureSide.wrapS = THREE.RepeatWrapping;
    treadCapTextureSide.wrapT = THREE.RepeatWrapping;
    treadCapTextureSide.needsUpdate = true;

    const bodyGeometry = this._tankGeoCache?.body ?? new THREE.BoxGeometry(3, 1, 4);
    const bodyMaterial = new THREE.MeshLambertMaterial({ map: bodyTexture });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.8;
    body.castShadow = true;
    body.receiveShadow = true;
    tankGroup.add(body);
    tankGroup.userData.body = body;

    const treadCapMat = new THREE.MeshLambertMaterial({ map: treadCapTexture });

    const leftTreadGroup = new THREE.Group();
    leftTreadGroup.position.set(-1.1375, 0.6, 0);

    tankGroup.userData.leftTreadTextures = [];
    tankGroup.userData.rightTreadTextures = [];

    const treadHeight = 1.2;            // BZFlag exposed treadHeight
    const treadWidth = 0.525;           // BZFlag exposed treadWidth (treadOutside - treadInside)
    const treadCapRadius = treadHeight / 2;
    const treadMiddleLength = 4.8;      // BZFlag fullLength - treadHeight = 6.0 - 1.2
    const treadMiddleGeom = this._tankGeoCache?.treadMiddle ?? new THREE.BoxGeometry(treadWidth, treadHeight, treadMiddleLength);
    const leftTreadRotatedTex = treadTextureRotated.clone();
    leftTreadRotatedTex.wrapS = THREE.RepeatWrapping;
    leftTreadRotatedTex.wrapT = THREE.RepeatWrapping;
    const leftTreadRotatedMat = new THREE.MeshLambertMaterial({ map: leftTreadRotatedTex });
    const treadCapMatSide = new THREE.MeshLambertMaterial({ map: treadCapTextureSide });
    const leftTreadMiddle = new THREE.Mesh(
      treadMiddleGeom,
      [treadCapMatSide, treadCapMatSide, leftTreadRotatedMat, leftTreadRotatedMat, treadCapMatSide, treadCapMatSide],
    );
    leftTreadMiddle.castShadow = true;
    leftTreadGroup.add(leftTreadMiddle);
    tankGroup.userData.leftTreadTextures.push(leftTreadRotatedTex);

    const treadCapGeom = this._tankGeoCache?.treadFrontCap ?? new THREE.CylinderGeometry(treadCapRadius, treadCapRadius, treadWidth, 16, 1, false, 0, Math.PI);
    const treadCapGeomRear = this._tankGeoCache?.treadRearCap ?? new THREE.CylinderGeometry(treadCapRadius, treadCapRadius, treadWidth, 16, 1, false, Math.PI, Math.PI);
    // OBJ-loaded caps have 2 groups (tread_side, tread_cap); procedural have 3
    const capGroups = treadCapGeom.groups.length;
    const leftTreadFrontTex = treadTexture.clone();
    leftTreadFrontTex.wrapS = THREE.RepeatWrapping;
    leftTreadFrontTex.wrapT = THREE.RepeatWrapping;
    const leftTreadFrontMat = new THREE.MeshLambertMaterial({ map: leftTreadFrontTex });
    const leftTreadFront = new THREE.Mesh(treadCapGeom, capGroups === 2 ? [leftTreadFrontMat, treadCapMat] : [leftTreadFrontMat, treadCapMat, treadCapMat]);
    leftTreadFront.rotation.x = Math.PI / 2;
    leftTreadFront.rotation.z = Math.PI / 2;
    leftTreadFront.position.z = treadMiddleLength / 2;
    leftTreadFront.castShadow = true;
    leftTreadGroup.add(leftTreadFront);
    tankGroup.userData.leftTreadTextures.push(leftTreadFrontTex);

    const leftTreadRearTex = treadTexture.clone();
    leftTreadRearTex.wrapS = THREE.RepeatWrapping;
    leftTreadRearTex.wrapT = THREE.RepeatWrapping;
    const leftTreadRearMat = new THREE.MeshLambertMaterial({ map: leftTreadRearTex });
    const leftTreadRear = new THREE.Mesh(treadCapGeomRear, capGroups === 2 ? [leftTreadRearMat, treadCapMat] : [leftTreadRearMat, treadCapMat, treadCapMat]);
    leftTreadRear.rotation.x = Math.PI / 2;
    leftTreadRear.rotation.z = Math.PI / 2;
    leftTreadRear.position.z = -treadMiddleLength / 2;
    leftTreadRear.castShadow = true;
    leftTreadGroup.add(leftTreadRear);
    tankGroup.userData.leftTreadTextures.push(leftTreadRearTex);

    tankGroup.add(leftTreadGroup);

    const rightTreadGroup = new THREE.Group();
    rightTreadGroup.position.set(1.1375, 0.6, 0);

    const rightTreadRotatedTex = treadTextureRotated.clone();
    rightTreadRotatedTex.wrapS = THREE.RepeatWrapping;
    rightTreadRotatedTex.wrapT = THREE.RepeatWrapping;
    const rightTreadRotatedMat = new THREE.MeshLambertMaterial({ map: rightTreadRotatedTex });
    const rightTreadMiddle = new THREE.Mesh(
      treadMiddleGeom,
      [treadCapMatSide, treadCapMatSide, rightTreadRotatedMat, rightTreadRotatedMat, treadCapMatSide, treadCapMatSide],
    );
    rightTreadMiddle.castShadow = true;
    rightTreadGroup.add(rightTreadMiddle);
    tankGroup.userData.rightTreadTextures.push(rightTreadRotatedTex);

    const rightTreadFrontTex = treadTexture.clone();
    rightTreadFrontTex.wrapS = THREE.RepeatWrapping;
    rightTreadFrontTex.wrapT = THREE.RepeatWrapping;
    const rightTreadFrontMat = new THREE.MeshLambertMaterial({ map: rightTreadFrontTex });
    const rightTreadFront = new THREE.Mesh(treadCapGeom, capGroups === 2 ? [rightTreadFrontMat, treadCapMat] : [rightTreadFrontMat, treadCapMat, treadCapMat]);
    rightTreadFront.rotation.x = Math.PI / 2;
    rightTreadFront.rotation.z = Math.PI / 2;
    rightTreadFront.position.z = treadMiddleLength / 2;
    rightTreadFront.castShadow = true;
    rightTreadGroup.add(rightTreadFront);
    tankGroup.userData.rightTreadTextures.push(rightTreadFrontTex);

    const rightTreadRearTex = treadTexture.clone();
    rightTreadRearTex.wrapS = THREE.RepeatWrapping;
    rightTreadRearTex.wrapT = THREE.RepeatWrapping;
    const rightTreadRearMat = new THREE.MeshLambertMaterial({ map: rightTreadRearTex });
    const rightTreadRear = new THREE.Mesh(treadCapGeomRear, capGroups === 2 ? [rightTreadRearMat, treadCapMat] : [rightTreadRearMat, treadCapMat, treadCapMat]);
    rightTreadRear.rotation.x = Math.PI / 2;
    rightTreadRear.rotation.z = Math.PI / 2;
    rightTreadRear.position.z = -treadMiddleLength / 2;
    rightTreadRear.castShadow = true;
    rightTreadGroup.add(rightTreadRear);
    tankGroup.userData.rightTreadTextures.push(rightTreadRearTex);

    tankGroup.add(rightTreadGroup);

    const turretGeometry = this._tankGeoCache?.turret ?? new THREE.CylinderGeometry(1, 1, 0.8, 32);
    const turretTexture = bodyTexture.clone();
    turretTexture.wrapS = THREE.RepeatWrapping;
    turretTexture.wrapT = THREE.RepeatWrapping;
    turretTexture.repeat.set(6.28 / 4, 0.8 / 4);
    turretTexture.needsUpdate = true;
    const turretMaterial = new THREE.MeshLambertMaterial({ map: turretTexture });
    const turret = new THREE.Mesh(turretGeometry, turretMaterial);
    turret.position.y = 1.7;
    turret.castShadow = true;
    tankGroup.add(turret);
    tankGroup.userData.turret = turret;

    const barrelGeometry = this._tankGeoCache?.barrel ?? new THREE.CylinderGeometry(0.2, 0.2, 3, 8);
    const barrelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1.7, -1.5);
    barrel.castShadow = true;
    tankGroup.add(barrel);
    tankGroup.userData.barrel = barrel;
    this._setTankMuzzleData(tankGroup, barrel);

    tankGroup.userData.leftWheels = [];
    tankGroup.userData.rightWheels = [];
    tankGroup.userData.leftWheelTextures = [];
    tankGroup.userData.rightWheelTextures = [];
    tankGroup.userData.wheelRadius = 0.495;

    tankGroup.userData.treadGroups = [leftTreadGroup, rightTreadGroup];
    tankGroup.userData.explodableParts = [
      body,
      turret,
      barrel,
      leftTreadGroup,
      rightTreadGroup,
    ];

    return tankGroup;
  }

  createGhostMesh(tank) {
    // Create a semi-transparent ghost version of a tank for showing server-confirmed position
    const ghostTank = tank.clone(true); // Deep clone the tank

    // Scale slightly larger to wrap around the tank (1.05x = 5% larger)
    ghostTank.scale.set(1.05, 1.05, 1.05);

    ghostTank.traverse((child) => {
      if (child.isMesh && child.material) {
        // Clone materials to avoid shared references
        if (Array.isArray(child.material)) {
          child.material = child.material.map(mat => {
            const cloned = mat.clone();
            cloned.transparent = true;
            cloned.opacity = 0.25;
            cloned.color.setHex(0xffffff);
            cloned.emissive.setHex(0x404040);
            cloned.emissiveIntensity = 0.2;
            return cloned;
          });
        } else {
          child.material = child.material.clone();
          child.material.transparent = true;
          child.material.opacity = 0.25;
          child.material.color.setHex(0xffffff);
          child.material.emissive.setHex(0x404040);
          child.material.emissiveIntensity = 0.2;
        }
      } else if (child.isSprite && child.material) {
        // Make sprite label (name) transparent to match ghost opacity
        child.material = child.material.clone();
        child.material.opacity = 0.25;
        child.material.transparent = true;
      }
    });
    return ghostTank;
  }

  updateSpriteLabel(sprite, name, color = '#4CAF50') {
    if (!sprite) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = 'bold 36px Arial';
    // Convert numeric color to hex string if needed
    let cssColor = color;
    if (typeof color === 'number') {
      cssColor = '#' + color.toString(16).padStart(6, '0');
    }
    context.fillStyle = cssColor;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
  }

  _getSharedImage(path) {
    if (!this._imageCache) {
      this._imageCache = new Map();
    }

    let entry = this._imageCache.get(path);
    if (!entry) {
      const image = document.createElement('img');
      entry = {
        image,
        loaded: false,
        listeners: [],
        error: null,
      };
      image.onload = () => {
        entry.loaded = true;
        const listeners = entry.listeners.splice(0);
        listeners.forEach((listener) => {
          try {
            listener(image);
          } catch (error) {
            console.error('Failed to update texture from image:', error);
          }
        });
      };
      image.onerror = () => {
        entry.error = new Error(`Failed to load image: ${path}`);
        const listeners = entry.listeners.splice(0);
        listeners.forEach((listener) => {
          try {
            listener(null, entry.error);
          } catch (error) {
            console.error('Failed to propagate image load error:', error);
          }
        });
      };
      image.src = path;
      this._imageCache.set(path, entry);
    }

    return entry;
  }

  _createCanvasBackedImageTexture(width, height, drawWhenReady) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    const redraw = () => {
      const ctx = canvas.getContext('2d');
      drawWhenReady(ctx, canvas, texture);
      texture.needsUpdate = true;
    };

    redraw();
    return { canvas, texture, redraw };
  }

  preloadImage(path) {
    const entry = this._getSharedImage(path);
    if (entry.loaded) {
      return Promise.resolve(entry.image);
    }
    if (entry.error) {
      return Promise.reject(entry.error);
    }
    if (!entry.promise) {
      entry.promise = new Promise((resolve, reject) => {
        entry.listeners.push((image, error) => {
          if (error) reject(error);
          else resolve(image);
        });
      });
    }
    return entry.promise;
  }

  _paintTintedBZFlagTankTexture(ctx, canvas, image, baseColor) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!image) {
      ctx.fillStyle = '#777777';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const tint = new THREE.Color(baseColor);
    const tintR = tint.r * 255;
    const tintG = tint.g * 255;
    const tintB = tint.b * 255;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;

      const luminance = (
        (0.2126 * data[i]) +
        (0.7152 * data[i + 1]) +
        (0.0722 * data[i + 2])
      ) / 255;
      const shaded = 0.28 + (luminance * 0.92);
      data[i] = Math.max(0, Math.min(255, tintR * shaded));
      data[i + 1] = Math.max(0, Math.min(255, tintG * shaded));
      data[i + 2] = Math.max(0, Math.min(255, tintB * shaded));
    }

    ctx.putImageData(imageData, 0, 0);
  }

  _createTankTexture(baseColor) {
    const source = this._getSharedImage('/textures/green_tank.png');
    const { texture, redraw } = this._createCanvasBackedImageTexture(128, 128, (ctx, canvas) => {
      this._paintTintedBZFlagTankTexture(
        ctx,
        canvas,
        source.loaded ? source.image : null,
        baseColor,
      );
    });

    if (!source.loaded) {
      source.listeners.push(redraw);
    }

    return texture;
  }

  _paintTintedBZFlagBoltTexture(ctx, canvas, image, baseColor) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!image) {
      ctx.fillStyle = '#ffff66';
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width * 0.16, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const tint = new THREE.Color(baseColor);
    const tintR = tint.r * 255;
    const tintG = tint.g * 255;
    const tintB = tint.b * 255;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;

      const luminance = (
        (0.2126 * data[i]) +
        (0.7152 * data[i + 1]) +
        (0.0722 * data[i + 2])
      ) / 255;
      const shaded = 0.35 + (luminance * 0.95);
      data[i] = Math.max(0, Math.min(255, tintR * shaded));
      data[i + 1] = Math.max(0, Math.min(255, tintG * shaded));
      data[i + 2] = Math.max(0, Math.min(255, tintB * shaded));
    }

    ctx.putImageData(imageData, 0, 0);
  }

  _createBoltTexture(baseColor) {
    const source = this._getSharedImage('/textures/green_bolt.png');
    const { texture, redraw } = this._createCanvasBackedImageTexture(64, 64, (ctx, canvas) => {
      this._paintTintedBZFlagBoltTexture(
        ctx,
        canvas,
        source.loaded ? source.image : null,
        baseColor,
      );
    });
    texture.colorSpace = THREE.SRGBColorSpace;

    if (!source.loaded) {
      source.listeners.push(redraw);
    }

    return texture;
  }

  _paintTintedBZFlagTailTexture(ctx, canvas, image, baseColor) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!image) {
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
      gradient.addColorStop(1, '#ffff66');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, canvas.height * 0.3, canvas.width, canvas.height * 0.4);
      return;
    }

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const tint = new THREE.Color(baseColor);
    const tintR = tint.r * 255;
    const tintG = tint.g * 255;
    const tintB = tint.b * 255;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;

      const luminance = (
        (0.2126 * data[i]) +
        (0.7152 * data[i + 1]) +
        (0.0722 * data[i + 2])
      ) / 255;
      const shaded = 0.3 + (luminance * 0.95);
      data[i] = Math.max(0, Math.min(255, tintR * shaded));
      data[i + 1] = Math.max(0, Math.min(255, tintG * shaded));
      data[i + 2] = Math.max(0, Math.min(255, tintB * shaded));
      data[i + 3] = Math.max(0, Math.min(255, alpha * 0.9));
    }

    ctx.putImageData(imageData, 0, 0);
  }

  _createShotTailTexture(baseColor) {
    const source = this._getSharedImage('/textures/shot_tail.png');
    const { texture, redraw } = this._createCanvasBackedImageTexture(128, 32, (ctx, canvas) => {
      this._paintTintedBZFlagTailTexture(
        ctx,
        canvas,
        source.loaded ? source.image : null,
        baseColor,
      );
    });
    texture.colorSpace = THREE.SRGBColorSpace;

    if (!source.loaded) {
      source.listeners.push(redraw);
    }

    return texture;
  }

  _createTreadTexture() {
    const source = this._getSharedImage('/textures/treads.png');
    const { texture, redraw } = this._createCanvasBackedImageTexture(128, 128, (ctx, canvas) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (source.loaded) {
        ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = '#2b2b2b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    });

    if (!source.loaded) {
      source.listeners.push(redraw);
    }

    return texture;
  }

  _createTreadCapTexture(baseColor = 0x646464) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const color = new THREE.Color(baseColor);
    const darkened = color.clone().multiplyScalar(0.5);
    const r = Math.round(darkened.r * 255);
    const g = Math.round(darkened.g * 255);
    const b = Math.round(darkened.b * 255);

    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, 128, 128);

    const numBlobs = 25;
    for (let i = 0; i < numBlobs; i += 1) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const radius = Math.random() * 20 + 10;
      const variation = (Math.random() - 0.5) * 0.4;
      const newR = Math.max(0, Math.min(255, r + r * variation));
      const newG = Math.max(0, Math.min(255, g + g * variation));
      const newB = Math.max(0, Math.min(255, b + b * variation));
      ctx.fillStyle = `rgba(${Math.floor(newR)}, ${Math.floor(newG)}, ${Math.floor(newB)}, 0.6)`;
      ctx.beginPath();
      const points = 8;
      for (let j = 0; j <= points; j += 1) {
        const angle = (j / points) * Math.PI * 2;
        const radiusVariation = radius * (0.7 + Math.random() * 0.6);
        const px = x + Math.cos(angle) * radiusVariation;
        const py = y + Math.sin(angle) * radiusVariation;
        if (j === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.fill();
    }

    for (let i = 0; i < 15; i += 1) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const radius = Math.random() * 8 + 4;
      ctx.fillStyle = `rgba(0, 0, 0, ${0.1 + Math.random() * 0.2})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  _createWheelTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#303030';
    ctx.fillRect(0, 0, 128, 32);

    ctx.fillStyle = '#202020';
    for (let x = 0; x < 128; x += 16) {
      ctx.fillRect(x, 0, 10, 32);
    }

    ctx.fillStyle = 'rgba(120, 120, 120, 0.55)';
    for (let x = 0; x < 128; x += 32) {
      ctx.fillRect(x + 2, 5, 3, 22);
    }

    ctx.strokeStyle = 'rgba(10, 10, 10, 0.6)';
    ctx.lineWidth = 1;
    for (let x = 8; x < 128; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 32);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.needsUpdate = true;
    return texture;
  }

  _createWheelTreadTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const outerRadius = 58;
    const innerRadius = 18;
    const segmentCount = 24;

    ctx.fillStyle = '#181818';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#333333';
    ctx.fill();

    for (let i = 0; i < segmentCount; i += 1) {
      const start = (i / segmentCount) * Math.PI * 2;
      const end = start + ((Math.PI * 2) / segmentCount) * 0.62;
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, start, end);
      ctx.arc(cx, cy, innerRadius, end, start, true);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? '#222222' : '#2a2a2a';
      ctx.fill();
    }

    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    for (let i = 0; i < segmentCount; i += 1) {
      const angle = (i / segmentCount) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * innerRadius, cy + Math.sin(angle) * innerRadius);
      ctx.lineTo(cx + Math.cos(angle) * outerRadius, cy + Math.sin(angle) * outerRadius);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius - 4, 0, Math.PI * 2);
    ctx.fillStyle = '#202020';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.center.set(0.5, 0.5);
    texture.needsUpdate = true;
    return texture;
  }

  createShield({ x, y, z }) {
    if (!this.scene) return null;
    const shieldGeometry = new THREE.SphereGeometry(3, 16, 16);
    const shieldMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.3,
      wireframe: true,
    });
    const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
    shield.position.set(x, y + 2, z);
    shield.userData.rotation = 0;
    this.worldGroup.add(shield);
    return shield;
  }

  removeShield(shield) {
    if (!shield || !this.scene) return;
    this.worldGroup.remove(shield);
    if (shield.geometry) shield.geometry.dispose();
    if (shield.material) shield.material.dispose();
  }

  playShootSound(position) {
    if (!this.shootBuffer) return;
    const sound = new THREE.PositionalAudio(this.audioListener);
    sound.setBuffer(this.shootBuffer);
    sound.setRefDistance(10);
    sound.setVolume(0.5);
    if (position) sound.position.copy(position);
    this.worldGroup.add(sound);
    sound.play();
    // Remove from scene after playback
    sound.source.onended = () => { this.worldGroup.remove(sound); };
  }

  playExplosionSound(position) {
    if (!this.explosionBuffer) return;
    const sound = new THREE.PositionalAudio(this.audioListener);
    sound.setBuffer(this.explosionBuffer);
    sound.setRefDistance(15);
    sound.setVolume(0.7);
    if (position) sound.position.copy(position);
    this.worldGroup.add(sound);
    sound.play();
    sound.source.onended = () => { this.worldGroup.remove(sound); };
  }

  playLocalJumpSound(position) {
    if (!this.jumpBuffer) return;
    const sound = new THREE.PositionalAudio(this.audioListener);
    sound.setBuffer(this.jumpBuffer);
    sound.setRefDistance(8);
    sound.setVolume(0.4);
    if (position) sound.position.copy(position);
    this.worldGroup.add(sound);
    sound.play();
    sound.source.onended = () => { this.worldGroup.remove(sound); };
  }

  playLandSound(position) {
    if (!this.landBuffer) return;
    const sound = new THREE.PositionalAudio(this.audioListener);
    sound.setBuffer(this.landBuffer);
    sound.setRefDistance(8);
    sound.setVolume(0.9);
    if (position) sound.position.copy(position);
    this.worldGroup.add(sound);
    sound.play();
    sound.source.onended = () => { this.worldGroup.remove(sound); };
  }

  playLocalLandSound(intensity = 1) {
    if (!this.landBuffer) return;
    const sound = new THREE.Audio(this.audioListener);
    sound.setBuffer(this.landBuffer);
    sound.setVolume(Math.max(0.45, Math.min(1.25, 0.55 + (intensity || 1) * 0.35)));
    this.camera.add(sound);
    sound.play();
    sound.source.onended = () => {
      this.camera.remove(sound);
      sound.disconnect();
    };
  }

  createLandingEffect(position, intensity = 1, { local = false } = {}) {
    if (!this.scene || !position) return;
    const clampedIntensity = Math.max(0.4, Math.min(1.6, intensity || 1));
    if (local) this.playLocalLandSound(clampedIntensity);
    else this.playLandSound(position);

    const ringGeometry = new THREE.RingGeometry(0.5, 0.9, 48);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1.0,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(position.x, position.y + 0.03, position.z);

    const startRadius = 2.5;
    ring.scale.set(startRadius, startRadius, 1);

    this.worldGroup.add(ring);
    this.activeLandingEffects.push({
      ring,
      geometry: ringGeometry,
      material: ringMaterial,
      intensity: clampedIntensity,
      startRadius,
      expansionRate: 3.5,
      lifetime: 0,
      maxLifetime: 1.0
    });
  }

  createSpawnEffect(position, color = 0x4caf50) {
    if (!this.scene || !position) return;

    const tint = new THREE.Color(typeof color === 'number' ? color : 0x4caf50)
      .lerp(new THREE.Color(0xffffff), 0.35);

    const ringGeometry = new THREE.RingGeometry(0.7, 1.1, 48);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: tint,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(position.x, position.y + 0.05, position.z);
    ring.scale.set(0.7, 0.7, 1);

    const columnGeometry = new THREE.CylinderGeometry(0.28, 0.55, 3.0, 18, 1, true);
    const columnMaterial = new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const column = new THREE.Mesh(columnGeometry, columnMaterial);
    column.position.set(position.x, position.y + 1.5, position.z);
    column.scale.set(0.4, 0.3, 0.4);

    const topRingGeometry = new THREE.RingGeometry(0.45, 0.78, 40);
    const topRingMaterial = new THREE.MeshBasicMaterial({
      color: tint,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const topRing = new THREE.Mesh(topRingGeometry, topRingMaterial);
    topRing.rotation.x = Math.PI / 2;
    topRing.position.set(position.x, position.y + 1.35, position.z);
    topRing.scale.set(0.65, 0.65, 1);

    this.worldGroup.add(ring);
    this.worldGroup.add(column);
    this.worldGroup.add(topRing);

    this.activeSpawnEffects.push({
      ring,
      ringGeometry,
      ringMaterial,
      column,
      columnGeometry,
      columnMaterial,
      topRing,
      topRingGeometry,
      topRingMaterial,
      lifetime: 0,
      maxLifetime: 0.75,
    });
  }

  createProjectile(data) {
    if (!this.scene) return null;
    const projectileColor = typeof data.color === 'number' ? data.color : 0xffff00;
    const projectileTexture = this._createBoltTexture(projectileColor);
    const headMaterial = new THREE.SpriteMaterial({
      map: projectileTexture,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    const projectile = new THREE.Group();
    projectile.position.set(data.x, data.y, data.z);

    const head = new THREE.Sprite(headMaterial);
    head.scale.set(1.35, 1.35, 1);

    const dir = new THREE.Vector3(data.dirX || 0, 0, data.dirZ || -1);
    if (dir.lengthSq() < 0.0001) {
      dir.set(0, 0, -1);
    } else {
      dir.normalize();
    }
    const tailSegmentCount = 6;
    const tailTexture = this._createShotTailTexture(projectileColor);
    const tailSegments = [];
    let uvCell = Math.floor(Math.random() * 16);
    for (let i = 0; i < tailSegmentCount; i += 1) {
      uvCell = (uvCell + 1) % 16;
      const u = (uvCell % 4) * 0.25;
      const v = Math.floor(uvCell / 4) * 0.25;
      const segmentTexture = tailTexture.clone();
      segmentTexture.repeat.set(0.25, 0.25);
      segmentTexture.offset.set(u, v);
      segmentTexture.needsUpdate = true;

      const segmentMaterial = new THREE.SpriteMaterial({
        map: segmentTexture,
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        opacity: 0.74 - (i * 0.1),
        blending: THREE.AdditiveBlending,
      });
      const segment = new THREE.Sprite(segmentMaterial);
      const scale = 0.78 - (i * 0.08);
      segment.scale.set(scale, scale, 1);
      const distance = 0.34 + (i * 0.28);
      segment.position.set(-dir.x * distance, 0, -dir.z * distance);
      projectile.add(segment);
      tailSegments.push(segment);
    }
    projectile.add(head);
    projectile.userData = {
      dirX: data.dirX,
      dirZ: data.dirZ,
      color: projectileColor,
      projectileTexture,
      head,
      tailSegments,
    };
    // Only add a point light if dynamic lighting is enabled
    if (this.dynamicLightingEnabled) {
      const shotLight = new THREE.PointLight(projectileColor, 1.5, 12, 2);
      shotLight.position.copy(projectile.position);
      this.worldGroup.add(shotLight);
      projectile.userData.shotLight = shotLight;
      // Track for update/removal
      if (!this.projectileLights) this.projectileLights = new Map();
      this.projectileLights.set(projectile, shotLight);
    }
    this.worldGroup.add(projectile);
    this.playShootSound(projectile.position);
    return projectile;
  }

  removeProjectile(projectile) {
    if (!projectile || !this.scene) return;
    // Play pop sound at projectile's last position
    if (this.audioListener && this.projectilePopBuffer && projectile.position) {
      const popSound = new THREE.PositionalAudio(this.audioListener);
      popSound.setBuffer(this.projectilePopBuffer);
      popSound.setRefDistance(8);
      popSound.setVolume(0.7);
      popSound.position.copy(projectile.position);
      this.worldGroup.add(popSound);
      popSound.play();
      // Remove sound from scene after it finishes
      popSound.source.onended = () => {
        this.worldGroup.remove(popSound);
        popSound.disconnect();
      };
    }
    // Remove point light from scene if present
    if (this.projectileLights && this.projectileLights.has(projectile)) {
      const light = this.projectileLights.get(projectile);
      this.worldGroup.remove(light);
      this.projectileLights.delete(projectile);
    }
    this.worldGroup.remove(projectile);
    if (projectile.userData?.head?.material?.map) projectile.userData.head.material.map.dispose();
    if (projectile.userData?.head?.material) projectile.userData.head.material.dispose();
    if (Array.isArray(projectile.userData?.tailSegments)) {
      for (const segment of projectile.userData.tailSegments) {
        if (segment?.material?.map) segment.material.map.dispose();
        if (segment?.material) segment.material.dispose();
      }
    }
  }

  createExplosion(position, tank) {
    if (!this.scene || !position) return;
    this.playExplosionSound(position);

    // Dynamic lighting flash
    let explosionLight = null;
    let lightIntensity = 0;
    if (this.dynamicLightingEnabled && typeof THREE !== 'undefined') {
      explosionLight = new THREE.PointLight(0xffe066, 3, 40, 2.5);
      explosionLight.position.copy(position);
      lightIntensity = 500.0;
      explosionLight.intensity = lightIntensity;
      this.worldGroup.add(explosionLight);
    }

    const geometry = new THREE.SphereGeometry(2, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: true, opacity: 0.8 });
    const explosion = new THREE.Mesh(geometry, material);
    explosion.position.copy(position);
    this.worldGroup.add(explosion);

    const shockwaveGeometry = new THREE.TorusGeometry(1.6, 0.12, 8, 48);
    const shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.8,
      depthWrite: false
    });
    const shockwave = new THREE.Mesh(shockwaveGeometry, shockwaveMaterial);
    shockwave.rotation.x = Math.PI / 2;
    shockwave.position.set(position.x, Math.max(0.08, position.y + 0.08), position.z);
    this.worldGroup.add(shockwave);

    const debrisPieces = [];
    let followTarget = null;
    if (tank && tank.userData) {
      const tankWorldPos = tank.position.clone();
      const explodableParts = Array.isArray(tank.userData.explodableParts)
        ? tank.userData.explodableParts
        : [];

      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      const worldMatrix = new THREE.Matrix4();
      const localMatrix = new THREE.Matrix4();
      const parentInverseMatrix = new THREE.Matrix4();
      const localPos = new THREE.Vector3();
      const localQuat = new THREE.Quaternion();
      const localScale = new THREE.Vector3();

      this.worldGroup.updateWorldMatrix(true, false);
      parentInverseMatrix.copy(this.worldGroup.matrixWorld).invert();

      explodableParts.forEach((sourcePart) => {
        if (!sourcePart) return;

        const part = sourcePart.clone(true);
        part.traverse((node) => {
          if (node.isMesh && node.material) {
            node.material = Array.isArray(node.material)
              ? node.material.map((material) => material.clone())
              : node.material.clone();
          }
        });

        sourcePart.updateWorldMatrix(true, false);
        sourcePart.getWorldPosition(worldPos);
        sourcePart.getWorldQuaternion(worldQuat);
        sourcePart.getWorldScale(worldScale);

        worldMatrix.compose(worldPos, worldQuat, worldScale);
        localMatrix.multiplyMatrices(parentInverseMatrix, worldMatrix);
        localMatrix.decompose(localPos, localQuat, localScale);

        part.position.copy(localPos);
        part.quaternion.copy(localQuat);
        part.scale.copy(localScale);

        let speedMultiplier = 0.9;
        if (sourcePart === tank.userData.body) speedMultiplier = 0.95;
        else if (sourcePart === tank.userData.turret) speedMultiplier = 0.8;
        else if (sourcePart === tank.userData.barrel) speedMultiplier = 0.6;

        const debrisPiece = this._launchTankPart(part, tankWorldPos, debrisPieces, speedMultiplier, {
          isFollowTarget: sourcePart === tank.userData.body,
          maxLifetime: sourcePart === tank.userData.body ? 5.0 : 3.2
        });
        if (sourcePart === tank.userData.body && debrisPiece) {
          followTarget = debrisPiece.mesh;
        }
      });
    }

    const debrisCount = 15;
    for (let i = 0; i < debrisCount; i += 1) {
      const size = Math.random() * 0.5 + 0.3;
      const debrisGeom = new THREE.BoxGeometry(size, size, size);
      const debrisMat = new THREE.MeshLambertMaterial({
        color: i % 3 === 0 ? 0x4caf50 : (i % 3 === 1 ? 0x666666 : 0xff5722),
      });
      const debris = new THREE.Mesh(debrisGeom, debrisMat);
      debris.position.copy(position);

      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.3) * Math.PI / 3;
      const speed = Math.random() * 15 + 10;
      debris.velocity = new THREE.Vector3(
        Math.cos(angle) * Math.cos(elevation) * speed,
        Math.sin(elevation) * speed + 5,
        Math.sin(angle) * Math.cos(elevation) * speed,
      );
      debris.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      );
      debris.rotationVelocity = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      );
      debris.userData.isTankPart = false;
      this.worldGroup.add(debris);
      debrisPieces.push({ mesh: debris, lifetime: 0, maxLifetime: 2.5 });
    }

    this.activeExplosions.push({
      light: explosionLight,
      lightIntensity,
      sphere: explosion,
      sphereGeometry: geometry,
      sphereMaterial: material,
      shockwave,
      shockwaveGeometry,
      shockwaveMaterial,
      debrisPieces,
    });
    return { followTarget };
  }

  updateExplosions(deltaTime) {
    const dt = Math.max(0.001, Math.min(0.05, deltaTime || 0.016));

    for (let index = this.activeSpawnEffects.length - 1; index >= 0; index -= 1) {
      const effect = this.activeSpawnEffects[index];
      effect.lifetime += dt;
      const progress = Math.min(1, effect.lifetime / effect.maxLifetime);

      const ringScale = 0.7 + progress * 3.3;
      effect.ring.scale.set(ringScale, ringScale, 1);
      effect.ringMaterial.opacity = Math.max(0, 0.95 * (1 - progress));

      const columnPulse = 0.28 + (1 - progress) * 0.72;
      effect.column.scale.set(0.4 * columnPulse, 0.3 + (1 - progress) * 1.25, 0.4 * columnPulse);
      effect.columnMaterial.opacity = Math.max(0, 0.34 * (1 - progress));

      const topRingScale = 0.65 + progress * 1.45;
      effect.topRing.scale.set(topRingScale, topRingScale, 1);
      effect.topRing.position.y += dt * 1.8;
      effect.topRingMaterial.opacity = Math.max(0, 0.55 * (1 - progress));

      if (progress >= 1) {
        this.worldGroup.remove(effect.ring);
        this.worldGroup.remove(effect.column);
        this.worldGroup.remove(effect.topRing);
        effect.ringGeometry.dispose();
        effect.ringMaterial.dispose();
        effect.columnGeometry.dispose();
        effect.columnMaterial.dispose();
        effect.topRingGeometry.dispose();
        effect.topRingMaterial.dispose();
        this.activeSpawnEffects.splice(index, 1);
      }
    }

    for (let index = this.activeLandingEffects.length - 1; index >= 0; index -= 1) {
      const effect = this.activeLandingEffects[index];
      effect.lifetime += dt;
      const progress = Math.min(1, effect.lifetime / effect.maxLifetime);
      const radius = effect.startRadius + (effect.expansionRate * effect.lifetime);
      effect.ring.scale.x = radius;
      effect.ring.scale.y = radius;
      effect.material.opacity = Math.max(0, 1.0 - progress);
      if (progress >= 1) {
        this.worldGroup.remove(effect.ring);
        effect.geometry.dispose();
        effect.material.dispose();
        this.activeLandingEffects.splice(index, 1);
      }
    }

    if (!this.activeExplosions.length) return;

    for (let index = this.activeExplosions.length - 1; index >= 0; index -= 1) {
      const explosion = this.activeExplosions[index];

      if (explosion.sphere && explosion.sphereMaterial) {
        explosion.sphereMaterial.opacity -= 1.5 * dt;
        explosion.sphere.scale.addScalar(3.8 * dt);
        if (explosion.sphereMaterial.opacity <= 0) {
          this.worldGroup.remove(explosion.sphere);
          explosion.sphereGeometry.dispose();
          explosion.sphereMaterial.dispose();
          explosion.sphere = null;
          explosion.sphereGeometry = null;
          explosion.sphereMaterial = null;
        }
      }

      if (explosion.shockwave && explosion.shockwaveMaterial) {
        explosion.shockwaveMaterial.opacity -= 0.65 * dt;
        explosion.shockwave.scale.x += 5.5 * dt;
        explosion.shockwave.scale.y += 5.5 * dt;
        if (explosion.shockwaveMaterial.opacity <= 0) {
          this.worldGroup.remove(explosion.shockwave);
          explosion.shockwaveGeometry.dispose();
          explosion.shockwaveMaterial.dispose();
          explosion.shockwave = null;
          explosion.shockwaveGeometry = null;
          explosion.shockwaveMaterial = null;
        }
      }

      if (explosion.light) {
        const fade = Math.pow(0.92, dt / 0.016);
        explosion.lightIntensity *= fade;
        explosion.light.intensity = explosion.lightIntensity;
        if (explosion.lightIntensity <= 0.05) {
          this.worldGroup.remove(explosion.light);
          explosion.light.dispose && explosion.light.dispose();
          explosion.light = null;
        }
      }

      for (let pieceIndex = explosion.debrisPieces.length - 1; pieceIndex >= 0; pieceIndex -= 1) {
        const piece = explosion.debrisPieces[pieceIndex];
        if (piece.lifetime < piece.maxLifetime) {
          piece.lifetime += dt;
          const isPrimaryHull = Boolean(piece.mesh.userData?.isPrimaryHull);
          const gravity = isPrimaryHull ? 9 : 12;
          piece.mesh.velocity.y -= gravity * dt;
          piece.mesh.position.x += piece.mesh.velocity.x * dt;
          piece.mesh.position.y += piece.mesh.velocity.y * dt;
          piece.mesh.position.z += piece.mesh.velocity.z * dt;
          piece.mesh.rotation.x += piece.mesh.rotationVelocity.x * dt;
          piece.mesh.rotation.y += piece.mesh.rotationVelocity.y * dt;
          piece.mesh.rotation.z += piece.mesh.rotationVelocity.z * dt;

          const fadeStart = piece.maxLifetime * 0.7;
          if (piece.lifetime > fadeStart) {
            const fadeProgress = (piece.lifetime - fadeStart) / (piece.maxLifetime - fadeStart);
            this._fadeMaterial(piece.mesh.material, fadeProgress);
            piece.mesh.traverse((child) => {
              if (child.material) this._fadeMaterial(child.material, fadeProgress);
            });
          }

          if (piece.mesh.position.y < 0) {
            if (isPrimaryHull) {
              piece.mesh.position.y = 0;
              const bounceCount = piece.mesh.userData.groundBounces || 0;
              const verticalImpact = Math.abs(piece.mesh.velocity.y);
              if (bounceCount < 2 && verticalImpact > 1.2) {
                piece.mesh.userData.groundBounces = bounceCount + 1;
                piece.mesh.userData.grounded = false;
                piece.mesh.velocity.y = verticalImpact * (bounceCount === 0 ? 0.38 : 0.24);
                piece.mesh.velocity.x *= 0.82;
                piece.mesh.velocity.z *= 0.82;
                piece.mesh.rotationVelocity.multiplyScalar(0.72);
              } else {
                piece.mesh.userData.grounded = true;
                piece.mesh.velocity.y = 0;
                const skidDamping = Math.pow(0.22, dt / 0.016);
                piece.mesh.velocity.x *= skidDamping;
                piece.mesh.velocity.z *= skidDamping;
                piece.mesh.rotationVelocity.multiplyScalar(Math.pow(0.18, dt / 0.016));
                if ((piece.mesh.velocity.x * piece.mesh.velocity.x) + (piece.mesh.velocity.z * piece.mesh.velocity.z) < 0.04) {
                  piece.mesh.velocity.x = 0;
                  piece.mesh.velocity.z = 0;
                  piece.mesh.rotationVelocity.set(0, 0, 0);
                }
              }
            } else {
              piece.lifetime = piece.maxLifetime;
            }
          }

          continue;
        }

        this._cleanupDebrisPiece(piece.mesh);
        explosion.debrisPieces.splice(pieceIndex, 1);
      }

      const done = !explosion.sphere && !explosion.light && !explosion.shockwave && explosion.debrisPieces.length === 0;
      if (done) {
        this.activeExplosions.splice(index, 1);
      }
    }
  }

  _fadeMaterial(material, fadeProgress) {
    if (!material) return;
    if (Array.isArray(material)) {
      material.forEach((mat) => {
        if (mat) {
          mat.opacity = 1 - fadeProgress;
          mat.transparent = true;
        }
      });
    } else {
      material.opacity = 1 - fadeProgress;
      material.transparent = true;
    }
  }

  _launchTankPart(part, centerPos, debrisPieces, speedMultiplier = 1.0, options = {}) {
    this.worldGroup.add(part);
    part.userData.isTankPart = true;
    part.userData.isPrimaryHull = Boolean(options.isFollowTarget);
    part.userData.groundBounces = 0;
    part.userData.grounded = false;
    const angle = Math.random() * Math.PI * 2;
    const elevation = (Math.random() - 0.15) * Math.PI / 4;
    const speed = (Math.random() * 6 + 6) * speedMultiplier;
    part.velocity = new THREE.Vector3(
      Math.cos(angle) * Math.cos(elevation) * speed,
      Math.sin(elevation) * speed + (options.isFollowTarget ? 7 : 5.5),
      Math.sin(angle) * Math.cos(elevation) * speed,
    );
    part.rotationVelocity = new THREE.Vector3(
      (Math.random() - 0.5) * (options.isFollowTarget ? 2.5 : 4.5),
      (Math.random() - 0.5) * (options.isFollowTarget ? 2.5 : 4.5),
      (Math.random() - 0.5) * (options.isFollowTarget ? 2.5 : 4.5),
    );
    const debrisPiece = {
      mesh: part,
      lifetime: 0,
      maxLifetime: options.maxLifetime || (options.isFollowTarget ? 3.5 : 2.0)
    };
    debrisPieces.push(debrisPiece);
    return debrisPiece;
  }

  _cleanupDebrisPiece(mesh) {
    if (mesh === this.deathFollowTarget) {
      this.deathFollowTarget = null;
    }
    this.worldGroup.remove(mesh);
    if (mesh.userData && !mesh.userData.isTankPart) {
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    }
    if (mesh.children) {
      mesh.children.forEach((child) => {
        mesh.remove(child);
      });
    }
  }

  updateTreads(tanks, deltaTime, gameConfig) {
    tanks.forEach((tank) => {
      if (!tank.userData.leftTreadOffset) {
        tank.userData.leftTreadOffset = 0;
        tank.userData.rightTreadOffset = 0;
      }
      const forwardSpeed = tank.userData.forwardSpeed || 0;
      const rotationSpeed = tank.userData.rotationSpeed || 0;
      const treadWidth = 3.5;
      const tankSpeed = gameConfig ? gameConfig.TANK_SPEED : 5;
      const tankRotSpeed = gameConfig ? gameConfig.TANK_ROTATION_SPEED : 2;
      const forwardDistance = forwardSpeed * tankSpeed * deltaTime;
      const rotationDistance = rotationSpeed * tankRotSpeed * deltaTime * treadWidth / 2;
      const leftDistance = forwardDistance - rotationDistance;
      const rightDistance = forwardDistance + rotationDistance;
      const treadSpeed = 0.5;
      tank.userData.leftTreadOffset -= leftDistance * treadSpeed;
      tank.userData.rightTreadOffset -= rightDistance * treadSpeed;

      const wheelRadius = tank.userData.wheelRadius || 0.42;
      if (wheelRadius > 0) {
        const leftWheelAngleDelta = leftDistance / wheelRadius;
        const rightWheelAngleDelta = -rightDistance / wheelRadius;
        const wheelSideOffsetScale = 1 / (Math.PI * 2 * wheelRadius);
        if (tank.userData.leftWheelTextures) {
          tank.userData.leftWheelTextures.forEach((texture) => {
            texture.rotation += leftWheelAngleDelta;
          });
        }
        if (tank.userData.leftWheelSideTextures) {
          tank.userData.leftWheelSideTextures.forEach((texture) => {
            texture.offset.x -= leftDistance * wheelSideOffsetScale;
          });
        }
        if (tank.userData.rightWheelTextures) {
          tank.userData.rightWheelTextures.forEach((texture) => {
            texture.rotation += rightWheelAngleDelta;
          });
        }
        if (tank.userData.rightWheelSideTextures) {
          tank.userData.rightWheelSideTextures.forEach((texture) => {
            texture.offset.x -= rightDistance * wheelSideOffsetScale;
          });
        }
      }

      if (tank.userData.leftTreadTextures) {
        tank.userData.leftTreadTextures.forEach((texture) => {
          if (texture && texture.offset) {
            texture.offset.x = tank.userData.leftTreadOffset;
          }
        });
      }
      if (tank.userData.rightTreadTextures) {
        tank.userData.rightTreadTextures.forEach((texture) => {
          if (texture && texture.offset) {
            texture.offset.x = tank.userData.rightTreadOffset;
          }
        });
      }
    });
  }

  updateClouds(deltaTime, mapSize) {
    const mapBoundary = mapSize / 2;
    this.clouds.forEach((cloud) => {
      cloud.position.x += cloud.userData.velocity * deltaTime;
      if (cloud.position.x > mapBoundary + 30) {
        cloud.position.x = -mapBoundary - 30;
      }
    });
  }

  updateCamera({ cameraMode, myTank, playerRotation, deathFollowTarget }) {
    if (!this.camera) return;
    if (cameraMode === 'overview') {
      const target = deathFollowTarget || this.deathFollowTarget;
      const focusPoint = target && target.parent
        ? target.getWorldPosition(new THREE.Vector3())
        : this.deathFollowAnchor;
      if (target && target.parent) {
        this.deathFollowAnchor = target.getWorldPosition(new THREE.Vector3());
      }
      if (focusPoint) {
        const velocity = target && target.parent ? (target.velocity || new THREE.Vector3()) : new THREE.Vector3();
        if (xrState.enabled) {
          const followOffset = velocity.lengthSq() > 0.1
            ? velocity.clone().normalize().multiplyScalar(-18).add(new THREE.Vector3(0, 9.5, 0))
            : new THREE.Vector3(0, 9.5, 20);
          const desiredPosition = focusPoint.clone().add(followOffset);
          const lookDirection = focusPoint.clone().sub(desiredPosition);
          const desiredYaw = Math.atan2(-lookDirection.x, -lookDirection.z);
          const desiredQuaternion = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -desiredYaw
          );
          const rotatedDesiredPosition = desiredPosition.clone().applyQuaternion(desiredQuaternion);
          const desiredWorldOffset = rotatedDesiredPosition.multiplyScalar(-1);
          this.worldGroup.quaternion.slerp(desiredQuaternion, 0.035);
          this.worldGroup.position.lerp(desiredWorldOffset, 0.035);
        } else {
          this.worldGroup.position.set(0, 0, 0);
          this.worldGroup.quaternion.identity();
          const followOffset = velocity.lengthSq() > 0.1
            ? velocity.clone().normalize().multiplyScalar(-20).add(new THREE.Vector3(0, 10, 0))
            : new THREE.Vector3(0, 10, 22);
          const desiredPosition = focusPoint.clone().add(followOffset);
          if (!this.deathCameraLogged) {
            const dl = window.gameDebugLog;
            if (dl) {
              dl(`deathCam lookAt=${focusPoint.x.toFixed(1)},${focusPoint.y.toFixed(1)},${focusPoint.z.toFixed(1)} camPos=${desiredPosition.x.toFixed(1)},${desiredPosition.y.toFixed(1)},${desiredPosition.z.toFixed(1)} debrisVel=${velocity.x.toFixed(1)},${velocity.y.toFixed(1)},${velocity.z.toFixed(1)}`, 'render');
            }
            this.deathCameraLogged = true;
          }
          this.camera.position.lerp(desiredPosition, 0.045);
          this.camera.up.set(0, 1, 0);
          this.camera.lookAt(focusPoint);
        }
        return;
      }
      this.deathFollowTarget = null;
      this.deathFollowAnchor = null;
      this.deathCameraLogged = false;
      this.worldGroup.position.set(0, 0, 0);
      this.worldGroup.quaternion.identity();
      this.camera.position.set(0, 15, 20);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);
      return;
    }

    if (!myTank) return;
    if (cameraMode === 'first-person') {
      if (xrState.enabled) {
        // In XR mode, keep tank visible and position camera above it
        if (myTank.userData.body) myTank.userData.body.visible = true;
        if (myTank.userData.turret) myTank.userData.turret.visible = true;

        // Apply rotation first (around the camera/origin)
        const q = new THREE.Quaternion();
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -myTank.rotation.y);
        this.worldGroup.quaternion.copy(q);

        // Calculate where the tank ends up after rotation
        const tankRotated = myTank.position.clone();
        tankRotated.applyQuaternion(q);

        // Translate to center the rotated tank at camera origin, with ground slightly below eye height
        this.worldGroup.position.set(
          -tankRotated.x,
          -myTank.position.y - 0.6,
          -tankRotated.z
        );
      } else {
        // In non-XR first-person, keep hull visible like BZFlag; hide turret to avoid center obstruction
        if (myTank.userData.body) myTank.userData.body.visible = true;
        if (myTank.userData.turret) myTank.userData.turret.visible = false;
        // Reset world group for non-XR
        this.worldGroup.position.set(0, 0, 0);
        this.worldGroup.rotation.y = 0;
        const cameraHeight = Number.isFinite(myTank.userData.cameraHeight)
          ? myTank.userData.cameraHeight
          : DEFAULT_MUZZLE_HEIGHT;
        this.camera.position.set(
          myTank.position.x,
          myTank.position.y + cameraHeight,
          myTank.position.z,
        );
        const lookTarget = new THREE.Vector3(
          myTank.position.x - Math.sin(playerRotation) * 10,
          myTank.position.y + cameraHeight,
          myTank.position.z - Math.cos(playerRotation) * 10,
        );
        this.camera.lookAt(lookTarget);
      }
    } else {
      if (myTank.userData.body) myTank.userData.body.visible = true;
      if (myTank.userData.turret) myTank.userData.turret.visible = true;
      const cameraOffset = new THREE.Vector3(
        Math.sin(playerRotation) * 12,
        4,
        Math.cos(playerRotation) * 12,
      );
      this.camera.position.copy(myTank.position).add(cameraOffset);
      this.camera.lookAt(new THREE.Vector3(
        myTank.position.x - Math.sin(playerRotation) * 10,
        myTank.position.y + 3,
        myTank.position.z - Math.cos(playerRotation) * 10,
      ));
    }
  }

}

export const renderManager = new RenderManager();
