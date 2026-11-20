import { COURT } from '../game/court';
import type { Controls } from '../core/input';

// Top-down wheelchair with momentum: it can only roll along its heading,
// so sideways velocity is scrubbed by tyre grip.
export class Chair {
  x: number; y: number;
  vx = 0; vy = 0;
  heading: number;
  radius = 0.55;
  stamina = 1;
  pushCooldown = 0;

  // Tunables (will come from player stats/classification later)
  pushImpulse = 2.6;   // m/s added per push
  cruiseAccel = 4.5;   // m/s^2 when holding forward
  maxSpeed = 7;
  turnRate = 4.2;      // rad/s
  rollDrag = 0.6;      // 1/s
  brakeDrag = 4;       // 1/s
  grip = 9;            // 1/s lateral scrub

  constructor(x: number, y: number, heading: number, public color: string, public number: number) {
    this.x = x; this.y = y; this.heading = heading;
  }

  get speed() { return Math.hypot(this.vx, this.vy); }

  update(dt: number, c: Controls) {
    const fx = Math.cos(this.heading), fy = Math.sin(this.heading);

    // Steering: tank-style turn or stick-aim toward a target angle.
    let throttle = c.throttle;
    if (c.aim !== null) {
      let d = c.aim - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turnSlow = 1 / (1 + this.speed * 0.08);
      this.heading += Math.max(-1, Math.min(1, d * 4)) * this.turnRate * turnSlow * dt;
      // Don't drive forward hard while facing the wrong way.
      throttle *= Math.max(0, Math.cos(d));
    } else {
      const turnSlow = 1 / (1 + this.speed * 0.08);
      this.heading += c.turn * this.turnRate * turnSlow * dt;
    }

    // Forward drive
    if (throttle > 0 && this.stamina > 0.02) {
      this.vx += fx * this.cruiseAccel * throttle * dt;
      this.vy += fy * this.cruiseAccel * throttle * dt;
      this.stamina -= 0.04 * throttle * dt;
    } else if (throttle < 0) {
      this.vx += fx * this.cruiseAccel * 0.5 * throttle * dt;
      this.vy += fy * this.cruiseAccel * 0.5 * throttle * dt;
    }

    // Push: a burst of speed
    this.pushCooldown -= dt;
    if (c.push && this.pushCooldown <= 0 && this.stamina > 0.1) {
      this.vx += fx * this.pushImpulse;
      this.vy += fy * this.pushImpulse;
      this.stamina -= 0.08;
      this.pushCooldown = 0.35;
    }

    // Lateral grip: remove velocity perpendicular to heading
    const lat = -this.vx * fy + this.vy * fx;
    const scrub = lat * Math.min(1, this.grip * dt);
    this.vx -= -fy * scrub;
    this.vy -= fx * scrub;

    // Drag / brake
    const drag = c.brake ? this.brakeDrag : this.rollDrag;
    const k = Math.max(0, 1 - drag * dt);
    this.vx *= k; this.vy *= k;

    const s = this.speed;
    const max = this.maxSpeed * (c.push ? 1.3 : 1);
    if (s > max) { this.vx *= max / s; this.vy *= max / s; }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Recover stamina while coasting
    if (throttle <= 0 && !c.push) this.stamina = Math.min(1, this.stamina + 0.12 * dt);

    this.collideWalls();
  }

  // Run-off around the court (players can roll slightly out of bounds).
  collideWalls() {
    const m = 1.5, r = this.radius, e = 0.4;
    if (this.x < -m + r) { this.x = -m + r; this.vx = Math.abs(this.vx) * e; }
    if (this.x > COURT.length + m - r) { this.x = COURT.length + m - r; this.vx = -Math.abs(this.vx) * e; }
    if (this.y < -m + r) { this.y = -m + r; this.vy = Math.abs(this.vy) * e; }
    if (this.y > COURT.width + m - r) { this.y = COURT.width + m - r; this.vy = -Math.abs(this.vy) * e; }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading);
    const r = this.radius;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0.06, 0.08, r * 1.05, r * 0.95, 0, 0, Math.PI * 2); ctx.fill();

    // Big wheels (cambered)
    ctx.fillStyle = '#222';
    ctx.fillRect(-r * 0.7, -r * 1.05, r * 1.2, r * 0.28);
    ctx.fillRect(-r * 0.7, r * 0.77, r * 1.2, r * 0.28);
    // Front bumper / wing
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 0.09;
    ctx.beginPath(); ctx.arc(r * 0.15, 0, r * 0.85, -1.1, 1.1); ctx.stroke();
    // Seat / body
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.roundRect(-r * 0.6, -r * 0.6, r * 1.0, r * 1.2, 0.12); ctx.fill();
    // Head
    ctx.fillStyle = '#8d5a3b';
    ctx.beginPath(); ctx.arc(-r * 0.15, 0, r * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Number (upright)
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 0.4px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.number), this.x, this.y - r - 0.35);
  }
}
