export interface Controls {
  turn: number;          // -1..1 (tank steering)
  throttle: number;      // -1..1
  aim: number | null;    // target heading in radians (stick steering), or null
  push: boolean;
  brake: boolean;
  pass: boolean;         // pass, or switch player when not holding the ball
  bounce: boolean;
}

export const IDLE: Controls = { turn: 0, throttle: 0, aim: null, push: false, brake: false, pass: false, bounce: false };

interface Button { id: string; label: string; x: number; y: number; r: number; held: boolean; pointer: number | null; }

// Keyboard (tank: arrows/WASD), gamepad (stick aim), touch (floating stick + buttons).
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  touchMode = false;

  stick = { active: false, pointer: -1, ox: 0, oy: 0, x: 0, y: 0 };
  readonly stickRadius = 60;
  buttons: Button[] = [
    { id: 'push', label: 'PUSH', x: 0, y: 0, r: 46, held: false, pointer: null },
    { id: 'brake', label: 'BRAKE', x: 0, y: 0, r: 36, held: false, pointer: null },
    { id: 'pass', label: 'PASS', x: 0, y: 0, r: 40, held: false, pointer: null },
    { id: 'bounce', label: 'BOUNCE', x: 0, y: 0, r: 32, held: false, pointer: null },
  ];
  /** Screen-space tap targets owned by the UI (e.g. camera toggle). */
  tapTargets: { x: number; y: number; w: number; h: number; onTap: () => void }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', e => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.touchMode = false;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', e => this.onUp(e));
    canvas.addEventListener('pointercancel', e => this.onUp(e));
  }

  layout(w: number, h: number) {
    const s = Math.min(1.2, Math.max(0.8, Math.min(w, h) / 420));
    const [push, brake, pass, bounce] = this.buttons;
    push.r = 46 * s; brake.r = 34 * s; pass.r = 40 * s; bounce.r = 32 * s;
    push.x = w - 80 * s; push.y = h - 85 * s;
    brake.x = w - 185 * s; brake.y = h - 62 * s;
    pass.x = w - 160 * s; pass.y = h - 150 * s;
    bounce.x = w - 70 * s; bounce.y = h - 190 * s;
  }

  private onDown(e: PointerEvent) {
    if (e.pointerType === 'touch') this.touchMode = true;
    const { x, y } = this.pos(e);
    for (const t of this.tapTargets) {
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) { t.onTap(); return; }
    }
    if (!this.touchMode) return;
    for (const b of this.buttons) {
      if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.2) { b.held = true; b.pointer = e.pointerId; this.pressed.add('btn:' + b.id); return; }
    }
    if (x < this.canvas.clientWidth * 0.55 && !this.stick.active) {
      Object.assign(this.stick, { active: true, pointer: e.pointerId, ox: x, oy: y, x, y });
    }
  }
  private onMove(e: PointerEvent) {
    if (this.stick.active && e.pointerId === this.stick.pointer) {
      const { x, y } = this.pos(e);
      this.stick.x = x; this.stick.y = y;
    }
  }
  private onUp(e: PointerEvent) {
    if (e.pointerId === this.stick.pointer) { this.stick.active = false; this.stick.pointer = -1; }
    for (const b of this.buttons) if (b.pointer === e.pointerId) { b.held = false; b.pointer = null; }
  }
  private pos(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** True once per key/button press. */
  wasPressed(code: string) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }

  read(): Controls {
    const k = (...c: string[]) => c.some(x => this.keys.has(x));
    const c: Controls = {
      turn: (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0),
      throttle: (k('ArrowUp', 'KeyW') ? 1 : 0) - (k('ArrowDown', 'KeyS') ? 1 : 0),
      aim: null,
      push: this.wasPressed('Space'),
      brake: k('ShiftLeft', 'ShiftRight'),
      pass: this.wasPressed('KeyE') || this.wasPressed('KeyJ'),
      bounce: this.wasPressed('KeyQ') || this.wasPressed('KeyK'),
    };

    // Touch stick: aim + throttle by distance
    if (this.stick.active) {
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const mag = Math.min(1, Math.hypot(dx, dy) / this.stickRadius);
      if (mag > 0.2) { c.aim = Math.atan2(dy, dx); c.throttle = mag; }
    }
    if (this.wasPressed('btn:push')) c.push = true;
    if (this.buttons[1].held) c.brake = true;
    if (this.wasPressed('btn:pass')) c.pass = true;
    if (this.wasPressed('btn:bounce')) c.bounce = true;

    // Gamepad: left stick aim, A push, B/RT brake
    const gp = navigator.getGamepads?.().find(g => g);
    if (gp) {
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0, mag = Math.min(1, Math.hypot(ax, ay));
      if (mag > 0.25) { c.aim = Math.atan2(ay, ax); c.throttle = mag; }
      const a = !!gp.buttons[0]?.pressed;
      if (a && !this.gpA) c.push = true;
      this.gpA = a;
      const x = !!gp.buttons[2]?.pressed, y = !!gp.buttons[3]?.pressed;
      if (x && !this.gpX) c.pass = true;
      if (y && !this.gpY) c.bounce = true;
      this.gpX = x; this.gpY = y;
      const st = !!gp.buttons[9]?.pressed;
      if (st && !this.gpStart) this.pressed.add('pad:start');
      this.gpStart = st;
      if (gp.buttons[1]?.pressed || (gp.buttons[7]?.value ?? 0) > 0.3) c.brake = true;
    }
    return c;
  }
  private gpA = false; private gpX = false; private gpY = false; private gpStart = false;

  drawTouch(ctx: CanvasRenderingContext2D) {
    if (!this.touchMode) return;
    ctx.save();
    if (this.stick.active) {
      const { ox, oy, x, y } = this.stick;
      const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy), m = Math.min(d, this.stickRadius);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ox, oy, this.stickRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(ox + (d ? dx / d * m : 0), oy + (d ? dy / d * m : 0), 26, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '600 14px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('Touch & drag here to steer', 20, this.canvas.clientHeight - 30);
    }
    for (const b of this.buttons) {
      ctx.fillStyle = b.held ? 'rgba(255,200,60,0.7)' : 'rgba(255,255,255,0.18)';
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(b.r * 0.36)}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x, b.y);
    }
    ctx.restore();
  }
}
