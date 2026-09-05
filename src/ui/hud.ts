import type { Body, SolarSystem } from '../ephemeris/bodies';
import { SimClock, jdToDate } from '../core/time/simclock';

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

  constructor(
    system: SolarSystem,
    private readonly clock: SimClock,
    onSelect: (b: Body) => void,
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
    document.body.appendChild(bar);
  }

  setFocus(id: string): void {
    for (const [bodyId, btn] of this.buttons) {
      btn.classList.toggle('active', bodyId === id);
    }
  }

  update(): void {
    this.dateEl.textContent = jdToDate(this.clock.jd).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    this.warpEl.textContent = this.clock.paused ? '❚❚' : this.clock.warpLabel;
    this.pauseBtn.textContent = this.clock.paused ? '▶' : '❚❚';
  }
}
