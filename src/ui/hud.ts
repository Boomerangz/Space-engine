import type { Body, SolarSystem } from '../ephemeris/bodies';
import type { CameraRig } from '../camera/rig';
import { SimClock, jdToDate } from '../core/time/simclock';
import { AU_KM, GM_SUN } from '../core/constants';

function fmtKm(km: number): string {
  if (km >= 1e7) return `${(km / 149597870.7).toFixed(3)} au`;
  if (km >= 1) return `${km.toLocaleString('en-US', { maximumFractionDigits: 0 })} km`;
  return `${(km * 1000).toFixed(0)} m`;
}

const HUD_CSS = `
.hud {
  position: fixed; z-index: 10; color: #cfd8e3; font-size: 13px;
  user-select: none;
}
.hud-bodies {
  top: 12px; left: 12px; display: flex; flex-direction: column; gap: 2px;
  max-height: calc(100vh - 90px); overflow-y: auto; padding-right: 4px;
}
.hud-bodies button {
  background: rgba(10, 16, 26, 0.55); color: #cfd8e3;
  border: 1px solid rgba(120, 150, 190, 0.25); border-radius: 4px;
  padding: 3px 10px; text-align: left; cursor: pointer; font-size: 13px;
}
.hud-bodies button:hover { background: rgba(40, 60, 90, 0.7); }
.hud-bodies button.active { border-color: #6ea8ff; color: #fff; }
.hud-bodies button.indent { margin-left: 16px; font-size: 12px; }
.hud-time {
  bottom: 12px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px;
  background: rgba(10, 16, 26, 0.55); border: 1px solid rgba(120, 150, 190, 0.25);
  border-radius: 6px; padding: 6px 12px;
}
.hud-time button {
  background: none; border: 1px solid rgba(120, 150, 190, 0.35); color: #cfd8e3;
  border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 13px;
}
.hud-time button:hover { background: rgba(40, 60, 90, 0.7); }
.hud-time .date { min-width: 180px; text-align: center; font-variant-numeric: tabular-nums; }
.hud-time .warp { min-width: 52px; text-align: center; color: #8fc1ff; }
.hud-status {
  top: 12px; right: 12px; text-align: right; line-height: 1.5;
  background: rgba(10, 16, 26, 0.55); border: 1px solid rgba(120, 150, 190, 0.25);
  border-radius: 6px; padding: 6px 12px; font-variant-numeric: tabular-nums;
}
.hud-status .mode { color: #8fc1ff; }
.hud-status .hint { color: #77839a; font-size: 11px; }
.hud-info {
  top: 118px; right: 12px; text-align: right; line-height: 1.5;
  background: rgba(10, 16, 26, 0.55); border: 1px solid rgba(120, 150, 190, 0.25);
  border-radius: 6px; padding: 6px 12px; font-variant-numeric: tabular-nums;
  color: #9fb0c4; font-size: 12px;
}
.hud-info .title { color: #dfe8f2; font-size: 13px; }
.body-label {
  color: #b9c6d8; font-size: 12px; cursor: pointer; pointer-events: auto;
  padding: 6px; text-shadow: 0 0 4px #000;
}
.body-label::before {
  content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%;
  background: #8fb6e8; margin-right: 4px; vertical-align: middle;
}
.body-label-moon { font-size: 11px; color: #93a8a0; }
.body-label-moon::before { background: #7ba88f; width: 4px; height: 4px; }
.body-label-star { color: #ffd9a0; }
.body-label:hover { color: #fff; }
`;

export class Hud {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly dateEl: HTMLSpanElement;
  private readonly warpEl: HTMLSpanElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;
  private readonly infoEl: HTMLDivElement;
  private frames = 0;
  private fps = 0;
  private lastFpsAt = performance.now();
  private quality = 2;

  constructor(
    system: SolarSystem,
    private readonly clock: SimClock,
    onSelect: (b: Body) => void,
    onQuality?: (level: number) => void,
  ) {
    const style = document.createElement('style');
    style.textContent = HUD_CSS;
    document.head.appendChild(style);

    const list = document.createElement('div');
    list.className = 'hud hud-bodies';
    for (const body of system.bodies) {
      const btn = document.createElement('button');
      btn.textContent = body.def.name;
      if (body.def.type === 'moon') btn.classList.add('indent');
      btn.addEventListener('click', () => onSelect(body));
      this.buttons.set(body.def.id, btn);
      list.appendChild(btn);
    }
    document.body.appendChild(list);

    const bar = document.createElement('div');
    bar.className = 'hud hud-time';
    const mk = (label: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    };
    mk('◀◀', () => clock.slowerWarp());
    this.pauseBtn = mk('❚❚', () => (clock.paused = !clock.paused));
    mk('▶▶', () => clock.fasterWarp());
    this.warpEl = document.createElement('span');
    this.warpEl.className = 'warp';
    bar.appendChild(this.warpEl);
    this.dateEl = document.createElement('span');
    this.dateEl.className = 'date';
    bar.appendChild(this.dateEl);
    mk('Now', () => clock.setNow());
    if (onQuality) {
      const names = ['Low', 'Med', 'High'];
      const qBtn = mk(`Q:${names[this.quality]}`, () => {
        this.quality = (this.quality + 1) % 3;
        qBtn.textContent = `Q:${names[this.quality]}`;
        onQuality(this.quality);
      });
    }
    document.body.appendChild(bar);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'hud hud-status';
    document.body.appendChild(this.statusEl);

    this.infoEl = document.createElement('div');
    this.infoEl.className = 'hud hud-info';
    document.body.appendChild(this.infoEl);
  }

  setFocus(body: Body): void {
    for (const [bodyId, btn] of this.buttons) {
      btn.classList.toggle('active', bodyId === body.def.id);
    }
    const def = body.def;
    const rows = [`<span class="title">${def.name}</span>`, `${def.type}`];
    rows.push(`radius ${def.radiusKm.toLocaleString('en-US')} km`);
    const orbit = def.orbit;
    if (orbit) {
      const el = body.elementsAt(this.clock.jd)!;
      const days =
        orbit.kind === 'simple'
          ? Math.abs(orbit.periodDays)
          : (2 * Math.PI * Math.sqrt(el.a ** 3 / GM_SUN)) / 86400;
      rows.push(
        el.a > AU_KM * 0.01
          ? `a = ${(el.a / AU_KM).toFixed(2)} au`
          : `a = ${Math.round(el.a).toLocaleString('en-US')} km`,
        days > 400 ? `period ${(days / 365.25).toFixed(1)} yr` : `period ${days.toFixed(2)} d`,
      );
    }
    if (def.rotationPeriodH) {
      rows.push(`day ${Math.abs(def.rotationPeriodH).toFixed(1)} h${def.rotationPeriodH < 0 ? ' (retro)' : ''}`);
    }
    this.infoEl.innerHTML = rows.join('<br>');
  }

  update(rig?: CameraRig): void {
    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsAt >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastFpsAt));
      this.frames = 0;
      this.lastFpsAt = now;
    }
    this.dateEl.textContent = jdToDate(this.clock.jd).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    this.warpEl.textContent = this.clock.paused ? '❚❚' : this.clock.warpLabel;
    this.pauseBtn.textContent = this.clock.paused ? '▶' : '❚❚';
    if (rig) {
      const mode = rig.mode === 'orbit' ? 'Orbit' : 'Fly';
      this.statusEl.innerHTML =
        `<span class="mode">${mode}</span> · ${rig.focus.def.name} · ${this.fps} fps<br>` +
        `alt ${fmtKm(Math.max(rig.surfaceDistance, 0))}<br>` +
        `<span class="hint">F fly/orbit · WASD+RV move · wheel ${rig.mode === 'orbit' ? 'zoom' : 'speed'}</span>`;
    }
  }
}
