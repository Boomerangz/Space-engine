/**
 * Double-precision 3D vector.
 *
 * JS numbers are IEEE-754 f64, so this class is the engine's source of truth
 * for world-space positions (kilometers). Only camera-relative offsets are
 * ever converted to f32 for the GPU.
 */
export class Vec3d {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3d): this {
    return this.set(v.x, v.y, v.z);
  }

  clone(): Vec3d {
    return new Vec3d(this.x, this.y, this.z);
  }

  add(v: Vec3d): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vec3d): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  addScaledVector(v: Vec3d, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  dot(v: Vec3d): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vec3d): this {
    const { x, y, z } = this;
    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;
    return this;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const l = this.length();
    return l > 0 ? this.multiplyScalar(1 / l) : this;
  }

  distanceTo(v: Vec3d): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  lerp(v: Vec3d, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  static subVectors(a: Vec3d, b: Vec3d, out = new Vec3d()): Vec3d {
    return out.set(a.x - b.x, a.y - b.y, a.z - b.z);
  }
}
