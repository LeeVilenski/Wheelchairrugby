import { Chair } from '../entities/chair';
import { Ball } from '../entities/ball';
import { Fx } from '../core/fx';
import { collideChairs, type HitEvent } from '../core/physics';
import { COURT } from './court';
import { IDLE, type Controls } from '../core/input';
import { autoLineup, validLineup, type Format, type PlayerDef, type TeamDef } from '../data/teams';
import { aiControls, type Scheme } from '../ai/ai';
import type { SfxName } from '../core/audio';
import { RULES, type RuleSet } from './rules';

const PASS_SPEED = 13;
const BRAKED: Controls = { ...IDLE, brake: true };

type State = { kind: 'play' } | { kind: 'dead'; timer: number; then: () => void; stopClock: boolean } | { kind: 'over' };

export interface PlayerStats { goals: number; hits: number; steals: number; fouls: number; }

export class Match {
  chairs: Chair[] = [];
  ball = new Ball();
  fx = new Fx();
  score = [0, 0];
  state: State = { kind: 'play' };
  banner: { text: string; sub: string; color: string; life: number } | null = null;
  /** People playing: P1 (and optionally P2), the team each controls, and their current chair. */
  players: { team: number; chair: Chair | null }[] = [{ team: 0, chair: null }];
  /** Player 1's chair (the single human in one-player games). */
  get human(): Chair { return this.players[0].chair!; }
  isHumanTeam(t: number) { return !this.demo && this.players.some(p => p.team === t); }
  onShake: (a: number) => void = () => {};

  rules: RuleSet = RULES.Arcade;
  period = 1;               // 1..rules.periods, then overtime
  clock = 0;                // seconds left in the period
  possTeam = -1;            // team in possession (kept while the ball is loose)
  shotClock = 0;
  backcourtClock = 0;
  crossedHalf = false;
  fouls = [0, 0];

  timeouts = [4, 4];
  /** Fives: penalised players waiting off court for a box slot (seconds still to serve). */
  waiting = new Map<PlayerDef, { team: number; secs: number }>();
  stamina = new Map<PlayerDef, number>();     // bench + on-court freshness, by player
  stats = new Map<PlayerDef, PlayerStats>();
  turnovers = [0, 0];
  demo = false;
  skill = [0.6, 0.6];                         // AI quality per team (0..1)
  speedMul = [1, 1];                          // difficulty handicap per team
  scheme: [Scheme, Scheme] = ['press', 'trap'];                                // attract mode: CPU plays both sides
  autoSubs = [true, true];                     // CPU manages substitutions for that team
  onFullTime: () => void = () => {};
  sfx: (name: SfxName, v?: number) => void = () => {};

  // --- Arcade juice ---
  hype = [0, 0];            // 0..1 charge per team
  hypeTime = [0, 0];        // seconds of HYPE left
  streak = { team: -1, n: 0 };
  onFire = [false, false];  // 3 goals in a row until the other team scores
  slowmo = 0;               // real seconds of slow motion left
  slowScale = 1;
  chain = { team: -1, n: 0, t: 0 };
  private hitSoundGap = 0;
  private stripGap = 0;
  onDeadBall: () => void = () => {};

  constructor(public teams: [TeamDef, TeamDef], rules: RuleSet = RULES.Arcade, mode: '1p' | 'vs' | 'coop' = '1p') {
    this.rules = rules;
    this.players = mode === 'vs' ? [{ team: 0, chair: null }, { team: 1, chair: null }]
      : mode === 'coop' ? [{ team: 0, chair: null }, { team: 0, chair: null }] : [{ team: 0, chair: null }];
    this.newGame();
  }

  newGame() {
    this.chairs = [];
    this.stamina.clear(); this.stats.clear();
    this.teams.forEach((t, ti) => {
      for (const p of t.players) { this.stamina.set(p, 1); this.stats.set(p, { goals: 0, hits: 0, steals: 0, fouls: 0 }); }
      for (const p of autoLineup(t.players, undefined, this.fmt)) this.chairs.push(new Chair(0, 0, 0, ti, t, p));
    });
    this.players.forEach((p, pi) => {
      p.chair = null;
      const free = this.team(p.team).find(c => !c.human);
      if (free) this.setControl(pi, free);
    });
    this.timeouts = [this.rules.timeouts, this.rules.timeouts]; this.turnovers = [0, 0]; this.waiting.clear();
    this.hype = [0, 0]; this.hypeTime = [0, 0]; this.onFire = [false, false]; this.streak = { team: -1, n: 0 };
    this.score = [0, 0]; this.fouls = [0, 0];
    this.period = 1; this.clock = this.rules.periodSeconds;
    for (const c of this.chairs) { c.penalty = 0; c.stamina = 1; }
    this.state = { kind: 'play' };
    this.tipOff();
  }

  get fmt(): Format { return this.rules.format; }
  get periods() { return this.rules.periods; }
  get inOvertime() { return this.period > this.rules.periods; }

  /** On-court players of a team (excludes the penalty box). */
  team(t: number) { return this.chairs.filter(c => c.team === t && c.penalty <= 0); }
  goalX(team: number) { return team === 0 ? COURT.length : 0; }
  ownGoalX(team: number) { return this.goalX(1 - team); }
  attackDir(team: number) { return team === 0 ? 1 : -1; }
  get onCourt() { return this.chairs.filter(c => c.penalty <= 0); }

  /** Give player `pi` control of chair `c`. */
  setControl(pi: number, c: Chair) {
    const p = this.players[pi], old = p.chair;
    if (old === c) return;
    if (c.human) return; // owned by the other player
    if (old) { old.human = false; old.player = 0; old.tag = ''; }
    p.chair = c; c.human = true; c.player = pi + 1;
    c.tag = this.players.length > 1 ? `P${pi + 1}` : '';
  }
  setHuman(c: Chair) { this.setControl(0, c); }
  playerOf(c: Chair) { return c.player - 1; }

  tipOff() {
    const L = COURT.length, W = COURT.width, mid = L / 2;
    const ys = [W / 2, W / 2 - 3.5, W / 2 + 3.5, W / 2, W / 2 + 5.5];
    const xs = [1.4, 3.5, 3.5, 7, 5.5];
    for (const t of [0, 1]) {
      const dir = this.attackDir(t);
      this.team(t).forEach((c, i) => {
        c.x = mid - dir * xs[i % 5];
        c.y = ys[i % 5];
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
      c.x = back + dir * [0.8, 4, 4, 6.5, 8][i % 5]; c.y = [W / 2, W / 2 - 3, W / 2 + 3, W / 2, W / 2 - 5][i % 5];
      c.heading = dir > 0 ? 0 : Math.PI; c.vx = c.vy = 0;
    });
    this.team(1 - team).forEach((c, i) => {
      c.x = COURT.length / 2 + dir * [-1, 1, 1, 4, 2.5][i % 5]; c.y = [W / 2, W / 2 - 3.5, W / 2 + 3.5, W / 2, W / 2 + 5.5][i % 5];
      c.heading = dir > 0 ? Math.PI : 0; c.vx = c.vy = 0;
    });
    const taker = this.team(team)[0] ?? this.team(1 - team)[0];
    if (taker) this.give(taker);
  }

  give(c: Chair) {
    this.ball.holder = c;
    c.holdTime = 0;
    if (c.team !== this.possTeam) this.newPossession(c.team);
    if (!c.human && this.isHumanTeam(c.team)) {
      // The player who threw the pass follows the ball; otherwise the first player on that team.
      const passer = this.ball.lockChair;
      let pi = passer?.human && passer.team === c.team ? this.playerOf(passer) : this.players.findIndex(p => p.team === c.team);
      if (pi < 0) pi = 0;
      this.setControl(pi, c);
    }
  }

  newPossession(team: number) {
    this.possTeam = team;
    // Defending team picks a scheme: better teams press more when chasing the game late on.
    const d = 1 - team, sk = this.skill[d];
    const behind = this.score[d] < this.score[team], late = this.period >= this.periods && this.clock < 60;
    const pPress = 0.15 + sk * 0.35 + (behind && late ? 0.4 : 0);
    this.scheme[d] = Math.random() < pPress ? 'press' : 'trap';
    this.shotClock = this.rules.shotClock;
    this.backcourtClock = this.rules.backcourtLimit;
    this.crossedHalf = false;
  }

  showBanner(text: string, sub: string, color: string, life = 1.6) { this.banner = { text, sub, color, life }; }
  deadBall(seconds: number, then: () => void, stopClock = false) {
    this.state = { kind: 'dead', timer: seconds, then, stopClock };
    for (const t of [0, 1]) if (this.autoSubs[t]) this.aiSubs(t);
    this.onDeadBall();
  }

  get isDead() { return this.state.kind === 'dead'; }
  bench(team: number) {
    const on = new Set(this.chairs.filter(c => c.team === team).map(c => c.def));
    return this.teams[team].players.filter(p => !on.has(p));
  }
  lineup(team: number) { return this.chairs.filter(c => c.team === team); }
  stat(p: PlayerDef) { return this.stats.get(p)!; }

  /** Swap a chair for a bench player (only at a dead ball). Returns false if illegal. */
  substitute(out: Chair, incoming: PlayerDef): boolean {
    if (!this.isDead) return false;
    return this.swap(out, incoming);
  }

  /** Replace a chair with a bench player if the lineup stays legal (no dead-ball check). */
  private swap(out: Chair, incoming: PlayerDef): boolean {
    if (out.penalty > 0 || this.waiting.has(incoming)) return false;
    const after = this.lineup(out.team).map(c => c === out ? incoming : c.def);
    if (!validLineup(after, this.fmt)) return false;
    this.stamina.set(out.def, out.stamina);
    const c = new Chair(out.x, out.y, out.heading, out.team, out.teamDef, incoming);
    c.stamina = this.stamina.get(incoming) ?? 1;
    this.chairs[this.chairs.indexOf(out)] = c;
    if (this.ball.holder === out) this.ball.holder = c;
    if (out.human) { const pi = this.playerOf(out); out.human = false; out.player = 0; this.players[pi].chair = null; this.setControl(pi, c); }
    return true;
  }

  /** CPU bench management: swap tired players for fresh ones of similar class while staying legal. */
  aiSubs(team: number) {
    for (const out of this.lineup(team)) {
      if (out.stamina > 0.4 || out.penalty > 0) continue;
      const options = this.bench(team)
        .filter(p => (this.stamina.get(p) ?? 1) > 0.75 && !this.waiting.has(p))
        .sort((a, b) => Math.abs(a.cls - out.cls) - Math.abs(b.cls - out.cls));
      for (const p of options) if (this.substitute(out, p)) break;
    }
  }

  addHype(team: number, amt: number) {
    if (this.hypeTime[team] > 0) return;
    const before = this.hype[team];
    this.hype[team] = Math.min(1, before + amt);
    const ctl = this.players.find(p => p.team === team)?.chair;
    if (before < 1 && this.hype[team] >= 1 && ctl && !this.demo) this.fx.text(ctl.x, ctl.y - 1.6, 'HYPE READY!', '#ff8a3d', 0.6);
  }
  useHype(team: number) {
    if (this.hype[team] < 1 || this.hypeTime[team] > 0) return;
    this.hype[team] = 0; this.hypeTime[team] = 6;
    this.fx.shout(`${this.teams[team].short} HYPE TIME!`, '#ff8a3d', true);
    this.fx.flash = 0.6; this.sfx('hype');
  }
  reducedEffects = false;
  onVibrate: (ms: number) => void = () => {};
  slowMotion(seconds: number, scale: number) { if (this.reducedEffects) return; this.slowmo = seconds; this.slowScale = scale; }

  /** Teams may call a timeout with possession of the ball, or at a dead ball. */
  canTimeout(team: number) {
    return this.timeouts[team] > 0 && this.state.kind !== 'over' && (this.isDead || this.ball.holder?.team === team);
  }
  callTimeout(team: number): boolean {
    if (!this.canTimeout(team)) return false;
    this.timeouts[team]--;
    for (const c of this.chairs) c.stamina = Math.min(1, c.stamina + 0.25);
    for (const [p, v] of this.stamina) this.stamina.set(p, Math.min(1, v + 0.15));
    this.showBanner('TIMEOUT', `${this.teams[team].name} (${this.timeouts[team]} left)`, this.teams[team].primary, 1.5);
    // Resume where we were: a live ball becomes a short dead ball so subs are allowed.
    if (this.state.kind === 'play') {
      const holder = this.ball.holder!;
      this.deadBall(1.5, () => { this.give(holder); }, true);
    } else {
      for (const t of [0, 1]) if (this.autoSubs[t]) this.aiSubs(t);
    }
    return true;
  }

  turnover(toTeam: number, reason: string, x: number, y: number) {
    const ball = this.ball;
    this.turnovers[1 - toTeam]++;
    this.sfx('whistle');
    ball.holder = null; ball.vx = ball.vy = ball.vz = 0;
    this.showBanner('TURNOVER', reason, this.teams[toTeam].primary);
    this.deadBall(1.3, () => {
      const ix = Math.max(0.4, Math.min(COURT.length - 0.4, x)), iy = Math.max(0.4, Math.min(COURT.width - 0.4, y));
      const taker = this.team(toTeam).sort((a, b) => dist(a, ix, iy) - dist(b, ix, iy))[0] ?? this.team(1 - toTeam)[0];
      if (!taker) return;
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
    this.stat(c.def).fouls++;
    this.sfx('whistle');
    const t = this.teams[c.team];
    this.fx.text(c.x, c.y - 1.3, 'FOUL!', '#ff4040', 0.8);
    if (c.team === this.possTeam) return this.turnover(1 - c.team, `Offensive foul: ${what} (#${c.def.number})`, c.x, c.y);
    // Fives: max 3 serving at once. A 4th penalised player is substituted and waits off court for a slot.
    const serving = this.chairs.filter(o => o.team === c.team && o.penalty > 0).length;
    if (serving >= this.rules.maxInBox && this.sendToWait(c)) {
      this.showBanner('PENALTY', `${what} — #${c.def.number} ${c.def.name} waits off court (box full), sub comes on`, '#ff4040', 2.2);
      return this.restartAfterFoul(c);
    }
    // Defensive foul: player sits out; play restarts with the attacking team in possession where it is.
    c.penalty = this.rules.penaltySeconds;
    const slot = this.chairs.filter(o => o.penalty > 0 && o.team === c.team).length;
    c.x = COURT.length / 2 + (c.team === 0 ? -1.2 : 1.2) * slot; c.y = COURT.width + 1.0;
    c.vx = c.vy = 0; c.heading = -Math.PI / 2; c.keyTime = 0; c.inOwnKey = false;
    if (this.ball.holder === c) this.ball.holder = null;
    if (c.human) this.switchPlayer(this.playerOf(c));
    this.showBanner('PENALTY', `${what} — #${c.def.number} ${c.def.name} (${t.short}) to the box`, '#ff4040', 2);
    this.restartAfterFoul(c);
  }

  /** Swap a penalised player for a legal bench sub and queue their penalty. */
  private sendToWait(c: Chair): boolean {
    const wasHolder = this.ball.holder === c;
    const options = this.bench(c.team).sort((a, b) => Math.abs(a.cls - c.cls) - Math.abs(b.cls - c.cls));
    const def = c.def, team = c.team;
    for (const p of options) if (this.swap(c, p)) {
      this.waiting.set(def, { team, secs: this.rules.penaltySeconds });
      if (wasHolder) this.ball.holder = null;
      // swap() hands a human player's control to the substitute
      return true;
    }
    return false; // no legal sub: fall back to the normal box
  }

  private restartAfterFoul(c: Chair) {
    const ball = this.ball, att = 1 - c.team;
    const carrier = ball.holder && ball.holder.team === att ? ball.holder : null;
    const x = carrier?.x ?? ball.x, y = carrier?.y ?? ball.y;
    ball.holder = null;
    this.deadBall(1.6, () => {
      const ix = Math.max(0.4, Math.min(COURT.length - 0.4, x)), iy = Math.max(0.4, Math.min(COURT.width - 0.4, y));
      const taker = carrier && carrier.penalty <= 0 ? carrier : this.team(att).sort((a, b) => dist(a, ix, iy) - dist(b, ix, iy))[0];
      if (!taker) return;
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

  update(dt: number, human: Controls | Controls[]) {
    const inputs = Array.isArray(human) ? human : [human];
    const ball = this.ball;
    // Slow motion / hit-stop: real time runs out, game time is scaled.
    if (this.slowmo > 0) { this.slowmo -= dt; dt *= this.slowScale; }
    this.fx.update(dt);
    if (this.banner && (this.banner.life -= dt) <= 0) this.banner = null;
    if (this.state.kind === 'over') return;

    if (this.state.kind === 'dead') {
      // Fives running clock: keeps going through stoppages until the last minutes of the period.
      if (this.rules.runningClock && !this.state.stopClock && this.clock > this.rules.clockStopsLast)
        this.clock = Math.max(this.rules.clockStopsLast, this.clock - dt);
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
    for (const t of [0, 1]) {
      const inBox = this.chairs.filter(o => o.team === t && o.penalty > 0).length;
      const next = [...this.waiting].find(([, w]) => w.team === t);
      if (next && inBox < this.rules.maxInBox && (next[1].secs -= dt) <= 0) this.waiting.delete(next[0]);
    }
    if (this.clock <= 0) return this.endPeriod();
    const on = new Set(this.chairs.map(c => c.def));
    for (const [p, v] of this.stamina) if (!on.has(p)) this.stamina.set(p, Math.min(1, v + 0.04 * dt));
    // CPU teams call a timeout when exhausted and in possession.
    for (const t of [0, 1]) if (this.autoSubs[t] && !this.isHumanTeam(t) && this.canTimeout(t) && this.timeouts[t] > 1) {
      const lu = this.lineup(t);
      if (lu.reduce((s, c) => s + c.stamina, 0) / lu.length < 0.3) { this.callTimeout(t); return; }
    }

    for (const t of [0, 1]) {
      if (this.hypeTime[t] > 0) this.hypeTime[t] -= dt;
      // CPU teams use HYPE on the attack once over half way.
      const h = ball.holder;
      if (!this.isHumanTeam(t) && this.hype[t] >= 1 && h?.team === t && (h.x - COURT.length / 2) * this.attackDir(t) > 0) this.useHype(t);
    }
    if (this.chain.t > 0) this.chain.t -= dt;
    this.hitSoundGap -= dt; this.stripGap -= dt;

    const acted = new Set<number>(); // a player's input drives one chair per step (switching mid-loop must not re-trigger)
    for (const c of this.onCourt) {
      const isHuman = c.human && !this.demo && !acted.has(c.player);
      if (isHuman) acted.add(c.player);
      const ctl = isHuman ? inputs[c.player - 1] ?? IDLE : (c.human && !this.demo) || c.frozen ? BRAKED : aiControls(c, this);
      if (isHuman && ctl.hype) this.useHype(c.team);
      c.boost = this.hypeTime[c.team] > 0 ? 1 : this.onFire[c.team] ? 0.3 : 0;
      c.speedMul = this.speedMul[c.team];
      const holding = ball.holder === c;
      const cd = c.pushCooldown;
      c.update(dt, ctl, holding);
      if (c.pushCooldown > cd + 0.1) {
        if (c.human || Math.random() < 0.3) this.sfx('push', c.human ? 1 : 0.3);
        for (let i = 0; i < 3; i++) this.fx.trail(c.x - Math.cos(c.heading) * 0.4 + (Math.random() - 0.5) * 0.8, c.y - Math.sin(c.heading) * 0.4 + (Math.random() - 0.5) * 0.8);
      }
      if (c.speed > 5) this.fx.trail(c.x - Math.cos(c.heading) * c.radius * 0.5, c.y - Math.sin(c.heading) * c.radius * 0.5);
      if (c.boost >= 1 && c.speed > 2) this.fx.flame(c.x, c.y, c.vx, c.vy);
      if (holding) {
        c.holdTime += dt;
        if (ctl.pass) { this.pass(c, ctl.aim ?? c.heading); this.sfx('pass'); }
        else if (ctl.bounce) { this.bounce(c); this.sfx('bounce'); }
      } else if (isHuman && ctl.pass) {
        this.switchPlayer(this.playerOf(c));
      }
    }

    for (const h of collideChairs(this.onCourt)) if (this.onHit(h)) return;

    if (this.rules.handsFouls && this.checkHolding(dt)) return;
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
    if (big && (h.a.player === 1 || h.b.player === 1)) this.onVibrate(Math.min(60, h.impact * 8));
    if (h.impact > 2.5 || this.hitSoundGap <= 0) { this.sfx('hit', h.impact); this.hitSoundGap = 0.08; }
    if (h.a.team === h.b.team) return false;

    // Spinning: contact behind the rear axle of the victim.
    const [hitter, victim, hs, toHitterX, toHitterY] = h.aSpeed >= h.bSpeed
      ? [h.a, h.b, h.aSpeed, -h.nx, -h.ny] : [h.b, h.a, h.bSpeed, h.nx, h.ny];
    const facing = Math.cos(victim.heading) * toHitterX + Math.sin(victim.heading) * toHitterY;
    if (facing < -0.75 && hs > this.rules.spinFoulSpeed && victim.speed < hs * 0.6) {
      this.foul(hitter, 'Spinning');
      return true;
    }

    if (big) {
      this.stat(hitter.def).hits++;
      this.addHype(hitter.team, 0.025);
      if (h.impact > 7.5 && this.fx.shout(pick(['WHAT A HIT!', 'DEMOLISHED!', 'OH MY!', 'FLATTENED!']))) { this.slowMotion(0.12, 0.08); this.fx.flash = 0.35; }
      // Chain blocks: big hits by the same team in quick succession.
      if (this.chain.team === hitter.team && this.chain.t > 0) this.chain.n++; else this.chain = { team: hitter.team, n: 1, t: 0 };
      this.chain.t = 2.5;
      if (this.chain.n >= 2) this.fx.text(h.x, h.y - 1.8, `CHAIN BLOCK x${this.chain.n}`, '#7dd3fc', 0.7);
      if (this.chain.n === 3) this.addHype(hitter.team, 0.05);
    }
    // Huge hits can tip a chair over (light, fast chairs go over more easily).
    if (this.rules.tipping && h.impact > 10 && victim.tipped <= 0 && Math.random() < Math.min(0.5, (h.impact - 10) / 10 * (1.3 - victim.mass * 0.5))) {
      victim.tipped = 1.6;
      this.fx.shout("TIPPED OVER!", "#ffe14d", true);
      this.onShake(0.5); this.sfx('hit', 9);
      if (ball.holder === victim) {
        ball.holder = null; ball.vx = victim.vx + (Math.random() - 0.5) * 3; ball.vy = victim.vy + (Math.random() - 0.5) * 3;
        ball.vz = 2; ball.lockChair = victim; ball.lockTime = 0.6;
      }
    }
    if (big && this.fx.texts.length < 2) this.fx.text(h.x, h.y - 1, pick(['SMASH!', 'BOOM!', 'WRECKED!', 'CRUNCH!']), '#ffe14d', 0.9);
    const carrier = ball.holder === h.a ? h.a : ball.holder === h.b ? h.b : null;
    // Strip: a defender making contact can knock the ball out of the carrier's hands (legal in the real game).
    if (carrier && this.stripGap <= 0) {
      const def = carrier === h.a ? h.b : h.a;
      const facing = Math.cos(def.heading) * (carrier.x - def.x) + Math.sin(def.heading) * (carrier.y - def.y);
      const human = def.human && !this.demo;
      const p = (human ? 0.22 : 0.04 + this.skill[def.team] * 0.22) * (facing > 0 ? 1 : 0.3) * (1.2 - carrier.cls * 0.12);
      this.stripGap = 0.4;
      // Reaching in from the side or behind risks an illegal-use-of-hands call.
      if (this.rules.handsFouls && facing <= 0 && def.team !== this.possTeam && Math.random() < 0.12) {
        this.foul(def, 'Illegal use of hands');
        return true;
      }
      if (Math.random() < p) {
        ball.holder = null;
        const a = Math.atan2(carrier.y - def.y, carrier.x - def.x) + (Math.random() - 0.5);
        ball.vx = carrier.vx * 0.5 + Math.cos(a) * 3; ball.vy = carrier.vy * 0.5 + Math.sin(a) * 3;
        ball.vz = 2; ball.lockChair = carrier; ball.lockTime = 0.4;
        this.fx.text(carrier.x, carrier.y - 1.4, 'STRIPPED!', '#7dd3fc', 0.6);
        return false;
      }
    }
    if (carrier && carrier !== hitter && h.impact > (hitter.boost >= 1 ? 3 : 4.2) && (hitter.boost >= 1 || Math.random() < 0.45)) {
      const s = carrier === h.a ? -1 : 1;
      ball.holder = null;
      ball.vx = carrier.vx + s * h.nx * 3 + (Math.random() - 0.5) * 2;
      ball.vy = carrier.vy + s * h.ny * 3 + (Math.random() - 0.5) * 2;
      ball.vz = 2.5; ball.lockChair = carrier; ball.lockTime = 0.5;
      this.fx.text(carrier.x, carrier.y - 1.4, 'LOOSE BALL!', '#fff', 0.6);
    }
    return false;
  }

  /** Holding: a defender stuck to a nearly stationary carrier for a long time draws a call. */
  private checkHolding(dt: number): boolean {
    const h = this.ball.holder;
    if (!h) return false;
    const stuck = this.team(1 - h.team).find(d => dist(d, h.x, h.y) < d.radius + h.radius + 0.08 && d.tipped <= 0);
    h.pinTime = stuck && h.speed < 1.0 ? h.pinTime + dt : 0;
    if (h.pinTime > 2) {
      h.pinTime = 0;
      if (stuck && Math.random() < 0.35) { this.foul(stuck, 'Holding'); return true; }
    }
    return false;
  }

  private checkCatch() {
    const ball = this.ball;
    if (ball.holder || ball.z >= 1.7) return;
    let best: Chair | null = null, bd = Infinity;
    for (const c of this.onCourt) {
      if ((c === ball.lockChair && ball.lockTime > 0) || c.tipped > 0) continue;
      const d = dist(c, ball.x, ball.y);
      if (d < c.catchRadius && d < bd) { bd = d; best = c; }
    }
    if (best) {
      const flying = Math.hypot(ball.vx, ball.vy) > 6;
      const lastTeam = ball.lockChair?.team;
      const steal = this.possTeam >= 0 && this.possTeam !== best.team;
      if (steal) { this.stat(best.def).steals++; this.addHype(best.team, 0.04); }
      this.give(best);
      if (flying && lastTeam !== undefined && lastTeam !== best.team) { this.fx.shout('INTERCEPTED!', '#7dd3fc'); this.addHype(best.team, 0.03); }
      this.sfx(steal ? 'steal' : 'catch');
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
    this.sfx('buzzer');
    this.ball.holder = null;
    const [a, b] = this.score, T = this.teams;
    if (this.period >= this.periods && a !== b) {
      const w = a > b ? 0 : 1;
      this.showBanner('FULL TIME', `${T[w].name} win ${Math.max(a, b)}–${Math.min(a, b)}`, T[w].primary, 6);
      this.state = { kind: 'over' };
      this.onFullTime();
      return;
    }
    const label = this.period >= this.periods ? 'OVERTIME!' : this.period === this.periods / 2 ? 'HALF TIME' : `END OF Q${this.period}`;
    this.showBanner(label, `${T[0].short} ${a} – ${b} ${T[1].short}`, '#fff', 2.5);
    this.deadBall(2.5, () => {
      this.period++;
      this.clock = this.period > this.periods ? this.rules.overtimeSeconds : this.rules.periodSeconds;
      for (const c of this.chairs) c.stamina = Math.min(1, c.stamina + 0.4);
      this.possTeam = -1;
      this.kickoff((this.period + 1) % 2); // alternate possession each period
    }, true);
  }

  /** Switch player `pi` to the free teammate nearest the ball. */
  switchPlayer(pi = 0) {
    const b = this.ball, p = this.players[pi];
    const mates = this.team(p.team).filter(c => !c.human && c.tipped <= 0);
    mates.sort((a, c) => dist(a, b.x, b.y) - dist(c, b.x, b.y));
    if (!mates[0]) return;
    if (p.chair) { p.chair.human = false; p.chair.player = 0; p.chair.tag = ''; p.chair = null; }
    this.setControl(pi, mates[0]);
  }

  goal(scorer: Chair) {
    this.score[scorer.team]++;
    this.stat(scorer.def).goals++;
    this.sfx('goal');
    this.onVibrate(scorer.team === this.players[0].team ? 120 : 40);
    this.slowMotion(0.9, 0.3);
    this.fx.flash = 0.5;
    this.addHype(scorer.team, 0.08);
    const team = scorer.team;
    if (this.streak.team === team) this.streak.n++; else this.streak = { team, n: 1 };
    if (this.onFire[1 - team]) { this.onFire[1 - team] = false; this.fx.shout('FIRE EXTINGUISHED!', '#7dd3fc', true); }
    else if (this.clock < 2) this.fx.shout('BUZZER BEATER!', '#ffe14d', true);
    if (this.streak.n === 3) { this.onFire[team] = true; this.fx.shout(`${this.teams[team].short} IS ON FIRE!`, '#ff5a1f', true); }
    const t = this.teams[scorer.team];
    this.fx.confetti(scorer.x, scorer.y, [t.primary, t.secondary, '#fff']);
    this.onShake(0.5);
    this.showBanner('GOAL!', `#${scorer.def.number} ${scorer.def.name} — ${t.name}`, t.primary, 2.2);
    this.fx.onShout(`${scorer.def.name} scores!`);
    this.ball.holder = null; this.ball.vx = this.ball.vy = 0;
    this.deadBall(2.2, () => {
      this.releasePenalties(1 - scorer.team, true); // a goal frees the conceding team's penalised players
      for (const [p, w] of this.waiting) if (w.team === 1 - scorer.team) this.waiting.delete(p);
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
    this.fx.drawFloor(ctx);
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
