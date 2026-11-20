interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; }
interface FloatText { x: number; y: number; text: string; life: number; color: string; size: number; }

export class Fx {
  particles: Particle[] = [];
  texts: FloatText[] = [];

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
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 2.5 * dt; p.vy *= 1 - 2.5 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const t of this.texts) { t.y -= 1.2 * dt; t.life -= dt; }
    this.texts = this.texts.filter(t => t.life > 0);
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
