import type { Chair } from '../entities/chair';
import type { Controls } from '../core/input';
import { COURT } from '../game/court';
import { dist, type Match } from '../game/match';

// Basic per-player AI. Team tactics (presses, picks, key traps) come in milestone 8.
export function aiControls(c: Chair, m: Match): Controls {
  const ball = m.ball, W = COURT.width;
  const holder = ball.holder;
  const mates = m.team(c.team).filter(o => o !== c);
  const opps = m.team(1 - c.team);
  const gx = m.goalX(c.team), dir = m.attackDir(c.team);

  // Ball carrier
  if (holder === c) {
    const og = m.ownGoalX(c.team);
    const ctl = Math.abs(c.x - og) < 2.5
      ? steer(c, og + dir * 5, c.y < W / 2 ? 2 : W - 2, 0)
      : steer(c, gx + dir * 0.5, W / 2 + Math.sin(c.holdTime * 1.3) * 2.5, 0);
    const near = nearest(opps, c.x, c.y);
    const toGoal = Math.abs(gx - c.x);
    const threatened = near && dist(near, c.x, c.y) < 2.4 && (near.x - c.x) * dir > -0.5;
    if (c.holdTime > 6.5 + Math.random() * 2) { ctl.bounce = true; return ctl; }
    if ((threatened && toGoal > 3) || c.holdTime > 8.5) {
      const open = mates
        .filter(o => { const d = nearest(opps, o.x, o.y); return !d || dist(d, o.x, o.y) > 2.2; })
        .sort((a, b) => (b.x - a.x) * dir)[0]; // most advanced open teammate
      if (open && Math.random() < 0.08) { ctl.pass = true; ctl.aim = Math.atan2(open.y - c.y, open.x - c.x); }
    }
    return ctl;
  }

  // Loose ball: closest player on each team chases it.
  if (!holder) {
    const chaser = nearest(m.team(c.team), ball.x, ball.y);
    if (chaser === c) return steer(c, ball.x + ball.vx * 0.3, ball.y + ball.vy * 0.3, 0);
    return steer(c, (ball.x + m.ownGoalX(c.team)) / 2, clampY(c.y), 1.5);
  }

  // Attacking without the ball
  if (holder.team === c.team) {
    if (c.isDefensive) {
      // Low pointers clear a path: drive into the defender closest to the carrier's route.
      const d = nearest(opps.filter(o => (o.x - holder.x) * dir > -1), holder.x + dir * 2, holder.y);
      if (d && dist(d, holder.x, holder.y) < 7) return steer(c, d.x, d.y, 0, true);
    }
    const lanes = [W * 0.22, W * 0.5, W * 0.78];
    const lane = lanes[m.team(c.team).indexOf(c) % 3];
    const tx = clampX(holder.x + dir * 4.5, c.team, m);
    return steer(c, tx, lane, 1.2);
  }

  // Defending
  const chaser = nearest(m.team(c.team), holder.x, holder.y);
  if (chaser === c) return steer(c, holder.x + holder.vx * 0.4, holder.y + holder.vy * 0.4, 0, true);
  // Mark an attacker: sit between them and our goal.
  const attackers = m.team(holder.team).filter(o => o !== holder);
  const myIdx = m.team(c.team).filter(o => o !== chaser).indexOf(c);
  const mark = attackers[myIdx % attackers.length];
  const og = m.ownGoalX(c.team);
  return steer(c, mark.x + (og - mark.x) * 0.25, mark.y + (W / 2 - mark.y) * 0.2, 0.6);
}

function steer(c: Chair, tx: number, ty: number, arrive: number, ram = false): Controls {
  const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
  const aim = Math.atan2(dy, dx);
  let da = aim - c.heading; da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
  const ctl: Controls = { turn: 0, throttle: 0, aim, push: false, brake: false, pass: false, bounce: false };
  if (d < arrive) { ctl.aim = null; ctl.brake = c.speed > 1; return ctl; }
  ctl.throttle = Math.min(1, d / 2);
  const wantPush = ram ? d < 4 : d > 4;
  ctl.push = wantPush && da < 0.3 && c.stamina > 0.35 && Math.random() < 0.15;
  ctl.brake = !ram && d < 1.5 && c.speed > 2.5;
  return ctl;
}

function nearest(list: Chair[], x: number, y: number): Chair | undefined {
  let best: Chair | undefined, bd = Infinity;
  for (const c of list) { const d = dist(c, x, y); if (d < bd) { bd = d; best = c; } }
  return best;
}
const clampY = (y: number) => Math.max(1, Math.min(COURT.width - 1, y));
function clampX(x: number, team: number, m: Match) {
  const g = m.goalX(team);
  return team === 0 ? Math.min(g - 1.2, x) : Math.max(g + 1.2, x);
}
