import type { Chair } from './chair';

export class Ball {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  holder: Chair | null = null;
  lockChair: Chair | null = null;   // can't re-catch immediately after passing / being stripped
  lockTime = 0;
  bounceAnim = 0;
  readonly radius = 0.17;

  update(dt: number) {
    this.lockTime -= dt;
    this.bounceAnim = Math.max(0, this.bounceAnim - dt);
    if (this.holder) {
      const h = this.holder;
      this.x = h.x + Math.cos(h.heading) * 0.15;
      this.y = h.y + Math.sin(h.heading) * 0.15;
      this.z = 0.6; this.vx = h.vx; this.vy = h.vy; this.vz = 0;
      return;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    this.vz -= 9.8 * dt;
    if (this.z <= 0) {
      this.z = 0;
      this.vz = Math.abs(this.vz) > 1.2 ? -this.vz * 0.55 : 0;
      const k = Math.max(0, 1 - 0.9 * dt);
      this.vx *= k; this.vy *= k;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    let { x, y, z } = this;
    if (this.holder && this.bounceAnim > 0) {
      const h = this.holder, t = this.bounceAnim / 0.4;
      x = h.x - Math.sin(h.heading) * (h.radius + 0.2);
      y = h.y + Math.cos(h.heading) * (h.radius + 0.2);
      z = Math.abs(Math.sin(t * Math.PI)) * 0.8;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.arc(x + z * 0.15, y + z * 0.2, this.radius, 0, Math.PI * 2); ctx.fill();
    const r = this.radius * (1 + z * 0.12);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.arc(x, y - z * 0.3, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r, y - z * 0.3); ctx.lineTo(x + r, y - z * 0.3); ctx.stroke();
  }
}
