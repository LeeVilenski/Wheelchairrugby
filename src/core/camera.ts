import { COURT } from '../game/court';

export type CameraMode = 'full' | 'follow';

// Maps world metres to screen pixels. "full" fits the whole court; "follow" zooms in on a target.
export class Camera {
  mode: CameraMode = 'full';
  x = COURT.length / 2; y = COURT.width / 2; scale = 30;
  private shake = 0;

  toggle() { this.mode = this.mode === 'full' ? 'follow' : 'full'; }
  addShake(a: number) { this.shake = Math.min(0.6, this.shake + a); }

  update(dt: number, w: number, h: number, tx: number, ty: number) {
    const margin = 2;
    const fit = Math.min(w / (COURT.length + margin * 2), h / (COURT.width + margin * 2));
    let targetScale = fit, cx = COURT.length / 2, cy = COURT.width / 2;
    if (this.mode === 'follow') {
      targetScale = Math.max(fit * 2, Math.min(w, h) / 12);
      const hw = w / targetScale / 2, hh = h / targetScale / 2;
      cx = clampCentre(tx, hw, COURT.length, margin);
      cy = clampCentre(ty, hh, COURT.width, margin);
    }
    const k = 1 - Math.exp(-6 * dt);
    this.scale += (targetScale - this.scale) * k;
    this.x += (cx - this.x) * k;
    this.y += (cy - this.y) * k;
    this.shake = Math.max(0, this.shake - dt * 1.5);
  }

  apply(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.x + sx, -this.y + sy);
  }
}

function clampCentre(t: number, half: number, size: number, m: number) {
  if (half * 2 >= size + m * 2) return size / 2;
  return Math.max(half - m, Math.min(size + m - half, t));
}
