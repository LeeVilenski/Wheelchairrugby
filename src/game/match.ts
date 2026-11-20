import { Chair } from '../entities/chair';
import { Ball } from '../entities/ball';
import { Fx } from '../core/fx';
import { collideChairs, type HitEvent } from '../core/physics';
import { COURT } from './court';
import { IDLE, type Controls } from '../core/input';
import type { TeamDef } from '../data/teams';
import { aiControls } from '../ai/ai';
import { RULES, type RuleSet } from './rules';

const PASS_SPEED = 13;
const BRAKED: Controls = { ...IDLE, brake: true };

type State = { kind: 'play' } | { kind: 'dead'; timer: number; then: () => void } | { kind: 'over' };

export class Match {
  chairs: Chair[] = [];
  ball = new Ball();
  fx = new Fx();
  score = [0, 0];
  state: State = { kind: 'play' };
  banner: { text: string; sub: string; color: string; life: number } | null = null;
  human!: Chair;
  onShake: (a: number) => void = () => {};

  rules: RuleSet = RULES.Arcade;
  period = 1;               // 1-4, 5+ = overtime
  clock = 0;                // seconds left in the period
  possTeam = -1;            // team in possession (kept while the ball is loose)
  shotClock = 0;
  backcourtClock = 0;
  crossedHalf = false;
  fouls = [0, 0];

  constructor(public teams: [TeamDef, TeamDef]) {
    teams.forEach((t, ti) => t.players.forEach(p => this.chairs.push(new Chair(0, 0, 0, ti, t, p))));
    this.setHuman(this.team(0)[0]);
    this.newGame();
  }

  setRules(r: RuleSet) { this.rules = r; this.newGame(); }

  newGame() {
    this.score = [0, 0]; this.fouls = [0, 0];
    this.period = 1; this.clock = this.rules.quarterSeconds;
    for (const c of this.chairs) { c.penalty = 0; c.stamina = 1; }
    this.state = { kind: 'play' };
    this.tipOff();
  }

  /** On-court players of a team (excludes the penalty box). */
  team(t: number) { return this.chairs.filter(c => c.team === t && c.penalty <= 0); }
  goalX(team: number) { return team === 0 ? COURT.length : 0; }
  ownGoalX(team: number) { return this.goalX(1 - team); }
  attackDir(team: number) { return team === 0 ? 1 : -1; }
  get onCourt() { return this.chairs.filter(c => c.penalty <= 0); }

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
    this.possTeam = -1;
    this.showBanner('TIP-OFF', '', '#fff');
  }

  /** Inbound for `team` from its own back line. */
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
    if (c.team !== this.possTeam) this.newPossession(c.team);
    if (c.team === this.human.team) this.setHuman(c);
  }

  newPossession(team: number) {
    this.possTeam = team;
    this.shotClock = this.rules.shotClock;
    this.backcourtClock = this.rules.backcourtLimit;
    this.crossedHalf = false;
  }

  showBanner(text: string, sub: string, color: string, life = 1.6) { this.banner = { text, sub, color, life }; }
  deadBall(seconds: number, then: () => void) { this.state = { kind: 'dead', timer: seconds, then }; }

  turnover(toTeam: number, reason: string, x: number, y: number) {
    const ball = this.ball;
    ball.holder = null; ball.vx = ball.vy = ball.vz = 0;
    this.showBanner('TURNOVER', reason, this.teams[toTeam].primary);
    this.deadBall(1.3, () => {
      const ix = Math.max(0.4, Math.min(COURT.length - 0.4, x)), iy = Math.max(0.4, Math.min(COURT.width - 0.4, y));
      const taker = this.team(toTeam).sort((a, b) => dist(a, ix, iy) - dist(b, ix, iy))[0];
      taker.x = ix; taker.y = iy; taker.vx = taker.vy = 0;
      taker.heading = Math.atan2(COURT.width / 2 - iy, this.goalX(toTeam) - ix);
      for (const c of this.team(1 - toTeam)) if (dist(c, ix, iy) < 2) {
        const a = Math.atan2(c.y - iy, c.x - ix); c.x = ix + Math.cos(a) * 2; c.y = iy + Math.sin(a) * 2;
      }
      this.possTeam = -1; // force a fresh possession (and clocks) for the inbounding team
      this.give(taker);
    });
  }

  /** Offensive foul = turnover; defensive foul = penalty box. */
  foul(c: Chair, what: string) {
    this.fouls[c.team]++;
    const t = this.teams[c.team];
    this.fx.text(c.x, c.y - 1.3, 'FOUL!', '#ff4040', 0.8);
    if (c.team === this.possTeam) return this.turnover(1 - c.team, `Offensive foul: ${what} (#${c.def.number})`, c.x, c.y);
    // Defensive foul: player sits out; play restarts with the attacking team in possession where it is.
    c.penalty = this.rules.penaltySeconds;
    const slot = this.chairs.filter(o => o.penalty > 0 && o.team === c.team).length;
    c.x = COURT.length / 2 + (c.team === 0 ? -1.2 : 1.2) * slot; c.y = COURT.width + 1.0;
    c.vx = c.vy = 0; c.heading = -Math.PI / 2; c.keyTime = 0; c.inOwnKey = false;
    if (this.ball.holder === c) this.ball.holder = null;
    if (c.human) this.switchHuman(true);
    this.showBanner('PENALTY', `${what} — #${c.def.number} ${c.def.name} (${t.short}) to the box`, '#ff4040', 2);
    const ball = this.ball, att = 1 - c.team;
    const carrier = ball.holder && ball.holder.team === att ? ball.holder : null;
    const x = carrier?.x ?? ball.x, y = carrier?.y ?? ball.y;
    ball.holder = null;
    this.deadBall(1.6, () => {
      const ix = Math.max(0.4, Math.min(COURT.length - 0.4, x)), iy = Math.max(0.4, Math.min(COURT.width - 0.4, y));
      const taker = carrier && carrier.penalty <= 0 ? carrier : this.team(att).sort((a, b) => dist(a, ix, iy) - dist(b, ix, iy))[0];
      taker.x = ix; taker.y = iy; taker.vx = taker.vy = 0;
      const keepClocks = this.possTeam === att;
      this.give(taker);
      if (!keepClocks) this.newPossession(att);
    });
  }

  releasePenalties(team: number, all: boolean) {
    for (const c of this.chairs) if (c.team === team && c.penalty > 0 && (all || c.penalty <= 0.0001)) {
      c.penalty = 0;
      c.x = COURT.length / 2 + (team === 0 ? -1 : 1); c.y = COURT.width - 0.8;
      c.heading = team === 0 ? 0 : Math.PI;
      this.fx.text(c.x, c.y - 1, 'BACK IN!', '#fff', 0.6);
    }
  }

  pass(from: Chair, aim: number) {
    const ball = this.ball;
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
    ball.z = 1; ball.vz = 9.8 * t / 2 - 0.3 / t;
    ball.lockChair = from; ball.lockTime = 0.35;
    from.holdTime = 0;
  }

  bounce(c: Chair) { c.holdTime = 0; this.ball.bounceAnim = 0.4; }

  update(dt: number, human: Controls) {
    const ball = this.ball;
    this.fx.update(dt);
    if (this.banner && (this.banner.life -= dt) <= 0) this.banner = null;
    if (this.state.kind === 'over') return;

    if (this.state.kind === 'dead') {
      if ((this.state.timer -= dt) <= 0) { const then = this.state.then; this.state = { kind: 'play' }; then(); }
      for (const c of this.onCourt) c.update(dt, BRAKED, false);
      collideChairs(this.onCourt);
      ball.update(dt);
      return;
    }

    // --- Clocks (only run while the ball is live) ---
    this.clock -= dt;
    for (const c of this.chairs) if (c.penalty > 0) {
      c.penalty -= dt;
      if (c.penalty <= 0) { c.penalty = 0.00001; this.releasePenalties(c.team, false); }
    }
    if (this.clock <= 0) return this.endPeriod();

    for (const c of this.onCourt) {
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

    for (const h of collideChairs(this.onCourt)) if (this.onHit(h)) return;

    ball.update(dt);
    this.checkCatch();
    this.refereePossession(dt);
  }

  /** Returns true if the hit stopped play. */
  private onHit(h: HitEvent): boolean {
    const ball = this.ball;
    if (h.impact < 1.2) return false;
    const big = h.impact > 4;
    this.fx.sparks(h.x, h.y, h.impact);
    this.onShake(h.impact * (big ? 0.08 : 0.03));
    if (h.a.team === h.b.team) return false;

    // Spinning: contact behind the rear axle of the victim.
    const [hitter, victim, hs, toHitterX, toHitterY] = h.aSpeed >= h.bSpeed
      ? [h.a, h.b, h.aSpeed, -h.nx, -h.ny] : [h.b, h.a, h.bSpeed, h.nx, h.ny];
    const facing = Math.cos(victim.heading) * toHitterX + Math.sin(victim.heading) * toHitterY;
    if (facing < -0.75 && hs > this.rules.spinFoulSpeed && victim.speed < hs * 0.6) {
      this.foul(hitter, 'Spinning');
      return true;
    }

    if (big && this.fx.texts.length < 2) this.fx.text(h.x, h.y - 1, pick(['SMASH!', 'BOOM!', 'WRECKED!', 'CRUNCH!']), '#ffe14d', 0.9);
    const carrier = ball.holder === h.a ? h.a : ball.holder === h.b ? h.b : null;
    if (carrier && h.impact > 4.2 && Math.random() < 0.45) {
      const s = carrier === h.a ? -1 : 1;
      ball.holder = null;
      ball.vx = carrier.vx + s * h.nx * 3 + (Math.random() - 0.5) * 2;
      ball.vy = carrier.vy + s * h.ny * 3 + (Math.random() - 0.5) * 2;
      ball.vz = 2.5; ball.lockChair = carrier; ball.lockTime = 0.5;
      this.fx.text(carrier.x, carrier.y - 1.4, 'LOOSE BALL!', '#fff', 0.6);
    }
    return false;
  }

  private checkCatch() {
    const ball = this.ball;
    if (ball.holder || ball.z >= 1.7) return;
    let best: Chair | null = null, bd = Infinity;
    for (const c of this.onCourt) {
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

  private refereePossession(dt: number) {
    const ball = this.ball, h = ball.holder, R = this.rules;
    const pt = this.possTeam;

    // Possession clocks keep running through loose balls.
    if (pt >= 0) {
      this.shotClock -= dt;
      const bx = h ? h.x : ball.x;
      if (!this.crossedHalf) {
        this.backcourtClock -= dt;
        if ((bx - COURT.length / 2) * this.attackDir(pt) > 0 && (!!h || ball.z < 0.5)) this.crossedHalf = true;
      }
      if (this.shotClock <= 0) return this.turnover(1 - pt, '40-second violation', ball.x, ball.y);
      if (!this.crossedHalf && this.backcourtClock <= 0) return this.turnover(1 - pt, '12-second violation', ball.x, ball.y);
    }

    // Key rules
    for (const c of this.onCourt) {
      const inOpp = inKey(c, this.goalX(c.team)), inOwn = inKey(c, this.ownGoalX(c.team));
      c.keyTime = inOpp && pt === c.team ? c.keyTime + dt : 0;
      if (c.keyTime > R.attackerKeyLimit) return this.turnover(1 - c.team, `Key violation: 10 s in the key (#${c.def.number})`, c.x, c.y);
      if (inOwn && !c.inOwnKey) c.keyEnteredAt = performance.now();
      c.inOwnKey = inOwn;
    }
    for (const t of [0, 1]) {
      const inside = this.team(t).filter(c => c.inOwnKey);
      if (inside.length > R.maxDefendersInKey && pt === 1 - t) {
        const last = inside.sort((a, b) => b.keyEnteredAt - a.keyEnteredAt)[0];
        return this.foul(last, 'Four in the key');
      }
    }

    if (h) {
      const gx = this.goalX(h.team), ky = (COURT.width - COURT.keyWidth) / 2;
      const crossed = h.team === 0 ? h.x > gx + 0.1 : h.x < gx - 0.1;
      if (crossed && h.y > ky && h.y < ky + COURT.keyWidth) return this.goal(h);
      const o = 0.35;
      if (h.x < -o || h.x > COURT.length + o || h.y < -o || h.y > COURT.width + o) return this.turnover(1 - h.team, 'Out of bounds', h.x, h.y);
      if (h.holdTime > R.dribbleLimit) return this.turnover(1 - h.team, '10-second dribble violation', h.x, h.y);
    } else if (ball.z < 0.3 && (ball.x < 0 || ball.x > COURT.length || ball.y < 0 || ball.y > COURT.width)) {
      const last = ball.lockChair?.team ?? 0;
      return this.turnover(1 - last, 'Ball out', ball.x, ball.y);
    }
  }

  private endPeriod() {
    this.clock = 0;
    this.ball.holder = null;
    const [a, b] = this.score, T = this.teams;
    if (this.period >= 4 && a !== b) {
      const w = a > b ? 0 : 1;
      this.showBanner('FULL TIME', `${T[w].name} win ${Math.max(a, b)}–${Math.min(a, b)}`, T[w].primary, 6);
      this.state = { kind: 'over' };
      setTimeout(() => this.newGame(), 6000);
      return;
    }
    const label = this.period >= 4 ? 'OVERTIME!' : this.period === 2 ? 'HALF TIME' : `END OF Q${this.period}`;
    this.showBanner(label, `${T[0].short} ${a} – ${b} ${T[1].short}`, '#fff', 2.5);
    this.deadBall(2.5, () => {
      this.period++;
      this.clock = this.period > 4 ? this.rules.overtimeSeconds : this.rules.quarterSeconds;
      for (const c of this.chairs) c.stamina = Math.min(1, c.stamina + 0.4);
      this.possTeam = -1;
      this.kickoff((this.period + 1) % 2); // alternate possession each period
    });
  }

  switchHuman(_force = false) {
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
    this.deadBall(2.2, () => {
      this.releasePenalties(1 - scorer.team, true); // a goal frees the conceding team's penalised players
      this.possTeam = -1;
      this.kickoff(1 - scorer.team);
    });
  }

  draw(ctx: CanvasRenderingContext2D) {
    const h = this.ball.holder;
    if (h) {
      const left = 1 - h.holdTime / this.rules.dribbleLimit;
      ctx.strokeStyle = left > 0.3 ? 'rgba(255,255,255,0.8)' : '#ff4040';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius + 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.stroke();
    }
    // Attacker key timers
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const c of this.onCourt) if (c.keyTime > 5) {
      ctx.fillStyle = '#ff4040'; ctx.font = '900 0.45px system-ui';
      ctx.fillText(`KEY ${Math.ceil(this.rules.attackerKeyLimit - c.keyTime)}`, c.x, c.y + c.radius + 0.4);
    }
    for (const c of this.chairs) c.draw(ctx);
    // Penalty box labels
    for (const c of this.chairs) if (c.penalty > 0) {
      ctx.fillStyle = '#ff4040'; ctx.font = '800 0.4px system-ui';
      ctx.fillText(`${Math.ceil(c.penalty)}s`, c.x, c.y + c.radius + 0.3);
    }
    this.ball.draw(ctx);
    this.fx.draw(ctx);
  }
}

export function inKey(c: { x: number; y: number; radius: number }, goalX: number) {
  const ky = (COURT.width - COURT.keyWidth) / 2;
  const dx = Math.abs(c.x - goalX);
  return dx < COURT.keyDepth + c.radius * 0.5 && c.y > ky - c.radius * 0.5 && c.y < ky + COURT.keyWidth + c.radius * 0.5
    && (goalX === 0 ? c.x > -0.5 : c.x < COURT.length + 0.5);
}
export function dist(c: { x: number; y: number }, x: number, y: number) { return Math.hypot(c.x - x, c.y - y); }
function pick<T>(a: T[]) { return a[Math.floor(Math.random() * a.length)]; }
