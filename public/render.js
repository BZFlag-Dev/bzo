/*
 * This file is part of a project licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * See the LICENSE file in the project root or visit https://www.gnu.org/licenses/agpl-3.0.html
 */
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createTextLabel } from './labelUtil.js';
import {
  createShootBuffer,
  createExplosionBuffer,
  createJumpBuffer,
  createLandBuffer,
} from './audio.js';
import {
  createPyramidTexture,
  createCobblestoneTexture,
  createGroundTexture,
  createWallTexture,
  createObstacleTexture,
} from './texture.js';

class RenderManager {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.labelRenderer = null;
    this.audioListener = null;
    this.shootSound = null;
    this.jumpSound = null;
    this.landSound = null;
    this.explosionSound = null;
    this.container = null;

    this.ground = null;
    this.gridHelper = null;
    this.obstacleMeshes = [];
    this.mountainMeshes = [];
    this.celestialMeshes = [];
    this.clouds = [];

    this.debugLabels = [];
    this.debugLabelsEnabled = true;
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
    this.scene.fog = new THREE.Fog(0x87ceeb, 50, 200);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 15, 20);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);

    this.audioListener = new THREE.AudioListener();
    this.camera.add(this.audioListener);
    const audioContext = this.audioListener.context;

    this.shootSound = new THREE.Audio(this.audioListener);
    this.shootSound.setBuffer(createShootBuffer(audioContext));
    this.shootSound.setVolume(0.5);

    this.explosionSound = new THREE.Audio(this.audioListener);
    this.explosionSound.setBuffer(createExplosionBuffer(audioContext));
    this.explosionSound.setVolume(0.7);

    this.jumpSound = new THREE.Audio(this.audioListener);
    this.jumpSound.setBuffer(createJumpBuffer(audioContext));
    this.jumpSound.setVolume(0.4);

    this.landSound = new THREE.Audio(this.audioListener);
    this.landSound.setBuffer(createLandBuffer(audioContext));
    this.landSound.setVolume(0.5);

    this._addDefaultLights();

    return {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      labelRenderer: this.labelRenderer,
    };
  }

  _addDefaultLights() {
    if (!this.scene) return;
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 50, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.left = -60;
    dirLight.shadow.camera.right = 60;
    dirLight.shadow.camera.top = 60;
    dirLight.shadow.camera.bottom = -60;
    this.scene.add(dirLight);
  }

  getScene() {
    return this.scene;
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
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
  }

  renderFrame() {
    if (!this.renderer || !this.scene || !this.camera || !this.labelRenderer) return;
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  clearGround() {
    if (this.ground && this.scene) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      this.ground.material.dispose();
      this.ground = null;
    }
    if (this.gridHelper && this.scene) {
      this.scene.remove(this.gridHelper);
      this.gridHelper = null;
    }
  }

  buildGround(mapSize) {
    if (!this.scene) return;
    this.clearGround();

    const groundGeometry = new THREE.PlaneGeometry(mapSize * 3, mapSize * 3);
    const groundTexture = createGroundTexture();
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(20, 20);

    const groundMaterial = new THREE.MeshLambertMaterial({
      map: groundTexture,
      side: THREE.DoubleSide,
    });

    this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.gridHelper = new THREE.GridHelper(mapSize * 3, mapSize, 0x000000, 0x555555);
    this.scene.add(this.gridHelper);
  }


  createMapBoundaries(mapSize = 100) {
    if (!this.scene) return;

    // Remove old boundary meshes and debug labels if present
    if (!this.boundaryMeshes) this.boundaryMeshes = [];
    this.boundaryMeshes.forEach(mesh => {
      this.scene.remove(mesh);
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

    const nsWallTexture = createCobblestoneTexture();
    nsWallTexture.wrapS = THREE.RepeatWrapping;
    nsWallTexture.wrapT = THREE.RepeatWrapping;

    const makeNsMaterial = () => new THREE.MeshLambertMaterial({ map: nsWallTexture.clone() });

    const nsWallMaterials = [
      makeNsMaterial(),
      makeNsMaterial(),
      makeNsMaterial(),
      makeNsMaterial(),
      makeNsMaterial(),
      makeNsMaterial(),
    ];

    nsWallMaterials[0].map.repeat.set(wallThickness / 2, wallHeight / 2);
    nsWallMaterials[1].map.repeat.set(wallThickness / 2, wallHeight / 2);
    nsWallMaterials[2].map.repeat.set(mapSize / 2, wallThickness / 2);
    nsWallMaterials[3].map.repeat.set(mapSize / 2, wallThickness / 2);
    nsWallMaterials[4].map.repeat.set(mapSize / 2, wallHeight / 2);
    nsWallMaterials[5].map.repeat.set(mapSize / 2, wallHeight / 2);

    const ewWallTexture = createCobblestoneTexture();
    ewWallTexture.wrapS = THREE.RepeatWrapping;
    ewWallTexture.wrapT = THREE.RepeatWrapping;

    const makeEwMaterial = () => new THREE.MeshLambertMaterial({ map: ewWallTexture.clone() });

    const ewWallMaterials = [
      makeEwMaterial(),
      makeEwMaterial(),
      makeEwMaterial(),
      makeEwMaterial(),
      makeEwMaterial(),
      makeEwMaterial(),
    ];

    ewWallMaterials[0].map.repeat.set(mapSize / 2, wallHeight / 2);
    ewWallMaterials[1].map.repeat.set(mapSize / 2, wallHeight / 2);
    ewWallMaterials[2].map.repeat.set(mapSize / 2, wallThickness / 2);
    ewWallMaterials[2].map.rotation = Math.PI / 2;
    ewWallMaterials[2].map.center.set(0.5, 0.5);
    ewWallMaterials[3].map.repeat.set(mapSize / 2, wallThickness / 2);
    ewWallMaterials[3].map.rotation = Math.PI / 2;
    ewWallMaterials[3].map.center.set(0.5, 0.5);
    ewWallMaterials[4].map.repeat.set(wallThickness / 2, wallHeight / 2);
    ewWallMaterials[5].map.repeat.set(wallThickness / 2, wallHeight / 2);

    // Create and track boundary meshes
    const boundaryMeshes = [];


    const northWall = new THREE.Mesh(
      new THREE.BoxGeometry(mapSize + wallThickness * 2, wallHeight, wallThickness),
      nsWallMaterials,
    );
    northWall.position.set(0, wallHeight / 2, -mapSize / 2 - wallThickness / 2);
    northWall.castShadow = true;
    northWall.receiveShadow = true;
    northWall.name = 'North Wall';
    this.scene.add(northWall);
    boundaryMeshes.push(northWall);
    this._addCompassMarker('N', 0xB20000, new THREE.Vector3(0, wallHeight + 8, -mapSize / 2));
    this._addDebugLabel(northWall, 'boundary');


    const southWall = new THREE.Mesh(
      new THREE.BoxGeometry(mapSize + wallThickness * 2, wallHeight, wallThickness),
      nsWallMaterials,
    );
    southWall.position.set(0, wallHeight / 2, mapSize / 2 + wallThickness / 2);
    southWall.castShadow = true;
    southWall.receiveShadow = true;
    this.scene.add(southWall);
    southWall.name = 'South Wall';
    boundaryMeshes.push(southWall);
    this._addCompassMarker('S', 0x1976D2, new THREE.Vector3(0, wallHeight + 8, mapSize / 2));
    this._addDebugLabel(southWall, 'boundary');


    const eastWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, mapSize),
      ewWallMaterials,
    );
    eastWall.position.set(mapSize / 2 + wallThickness / 2, wallHeight / 2, 0);
    eastWall.castShadow = true;
    eastWall.receiveShadow = true;
    this.scene.add(eastWall);
    eastWall.name = 'East Wall';
    boundaryMeshes.push(eastWall);
    this._addCompassMarker('E', 0x388E3C, new THREE.Vector3(mapSize / 2, wallHeight + 8, 0));
    this._addDebugLabel(eastWall, 'boundary');


    const westWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, mapSize),
      ewWallMaterials,
    );
    westWall.position.set(-mapSize / 2 - wallThickness / 2, wallHeight / 2, 0);
    westWall.castShadow = true;
    westWall.receiveShadow = true;
    this.scene.add(westWall);
    westWall.name = 'West Wall';
    boundaryMeshes.push(westWall);
    this._addCompassMarker('W', 0xFBC02D, new THREE.Vector3(-mapSize / 2, wallHeight + 8, 0));
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
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(20, 20, 1);
    this.scene.add(sprite);
  }

  clearObstacles() {
    if (!this.scene) return;
    this.obstacleMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
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

        // Use new blue marble pyramid texture
        const pyramidTexture = createPyramidTexture();
        pyramidTexture.wrapS = THREE.RepeatWrapping;
        pyramidTexture.wrapT = THREE.RepeatWrapping;
        pyramidTexture.repeat.set(obs.w, obs.h);

        const concreteTexture = createObstacleTexture();
        concreteTexture.wrapS = THREE.RepeatWrapping;
        concreteTexture.wrapT = THREE.RepeatWrapping;
        concreteTexture.repeat.set(obs.w, obs.d);
        if (obs.inverted) {
          concreteTexture.rotation = Math.PI;
          concreteTexture.center.set(0.5, 0.5);
        }

        mesh = new THREE.Mesh(
          geometry,
          [
            new THREE.MeshLambertMaterial({ map: pyramidTexture, flatShading: true }),
            new THREE.MeshLambertMaterial({ map: concreteTexture, flatShading: true }),
          ],
        );
        mesh.position.set(obs.x, baseY + h / 2, obs.z);
        mesh.rotation.y = obs.rotation || 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = obs.name || `Pyramid ${i + 1}`;
        if (mesh.geometry && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        this.scene.add(mesh);
        this._addDebugLabel(mesh, 'obstacle');
      } else {
        const concreteTexture = createObstacleTexture();
        concreteTexture.wrapS = THREE.RepeatWrapping;
        concreteTexture.wrapT = THREE.RepeatWrapping;
        concreteTexture.repeat.set(obs.w, h);

        const wallTexture = createWallTexture();
        wallTexture.wrapS = THREE.RepeatWrapping;
        wallTexture.wrapT = THREE.RepeatWrapping;
        wallTexture.repeat.set(obs.d, h);

        const materials = [
          new THREE.MeshLambertMaterial({ map: wallTexture.clone() }),
          new THREE.MeshLambertMaterial({ map: wallTexture.clone() }),
          new THREE.MeshLambertMaterial({ map: concreteTexture.clone() }),
          new THREE.MeshLambertMaterial({ map: concreteTexture.clone() }),
          new THREE.MeshLambertMaterial({ map: wallTexture.clone() }),
          new THREE.MeshLambertMaterial({ map: wallTexture.clone() }),
        ];

        materials[0].map.repeat.set(obs.d, h);
        materials[1].map.repeat.set(obs.d, h);
        materials[4].map.repeat.set(obs.w, h);
        materials[5].map.repeat.set(obs.w, h);
        materials[2].map.repeat.set(obs.w, obs.d);
        materials[3].map.repeat.set(obs.w, obs.d);
        materials.forEach((mat) => { mat.map.needsUpdate = true; });

        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(obs.w, h, obs.d),
          materials,
        );
        mesh.position.set(obs.x, baseY + h / 2, obs.z);
        mesh.rotation.y = obs.rotation || 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = obs.name || `Box ${i + 1}`;
        if (mesh.geometry && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        this.scene.add(mesh);
        this._addDebugLabel(mesh, 'obstacle');
      }

      if (mesh) {
        this.obstacleMeshes.push(mesh);
      }
    });
  }

  setDebugLabelsEnabled(enabled) {
    this.debugLabelsEnabled = enabled;
    this._updateDebugLabelsVisibility();
  }

  _addDebugLabel(object3D, type) {
    if (!object3D) return;
    // Always use object3D.name for label text
    const label = createTextLabel(object3D.name || '', '#fff', '14px', 'bold', true);
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
        if (object3D && label) object3D.remove(label);
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
      this.scene.remove(mesh);
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

  createMountains(mapSize) {
    if (!this.scene) return;
    this.clearMountains();

    const mountainDistance = 1.8 * mapSize;
    const mountainCount = 8;

    for (let i = 0; i < mountainCount; i += 1) {
      const angle = (i / mountainCount) * Math.PI * 2;
      const x = Math.cos(angle) * mountainDistance;
      const z = Math.sin(angle) * mountainDistance;

      const width = 30 + Math.random() * 40;
      const height = 40 + Math.random() * 60;

      const geometry = new THREE.ConeGeometry(width / 2, height, 4);
      const color = new THREE.Color().setHSL(0.3, 0.3, 0.3 + Math.random() * 0.2);
      const material = new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
        roughness: 0.9,
        metalness: 0.1,
      });
      const mountain = new THREE.Mesh(geometry, material);
      mountain.position.set(x, height / 2, z);
      mountain.rotation.y = Math.random() * Math.PI * 2;
      mountain.receiveShadow = true;
      mountain.castShadow = true;
      this.scene.add(mountain);

      const snowCapHeight = height * 0.3;
      const snowGeometry = new THREE.ConeGeometry(width / 4, snowCapHeight, 4);
      const snowMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        flatShading: true,
        roughness: 0.7,
        metalness: 0.0,
      });
      const snowCap = new THREE.Mesh(snowGeometry, snowMaterial);
      snowCap.position.set(x, height - snowCapHeight / 2, z);
      snowCap.rotation.y = mountain.rotation.y;
      snowCap.receiveShadow = true;
      this.scene.add(snowCap);

      this.mountainMeshes.push(mountain, snowCap);
    }
  }

  clearCelestialBodies() {
    if (!this.scene) return;
    this.celestialMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    });
    this.celestialMeshes = [];
  }

  createCelestialBodies(celestialData) {
    if (!this.scene || !celestialData) return;
    this.clearCelestialBodies();

    if (celestialData.sun && celestialData.sun.visible) {
      const sunGeometry = new THREE.SphereGeometry(8, 32, 32);
      const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
      const sun = new THREE.Mesh(sunGeometry, sunMaterial);
      sun.position.set(celestialData.sun.x, celestialData.sun.y, celestialData.sun.z);
      this.scene.add(sun);
      this.celestialMeshes.push(sun);

      const glowGeometry = new THREE.SphereGeometry(12, 32, 32);
      const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.3 });
      const glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.position.copy(sun.position);
      this.scene.add(glow);
      this.celestialMeshes.push(glow);
    }

    if (celestialData.moon && celestialData.moon.visible) {
      const moonGeometry = new THREE.SphereGeometry(6, 32, 32);
      const moonMaterial = new THREE.MeshLambertMaterial({ color: 0xcccccc });
      const moon = new THREE.Mesh(moonGeometry, moonMaterial);
      moon.position.set(celestialData.moon.x, celestialData.moon.y, celestialData.moon.z);
      this.scene.add(moon);
      this.celestialMeshes.push(moon);
    }
  }

  clearClouds() {
    if (!this.scene) return;
    this.clouds.forEach((cloud) => {
      this.scene.remove(cloud);
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

      this.scene.add(cloudGroup);
      this.clouds.push(cloudGroup);
    });
  }

  getClouds() {
    return this.clouds;
  }

  createTank(color = 0x4caf50, name = '') {
    const tankGroup = new THREE.Group();

    if (name) {
      const spriteMaterial = new THREE.SpriteMaterial({ depthTest: true, depthWrite: false });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.set(0, 3, 0);
      sprite.scale.set(2, 0.5, 1);
      tankGroup.add(sprite);
      tankGroup.userData.nameLabel = sprite;
      this.updateSpriteLabel(sprite, name);
    }

    const bodyTexture = this._createTankTexture(color);
    const treadTexture = this._createTreadTexture();
    const treadTextureRotated = treadTexture.clone();
    treadTextureRotated.rotation = Math.PI / 2;
    treadTextureRotated.center.set(0.5, 0.5);
    treadTextureRotated.needsUpdate = true;
    const treadCapTexture = this._createTreadCapTexture();

    const treadCapTextureSide = treadCapTexture.clone();
    treadCapTextureSide.repeat.set(3.0, 1.0);
    treadCapTextureSide.wrapS = THREE.RepeatWrapping;
    treadCapTextureSide.wrapT = THREE.RepeatWrapping;
    treadCapTextureSide.needsUpdate = true;

    const bodyGeometry = new THREE.BoxGeometry(3, 1, 4);
    const bodyMaterial = new THREE.MeshLambertMaterial({ map: bodyTexture });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.8;
    body.castShadow = true;
    body.receiveShadow = true;
    tankGroup.add(body);
    tankGroup.userData.body = body;

    const treadMat = new THREE.MeshLambertMaterial({ map: treadTexture.clone() });
    const treadCapMat = new THREE.MeshLambertMaterial({ map: treadCapTexture });

    const leftTreadGroup = new THREE.Group();
    leftTreadGroup.position.set(-1.75, 0.5, 0);

    tankGroup.userData.leftTreadTextures = [];
    tankGroup.userData.rightTreadTextures = [];

    const treadHeight = 1.0;
    const treadWidth = 1.0;
    const treadCapRadius = treadHeight / 2;
    const treadMiddleLength = 3.0;
    const treadMiddleGeom = new THREE.BoxGeometry(treadWidth, treadHeight, treadMiddleLength);
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

    const treadCapGeom = new THREE.CylinderGeometry(treadCapRadius, treadCapRadius, treadWidth, 16, 1, false, 0, Math.PI);
    const treadCapGeomRear = new THREE.CylinderGeometry(treadCapRadius, treadCapRadius, treadWidth, 16, 1, false, Math.PI, Math.PI);
    const leftTreadFrontTex = treadTexture.clone();
    leftTreadFrontTex.wrapS = THREE.RepeatWrapping;
    leftTreadFrontTex.wrapT = THREE.RepeatWrapping;
    const leftTreadFrontMat = new THREE.MeshLambertMaterial({ map: leftTreadFrontTex });
    const leftTreadFront = new THREE.Mesh(treadCapGeom, [leftTreadFrontMat, treadCapMat, treadCapMat]);
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
    const leftTreadRear = new THREE.Mesh(treadCapGeomRear, [leftTreadRearMat, treadCapMat, treadCapMat]);
    leftTreadRear.rotation.x = Math.PI / 2;
    leftTreadRear.rotation.z = Math.PI / 2;
    leftTreadRear.position.z = -treadMiddleLength / 2;
    leftTreadRear.castShadow = true;
    leftTreadGroup.add(leftTreadRear);
    tankGroup.userData.leftTreadTextures.push(leftTreadRearTex);

    tankGroup.add(leftTreadGroup);

    const rightTreadGroup = new THREE.Group();
    rightTreadGroup.position.set(1.75, 0.5, 0);

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
    const rightTreadFront = new THREE.Mesh(treadCapGeom, [rightTreadFrontMat, treadCapMat, treadCapMat]);
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
    const rightTreadRear = new THREE.Mesh(treadCapGeomRear, [rightTreadRearMat, treadCapMat, treadCapMat]);
    rightTreadRear.rotation.x = Math.PI / 2;
    rightTreadRear.rotation.z = Math.PI / 2;
    rightTreadRear.position.z = -treadMiddleLength / 2;
    rightTreadRear.castShadow = true;
    rightTreadGroup.add(rightTreadRear);
    tankGroup.userData.rightTreadTextures.push(rightTreadRearTex);

    tankGroup.add(rightTreadGroup);

    const turretGeometry = new THREE.CylinderGeometry(1, 1, 0.8, 32);
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

    const barrelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 3, 8);
    const barrelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1.7, -1.5);
    barrel.castShadow = true;
    tankGroup.add(barrel);
    tankGroup.userData.barrel = barrel;

    return tankGroup;
  }

  updateSpriteLabel(sprite, name) {
    if (!sprite) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = 'bold 36px Arial';
    context.fillStyle = '#4CAF50';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
  }

  _createTankTexture(baseColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const baseHex = baseColor.toString(16).padStart(6, '0');
    const r = parseInt(baseHex.substr(0, 2), 16);
    const g = parseInt(baseHex.substr(2, 2), 16);
    const b = parseInt(baseHex.substr(4, 2), 16);

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

  _createTreadTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#333333';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#222222';
    for (let x = 0; x < 128; x += 16) {
      ctx.fillRect(x, 0, 10, 64);
    }
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    for (let x = 10; x < 128; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 64);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  _createTreadCapTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const r = 100;
    const g = 100;
    const b = 100;

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
    this.scene.add(shield);
    return shield;
  }

  removeShield(shield) {
    if (!shield || !this.scene) return;
    this.scene.remove(shield);
    if (shield.geometry) shield.geometry.dispose();
    if (shield.material) shield.material.dispose();
  }

  playShootSound() {
    if (!this.shootSound || !this.shootSound.buffer) return;
    if (this.shootSound.isPlaying) {
      try { this.shootSound.stop(); } catch (error) {}
    }
    try { this.shootSound.play(); } catch (error) {}
  }

  playExplosionSound() {
    if (!this.explosionSound || !this.explosionSound.buffer) return;
    if (this.explosionSound.isPlaying) {
      try { this.explosionSound.stop(); } catch (error) {}
    }
    try { this.explosionSound.play(); } catch (error) {}
  }

  playLocalJumpSound() {
    if (!this.jumpSound) return;
    if (this.jumpSound.isPlaying) {
      try { this.jumpSound.stop(); } catch (error) {}
    }
    try { this.jumpSound.play(); } catch (error) {}
  }

  cloneJumpSound() {
    if (!this.jumpSound) return null;
    try {
      return this.jumpSound.clone();
    } catch (error) {
      return null;
    }
  }

  cloneLandSound() {
    if (!this.landSound) return null;
    try {
      return this.landSound.clone();
    } catch (error) {
      return null;
    }
  }

  createProjectile(data) {
    if (!this.scene) return null;
    const geometry = new THREE.SphereGeometry(0.3, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const projectile = new THREE.Mesh(geometry, material);
    projectile.position.set(data.x, data.y, data.z);
    projectile.userData = {
      dirX: data.dirX,
      dirZ: data.dirZ,
    };
    this.scene.add(projectile);
    this.playShootSound();
    return projectile;
  }

  removeProjectile(projectile) {
    if (!projectile || !this.scene) return;
    this.scene.remove(projectile);
    if (projectile.geometry) projectile.geometry.dispose();
    if (projectile.material) projectile.material.dispose();
  }

  createExplosion(position, tank) {
    if (!this.scene || !position) return;
    this.playExplosionSound();

    const geometry = new THREE.SphereGeometry(2, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: true, opacity: 0.8 });
    const explosion = new THREE.Mesh(geometry, material);
    explosion.position.copy(position);
    this.scene.add(explosion);

    const animateExplosion = () => {
      material.opacity -= 0.05;
      explosion.scale.addScalar(0.1);
      if (material.opacity > 0) {
        requestAnimationFrame(animateExplosion);
      } else {
        this.scene.remove(explosion);
        geometry.dispose();
        material.dispose();
      }
    };
    animateExplosion();

    const debrisPieces = [];
    if (tank && tank.userData) {
      const tankWorldPos = new THREE.Vector3();
      tank.getWorldPosition(tankWorldPos);
      const tankRotation = tank.rotation.y;

      if (tank.userData.body) {
        const part = tank.userData.body.clone();
        part.position.copy(tankWorldPos);
        part.position.y = tank.userData.body.position.y;
        part.rotation.y = tankRotation;
        this._launchTankPart(part, tankWorldPos, debrisPieces, 1.0);
      }
      if (tank.userData.turret) {
        const part = tank.userData.turret.clone();
        part.position.copy(tankWorldPos);
        part.position.y = tank.userData.turret.position.y;
        part.rotation.y = tankRotation;
        this._launchTankPart(part, tankWorldPos, debrisPieces, 0.8);
      }
      if (tank.userData.barrel) {
        const part = tank.userData.barrel.clone();
        part.position.copy(tankWorldPos);
        part.position.y = tank.userData.barrel.position.y;
        part.position.z += 1.5 * Math.cos(tankRotation);
        part.position.x += 1.5 * Math.sin(tankRotation);
        part.rotation.copy(tank.userData.barrel.rotation);
        part.rotation.y += tankRotation;
        this._launchTankPart(part, tankWorldPos, debrisPieces, 0.6);
      }
      tank.children.forEach((child) => {
        if (child instanceof THREE.Group && child.children.length > 0) {
          const treadGroup = child.clone();
          treadGroup.position.copy(tankWorldPos);
          treadGroup.position.x += child.position.x * Math.cos(tankRotation);
          treadGroup.position.z += child.position.x * Math.sin(tankRotation);
          treadGroup.position.y = child.position.y;
          treadGroup.rotation.y = tankRotation;
          this._launchTankPart(treadGroup, tankWorldPos, debrisPieces, 0.9);
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
      this.scene.add(debris);
      debrisPieces.push({ mesh: debris, lifetime: 0, maxLifetime: 1.5 });
    }

    const animateDebris = () => {
      let anyAlive = false;
      const dt = 0.016;
      debrisPieces.forEach((piece) => {
        if (piece.lifetime < piece.maxLifetime) {
          anyAlive = true;
          piece.lifetime += dt;
          piece.mesh.velocity.y -= 20 * dt;
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
            piece.lifetime = piece.maxLifetime;
          }
        } else {
          this.scene.remove(piece.mesh);
          if (piece.mesh.userData && !piece.mesh.userData.isTankPart) {
            if (piece.mesh.geometry) piece.mesh.geometry.dispose();
            if (piece.mesh.material) {
              if (Array.isArray(piece.mesh.material)) {
                piece.mesh.material.forEach((mat) => mat.dispose());
              } else {
                piece.mesh.material.dispose();
              }
            }
          }
          if (piece.mesh.children) {
            piece.mesh.children.forEach((child) => {
              this.scene.remove(child);
            });
          }
        }
      });
      if (anyAlive) {
        requestAnimationFrame(animateDebris);
      }
    };
    animateDebris();
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

  _launchTankPart(part, centerPos, debrisPieces, speedMultiplier = 1.0) {
    this.scene.add(part);
    part.userData.isTankPart = true;
    const angle = Math.random() * Math.PI * 2;
    const elevation = (Math.random() - 0.3) * Math.PI / 3;
    const speed = (Math.random() * 10 + 8) * speedMultiplier;
    part.velocity = new THREE.Vector3(
      Math.cos(angle) * Math.cos(elevation) * speed,
      Math.sin(elevation) * speed + 8,
      Math.sin(angle) * Math.cos(elevation) * speed,
    );
    part.rotationVelocity = new THREE.Vector3(
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 8,
    );
    debrisPieces.push({ mesh: part, lifetime: 0, maxLifetime: 2.0 });
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

  updateCamera({ cameraMode, myTank, playerRotation }) {
    if (!this.camera) return;
    if (cameraMode === 'overview' || !myTank) {
      this.camera.position.set(0, 15, 20);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);
      return;
    }

    if (cameraMode === 'first-person') {
      if (myTank.userData.body) myTank.userData.body.visible = false;
      if (myTank.userData.turret) myTank.userData.turret.visible = false;
      const fpOffset = new THREE.Vector3(
        -Math.sin(playerRotation) * 0.5,
        2.2,
        -Math.cos(playerRotation) * 0.5,
      );
      this.camera.position.copy(myTank.position).add(fpOffset);
      const lookTarget = new THREE.Vector3(
        myTank.position.x - Math.sin(playerRotation) * 10,
        myTank.position.y + 2,
        myTank.position.z - Math.cos(playerRotation) * 10,
      );
      this.camera.lookAt(lookTarget);
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
