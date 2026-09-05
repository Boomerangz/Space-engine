/**
 * WGSL port of the CPU chunk builder (src/terrain/heightfield.ts and
 * src/terrain/chunk-builder.ts). The two must stay in step: the camera's
 * terrain clamp evaluates the CPU version, so any change to the height
 * function has to land in both.
 *
 * The permutation table is uploaded from the CPU (same xorshift shuffle), so
 * a given seed produces the same terrain on either path.
 */
export const CHUNK_WGSL = /* wgsl */ `
struct Params {
  radiusKm      : f32,
  amplitude     : f32,
  baseFreq      : f32,
  ridged        : f32,
  detail        : f32,
  minWavelength : f32,
  u0            : f32,
  v0            : f32,
  size          : f32,
  step          : f32,
  arc           : f32,
  skirtDepth    : f32,
  face          : u32,
  res           : u32,   // quads per edge (CHUNK_RES)
  variation     : f32,
  _pad          : f32,
  anchor        : vec3<f32>,
  _pad2         : f32,
};

@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read>       perm      : array<u32>;   // 1024: 512 base + 512 detail
@group(0) @binding(2) var<storage, read_write> positions : array<f32>;
@group(0) @binding(3) var<storage, read_write> normals   : array<f32>;
@group(0) @binding(4) var<storage, read_write> uvs       : array<f32>;
@group(0) @binding(5) var<storage, read_write> colors    : array<f32>;

const GRAD = array<vec3<f32>, 12>(
  vec3f( 1., 1., 0.), vec3f(-1., 1., 0.), vec3f( 1.,-1., 0.), vec3f(-1.,-1., 0.),
  vec3f( 1., 0., 1.), vec3f(-1., 0., 1.), vec3f( 1., 0.,-1.), vec3f(-1., 0.,-1.),
  vec3f( 0., 1., 1.), vec3f( 0.,-1., 1.), vec3f( 0., 1.,-1.), vec3f( 0.,-1.,-1.)
);

fn permAt(table: u32, i: u32) -> u32 { return perm[table * 512u + (i & 511u)]; }

/** 3D simplex noise in [-1, 1]; \`table\` selects base (0) or detail (1) perm. */
fn snoise(table: u32, v: vec3<f32>) -> f32 {
  let F3 = 1.0 / 3.0;
  let G3 = 1.0 / 6.0;
  let s = (v.x + v.y + v.z) * F3;
  let ijk = floor(v + vec3f(s));
  let t = (ijk.x + ijk.y + ijk.z) * G3;
  let p0 = v - (ijk - vec3f(t));

  var o1 : vec3<f32>;
  var o2 : vec3<f32>;
  if (p0.x >= p0.y) {
    if (p0.y >= p0.z)      { o1 = vec3f(1.,0.,0.); o2 = vec3f(1.,1.,0.); }
    else if (p0.x >= p0.z) { o1 = vec3f(1.,0.,0.); o2 = vec3f(1.,0.,1.); }
    else                   { o1 = vec3f(0.,0.,1.); o2 = vec3f(1.,0.,1.); }
  } else {
    if (p0.y < p0.z)       { o1 = vec3f(0.,0.,1.); o2 = vec3f(0.,1.,1.); }
    else if (p0.x < p0.z)  { o1 = vec3f(0.,1.,0.); o2 = vec3f(0.,1.,1.); }
    else                   { o1 = vec3f(0.,1.,0.); o2 = vec3f(1.,1.,0.); }
  }

  let p1 = p0 - o1 + vec3f(G3);
  let p2 = p0 - o2 + vec3f(2.0 * G3);
  let p3 = p0 - vec3f(1.0) + vec3f(3.0 * G3);

  let ii = u32(i32(ijk.x) & 255);
  let jj = u32(i32(ijk.y) & 255);
  let kk = u32(i32(ijk.z) & 255);
  let i1 = u32(o1.x); let j1 = u32(o1.y); let k1 = u32(o1.z);
  let i2 = u32(o2.x); let j2 = u32(o2.y); let k2 = u32(o2.z);

  var n = 0.0;
  var t0 = 0.6 - dot(p0, p0);
  if (t0 > 0.0) {
    let g = permAt(table, ii + permAt(table, jj + permAt(table, kk))) % 12u;
    t0 = t0 * t0;
    n += t0 * t0 * dot(GRAD[g], p0);
  }
  var t1 = 0.6 - dot(p1, p1);
  if (t1 > 0.0) {
    let g = permAt(table, ii + i1 + permAt(table, jj + j1 + permAt(table, kk + k1))) % 12u;
    t1 = t1 * t1;
    n += t1 * t1 * dot(GRAD[g], p1);
  }
  var t2 = 0.6 - dot(p2, p2);
  if (t2 > 0.0) {
    let g = permAt(table, ii + i2 + permAt(table, jj + j2 + permAt(table, kk + k2))) % 12u;
    t2 = t2 * t2;
    n += t2 * t2 * dot(GRAD[g], p2);
  }
  var t3 = 0.6 - dot(p3, p3);
  if (t3 > 0.0) {
    let g = permAt(table, ii + 1u + permAt(table, jj + 1u + permAt(table, kk + 1u))) % 12u;
    t3 = t3 * t3;
    n += t3 * t3 * dot(GRAD[g], p3);
  }
  return 32.0 * n;
}

fn faceDir(face: u32, u: f32, v: f32) -> vec3<f32> {
  var p : vec3<f32>;
  switch (face) {
    case 0u: { p = vec3f( 1.0,  v,  -u); }
    case 1u: { p = vec3f(-1.0,  v,   u); }
    case 2u: { p = vec3f(  u, 1.0,  -v); }
    case 3u: { p = vec3f(  u,-1.0,   v); }
    case 4u: { p = vec3f(  u,   v, 1.0); }
    default: { p = vec3f( -u,   v,-1.0); }
  }
  return normalize(p);
}

/** Same global height function as Heightfield.heightAt on the CPU. */
fn heightAt(d: vec3<f32>) -> f32 {
  var sum = 0.0;
  var ridgedSum = 0.0;
  var freq = P.baseFreq;
  var amp = 1.0;
  for (var o = 0u; o < 26u; o = o + 1u) {
    let wavelength = P.radiusKm / freq;
    let fade = clamp(wavelength / P.minWavelength - 1.0, 0.0, 1.0);
    if (fade == 0.0) { break; }
    let n = snoise(0u, d * freq);
    let w = amp * fade;
    sum += n * w;
    let r = 1.0 - abs(n);
    ridgedSum += (r * r * 2.0 - 1.0) * w;
    freq *= 2.02;
    amp *= 0.5;
  }
  let h = sum * (1.0 - P.ridged) + ridgedSum * P.ridged;

  var detailSum = 0.0;
  var dFreq = P.radiusKm / 30.0;
  var dAmp = P.amplitude * 0.02 * P.detail;
  for (var o = 0u; o < 16u; o = o + 1u) {
    let wavelength = P.radiusKm / dFreq;
    let fade = clamp(wavelength / P.minWavelength - 1.0, 0.0, 1.0);
    if (fade == 0.0) { break; }
    detailSum += snoise(1u, d * dFreq) * dAmp * fade;
    dFreq *= 2.03;
    dAmp *= 0.68;
  }
  return h * P.amplitude * 0.25 + detailSum;
}

fn albedoVariation(d: vec3<f32>) -> f32 {
  let f1 = P.radiusKm / 0.8;
  let f2 = P.radiusKm / 0.06;
  return snoise(1u, d * f1) * 0.06
       + snoise(1u, d * f2 + vec3f(31.7, 0.0, 0.0)) * 0.05;
}

/** Height at grid cell (i, j), clamped to the padded range like the CPU path. */
fn hAt(i: i32, j: i32) -> f32 {
  let res = i32(P.res);
  let ci = clamp(i, -1, res + 1);
  let cj = clamp(j, -1, res + 1);
  return heightAt(faceDir(P.face, P.u0 + f32(ci) * P.step, P.v0 + f32(cj) * P.step));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let res = i32(P.res);
  let n = res + 3;                       // vertices per edge incl. skirt ring
  if (i32(gid.x) >= n || i32(gid.y) >= n) { return; }

  let i = i32(gid.x) - 1;                // -1 .. res+1
  let j = i32(gid.y) - 1;
  let vi = u32(i32(gid.y) * n + i32(gid.x));

  let isSkirt = i < 0 || j < 0 || i > res || j > res;
  let ci = clamp(i, 0, res);
  let cj = clamp(j, 0, res);

  let d = faceDir(P.face, P.u0 + f32(ci) * P.step, P.v0 + f32(cj) * P.step);
  let h = hAt(ci, cj);
  var r = P.radiusKm + h;
  if (isSkirt) { r = r - P.skirtDepth; }

  let pos = d * r - P.anchor;
  positions[vi * 3u + 0u] = pos.x;
  positions[vi * 3u + 1u] = pos.y;
  positions[vi * 3u + 2u] = pos.z;

  // normal from the height gradient in the surface tangent frame
  let spacing = P.arc / f32(res);
  let dhdu = (hAt(ci + 1, cj) - hAt(ci - 1, cj)) / (2.0 * spacing);
  let dhdv = (hAt(ci, cj + 1) - hAt(ci, cj - 1)) / (2.0 * spacing);
  let du = faceDir(P.face, P.u0 + f32(ci) * P.step + P.step, P.v0 + f32(cj) * P.step);
  let dv = faceDir(P.face, P.u0 + f32(ci) * P.step, P.v0 + f32(cj) * P.step + P.step);
  let tu = normalize(du - d);
  let tv = normalize(dv - d);
  let nrm = normalize(d - tu * dhdu - tv * dhdv);
  normals[vi * 3u + 0u] = nrm.x;
  normals[vi * 3u + 1u] = nrm.y;
  normals[vi * 3u + 2u] = nrm.z;

  // slope shading plus procedural tonal breakup on close-range chunks
  var shade = clamp(1.0 - (1.0 - dot(nrm, d)) * 5.0, 0.55, 1.0);
  if (P.variation > 0.0) {
    shade = shade * (1.0 + albedoVariation(d) * P.variation);
  }
  colors[vi * 3u + 0u] = shade;
  colors[vi * 3u + 1u] = shade;
  colors[vi * 3u + 2u] = shade;

  // equirect UVs matching the impostor sphere, unwrapped across the seam
  let centerDir = faceDir(P.face, P.u0 + P.size * 0.5, P.v0 + P.size * 0.5);
  let centerU = atan2(centerDir.z, -centerDir.x) / (2.0 * 3.14159265359);
  var u = atan2(d.z, -d.x) / (2.0 * 3.14159265359);
  if (u - centerU > 0.5) { u = u - 1.0; }
  else if (u - centerU < -0.5) { u = u + 1.0; }
  uvs[vi * 2u + 0u] = u;
  uvs[vi * 2u + 1u] = 1.0 - acos(clamp(d.y, -1.0, 1.0)) / 3.14159265359;
}
`;
