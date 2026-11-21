import { Match, dist } from './match';
import { COURT } from './court';
import { RULES } from './rules';
import type { TeamDef } from '../data/teams';

/**
 * Training drills: each sets up a small scenario on the court, explains one skill or rule,
 * and checks for success. Clocks are switched off; the drill enforces the rule it teaches.
 */
export interface Drill {
  id: string;
  title: string;
  /** Instructions: keyboard and touch wording. */
  text: { keys: string; touch: string };
  setup(m: Match): void;
  /** Return 'done', 'fail:<reason>', or a progress string to show. */
  check(m: Match, dt: number): string;
  /** Optional world-space overlay (targets, zones). */
  draw?(ctx: CanvasRenderingContext2D, m: Match): void;
}

const L = COURT.length, W = COURT.width;
const OFF = Infinity;
export const TRAINING_RULES = { ...RULES.Arcade, name: 'Arcade' as const, dribbleLimit: OFF, shotClock: OFF, backcourtLimit: OFF,
  attackerKeyLimit: OFF, spinFoulSpeed: OFF, handsFouls: false, tipping: false, periodSeconds: 99999 };

/** Keep only the listed chairs; position them. */
function only(m: Match, keep: { team: number; idx: number; x: number; y: number; frozen?: boolean; heading?: number }[]) {
  const picked = keep.map(k => { const c = m.lineup(k.team)[k.idx]; Object.assign(c, { x: k.x, y: k.y, vx: 0, vy: 0, frozen: !!k.frozen }); if (k.heading !== undefined) c.heading = k.heading; return c; });
  m.chairs = picked;
  m.chairs.forEach(c => { c.heading = c.team === 0 ? 0 : Math.PI; });
  m.state = { kind: 'play' };
  m.banner = null;
}
function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, label = '') {
  ctx.strokeStyle = color; ctx.lineWidth = 0.15;
  ctx.setLineDash([0.4, 0.25]); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  if (label) { ctx.fillStyle = color; ctx.font = '900 0.6px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y); }
}

export const DRILLS: Drill[] = [
  (() => {
    const pts = [[9, 4], [16, 11], [21, 5]];
    let n = 0;
    return {
      id: 'roll', title: '1. Rolling',
      text: { keys: 'Steer with W A S D (or arrows). Roll through the three rings in order.',
        touch: 'Drag on the left half of the screen to steer. Roll through the three rings in order.' },
      setup(m: Match) { n = 0; only(m, [{ team: 0, idx: 0, x: 4, y: W / 2 }]); m.give(m.human); },
      check(m: Match) {
        const h = m.human;
        if (n < 3 && dist(h, pts[n][0], pts[n][1]) < 1.3) { n++; m.sfx('catch'); }
        return n >= 3 ? 'done' : `Rings: ${n} / 3`;
      },
      draw(ctx: CanvasRenderingContext2D) { pts.forEach(([x, y], i) => ring(ctx, x, y, 1.3, i < n ? '#4ade80' : i === n ? '#ffe14d' : 'rgba(255,255,255,0.4)', String(i + 1))); },
    };
  })(),
  (() => {
    let best = 0;
    return {
      id: 'push', title: '2. Push for speed',
      text: { keys: 'Tap SPACE to push: each push is a burst of speed, but costs stamina. Reach 25 km/h.',
        touch: 'Tap PUSH for a burst of speed (it costs stamina). Reach 25 km/h.' },
      setup(m: Match) { best = 0; only(m, [{ team: 0, idx: 0, x: 3, y: W / 2 }]); m.give(m.human); },
      check(m: Match) { best = Math.max(best, m.human.speed * 3.6); return best >= 25 ? 'done' : `Top speed: ${best.toFixed(0)} / 25 km/h`; },
    };
  })(),
  (() => {
    let held = 0, bounces = 0;
    return {
      id: 'bounce', title: '3. The 10-second dribble',
      text: { keys: 'You must bounce (Q) or pass within 10 seconds of getting the ball. Keep the ball for 25 seconds, bouncing at least twice.',
        touch: 'You must BOUNCE or pass within 10 seconds of getting the ball. Keep it for 25 seconds, bouncing at least twice.' },
      setup(m: Match) { held = 0; bounces = 0; only(m, [{ team: 0, idx: 0, x: 8, y: W / 2 }]); m.give(m.human); },
      check(m: Match, dt: number) {
        const h = m.human;
        if (m.ball.holder !== h) { m.give(h); }
        if (m.ball.bounceAnim > 0.38) bounces++;
        held += dt;
        if (h.holdTime > 10) return 'fail:Too slow! The referee calls a 10-second violation. Bounce before the ring runs out.';
        return held >= 25 && bounces >= 2 ? 'done' : `Time: ${held.toFixed(0)} / 25 s · Bounces: ${bounces}${h.holdTime > 7 ? ' · BOUNCE NOW!' : ''}`;
      },
    };
  })(),
  (() => {
    let passes = 0, last: unknown = null;
    return {
      id: 'pass', title: '4. Passing',
      text: { keys: 'Aim with your steering and press E to pass. You take over whoever catches it. Complete 4 passes.',
        touch: 'Steer to aim, then tap PASS. You take over whoever catches it. Complete 4 passes.' },
      setup(m: Match) {
        passes = 0;
        only(m, [{ team: 0, idx: 0, x: 8, y: W / 2 }, { team: 0, idx: 1, x: 14, y: 3.5, frozen: true }, { team: 0, idx: 2, x: 14, y: W - 3.5, frozen: true }]);
        m.give(m.human); last = m.human;
      },
      check(m: Match) {
        const h = m.ball.holder;
        if (h && h !== last) { passes++; last = h; m.chairs.forEach(c => { c.frozen = !c.human; }); }
        if (h) h.holdTime = 0;
        if (!h && m.ball.z <= 0 && Math.hypot(m.ball.vx, m.ball.vy) < 0.3) { m.give(m.human); }
        return passes >= 4 ? 'done' : `Passes: ${passes} / 4`;
      },
    };
  })(),
  {
    id: 'score', title: '5. Scoring',
    text: { keys: 'Carry the ball over the goal line between the orange cones: two wheels over the line counts. Score at the right-hand end.',
      touch: 'Carry the ball over the goal line between the orange cones at the right-hand end.' },
    setup(m: Match) { only(m, [{ team: 0, idx: 0, x: 12, y: W / 2 }]); m.score = [0, 0]; m.give(m.human); },
    check(m: Match) { if (m.ball.holder) m.ball.holder.holdTime = 0; return m.score[0] > 0 ? 'done' : 'Score a goal'; },
    draw(ctx: CanvasRenderingContext2D) { ctx.fillStyle = 'rgba(255,225,77,0.25)'; ctx.fillRect(L - 0.4, (W - COURT.keyWidth) / 2, 0.8, COURT.keyWidth); },
  },
  {
    id: 'defender', title: '6. Beat a defender',
    text: { keys: 'A defender is in the way. Push past or round them and score. Contact is legal, but hits from behind the rear axle (spinning) are fouls.',
      touch: 'A defender is in the way. Push past or round them and score. Hitting a chair from behind the rear axle is a foul.' },
    setup(m: Match) {
      only(m, [{ team: 0, idx: 0, x: 10, y: W / 2 }, { team: 1, idx: 3, x: 22, y: W / 2 }]);
      m.score = [0, 0]; m.skill = [0.6, 0.35]; m.speedMul = [1, 0.85]; m.give(m.human);
    },
    check(m: Match) {
      if (m.ball.holder) m.ball.holder.holdTime = 0;
      if (m.score[0] > 0) return 'done';
      if (m.ball.holder && m.ball.holder.team === 1) return 'fail:The defender won the ball. Try going round them, or push hard past them.';
      return 'Score past the defender';
    },
  },
  {
    id: 'steal', title: '7. Defence',
    text: { keys: 'Now you defend. Win the ball: drive into the carrier from the side or front to knock it loose, or intercept a pass. Use E to switch to the nearest teammate.',
      touch: 'Now you defend. Win the ball: hit the carrier from the side or front to knock it loose, or intercept a pass.' },
    setup(m: Match) {
      // Defender starts goal-side (team 1 attacks toward x = 0), facing the oncoming carrier.
      only(m, [{ team: 0, idx: 0, x: 7, y: W / 2, heading: 0 }, { team: 1, idx: 0, x: 22, y: W / 2, heading: Math.PI }, { team: 1, idx: 1, x: 24, y: 3, heading: Math.PI }]);
      m.score = [0, 0]; m.skill = [0.6, 0.3]; m.speedMul = [1, 0.8];
      m.rules = { ...m.rules, handsFouls: false };
      m.give(m.lineup(1)[0]);
    },
    check(m: Match) {
      if (m.ball.holder) m.ball.holder.holdTime = 0;
      if (m.ball.holder?.team === 0) return 'done';
      if (m.score[1] > 0) return 'fail:They scored. Get between the carrier and your goal, then hit from the front.';
      return 'Win the ball';
    },
  },
  {
    id: 'hype', title: '8. Hype',
    text: { keys: 'Your Hype meter is full. Press F to unleash 6 seconds of extra speed and power, then score.',
      touch: 'Your Hype meter is full. Tap 🔥 to unleash 6 seconds of extra speed and power, then score.' },
    setup(m: Match) {
      only(m, [{ team: 0, idx: 0, x: 6, y: W / 2 }, { team: 1, idx: 3, x: 20, y: W / 2 - 2 }, { team: 1, idx: 2, x: 20, y: W / 2 + 2 }]);
      m.score = [0, 0]; m.hype = [1, 0]; m.hypeTime = [0, 0]; m.skill = [0.6, 0.4]; m.speedMul = [1, 0.85]; m.give(m.human);
    },
    check(m: Match) {
      if (m.ball.holder) m.ball.holder.holdTime = 0;
      if (m.score[0] > 0) return m.hypeTime[0] > 0 || m.hype[0] < 1 ? 'done' : 'fail:You scored, but use HYPE first this time!';
      if (m.ball.holder?.team === 1) return 'fail:They won the ball. Use HYPE to blast through.';
      return m.hypeTime[0] > 0 ? 'HYPE! Now score!' : 'Activate HYPE';
    },
  },
];

const KEY = 'mb.training';
export function completedDrills(): string[] { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
export function markDone(id: string) { try { const d = new Set(completedDrills()); d.add(id); localStorage.setItem(KEY, JSON.stringify([...d])); } catch { /* ignore */ } }

export function trainingMatch(team: TeamDef, sparring: TeamDef) {
  const m = new Match([team, sparring], TRAINING_RULES);
  m.autoSubs = [false, false];
  return m;
}
