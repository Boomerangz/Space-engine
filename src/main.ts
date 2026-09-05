import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Engine } from './render/engine';
import { AU_KM, EARTH_RADIUS_KM, SUN_RADIUS_KM } from './core/constants';

/**
 * M0 scene: the Sun and a textured Earth at true scale (kilometer units).
 *
 * Earth sits at the render-world origin and the Sun is placed 1 AU away —
 * a preview of the floating-origin scheme that M2 generalizes. Keeping the
 * camera near the origin avoids f32 jitter without any extra machinery.
 */
async function main() {
  const container = document.getElementById('app')!;
  const engine = await Engine.create(container);
  const { scene, camera } = engine;

  console.info(`[space-engine] rendering backend: ${engine.backend}`);

  // --- Sun ---
  const sunDir = new THREE.Vector3(1, 0, 0); // from Earth toward the Sun
  const sunMat = new THREE.MeshBasicMaterial();
  sunMat.color.setRGB(8, 7, 6); // HDR emissive: feeds the bloom pass
  const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS_KM, 48, 24), sunMat);
  sun.position.copy(sunDir).multiplyScalar(AU_KM);
  scene.add(sun);

  const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
  sunLight.position.copy(sunDir);
  scene.add(sunLight);

  // --- Earth ---
  const texLoader = new THREE.TextureLoader();
  const earthMap = await texLoader.loadAsync('/textures/earth_day.jpg');
  earthMap.colorSpace = THREE.SRGBColorSpace;
  earthMap.anisotropy = 8;
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS_KM, 96, 48),
    new THREE.MeshStandardMaterial({ map: earthMap, roughness: 0.9, metalness: 0 }),
  );
  earth.rotation.x = THREE.MathUtils.degToRad(-23.44); // axial tilt (placeholder until M1)
  scene.add(earth);

  // --- Placeholder starfield (M1 replaces this with a real catalog) ---
  scene.add(makeStarfield());

  // --- Camera ---
  camera.position.set(EARTH_RADIUS_KM * 2.2, EARTH_RADIUS_KM * 0.9, EARTH_RADIUS_KM * 2.0);
  const controls = new OrbitControls(camera, engine.renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = EARTH_RADIUS_KM + 200;
  controls.maxDistance = AU_KM * 4;

  // --- Loop ---
  const clock = new THREE.Clock();
  async function frame() {
    const dt = clock.getDelta();
    earth.rotation.y += dt * 0.02;
    controls.update();
    await engine.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function makeStarfield(): THREE.Points {
  const n = 6000;
  const radius = 5e10; // km, well beyond the planets
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // uniform directions on the sphere
    const z = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    positions[i * 3] = r * Math.cos(phi) * radius;
    positions[i * 3 + 1] = r * Math.sin(phi) * radius;
    positions[i * 3 + 2] = z * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false });
  return new THREE.Points(geo, mat);
}

main().catch((err) => {
  console.error('[space-engine] failed to start:', err);
  const el = document.createElement('pre');
  el.style.cssText = 'color:#f66;padding:16px;font-size:14px';
  el.textContent = `Failed to start: ${err?.message ?? err}`;
  document.body.appendChild(el);
});
