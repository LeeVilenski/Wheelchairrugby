import { Chair } from '../entities/chair';
import { Ball } from '../entities/ball';
import { Fx } from '../core/fx';
import { collideChairs } from '../core/physics';
import { COURT } from './court';
import type { Controls } from '../core/input';
import type { TeamDef } from '../data/teams';
import { aiControls } from '../ai/ai';

export const DRIBBLE_LIMIT = 10;   // must bounce or pass within 10 s
const PASS_SPEED = 13;

type State = { kind: 'play' } | { kind: 'dead'; timer: number; then: () => void };

export class Match {
  chairs: Chair[] = [];
  ball = new Ball();
  fx = new Fx();
  score = [0, 0];
  state: State = { kind: 'play' };
  banner: { text: string; sub: string; color: string; life: number } | null = null;
  human!: Chair;
  onShake: (a: number) => void = () => {};

  constructor(public teams: [TeamDef, TeamDef]) {
    teams.forEach((t, ti) => t.players.forEach(p => this.chairs.push(new Chair(0, 0, 0, ti, t, p))));
    this.setHuman(this.team(0)[0]);
    this.tipOff();
  }

  team(t: number) { return this.chairs.filter(c => c.team === t); }
  /** Team 0 attacks the right-hand goal (x = L), team 1 the left (x = 0). */
  goalX(team: number) { return team === 0 ? COURT.length : 0; }
  ownGoalX(team: number) { return this.goalX(1 - team); }
  attackDir(team: number) { return team === 0 ? 1 : -1; }

  setHuman(c: Chair) {
    if (this.human) this.human.human = false;
    this.human = c; c.human = true;
  }

  tipOff() {
    const L = COURT.length, W = COURT.width, mid = L / 2;
    const ys = [W / 2, W / 2 - 3.5, W / 2 + 3.5, W / 2];
    for (const t of [0, 1]) {
      const dir = this.attackDir(t);
      this.team(t).forEach((c, i) => {
        c.x = mid - dir * (i === 0 ? 1.4 : i === 3 ? 7 : 3.5);
        c.y = ys[i];
        c.heading = dir > 0 ? 0 : Math.PI;
        c.vx = c.vy = 0; c.holdTime = 0;
      });
    }
    Object.assign(this.ball, { x: mid, y: W / 2, z: 2.6, vx: 0, vy: 0, vz: 3, holder: null, lockTime: 0 });
    this.showBanner('TIP-OFF', '', '#fff');
  }

  /** Inbound for `team` from its own back line after conceding. */
  kickoff(team: number) {
    const W = COURT.width, dir = this.attackDir(team), back = this.ownGoalX(team);
    this.team(team).forEach((c, i) => {
      c.x = back + dir * [0.8, 4, 4, 6.5][i]; c.y = [W / 2, W / 2 - 3, W / 2 + 3, W / 2][i];
      c.heading = dir > 0 ? 0 : Math.PI; c.vx = c.vy = 0;
    });
    this.team(1 - team).forEach((c, i) => {
      c.x = COURT.length / 2 + dir * [-1, 1, 1, 4][i]; c.y = [W / 2, W / 2 - 3.5, W / 2 + 3.5, W / 2][i];
      c.heading = dir > 0 ? Math.PI : 0; c.vx = c.vy = 0;
    });
    this.give(this.team(team)[0]);
  }

  give(c: Chair) {
    this.ball.holder = c;
    c.holdTime = 0;
    if (c.team === this.human.team) this.setHuman(c);
  }

  showBanner(text: string, sub: string, color: string, life = 1.6) { this.banner = { text, sub, color, life }; }

  deadBall(seconds: number, then: () => void) { this.state = { kind: 'dead', timer: seconds, then }; }

  turnover(toTeam: number, reason: string, x: number, y: number) {
    const ball = this.ball;
    ball.holder = null; ball.vx = ball.vy = ball.vz = 0;
    this.showBanner('TURNOVER', reason, this.teams[toTeam].primary);
    this.deadBall(1.1, () => {
      // Nearest player of the new team inbounds from the point the ball went dead.
      const ix = Math.max(0.4, Math.min(COURT.length - 0.4, x)), iy = Math.max(0.4, Math.min(COURT.width - 0.4, y));
      const taker = this.team(toTeam).sort((a, b) => dist(a, ix, iy) - dist(b, ix, iy))[0];
      taker.x = ix; taker.y = iy; taker.vx = taker.vy = 0;
      taker.heading = Math.atan2(COURT.width / 2 - iy, this.goalX(toTeam) - ix);
      for (const c of this.team(1 - toTeam)) if (dist(c, ix, iy) < 2) { // give inbounder space
        const a = Math.atan2(c.y - iy, c.x - ix); c.x = ix + Math.cos(a) * 2; c.y = iy + Math.sin(a) * 2;
      }
      this.give(taker);
    });
  }

  pass(from: Chair, aim: number) {
    const ball = this.ball;
    // Pick the teammate best lined up with the aim direction.
    let best: Chair | null = null, bestScore = Infinity;
    for (const m of this.team(from.team)) {
      if (m === from) continue;
      const d = dist(m, from.x, from.y);
      let da = Math.atan2(m.y - from.y, m.x - from.x) - aim;
      da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
      if (da > 1.0 || d > 18) continue;
      const s = da * 6 + d * 0.15;
      if (s < bestScore) { bestScore = s; best = m; }
    }
    let tx: number, ty: number;
    if (best) {
      const t = dist(best, from.x, from.y) / PASS_SPEED;
      tx = best.x + best.vx * t; ty = best.y + best.vy * t;
    } else {
      tx = from.x + Math.cos(aim) * 9; ty = from.y + Math.sin(aim) * 9;
    }
    const d = Math.max(0.5, Math.hypot(tx - ball.x, ty - ball.y)), t = d / PASS_SPEED;
    ball.holder = null;
    ball.vx = (tx - ball.x) / t; ball.vy = (ty - ball.y) / t;
    ball.z = 1; ball.vz = 9.8 * t / 2 - 0.3 / t; // land around chest height of the receiver
    ball.lockChair = from; ball.lockTime = 0.35;
    from.holdTime = 0;
  }

  bounce(c: Chair) {
    c.holdTime = 0;
    this.ball.bounceAnim = 0.4;
  }

  update(dt: number, human: Controls) {
    const ball = this.ball;
    this.fx.update(dt);
    if (this.banner && (this.banner.life -= dt) <= 0) this.banner = null;

    if (this.state.kind === 'dead') {
      if ((this.state.timer -= dt) <= 0) { const then = this.state.then; this.state = { kind: 'play' }; then(); }
      for (const c of this.chairs) c.update(dt, { turn: 0, throttle: 0, aim: null, push: false, brake: true, pass: false, bounce: false }, false);
      collideChairs(this.chairs);
      ball.update(dt);
      return;
    }

    // Controls
    for (const c of this.chairs) {
      const ctl = c.human ? human : aiControls(c, this);
      const holding = ball.holder === c;
      c.update(dt, ctl, holding);
      if (holding) {
        c.holdTime += dt;
        if (ctl.pass) this.pass(c, ctl.aim ?? c.heading);
        else if (ctl.bounce) this.bounce(c);
      } else if (c.human && ctl.pass) {
        this.switchHuman();
      }
    }

    // Hits
    for (const h of collideChairs(this.chairs)) {
      if (h.impact < 1.2) continue;
      const big = h.impact > 4;
      this.fx.sparks(h.x, h.y, h.impact);
      this.onShake(h.impact * (big ? 0.08 : 0.03));
      if (h.a.team !== h.b.team) {
        if (big && this.fx.texts.length < 2) this.fx.text(h.x, h.y - 1, pick(['SMASH!', 'BOOM!', 'WRECKED!', 'CRUNCH!']), '#ffe14d', 0.9);
        // A big hit on the ball carrier can knock the ball loose.
        const carrier = ball.holder === h.a ? h.a : ball.holder === h.b ? h.b : null;
        if (carrier && h.impact > 4.2 && Math.random() < 0.45) {
          const s = carrier === h.a ? -1 : 1;
          ball.holder = null;
          ball.vx = carrier.vx + s * h.nx * 3 + (Math.random() - 0.5) * 2;
          ball.vy = carrier.vy + s * h.ny * 3 + (Math.random() - 0.5) * 2;
          ball.vz = 2.5; ball.lockChair = carrier; ball.lockTime = 0.5;
          this.fx.text(carrier.x, carrier.y - 1.4, 'LOOSE BALL!', '#fff', 0.6);
        }
      }
    }

    ball.update(dt);

    // Catch / pick up
    if (!ball.holder && ball.z < 1.7) {
      let best: Chair | null = null, bd = Infinity;
      for (const c of this.chairs) {
        if (c === ball.lockChair && ball.lockTime > 0) continue;
        const d = dist(c, ball.x, ball.y);
        if (d < c.catchRadius && d < bd) { bd = d; best = c; }
      }
      if (best) {
        const flying = Math.hypot(ball.vx, ball.vy) > 6;
        const lastTeam = ball.lockChair?.team;
        this.give(best);
        if (flying && lastTeam !== undefined && lastTeam !== best.team) this.fx.text(best.x, best.y - 1.2, 'PICKED OFF!', '#7dd3fc', 0.7);
      }
    }

    const h = ball.holder;
    if (h) {
      // Scoring: carrier crosses the opponent's goal line between the cones.
      const gx = this.goalX(h.team), ky = (COURT.width - COURT.keyWidth) / 2;
      const crossed = h.team === 0 ? h.x > gx + 0.1 : h.x < gx - 0.1;
      if (crossed && h.y > ky && h.y < ky + COURT.keyWidth) return this.goal(h);
      const o = 0.35; // centre well past the line ≈ two wheels out
      if (h.x < -o || h.x > COURT.length + o || h.y < -o || h.y > COURT.width + o) return this.turnover(1 - h.team, 'Out of bounds', h.x, h.y);
      if (h.holdTime > DRIBBLE_LIMIT) return this.turnover(1 - h.team, '10-second violation', h.x, h.y);
    } else if (ball.z < 0.3 && (ball.x < 0 || ball.x > COURT.length || ball.y < 0 || ball.y > COURT.width)) {
      // Last team to touch loses it.
      const last = ball.lockChair?.team ?? 0;
      return this.turnover(1 - last, 'Ball out', ball.x, ball.y);
    }
  }

  switchHuman() {
    const b = this.ball;
    const mates = this.team(this.human.team).filter(c => c !== this.human);
    mates.sort((a, c) => dist(a, b.x, b.y) - dist(c, b.x, b.y));
    if (mates[0]) this.setHuman(mates[0]);
  }

  goal(scorer: Chair) {
    this.score[scorer.team]++;
    const t = this.teams[scorer.team];
    this.fx.confetti(scorer.x, scorer.y, [t.primary, t.secondary, '#fff']);
    this.onShake(0.5);
    this.showBanner('GOAL!', `#${scorer.def.number} ${scorer.def.name} — ${t.name}`, t.primary, 2.2);
    this.ball.holder = null; this.ball.vx = this.ball.vy = 0;
    this.deadBall(2.2, () => this.kickoff(1 - scorer.team));
  }

  draw(ctx: CanvasRenderingContext2D) {
    const h = this.ball.holder;
    // Dribble clock ring around the carrier
    if (h) {
      const left = 1 - h.holdTime / DRIBBLE_LIMIT;
      ctx.strokeStyle = left > 0.3 ? 'rgba(255,255,255,0.8)' : '#ff4040';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius + 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.stroke();
    }
    for (const c of this.chairs) c.draw(ctx);
    this.ball.draw(ctx);
    this.fx.draw(ctx);
  }
}

export function dist(c: { x: number; y: number }, x: number, y: number) { return Math.hypot(c.x - x, c.y - y); }
function pick<T>(a: T[]) { return a[Math.floor(Math.random() * a.length)]; }
