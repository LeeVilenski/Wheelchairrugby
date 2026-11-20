import { Input } from './core/input';
import { Camera } from './core/camera';
import { Chair } from './entities/chair';
import { COURT, drawCourt } from './game/court';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const input = new Input(canvas);
const camera = new Camera();
const player = new Chair(COURT.length / 2 - 3, COURT.width / 2, 0, '#2f6fe0', 7);

let W = 0, H = 0;
const camBtn = { x: 0, y: 12, w: 120, h: 36 };
input.tapTargets.push({ ...camBtn, get x() { return W - camBtn.w - 12; }, onTap: () => camera.toggle() });

function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  input.layout(W, H);
}
addEventListener('resize', resize);
resize();

// Fixed-timestep update, render every frame.
const STEP = 1 / 60;
let acc = 0, last = performance.now();

function frame(now: number) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    if (input.wasPressed('KeyC')) camera.toggle();
    player.update(STEP, input.read());
    input.endFrame();
    acc -= STEP;
  }
  camera.update(1 / 60, W, H, player.x, player.y);
  render();
  requestAnimationFrame(frame);
}

function render() {
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  camera.apply(ctx, W, H);
  drawCourt(ctx);
  player.draw(ctx);
  ctx.restore();

  drawHud();
  input.drawTouch(ctx);
}

function drawHud() {
  // Stamina bar
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(12, 12, 164, 20);
  ctx.fillStyle = player.stamina > 0.25 ? '#4ade80' : '#f87171';
  ctx.fillRect(14, 14, 160 * player.stamina, 16);
  ctx.fillStyle = '#fff';
  ctx.font = '700 12px system-ui';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`STAMINA   ${(player.speed * 3.6).toFixed(0)} km/h`, 18, 22);

  // Camera toggle button
  const x = W - camBtn.w - 12;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(x, camBtn.y, camBtn.w, camBtn.h, 8); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(camera.mode === 'full' ? '🎥 FULL COURT' : '🎥 FOLLOW', x + camBtn.w / 2, camBtn.y + camBtn.h / 2);

  if (!input.touchMode) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('W/↑ roll · A/D turn · SPACE push · SHIFT brake · C camera', 12, H - 16);
  }
}

requestAnimationFrame(frame);
