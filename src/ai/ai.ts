import type { Chair } from '../entities/chair';
import type { Controls } from '../core/input';
import { COURT } from '../game/court';
import { dist, inKey, type Match } from '../game/match';

/**
 * Team AI. Each team picks a defensive scheme per possession:
 *  - press: deny passes upfield in the backcourt, on-ball defender cuts off half way
 *  - trap:  wall along half way, low pointers drop to the key early
 * Over half way both schemes become a 3-in-the-key defence (see defend()).
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
    if (m.inbound?.chair === c) {
      // Inbound: hold still, pick an open teammate after a beat (well inside the 8 s).
      const ctl: Controls = { turn: 0, throttle: 0, aim: null, push: false, brake: true, pass: false, bounce: false, hype: false };
      const legal = m.crossedHalf ? mates.filter(o => (o.x - COURT.length / 2) * dir > o.radius + 1.5) : mates;
      const best = legal.slice().sort((a, b) => {
        const sa = Math.min(4, dist(nearest(opps, a.x, a.y) ?? a, a.x, a.y)) - dist(a, c.x, c.y) / 6;
        const sb = Math.min(4, dist(nearest(opps, b.x, b.y) ?? b, b.x, b.y)) - dist(b, c.x, c.y) / 6;
        return sb - sa;
      })[0];
      if (best && (m.inbound.t < 7 - skill * 2 || m.inbound.t < 3)) { ctl.pass = true; ctl.aim = Math.atan2(best.y - c.y, best.x - c.x); }
      return ctl;
    }
    const pinned = Math.abs(c.x - og) < 2.5;
    const urgent = m.shotClock < 8 || (!m.crossedHalf && m.backcourtClock < 4);
    const ky = (W - COURT.keyWidth) / 2;
    // Aim for the goal between the cones, weaving to shake defenders.
    const aimY = Math.max(ky + 1, Math.min(ky + COURT.keyWidth - 1, W / 2 + Math.sin(c.holdTime * 1.3 + c.def.number) * 2.5));
    const ctl = pinned
      ? steer(c, og + dir * 5, c.y < W / 2 ? 2 : W - 2, 0)
      : steer(c, gx + dir * (c.radius + 1), aimY, 0, urgent);
    const near = nearest(opps, c.x, c.y);
    const nearD = near ? dist(near, c.x, c.y) : 99;
    const toGoal = Math.abs(gx - c.x);
    const ahead = near && (near.x - c.x) * dir > -0.5;

    if (c.holdTime > 4.5 + skill * 2 + Math.random()) { ctl.bounce = true; return ctl; }

    const threatened = nearD < 2.4 && ahead;
    if ((threatened && toGoal > 2.5) || c.holdTime > 7) {
      // Score each teammate: open, closer to goal, and a clean passing lane.
      let best: Chair | null = null, bestScore = 0.5;
      for (const o of mates) {
        if (m.crossedHalf && (o.x - COURT.length / 2) * dir < o.radius + 2.5) continue; // no passing back over half way
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
  return defend(c, m, skill, holder, team, og, dir);
}

/**
 * Defence, after wheelchair rugby coaching practice:
 *  1. Ball in the attackers' backcourt: stop it crossing half way. The on-ball defender sits
 *     goal-side of the carrier (between them and half way) instead of chasing from behind;
 *     the rest deny the passing lanes to attackers near half way (press), or form a wall
 *     along the line (trap). Low pointers peel back to the key early.
 *  2. Ball over half way: key defence. The three lowest pointers set up in the key: one at
 *     each cone and a middle player shading to the ball. High pointers sit just outside to
 *     contest the carrier and cut passes to the goal line, stopping the swing across the key.
 */
function defend(c: Chair, m: Match, skill: number, holder: Chair, team: Chair[], og: number, dir: number): Controls {
  const L = COURT.length, mid = L / 2, ky = (W - COURT.keyWidth) / 2, KW = COURT.keyWidth;
  const attackers = m.team(holder.team), others = attackers.filter(o => o !== holder);
  const scheme = m.scheme[c.team];
  // Distance of a point from our goal line, measured up the court.
  const depth = (x: number) => (x - og) * dir;
  const hd = depth(holder.x);
  const backcourt = !m.crossedHalf && hd > mid - 0.5;
  const ballSide = (holder.y - W / 2) / (W / 2); // -1..1

  // Roles: key players = lowest pointers (up to the key limit, leaving at least one out).
  const byCls = team.slice().sort((a, b) => a.cls - b.cls || a.def.number - b.def.number);
  const nKey = Math.min(m.rules.maxDefendersInKey, 3, Math.max(0, team.length - 1));
  const keyCrew = byCls.slice(0, nKey), outside = byCls.slice(nKey).reverse(); // highest first
  // On-ball defender: the nearest outside player, unless a key player is right on top of the carrier.
  let onBall = nearest(outside.length ? outside : team, holder.x, holder.y)!;
  const closest = nearest(team, holder.x, holder.y)!;
  if (dist(closest, holder.x, holder.y) < dist(onBall, holder.x, holder.y) - 4) onBall = closest;

  // Goal-side containment: get between the carrier and where they want to go, then hit from the front.
  const contain = (tx: number) => {
    const d = dist(c, holder.x, holder.y);
    const goalSide = depth(c.x) < hd - 0.3;
    if (goalSide && d < 2.5 + skill) return ramTarget(c, holder, 0.2 + skill * 0.2); // in front: attack
    // Not in front yet: race to a spot ahead of the carrier, lined up on their path.
    const lead = 0.3 + skill * 0.4;
    const px = holder.x + holder.vx * lead, py = holder.y + holder.vy * lead;
    const sx = tx !== undefined ? tx : px - dir * 1.6;
    return steer(c, sx, clampY(py + (W / 2 - py) * 0.15), 0.4, true);
  };

  if (backcourt) {
    if (c === onBall) {
      // Cut the carrier off from half way: sit between them and the line.
      const line = og + dir * (mid + 0.5);
      const tx = (holder.x - line) * dir > -2 ? holder.x - dir * 1.6 : holder.x - dir * Math.min(2.5, Math.abs(holder.x - line) / 2);
      return contain(tx);
    }
    const rest = team.filter(o => o !== onBall);
    // Low pointers not needed up front drop back into the key early (fewer bodies to beat later).
    const dropBack = scheme === 'trap' ? keyCrew.filter(k => k !== onBall).slice(0, 2) : keyCrew.filter(k => k !== onBall).slice(0, team.length >= 5 ? 1 : 0);
    if (dropBack.includes(c)) return keyDefence(c, m, holder, keyCrew.filter(k => dropBack.includes(k) || k === c), og, dir, ballSide);
    const markers = rest.filter(o => !dropBack.includes(o));
    const i = markers.indexOf(c);
    if (scheme === 'press') {
      // Deny: mark the receivers nearest half way, on the ball side of them and a little upfield.
      const targets = others.slice().sort((a, b) => depth(a.x) - depth(b.x)); // most advanced first
      const mark = targets[i % Math.max(1, targets.length)];
      if (mark) {
        const t = 0.3 + skill * 0.2; // fraction of the way from mark toward the ball
        let tx = mark.x + (holder.x - mark.x) * t, ty = mark.y + (holder.y - mark.y) * t;
        tx -= dir * 0.8; // stay half-way side of them
        if (depth(tx) < mid - 6) tx = og + dir * (mid - 6);
        return keyLegal(c, m, tx, clampY(ty), og, dir);
      }
    }
    // Trap: a wall along the defensive side of half way, shifted to the ball.
    const n = Math.max(1, markers.length);
    const span = Math.min(10, 4 + n * 2.5);
    const ty = W / 2 + ballSide * 2.5 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * span);
    return steer(c, og + dir * (mid - 1.8), clampY(ty), 0.6);
  }

  // ---------- Over half way: key defence ----------
  if (keyCrew.includes(c) && c !== onBall) return keyDefence(c, m, holder, keyCrew.filter(k => k !== onBall), og, dir, ballSide);
  if (c === onBall) {
    // Close to goal: everyone's job is to stop the carrier; further out, contain and wait for help.
    return contain(hd < 6 ? holder.x - dir * 1.2 : holder.x - dir * 1.8);
  }
  // Other outside players: cut the pass to the most dangerous open attacker (nearest the goal line),
  // standing just outside the key between them and the ball.
  const free = outside.filter(o => o !== onBall);
  const i = free.indexOf(c);
  const threats = others.slice().sort((a, b) => depth(a.x) - depth(b.x));
  const t = threats[i % Math.max(1, threats.length)];
  if (t) {
    let tx = t.x + (holder.x - t.x) * 0.4, ty = t.y + (holder.y - t.y) * 0.4;
    tx = og + dir * Math.max(COURT.keyDepth + c.radius + 0.4, depth(tx) - 0.6); // goal-side, outside the key
    return keyLegal(c, m, tx, clampY(ty), og, dir);
  }
  return keyLegal(c, m, og + dir * (COURT.keyDepth + 2.5), W / 2 + ballSide * 2, og, dir);
}

/** Key players: one on each cone and one in the middle, the whole line shading toward the ball. */
function keyDefence(c: Chair, m: Match, holder: Chair, crew: Chair[], og: number, dir: number, ballSide: number): Controls {
  const ky = (W - COURT.keyWidth) / 2, KW = COURT.keyWidth;
  const spots: [number, number][] = crew.length >= 3
    ? [[0.9, ky + 1.0], [1.1, W / 2], [0.9, ky + KW - 1.0]]
    : crew.length === 2 ? [[1.0, ky + 2.0], [1.0, ky + KW - 2.0]] : [[1.0, W / 2]];
  // Assign spots by lateral position so players don't cross each other.
  const order = crew.slice().sort((a, b) => a.y - b.y);
  const i = Math.max(0, order.indexOf(c));
  let [dx, ty] = spots[Math.min(i, spots.length - 1)];
  ty += ballSide * 1.2;
  // Carrier attacking the key: the nearest key player steps up to meet them in front of the line.
  const hd = (holder.x - og) * dir;
  if (hd < 4 && nearest(crew, holder.x, holder.y) === c) {
    dx = Math.max(0.6, Math.min(COURT.keyDepth - 0.2, hd - 1.0));
    ty = holder.y + (ty - holder.y) * 0.3;
  }
  ty = Math.max(ky + 0.6, Math.min(ky + KW - 0.6, ty));
  return keyLegal(c, m, og + dir * dx, ty, og, dir);
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
