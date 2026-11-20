import type { Chair } from '../entities/chair';

export interface HitEvent { a: Chair; b: Chair; impact: number; aSpeed: number; bSpeed: number; nx: number; ny: number; x: number; y: number; }

// Circle-vs-circle collisions with mass-weighted impulses.
export function collideChairs(chairs: Chair[]): HitEvent[] {
  const hits: HitEvent[] = [];
  for (let i = 0; i < chairs.length; i++) {
    for (let j = i + 1; j < chairs.length; j++) {
      const a = chairs[i], b = chairs[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy), min = a.radius + b.radius;
      if (d >= min || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      const ia = 1 / a.mass, ib = 1 / b.mass;
      const overlap = min - d;
      a.x -= nx * overlap * ia / (ia + ib); a.y -= ny * overlap * ia / (ia + ib);
      b.x += nx * overlap * ib / (ia + ib); b.y += ny * overlap * ib / (ia + ib);
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vn >= 0) continue;
      // How fast each chair was driving into the other (decides who the hitter is).
      const aSpeed = a.vx * nx + a.vy * ny, bSpeed = -(b.vx * nx + b.vy * ny);
      const e = 0.35;
      const jimp = -(1 + e) * vn / (ia + ib);
      a.vx -= jimp * ia * nx; a.vy -= jimp * ia * ny;
      b.vx += jimp * ib * nx; b.vy += jimp * ib * ny;
      hits.push({ a, b, impact: -vn, aSpeed, bSpeed, nx, ny, x: a.x + nx * a.radius, y: a.y + ny * a.radius });
    }
  }
  return hits;
}
