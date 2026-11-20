import type { Chair } from '../entities/chair';
import type { Controls } from '../core/input';
import { COURT } from '../game/court';
import { dist, inKey, type Match } from '../game/match';

/**
 * Team AI. Each team picks a defensive scheme per possession:
 *  - press: full-court man-marking with a chaser on the ball carrier
 *  - trap:  fall back and wall off the key (cone guards + key anchor), chaser harasses
 * On offence, low pointers set picks, high pointers spread wide or flood the goal line,
 * and the carrier looks for an open teammate nearer the goal (give-and-go).
 *
 * Skill (0..1) controls reaction time, pass accuracy and decision quality.
 */
export type Scheme = 'press' | 'trap';

const W = COURT.width;

export function aiControls(c: Chair, m: Match): Controls {
  const skill = m.skill[c.team];
  // Reaction time: re-plan every few frames; lower skill = slower to react.
  c.aiT -= 1 / 60;
  if (c.aiCtl && c.aiT > 0 && m.ball.holder !== c) return { ...c.aiCtl, push: false, pass: false, bounce: false, hype: false };
  c.aiT = 0.05 + (1 - skill) * 0.3;
  const ctl = think(c, m, skill);
  c.aiCtl = ctl;
  return ctl;
}

function think(c: Chair, m: Match, skill: number): Controls {
  const ball = m.ball, holder = ball.holder;
  const team = m.team(c.team), mates = team.filter(o => o !== c), opps = m.team(1 - c.team);
  const gx = m.goalX(c.team), og = m.ownGoalX(c.team), dir = m.attackDir(c.team);

  // ---------- Ball carrier ----------
  if (holder === c) {
    const pinned = Math.abs(c.x - og) < 2.5;
    const urgent = m.shotClock < 8 || (!m.crossedHalf && m.backcourtClock < 4);
    const ky = (W - COURT.keyWidth) / 2;
    // Aim for the goal between the cones, weaving to shake defenders.
    const aimY = Math.max(ky + 1, Math.min(ky + COURT.keyWidth - 1, W / 2 + Math.sin(c.holdTime * 1.3 + c.def.number) * 2.5));
    const ctl = pinned
      ? steer(c, og + dir * 5, c.y < W / 2 ? 2 : W - 2, 0)
      : steer(c, gx + dir * 0.6, aimY, 0, urgent);
    const near = nearest(opps, c.x, c.y);
    const nearD = near ? dist(near, c.x, c.y) : 99;
    const toGoal = Math.abs(gx - c.x);
    const ahead = near && (near.x - c.x) * dir > -0.5;

    if (c.holdTime > 6 + skill * 2.5 + Math.random()) { ctl.bounce = true; return ctl; }

    const threatened = nearD < 2.4 && ahead;
    if ((threatened && toGoal > 2.5) || c.holdTime > 8.8) {
      // Score each teammate: open, closer to goal, and a clean passing lane.
      let best: Chair | null = null, bestScore = 0.5;
      for (const o of mates) {
        const marker = nearest(opps, o.x, o.y), space = marker ? dist(marker, o.x, o.y) : 9;
        const gain = (Math.abs(gx - c.x) - Math.abs(gx - o.x)) / 6;
        const lane = laneClear(c, o, opps) ? 1 : -1.5;
        const s = Math.min(space, 4) / 2 + gain + lane - dist(o, c.x, c.y) / 20;
        if (s > bestScore) { bestScore = s; best = o; }
      }
      if (best && Math.random() < 0.05 + skill * 0.15) {
        const err = (Math.random() - 0.5) * (1 - skill) * 0.5;
        ctl.pass = true; ctl.aim = Math.atan2(best.y - c.y, best.x - c.x) + err;
      }
    }
    return ctl;
  }

  // ---------- Loose ball ----------
  if (!holder) {
    const chasers = team.slice().sort((a, b) => dist(a, ball.x, ball.y) - dist(b, ball.x, ball.y));
    const lead = 0.15 + skill * 0.25;
    if (chasers[0] === c || (skill > 0.7 && chasers[1] === c && dist(c, ball.x, ball.y) < 5))
      return steer(c, ball.x + ball.vx * lead, ball.y + ball.vy * lead, 0, true);
    return steer(c, (ball.x + og) / 2, clampY(c.y), 1.5);
  }

  // ---------- Attacking without the ball ----------
  if (holder.team === c.team) {
    if (c.keyTime > 6) return steer(c, gx - dir * 4, c.y, 0.5);
    const frontcourt = (holder.x - COURT.length / 2) * dir > 0;
    if (c.isDefensive) {
      // Pick: drive into the defender who is closest to the carrier's path to goal.
      const d = nearest(opps.filter(o => (o.x - holder.x) * dir > -1.5), holder.x + dir * 2, holder.y);
      if (d && dist(d, holder.x, holder.y) < 7) return ramTarget(c, d, 0.2);
    }
    const idx = Math.max(0, team.filter(o => o !== holder).indexOf(c));
    if (frontcourt && !c.isDefensive) {
      // Flood the goal line beside the cones: a pass there is a quick score.
      const ky = (W - COURT.keyWidth) / 2;
      const spots = [[gx - dir * 2.5, ky + 1.2], [gx - dir * 2.5, ky + COURT.keyWidth - 1.2], [gx - dir * 4, W / 2]];
      const [sx, sy] = spots[idx % spots.length];
      return steer(c, sx, sy, 0.8);
    }
    if (!frontcourt && opps.some(o => dist(o, holder.x, holder.y) < 2.5)) {
      // Inbound / pressure release: come back to give the carrier a short option.
      const side = idx % 2 ? 1 : -1;
      return steer(c, holder.x + dir * 3, clampY(holder.y + side * 3.5), 1);
    }
    const lanes = [W * 0.2, W * 0.8, W * 0.5];
    return steer(c, clampX(holder.x + dir * 4.5, c.team, m), lanes[idx % 3], 1.2);
  }

  // ---------- Defending ----------
  const scheme = m.scheme[c.team];
  const chaser = nearest(team, holder.x, holder.y);
  if (chaser === c) return ramTarget(c, holder, 0.3 + skill * 0.2);
  const others = team.filter(o => o !== chaser);
  const i = others.indexOf(c);
  const ky = (W - COURT.keyWidth) / 2;
  const keyEdge = og + dir * (COURT.keyDepth + c.radius + 0.4);

  if (scheme === 'trap' || (holder.x - og) * dir < 9) {
    // Wall off the key: two cone guards in front of the key corners, one anchor in the key.
    const spots: [number, number][] = [
      [keyEdge, ky + 1.0],
      [keyEdge, ky + COURT.keyWidth - 1.0],
      [og + dir * 1.0, Math.max(ky + 1, Math.min(ky + COURT.keyWidth - 1, holder.y))],
    ];
    let [tx, ty] = spots[i % spots.length];
    // Shift the wall toward the ball side.
    ty += (holder.y - W / 2) * 0.25;
    // Step up on attackers flooding the goal line.
    const threat = nearest(m.team(holder.team).filter(o => o !== holder && Math.abs(o.x - og) < 5), tx, ty);
    if (threat && dist(threat, tx, ty) < 2.5 && skill > 0.4) { tx = (tx + threat.x) / 2; ty = (ty + threat.y) / 2; }
    return keyLegal(c, m, tx, ty, og, dir);
  }

  // Press: mark a man, goal-side.
  const attackers = m.team(holder.team).filter(o => o !== holder);
  const mark = attackers.length ? attackers[Math.max(0, i) % attackers.length] : holder;
  const tight = 0.15 + (1 - skill) * 0.2;
  const tx = mark.x + (og - mark.x) * tight, ty = mark.y + (W / 2 - mark.y) * 0.15;
  return keyLegal(c, m, tx, ty, og, dir);
}

/** Respect the 3-in-the-key limit: wait just outside if the key is full. */
function keyLegal(c: Chair, m: Match, tx: number, ty: number, og: number, dir: number): Controls {
  const othersInKey = m.team(c.team).filter(o => o !== c && o.inOwnKey).length;
  if (othersInKey >= m.rules.maxDefendersInKey && !c.inOwnKey && inKey({ x: tx, y: ty, radius: c.radius * 2 }, og))
    tx = og + dir * (COURT.keyDepth + c.radius * 2 + 0.3);
  return steer(c, tx, ty, 0.6);
}

function laneClear(a: Chair, b: Chair, opps: Chair[]) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  return !opps.some(o => {
    const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.y - a.y) * dy) / L2));
    return Math.hypot(a.x + dx * t - o.x, a.y + dy * t - o.y) < 1.1;
  });
}

function steer(c: Chair, tx: number, ty: number, arrive: number, ram = false): Controls {
  const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
  const aim = Math.atan2(dy, dx);
  let da = aim - c.heading; da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
  const ctl: Controls = { turn: 0, throttle: 0, aim, push: false, brake: false, pass: false, bounce: false, hype: false };
  if (d < arrive) { ctl.aim = null; ctl.brake = c.speed > 1; return ctl; }
  ctl.throttle = Math.min(1, d / 2);
  const wantPush = ram ? d < 5 : d > 4;
  ctl.push = wantPush && da < 0.3 && c.stamina > 0.35 && Math.random() < 0.5;
  ctl.brake = !ram && d < 1.5 && c.speed > 2.5;
  return ctl;
}

/** Drive into a target, but swing round to hit the side/front: hits behind the rear axle are spinning fouls. */
function ramTarget(c: Chair, t: Chair, lead = 0): Controls {
  const tx = t.x + t.vx * lead, ty = t.y + t.vy * lead;
  const fx = Math.cos(t.heading), fy = Math.sin(t.heading);
  const behind = ((c.x - t.x) * fx + (c.y - t.y) * fy) / Math.max(0.1, dist(c, t.x, t.y));
  if (behind < -0.3) {
    const side = (c.x - t.x) * -fy + (c.y - t.y) * fx >= 0 ? 1 : -1;
    return steer(c, tx - fy * side * 1.6 + fx * 0.8, ty + fx * side * 1.6 + fy * 0.8, 0);
  }
  return steer(c, tx, ty, 0, true);
}

function nearest(list: Chair[], x: number, y: number): Chair | undefined {
  let best: Chair | undefined, bd = Infinity;
  for (const c of list) { const d = dist(c, x, y); if (d < bd) { bd = d; best = c; } }
  return best;
}
const clampY = (y: number) => Math.max(1, Math.min(W - 1, y));
function clampX(x: number, team: number, m: Match) {
  const g = m.goalX(team);
  return team === 0 ? Math.min(g - 1.2, x) : Math.max(g + 1.2, x);
}
