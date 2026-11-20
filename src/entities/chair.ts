import { COURT } from '../game/court';
import type { Controls } from '../core/input';
import { FOCUS, type PlayerDef, type TeamDef } from '../data/teams';

// Top-down wheelchair with momentum: it can only roll along its heading,
// so sideways velocity is scrubbed by tyre grip.
export class Chair {
  vx = 0; vy = 0;
  stamina = 1;
  pushCooldown = 0;
  holdTime = 0;          // seconds since last bounce/pickup while holding the ball
  human = false;
  keyTime = 0;           // seconds spent in the opponents' key (attacking)
  keyEnteredAt = 0;      // when this chair entered its own key (defending)
  inOwnKey = false;
  penalty = 0;           // seconds left in the penalty box; > 0 = off court
  boost = 0;
  speedMul = 1;
  tipped = 0;            // seconds left lying on its side after a huge hit
  pinTime = 0;           // seconds a defender has been stuck to this carrier          // difficulty handicap for CPU teams
  aiT = 0;               // AI re-plan timer
  aiCtl: Controls | null = null;             // 0..1: hype / on-fire speed and power boost

  // Stats derived from classification: low pointers are heavy blockers, high pointers fast ball carriers.
  readonly cls: number;
  readonly radius: number;
  readonly mass: number;
  readonly maxSpeed: number;
  readonly cruiseAccel: number;
  readonly turnRate: number;
  readonly pushImpulse: number;
  readonly catchRadius: number;
  readonly rollDrag = 0.6;
  readonly brakeDrag = 4;
  readonly grip = 9;

  constructor(
    public x: number, public y: number, public heading: number,
    public team: number, public teamDef: TeamDef, public def: PlayerDef,
  ) {
    const c = def.cls, f = FOCUS[def.focus ?? 'balanced'];
    this.cls = c;
    this.radius = 0.62 - c * 0.025;
    this.mass = 1.35 - c * 0.1 + f.mass;
    this.maxSpeed = 5.8 + c * 0.45 + f.speed;
    this.cruiseAccel = 3.8 + c * 0.4 + f.accel;
    this.turnRate = 3.4 + c * 0.35 + f.turn;
    this.pushImpulse = 2.1 + c * 0.2 + f.push;
    this.catchRadius = 0.7 + c * 0.07 + f.hands;
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get isDefensive() { return this.cls <= 1.5; }

  update(dt: number, c: Controls, holding: boolean) {
    if (this.tipped > 0) {
      // Tipped over: slide to a stop, then the player rights the chair.
      this.tipped -= dt;
      const k = Math.max(0, 1 - 5 * dt); this.vx *= k; this.vy *= k;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.collideWalls();
      return;
    }
    const fx = Math.cos(this.heading), fy = Math.sin(this.heading);
    const turnSlow = 1 / (1 + this.speed * 0.08);

    let throttle = c.throttle;
    if (c.aim !== null) {
      let d = c.aim - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += Math.max(-1, Math.min(1, d * 4)) * this.turnRate * turnSlow * dt;
      throttle *= Math.max(0, Math.cos(d));
    } else {
      this.heading += c.turn * this.turnRate * turnSlow * dt;
    }

    if (throttle > 0 && this.stamina > 0.02) {
      this.vx += fx * this.cruiseAccel * this.speedMul * throttle * dt;
      this.vy += fy * this.cruiseAccel * this.speedMul * throttle * dt;
      this.stamina -= 0.035 * throttle * dt;
    } else if (throttle < 0) {
      this.vx += fx * this.cruiseAccel * 0.5 * throttle * dt;
      this.vy += fy * this.cruiseAccel * 0.5 * throttle * dt;
    }

    this.pushCooldown -= dt;
    if (c.push && this.pushCooldown <= 0 && this.stamina > 0.1) {
      this.vx += fx * this.pushImpulse * (1 + this.boost * 0.35);
      this.vy += fy * this.pushImpulse * (1 + this.boost * 0.35);
      this.stamina -= 0.07;
      this.pushCooldown = 0.35 - this.boost * 0.15;
    }

    const lat = -this.vx * fy + this.vy * fx;
    const scrub = lat * Math.min(1, this.grip * dt);
    this.vx += fy * scrub;
    this.vy -= fx * scrub;

    const k = Math.max(0, 1 - (c.brake ? this.brakeDrag : this.rollDrag) * dt);
    this.vx *= k; this.vy *= k;

    const s = this.speed;
    const max = this.maxSpeed * this.speedMul * (holding ? 0.95 : 1) * (this.pushCooldown > 0 ? 1.25 : 1) * (1 + this.boost * 0.3);
    if (s > max) { this.vx *= max / s; this.vy *= max / s; }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (throttle <= 0.3 && !c.push) this.stamina = Math.min(1, this.stamina + 0.12 * dt);
    else this.stamina = Math.min(1, this.stamina + 0.03 * dt);

    this.collideWalls();
  }

  collideWalls() {
    const m = 1.5, r = this.radius, e = 0.4;
    if (this.x < -m + r) { this.x = -m + r; this.vx = Math.abs(this.vx) * e; }
    if (this.x > COURT.length + m - r) { this.x = COURT.length + m - r; this.vx = -Math.abs(this.vx) * e; }
    if (this.y < -m + r) { this.y = -m + r; this.vy = Math.abs(this.vy) * e; }
    if (this.y > COURT.width + m - r) { this.y = COURT.width + m - r; this.vy = -Math.abs(this.vy) * e; }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const r = this.radius;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading);
    if (this.tipped > 0) {
      // Lying on its side: squash across the axle, then pop back up in the last 0.3 s.
      const up = Math.max(0, 0.3 - this.tipped) / 0.3;
      ctx.scale(1, 0.45 + up * 0.55);
      ctx.rotate(Math.sin(performance.now() / 90) * 0.04 * (1 - up));
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0.06, 0.08, r * 1.05, r * 0.95, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.fillRect(-r * 0.7, -r * 1.05, r * 1.2, r * 0.28);
    ctx.fillRect(-r * 0.7, r * 0.77, r * 1.2, r * 0.28);
    // Defensive chairs get a wide bumper with wings, offensive chairs a compact rounded one.
    ctx.strokeStyle = this.teamDef.secondary;
    ctx.lineWidth = this.isDefensive ? 0.14 : 0.09;
    ctx.beginPath(); ctx.arc(r * 0.15, 0, r * 0.85, this.isDefensive ? -1.4 : -1.0, this.isDefensive ? 1.4 : 1.0); ctx.stroke();
    ctx.fillStyle = this.teamDef.primary;
    ctx.beginPath(); ctx.roundRect(-r * 0.6, -r * 0.6, r * 1.0, r * 1.2, 0.12); ctx.fill();
    ctx.fillStyle = '#8d5a3b';
    ctx.beginPath(); ctx.arc(-r * 0.15, 0, r * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 0.4px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.def.number), this.x, this.y - r - 0.35);
    if (this.human) {
      // "You" marker: bobbing arrow above the number
      const ty = this.y - r - 0.75 + Math.sin(performance.now() / 150) * 0.08;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 0.05;
      ctx.beginPath(); ctx.moveTo(this.x - 0.28, ty - 0.3); ctx.lineTo(this.x + 0.28, ty - 0.3); ctx.lineTo(this.x, ty); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }
}
