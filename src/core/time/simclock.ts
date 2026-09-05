import { SECONDS_PER_DAY } from '../constants';

export const JD_J2000 = 2451545.0;

/** Current UTC time as a Julian Date. */
export function jdNow(): number {
  return Date.now() / 86_400_000 + 2_440_587.5;
}

export function jdToDate(jd: number): Date {
  return new Date((jd - 2_440_587.5) * 86_400_000);
}

/**
 * Simulation clock: Julian Date driven by real time × warp factor.
 */
export class SimClock {
  jd = jdNow();
  paused = false;
  /** Simulated seconds per real second. */
  warp = 1;

  private static readonly WARP_STEPS = [
    1, 10, 100, 1000, 10_000, 100_000, 1_000_000, 10_000_000,
  ];
  private warpIndex = 0;
  private warpSign = 1;

  update(dtRealSeconds: number): void {
    if (this.paused) return;
    this.jd += (dtRealSeconds * this.warp) / SECONDS_PER_DAY;
  }

  setNow(): void {
    this.jd = jdNow();
  }

  fasterWarp(): void {
    if (this.warpSign < 0) {
      // decelerate reverse warp toward forward
      if (this.warpIndex > 0) this.warpIndex--;
      else this.warpSign = 1;
    } else if (this.warpIndex < SimClock.WARP_STEPS.length - 1) {
      this.warpIndex++;
    }
    this.applyWarp();
  }

  slowerWarp(): void {
    if (this.warpSign > 0) {
      if (this.warpIndex > 0) this.warpIndex--;
      else this.warpSign = -1;
    } else if (this.warpIndex < SimClock.WARP_STEPS.length - 1) {
      this.warpIndex++;
    }
    this.applyWarp();
  }

  private applyWarp(): void {
    this.warp = this.warpSign * SimClock.WARP_STEPS[this.warpIndex];
  }

  get warpLabel(): string {
    const v = Math.abs(this.warp);
    const s = v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1000 ? `${v / 1000}k` : `${v}`;
    return `${this.warp < 0 ? '-' : ''}×${s}`;
  }
}
