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
import { Starfield } from './scene/starfield';

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
  await view.selectTerrainBackend(engine.renderer);
  console.info(
    `[space-engine] terrain generation: ${view.terrainBackend}` +
      (view.terrainBenchmark
        ? ` (probe: gpu ${view.terrainBenchmark.gpuMs} ms vs workers ${view.terrainBenchmark.cpuMs} ms)`
        : ''),
  );

  const starfield = await Starfield.load();
  scene.add(starfield.group);
  console.info(`[space-engine] star catalog: ${starfield.starCount} stars`);

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

  const hud = new Hud(system, clock, select, (level) => engine.setQuality(level));
  hud.setFocus(startFocus);

  // debug/testing handle (used by the Playwright verification scripts)
  Object.assign(window as object, { __se: { rig, clock, system, engine, view, starfield, select } });

  function select(b: Body) {
    rig.flyTo(b);
    hud.setFocus(b);
  }

  const frameClock = new THREE.Clock();
  async function frame() {
    const dt = Math.min(frameClock.getDelta(), 0.1);
    clock.update(dt);
    system.update(clock.jd);
    view.sync(rig.focus);
    rig.update(dt, () => view.applyTerrainClamp(rig.focus, rig));
    view.updateTerrain(rig.focus, rig.offset);
    starfield.setSkyBrightness(view.skyBrightness(rig));
    hud.update(rig);
    await engine.render();
    labelRenderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error('[space-engine] failed to start:', err);
  const el = document.createElement('pre');
  el.style.cssText = 'color:#f66;padding:16px;font-size:14px';
  el.textContent = `Failed to start: ${err?.message ?? err}`;
  document.body.appendChild(el);
});
