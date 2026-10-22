// Geometry accumulator: collects boxes/cylinders/arbitrary geometry per material and merges them into
// one BufferGeometry per material (one draw call each). UVs are world-space so textures keep real scale.
import * as THREE from 'three';
import { UV_SCALE, type MatKey } from './materials';

interface Buf { pos: number[]; nrm: number[]; uv: number[]; idx: number[] }

const FACES: { n: [number, number, number]; u: [number, number, number]; v: [number, number, number] }[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

export class GeoBuilder {
  private bufs = new Map<MatKey, Buf>();
  /** Current placement transform (translation + rotation about Y) applied to everything added. */
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private trot = 0;
  private stack: [number, number, number, number][] = [];
  private mat = new THREE.Matrix4();

  /** Place subsequent geometry in an object's local frame (origin at x,y,z; rotated by rot about Y). */
  push(x: number, y: number, z: number, rot: number) {
    this.stack.push([this.tx, this.ty, this.tz, this.trot]);
    const c = Math.cos(this.trot), s = Math.sin(this.trot);
    this.tx += x * c + z * s;
    this.tz += -x * s + z * c;
    this.ty += y;
    this.trot += rot;
  }

  pop() {
    const t = this.stack.pop();
    if (t) [this.tx, this.ty, this.tz, this.trot] = t;
  }

  private toWorld(x: number, z: number): [number, number] {
    const c = Math.cos(this.trot), s = Math.sin(this.trot);
    return [this.tx + x * c + z * s, this.tz - x * s + z * c];
  }

  private buf(k: MatKey): Buf {
    let b = this.bufs.get(k);
    if (!b) { b = { pos: [], nrm: [], uv: [], idx: [] }; this.bufs.set(k, b); }
    return b;
  }

  private worldUV(k: MatKey, x: number, y: number, z: number, nx: number, ny: number, nz: number): [number, number] {
    const s = UV_SCALE[k] ?? 1;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) return [x / s, -z / s];
    if (ax >= az) return [z / s, y / s];
    return [x / s, y / s];
  }

  /** Axis-aligned (in local space) box rotated about Y by `rot` around its centre. */
  box(k: MatKey, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rot = 0, skipBottom = false) {
    if (sx <= 0 || sy <= 0 || sz <= 0) return;
    const b = this.buf(k);
    [cx, cz] = this.toWorld(cx, cz);
    cy += this.ty;
    rot += this.trot;
    const c = Math.cos(rot), s = Math.sin(rot);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    for (const f of FACES) {
      if (skipBottom && f.n[1] === -1) continue;
      const base = b.pos.length / 3;
      // four corners: n*h +/- u*h +/- v*h
      const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const nx = f.n[0] * c + f.n[2] * s;
      const nz = -f.n[0] * s + f.n[2] * c;
      for (const [cu, cv] of corners) {
        const lx = f.n[0] * hx + f.u[0] * cu * hx + f.v[0] * cv * hx;
        const ly = f.n[1] * hy + f.u[1] * cu * hy + f.v[1] * cv * hy;
        const lz = f.n[2] * hz + f.u[2] * cu * hz + f.v[2] * cv * hz;
        const wx = cx + lx * c + lz * s;
        const wy = cy + ly;
        const wz = cz - lx * s + lz * c;
        b.pos.push(wx, wy, wz);
        b.nrm.push(nx, f.n[1], nz);
        const [u, v] = this.worldUV(k, wx, wy, wz, nx, f.n[1], nz);
        b.uv.push(u, v);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /** Box given by min/max extents (no rotation). */
  boxMinMax(k: MatKey, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.box(k, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0);
  }

  /** Vertical cylinder centred at (cx, cy, cz). */
  cyl(k: MatKey, cx: number, cy: number, cz: number, rTop: number, rBot: number, h: number, seg = 14, caps = true) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !caps);
    g.translate(cx, cy, cz);
    this.geom(k, g);
    g.dispose();
  }

  /** Horizontal cylinder along local X rotated about Y. */
  hcyl(k: MatKey, cx: number, cy: number, cz: number, r: number, len: number, rot = 0, seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateZ(Math.PI / 2);
    g.rotateY(rot);
    g.translate(cx, cy, cz);
    this.geom(k, g);
    g.dispose();
  }

  sphere(k: MatKey, cx: number, cy: number, cz: number, r: number, sx = 1, sy = 1, sz = 1, detail = 1) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(sx, sy, sz);
    g.translate(cx, cy, cz);
    this.geom(k, g);
    g.dispose();
  }

  /** Append an arbitrary geometry (already in world space). UVs are regenerated in world space. */
  geom(k: MatKey, g: THREE.BufferGeometry) {
    if (this.tx || this.ty || this.tz || this.trot) {
      this.mat.makeRotationY(this.trot).setPosition(this.tx, this.ty, this.tz);
      g.applyMatrix4(this.mat);
    }
    const b = this.buf(k);
    const p = g.getAttribute('position');
    let n = g.getAttribute('normal');
    if (!n) { g.computeVertexNormals(); n = g.getAttribute('normal'); }
    const base = b.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      b.pos.push(x, y, z);
      b.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      const [u, v] = this.worldUV(k, x, y, z, n.getX(i), n.getY(i), n.getZ(i));
      b.uv.push(u, v);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) b.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) b.idx.push(base + i);
  }

  /** Flat quad on a vertical plane facing `heading` (for signs, art, panels). */
  quad(k: MatKey, cx: number, cy: number, cz: number, w: number, h: number, heading: number) {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY(heading);
    g.translate(cx, cy, cz);
    this.geom(k, g);
    g.dispose();
  }

  build(): Map<MatKey, THREE.BufferGeometry> {
    const out = new Map<MatKey, THREE.BufferGeometry>();
    for (const [k, b] of this.bufs) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      const vcount = b.pos.length / 3;
      g.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.set(k, g);
    }
    return out;
  }

  vertexCount(): number {
    let n = 0;
    for (const b of this.bufs.values()) n += b.pos.length / 3;
    return n;
  }
}
