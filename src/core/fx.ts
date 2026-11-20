interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; }
interface FloatText { x: number; y: number; text: string; life: number; color: string; size: number; }

export class Fx {
  particles: Particle[] = [];
  texts: FloatText[] = [];
  trails: Particle[] = [];
  flash = 0;                                    // screen flash alpha
  callout: { text: string; color: string; life: number } | null = null;

  private shoutCooldown = 0;
  /** Announcer callout. Minor callouts are skipped if one was shown recently; important ones always show. */
  shout(text: string, color = '#ffe14d', important = false) {
    if (!important && this.shoutCooldown > 0) return false;
    this.callout = { text, color, life: 1.3 };
    this.shoutCooldown = important ? 2 : 5;
    return true;
  }
  trail(x: number, y: number) {
    if (this.trails.length < 400) this.trails.push({ x, y, vx: 0, vy: 0, life: 0.6, max: 0.6, color: 'rgba(40,20,10,0.35)', size: 0.12 });
  }
  flame(x: number, y: number, vx: number, vy: number) {
    this.particles.push({ x: x + (Math.random() - 0.5) * 0.4, y: y + (Math.random() - 0.5) * 0.4, vx: -vx * 0.3 + (Math.random() - 0.5),
      vy: -vy * 0.3 + (Math.random() - 0.5), life: 0.35, max: 0.35, color: Math.random() < 0.5 ? '#ff5a1f' : '#ffd23f', size: 0.16 });
  }

  sparks(x: number, y: number, power: number) {
    const n = Math.min(40, 6 + power * 5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (1 + Math.random() * 4) * (0.5 + power * 0.25);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, max: 0.5,
        color: Math.random() < 0.5 ? '#ffe14d' : '#ff8c1a', size: 0.06 + Math.random() * 0.06 });
    }
  }
  confetti(x: number, y: number, colors: string[]) {
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 7;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.6, max: 1.6,
        color: colors[i % colors.length], size: 0.12 });
    }
  }
  text(x: number, y: number, text: string, color = '#fff', size = 0.8) {
    this.texts.push({ x, y, text, life: 1.1, color, size });
  }

  update(dt: number) {
    this.flash = Math.max(0, this.flash - dt * 3);
    this.shoutCooldown -= dt;
    if (this.callout && (this.callout.life -= dt) <= 0) this.callout = null;
    for (const t of this.trails) t.life -= dt;
    this.trails = this.trails.filter(t => t.life > 0);
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 2.5 * dt; p.vy *= 1 - 2.5 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const t of this.texts) { t.y -= 1.2 * dt; t.life -= dt; }
    this.texts = this.texts.filter(t => t.life > 0);
  }

  /** Floor layer, drawn under the chairs. */
  drawFloor(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgb(60,35,20)';
    for (const t of this.trails) { ctx.globalAlpha = (t.life / t.max) * 0.35; ctx.fillRect(t.x - 0.05, t.y - 0.05, 0.1, 0.1); }
    ctx.globalAlpha = 1;
  }

  /** Screen-space layer: flash + announcer callout. */
  drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.5})`; ctx.fillRect(0, 0, w, h); }
    const c = this.callout;
    if (!c) return;
    const t = 1.3 - c.life, s = Math.min(1, t * 6) * (1 + Math.max(0, 0.15 - t) * 3);
    ctx.save();
    ctx.globalAlpha = Math.min(1, c.life * 3);
    ctx.translate(w / 2, h * 0.28); ctx.rotate(-0.06); ctx.scale(s, s);
    ctx.font = `900 ${Math.min(56, w / 12)}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText(c.text, 0, 0);
    ctx.fillStyle = c.color; ctx.fillText(c.text, 0, 0);
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 2);
      const s = t.size * (1 + Math.max(0, t.life - 0.9) * 2);
      ctx.font = `900 ${s}px system-ui`;
      ctx.lineWidth = s * 0.15;
      ctx.strokeStyle = '#000';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
