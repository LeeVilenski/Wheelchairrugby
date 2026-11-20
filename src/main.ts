import { drawCourt } from './game/court';
import { Input, IDLE } from './core/input';
import { Camera } from './core/camera';
import { Match } from './game/match';
import { DEFAULT_TEAMS } from './data/teams';
import { RULES } from './game/rules';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const input = new Input(canvas);
const camera = new Camera();
const match = new Match([DEFAULT_TEAMS[0], DEFAULT_TEAMS[1]]);
match.onShake = a => camera.addShake(a);
(window as unknown as { match: Match }).match = match; // handy for debugging

let W = 0, H = 0;
const camBtn = { y: 12, w: 120, h: 36 };
input.tapTargets.push({ y: camBtn.y, w: camBtn.w, h: camBtn.h, get x() { return W - camBtn.w - 12; }, onTap: () => camera.toggle() });
const toggleRules = () => match.setRules(match.rules.name === 'Arcade' ? RULES.Sim : RULES.Arcade);
input.tapTargets.push({ y: camBtn.y + camBtn.h + 8, w: camBtn.w, h: 30, get x() { return W - camBtn.w - 12; }, onTap: toggleRules });

function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  input.layout(W, H);
}
addEventListener('resize', resize);
resize();

const STEP = 1 / 60;
let acc = 0, last = performance.now();

function frame(now: number) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    if (input.wasPressed('KeyC')) camera.toggle();
    if (input.wasPressed('KeyR')) toggleRules();
    match.update(STEP, input.read() ?? IDLE);
    input.endFrame();
    acc -= STEP;
  }
  camera.update(1 / 60, W, H, match.ball.x, match.ball.y);
  render();
  requestAnimationFrame(frame);
}

function render() {
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  camera.apply(ctx, W, H);
  drawCourtLayer();
  match.draw(ctx);
  ctx.restore();
  drawHud();
  input.drawTouch(ctx);
}

function drawCourtLayer() { drawCourt(ctx); }

function drawHud() {
  const [a, b] = match.teams;
  // Scoreboard
  const sw = 260, sx = W / 2 - sw / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath(); ctx.roundRect(sx, 10, sw, 40, 10); ctx.fill();
  ctx.fillStyle = a.primary; ctx.fillRect(sx + 10, 18, 8, 24);
  ctx.fillStyle = b.primary; ctx.fillRect(sx + sw - 18, 18, 8, 24);
  ctx.fillStyle = '#fff';
  ctx.font = '800 18px system-ui'; ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillText(a.short, sx + 26, 30);
  ctx.textAlign = 'right'; ctx.fillText(b.short, sx + sw - 26, 30);
  ctx.textAlign = 'center'; ctx.font = '900 22px system-ui';
  ctx.fillText(`${match.score[0]}  –  ${match.score[1]}`, W / 2, 30);

  // Clocks: period + game clock, shot clock, 12 s backcourt clock
  const per = match.period > 4 ? `OT${match.period - 4}` : `Q${match.period}`;
  const cl = Math.max(0, match.clock), mm = Math.floor(cl / 60), ss = Math.floor(cl % 60);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath(); ctx.roundRect(W / 2 - 95, 52, 190, 24, 8); ctx.fill();
  ctx.font = '800 13px ui-monospace, monospace'; ctx.fillStyle = '#fff';
  ctx.fillText(`${per}  ${mm}:${String(ss).padStart(2, '0')}`, W / 2 - 40, 64);
  if (match.possTeam >= 0) {
    const sc = Math.ceil(Math.max(0, match.shotClock));
    ctx.fillStyle = sc <= 10 ? '#ff4040' : '#ffe14d';
    ctx.fillText(`⏱${sc}`, W / 2 + 30, 64);
    if (!match.crossedHalf) {
      ctx.fillStyle = match.backcourtClock <= 4 ? '#ff4040' : '#7dd3fc';
      ctx.fillText(`½${Math.ceil(Math.max(0, match.backcourtClock))}`, W / 2 + 70, 64);
    }
    // Possession arrow
    ctx.fillStyle = match.teams[match.possTeam].primary;
    ctx.fillText(match.possTeam === 0 ? '◀' : '▶', match.possTeam === 0 ? W / 2 - 142 : W / 2 + 142, 30);
  }

  // Human stamina
  const p = match.human;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(12, 12, 164, 20);
  ctx.fillStyle = p.stamina > 0.25 ? '#4ade80' : '#f87171'; ctx.fillRect(14, 14, 160 * p.stamina, 16);
  ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`#${p.def.number} ${p.def.name} (${p.cls.toFixed(1)})`, 18, 22);

  // Camera toggle
  const x = W - camBtn.w - 12;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(x, camBtn.y, camBtn.w, camBtn.h, 8); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.fillText(camera.mode === 'full' ? '🎥 FULL COURT' : '🎥 FOLLOW BALL', x + camBtn.w / 2, camBtn.y + camBtn.h / 2);

  // Rules toggle
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(x, camBtn.y + camBtn.h + 8, camBtn.w, 30, 8); ctx.fill();
  ctx.fillStyle = match.rules.name === 'Sim' ? '#7dd3fc' : '#ffe14d';
  ctx.fillText(`RULES: ${match.rules.name.toUpperCase()}`, x + camBtn.w / 2, camBtn.y + camBtn.h + 23);

  // Banner
  const bn = match.banner;
  if (bn) {
    const t = Math.min(1, bn.life * 3);
    ctx.globalAlpha = t;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, H / 2 - 50, W, 100);
    ctx.font = `900 ${Math.min(64, W / 9)}px system-ui`;
    ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText(bn.text, W / 2, H / 2 - 10);
    ctx.fillStyle = bn.color; ctx.fillText(bn.text, W / 2, H / 2 - 10);
    if (bn.sub) { ctx.font = '700 16px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(bn.sub, W / 2, H / 2 + 32); }
    ctx.globalAlpha = 1;
  }

  if (!input.touchMode) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textAlign = 'left'; ctx.font = '600 12px system-ui';
    ctx.fillText('W/↑ roll · A/D turn · SPACE push · E pass/switch · Q bounce · SHIFT brake · C camera · R rules', 12, H - 16);
  }
}

requestAnimationFrame(frame);

// --- Installable web app (PWA) ---
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
const installBtn = document.getElementById('install') as HTMLButtonElement;
let deferredPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e as typeof deferredPrompt;
  installBtn.style.display = 'block';
});
installBtn.addEventListener('click', async () => {
  installBtn.style.display = 'none';
  await deferredPrompt?.prompt();
  deferredPrompt = null;
});
// Lock to landscape where supported (installed app / fullscreen).
(screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {});
