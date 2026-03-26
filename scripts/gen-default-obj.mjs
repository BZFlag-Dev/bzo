#!/usr/bin/env node
/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/BZFlag-Dev/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import * as THREE from 'three';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BODY_WIDTH = 1.755;
const BODY_HALF_WIDTH = BODY_WIDTH / 2;
const BODY_X_SCALE = BODY_WIDTH / 4.5;
const BODY_DEPTH = BODY_WIDTH;

class OBJBuilder {
  constructor() {
    this.vOffset = 0;
    this.vtOffset = 0;
    this.vnOffset = 0;
    this.out = '';
  }

  addObject(name, geo, matNames) {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const indexed = geo.index !== null;

    this.out += `\no ${name}\n`;

    for (let i = 0; i < pos.count; i += 1) {
      this.out += `v ${pos.getX(i).toFixed(6)} ${pos.getY(i).toFixed(6)} ${pos.getZ(i).toFixed(6)}\n`;
    }
    if (uv) {
      for (let i = 0; i < uv.count; i += 1) {
        this.out += `vt ${uv.getX(i).toFixed(6)} ${uv.getY(i).toFixed(6)}\n`;
      }
    }
    if (nor) {
      for (let i = 0; i < nor.count; i += 1) {
        this.out += `vn ${nor.getX(i).toFixed(6)} ${nor.getY(i).toFixed(6)} ${nor.getZ(i).toFixed(6)}\n`;
      }
    }

    const hasUV = !!uv;
    const hasNor = !!nor;
    const vOff = this.vOffset;
    const vtOff = this.vtOffset;
    const vnOff = this.vnOffset;

    const fRef = (i) => {
      const v = i + 1 + vOff;
      const vt = i + 1 + vtOff;
      const vn = i + 1 + vnOff;
      if (hasUV && hasNor) return `${v}/${vt}/${vn}`;
      if (hasUV) return `${v}/${vt}`;
      if (hasNor) return `${v}//${vn}`;
      return `${v}`;
    };

    const groups = (geo.groups && geo.groups.length > 0)
      ? geo.groups
      : [{ start: 0, count: indexed ? geo.index.count : pos.count, materialIndex: 0 }];

    const useGroups = matNames && matNames.length > 1;
    const indexArr = indexed ? geo.index.array : null;

    for (const group of groups) {
      if (useGroups) {
        const mName = matNames[group.materialIndex] ?? matNames[0];
        this.out += `usemtl ${mName}\n`;
      }
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const a = indexArr ? indexArr[i] : i;
        const b = indexArr ? indexArr[i + 1] : i + 1;
        const c = indexArr ? indexArr[i + 2] : i + 2;
        this.out += `f ${fRef(a)} ${fRef(b)} ${fRef(c)}\n`;
      }
    }

    this.vOffset += pos.count;
    if (uv) this.vtOffset += uv.count;
    if (nor) this.vnOffset += nor.count;
  }

  build() {
    return this.out;
  }
}

function transformedGeometry(geometry, {
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
} = {}) {
  const geo = geometry.clone();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  const position = new THREE.Vector3(x, y, z);
  const scale = new THREE.Vector3(sx, sy, sz);
  matrix.compose(position, quaternion, scale);
  geo.applyMatrix4(matrix);
  geo.computeVertexNormals();
  return geo;
}

function scaleGroupUVs(geometry, groupIndex, { scaleU = 1, scaleV = 1 } = {}) {
  const uv = geometry.attributes.uv;
  if (!uv || !geometry.groups || !geometry.groups[groupIndex]) return geometry;

  const group = geometry.groups[groupIndex];
  const indexArray = geometry.index ? geometry.index.array : null;
  const touched = new Set();

  for (let i = group.start; i < group.start + group.count; i += 1) {
    touched.add(indexArray ? indexArray[i] : i);
  }

  for (const vertexIndex of touched) {
    uv.setXY(vertexIndex, uv.getX(vertexIndex) * scaleU, uv.getY(vertexIndex) * scaleV);
  }

  uv.needsUpdate = true;
  return geometry;
}

function makeTreadMiddleGeometry() {
  const geometry = new THREE.BoxGeometry(treadWidth, treadHeight, treadMiddleLength);
  const lengthScale = treadMiddleLength / 3.0;
  const widthScale = treadWidth / 1.0;

  scaleGroupUVs(geometry, 0, { scaleU: lengthScale });
  scaleGroupUVs(geometry, 1, { scaleU: lengthScale });
  scaleGroupUVs(geometry, 4, { scaleU: widthScale });
  scaleGroupUVs(geometry, 5, { scaleU: widthScale });

  return geometry;
}

function makeTreadCapGeometry(thetaStart) {
  const geometry = new THREE.CylinderGeometry(treadCapRadius, treadCapRadius, treadWidth, 16, 1, false, thetaStart, Math.PI);
  const widthScale = treadWidth / 1.0;

  scaleGroupUVs(geometry, 0, { scaleV: widthScale });

  return geometry;
}

function makeCurvedBodyGeometry() {
  const profile = new THREE.Shape();
  profile.moveTo(-BODY_HALF_WIDTH, 0.70);
  profile.lineTo(BODY_HALF_WIDTH, 0.70);
  profile.lineTo(2.18 * BODY_X_SCALE, 0.46);
  profile.bezierCurveTo(1.55 * BODY_X_SCALE, 0.16, 0.85 * BODY_X_SCALE, 0.03, 0.00, -0.08);
  profile.bezierCurveTo(-0.85 * BODY_X_SCALE, 0.03, -1.55 * BODY_X_SCALE, 0.16, -2.18 * BODY_X_SCALE, 0.46);
  profile.lineTo(-BODY_HALF_WIDTH, 0.70);

  const body = new THREE.ExtrudeGeometry(profile, {
    depth: BODY_DEPTH,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 20,
  });

  body.translate(0, 0, -BODY_DEPTH / 2);
  body.rotateY(Math.PI / 2);
  body.computeVertexNormals();
  return body;
}

function makeTurretGeometry() {
  const pts = [
    new THREE.Vector2(0.00, 0.42),
    new THREE.Vector2(0.24, 0.40),
    new THREE.Vector2(0.55, 0.32),
    new THREE.Vector2(0.80, 0.18),
    new THREE.Vector2(0.95, 0.00),
    new THREE.Vector2(0.88, -0.14),
    new THREE.Vector2(0.62, -0.26),
    new THREE.Vector2(0.25, -0.33),
    new THREE.Vector2(0.00, -0.35),
  ];

  const lathe = new THREE.LatheGeometry([...pts].reverse(), 32);
  lathe.rotateY(Math.PI / 2);
  lathe.computeVertexNormals();
  return lathe;
}

function makeBarrelGeometry() {
  const barrel = new THREE.CylinderGeometry(0.16, 0.20, 3.2, 12, 1, false);
  barrel.rotateX(Math.PI / 2);
  barrel.computeVertexNormals();
  return barrel;
}

function makeWheelGeometry() {
  const wheel = new THREE.CylinderGeometry(0.42, 0.42, WHEEL_THICKNESS, 20);
  wheel.rotateZ(Math.PI / 2);
  wheel.computeVertexNormals();
  return wheel;
}

const treadHeight = 1.0;
const treadWidth = 0.52;
const treadCapRadius = treadHeight / 2;
const treadMiddleLength = 3.6;
const TREAD_BODY_OVERLAP = 0.08;
const treadCenterOffset = BODY_HALF_WIDTH + (treadWidth / 2) - TREAD_BODY_OVERLAP;
const WHEEL_THICKNESS = 0.22;
const TARGET_HALF_MODEL_WIDTH = 1.4;
const wheelCenterOffset = TARGET_HALF_MODEL_WIDTH - (WHEEL_THICKNESS / 2);
const wheelCenterZStart = treadMiddleLength / 2;
const wheelCenterZStep = treadMiddleLength / 3;
const CAP_MATS = ['tread_side', 'tread_cap', 'tread_cap'];
const WHEEL_MATS = ['tread_side', 'tread_cap', 'tread_cap'];
const BOX_MATS = ['bm0', 'bm1', 'bm2', 'bm3', 'bm4', 'bm5'];

const builder = new OBJBuilder();
builder.out = `# DefaultTank geometry for BZO\n# Generated by scripts/gen-default-obj.mjs\n# Assembled BZFlag-like body/turret + treads + wheels\n# Naming contract used by render.js template-driven assembly\n`;

builder.addObject('body', transformedGeometry(makeCurvedBodyGeometry(), { y: 0.38 }));

builder.addObject('leftTreadMiddle', transformedGeometry(
  makeTreadMiddleGeometry(),
  { x: -treadCenterOffset, y: 0.5 },
), BOX_MATS);

builder.addObject('leftTreadFrontCap', transformedGeometry(
  makeTreadCapGeometry(0),
  { x: -treadCenterOffset, y: 0.5, z: treadMiddleLength / 2, rx: Math.PI / 2, rz: Math.PI / 2 },
), CAP_MATS);

builder.addObject('leftTreadRearCap', transformedGeometry(
  makeTreadCapGeometry(Math.PI),
  { x: -treadCenterOffset, y: 0.5, z: -treadMiddleLength / 2, rx: Math.PI / 2, rz: Math.PI / 2 },
), CAP_MATS);

builder.addObject('rightTreadMiddle', transformedGeometry(
  makeTreadMiddleGeometry(),
  { x: treadCenterOffset, y: 0.5 },
), BOX_MATS);

builder.addObject('rightTreadFrontCap', transformedGeometry(
  makeTreadCapGeometry(0),
  { x: treadCenterOffset, y: 0.5, z: treadMiddleLength / 2, rx: Math.PI / 2, rz: Math.PI / 2 },
), CAP_MATS);

builder.addObject('rightTreadRearCap', transformedGeometry(
  makeTreadCapGeometry(Math.PI),
  { x: treadCenterOffset, y: 0.5, z: -treadMiddleLength / 2, rx: Math.PI / 2, rz: Math.PI / 2 },
), CAP_MATS);

builder.addObject('turret', transformedGeometry(makeTurretGeometry(), {
  y: 1.76,
  sx: 1.18,
  sy: 1.15,
  sz: 1.18,
}));
builder.addObject('barrel', transformedGeometry(makeBarrelGeometry(), { x: 0, y: 1.72, z: -1.68 }));

const wheelZ = Array.from({ length: 4 }, (_, index) => wheelCenterZStart - (index * wheelCenterZStep));
for (let i = 0; i < wheelZ.length; i += 1) {
  builder.addObject(`leftWheel${i + 1}`, transformedGeometry(makeWheelGeometry(), {
    x: -wheelCenterOffset,
    y: 0.5,
    z: wheelZ[i],
  }), WHEEL_MATS);
  builder.addObject(`rightWheel${i + 1}`, transformedGeometry(makeWheelGeometry(), {
    x: wheelCenterOffset,
    y: 0.5,
    z: wheelZ[i],
  }), WHEEL_MATS);
}

const objText = builder.build();
const outPath = resolve(__dirname, '../public/obj/default.obj');
writeFileSync(outPath, objText, 'utf-8');

console.log(`Written: ${outPath}`);
console.log(`Objects: ${(objText.match(/^o /mg) || []).length}`);
console.log(`usemtl groups: ${(objText.match(/^usemtl /mg) || []).length}`);
console.log(`Global vertex count: ${builder.vOffset}`);
