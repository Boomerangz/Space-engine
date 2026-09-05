import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Engine } from './render/engine';
import { SimClock } from './core/time/simclock';
import { Body, SolarSystem } from './ephemeris/bodies';
import type { SystemDef } from './ephemeris/types';
import systemJson from './data/solar-system.json';
import { SystemView, eclToRender } from './scene/system-view';
import { Hud } from './ui/hud';
import { Vec3d } from './core/math/vec3d';

async function main() {
  const container = document.getElementById('app')!;
  const engine = await Engine.create(container);
  const { scene, camera } = engine;
  console.info(`[space-engine] rendering backend: ${engine.backend}`);

  const clock = new SimClock();
  const system = SolarSystem.fromDef(systemJson as SystemDef);
  system.update(clock.jd);

  let focus: Body = system.byId.get('earth')!;
  let flying = false;

  const view = new SystemView(system, clock.jd, select);
  scene.add(view.group);
  void view.loadTextures(); // textures stream in; colored spheres until then

  scene.add(makeStarfield());

  // DOM overlay for body labels
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.cssText =
    'position:absolute;top:0;left:0;pointer-events:none;z-index:5';
  container.appendChild(labelRenderer.domElement);
  window.addEventListener('resize', () =>
    labelRenderer.setSize(container.clientWidth, container.clientHeight),
  );

  const controls = new OrbitControls(camera, engine.renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = focus.def.radiusKm * 1.05;
  controls.maxDistance = 1e10;
  // spawn on the sunlit side of the focus body, slightly off-axis
  {
    const sun = system.byId.get('sun')!;
    const toSun = new THREE.Vector3();
    eclToRender(Vec3d.subVectors(sun.worldPosition, focus.worldPosition), toSun).normalize();
    const side = new THREE.Vector3().crossVectors(toSun, new THREE.Vector3(0, 1, 0)).normalize();
    camera.position
      .copy(toSun)
      .addScaledVector(side, 0.7)
      .addScaledVector(new THREE.Vector3(0, 1, 0), 0.35)
      .normalize()
      .multiplyScalar(focus.def.radiusKm * 4);
  }

  const hud = new Hud(system, clock, select);
  hud.setFocus(focus.def.id);

  /**
   * Refocus on a body. The render world is always origin-rebased to the
   * focus body, so on switch we shift the camera by the old→new focus offset
   * to keep its true position continuous, then glide in.
   */
  function select(b: Body) {
    if (b === focus) return;
    const shift = new THREE.Vector3();
    eclToRender(Vec3d.subVectors(focus.worldPosition, b.worldPosition), shift);
    camera.position.add(shift);
    focus = b;
    flying = true;
    hud.setFocus(b.def.id);
    controls.minDistance = b.def.radiusKm * 1.05;
  }

  const frameClock = new THREE.Clock();
  async function frame() {
    const dt = Math.min(frameClock.getDelta(), 0.1);
    clock.update(dt);
    system.update(clock.jd);
    view.sync(focus);

    if (flying) {
      const desired = focus.def.radiusKm * 4;
      const d = camera.position.length();
      const nd = THREE.MathUtils.damp(d, desired, 3, dt);
      camera.position.setLength(nd);
      if (Math.abs(nd - desired) < desired * 0.02) flying = false;
    }

    controls.update();
    hud.update();
    await engine.render();
    labelRenderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function makeStarfield(): THREE.Points {
  const n = 6000;
  const radius = 5e10; // km, well beyond the planets
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
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
