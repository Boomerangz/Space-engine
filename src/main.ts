import * as THREE from 'three/webgpu';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Engine } from './render/engine';
import { SimClock } from './core/time/simclock';
import { Body, SolarSystem } from './ephemeris/bodies';
import type { SystemDef } from './ephemeris/types';
import systemJson from './data/solar-system.json';
import { SystemView, eclToRender } from './scene/system-view';
import { Hud } from './ui/hud';
import { Vec3d } from './core/math/vec3d';
import { CameraRig } from './camera/rig';

async function main() {
  const container = document.getElementById('app')!;
  const engine = await Engine.create(container);
  const { scene, camera } = engine;
  console.info(`[space-engine] rendering backend: ${engine.backend}`);

  const clock = new SimClock();
  const system = SolarSystem.fromDef(systemJson as SystemDef);
  system.update(clock.jd);

  const startFocus = system.byId.get('earth')!;
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

  const rig = new CameraRig(camera, system, startFocus, engine.renderer.domElement);

  // spawn on the sunlit side of the focus body, slightly off-axis
  {
    const sun = system.byId.get('sun')!;
    const toSun = new THREE.Vector3();
    eclToRender(Vec3d.subVectors(sun.worldPosition, startFocus.worldPosition), toSun).normalize();
    const side = new THREE.Vector3().crossVectors(toSun, new THREE.Vector3(0, 1, 0)).normalize();
    toSun
      .addScaledVector(side, 0.7)
      .addScaledVector(new THREE.Vector3(0, 1, 0), 0.35)
      .normalize()
      .multiplyScalar(startFocus.def.radiusKm * 4);
    rig.spawnAt(toSun);
  }

  const hud = new Hud(system, clock, select);
  hud.setFocus(startFocus.def.id);

  // debug/testing handle (used by the Playwright verification scripts)
  Object.assign(window as object, { __se: { rig, clock, system, engine, select } });

  function select(b: Body) {
    rig.flyTo(b);
    hud.setFocus(b.def.id);
  }

  const frameClock = new THREE.Clock();
  async function frame() {
    const dt = Math.min(frameClock.getDelta(), 0.1);
    clock.update(dt);
    system.update(clock.jd);
    view.sync(rig.focus);
    rig.update(dt);
    hud.update(rig);
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
