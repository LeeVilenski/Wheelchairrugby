import { drawCourt } from './game/court';
import { Input, IDLE } from './core/input';
import { Camera } from './core/camera';
import { Match } from './game/match';
import { DEFAULT_TEAMS, type TeamDef } from './data/teams';
import { buildRules, type RuleSet } from './game/rules';
import { canField, FORMATS } from './data/teams';
import { Ui, type Settings } from './ui/ui';
import { loadCup } from './game/cup';
import { Audio, Announcer } from './core/audio';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const input = new Input(canvas);
const camera = new Camera();
let match: Match;
const audio = new Audio();
const announcer = new Announcer();
const unlock = () => audio.unlock();
addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
let paused = false;
(window as unknown as { app: unknown }).app = { get match() { return match; } }; // handy for debugging

function rulesFrom(st: Settings, format = st.format, minutes = st.quarterMinutes): RuleSet { return buildRules(st.rules, format, minutes, st.custom); }

const DIFF = { easy: { skill: 0.25, speed: 0.88 }, normal: { skill: 0.6, speed: 0.95 }, hard: { skill: 1, speed: 1 } };
type Mode = '1p' | 'vs' | 'coop';
let mode: Mode = '1p';
function newMatch(home: TeamDef, away: TeamDef, demo: boolean, cup = false, m: Mode = '1p') {
  const st = ui.settings;
  const c = cup ? loadCup() : null;
  mode = demo ? '1p' : m;
  match = new Match([home, away], c ? rulesFrom(st, c.format ?? 'standard', c.quarterMinutes) : rulesFrom(st), mode);
  match.demo = demo;
  ui.inCup = cup;
  const d = DIFF[st.difficulty];
  const vs = mode === 'vs';
  match.skill = demo || vs ? [0.6, 0.6] : [0.6, d.skill];
  match.speedMul = demo || vs ? [1, 1] : [1, d.speed];
  match.autoSubs = [demo || st.autoSubs, !vs || st.autoSubs];
  match.onShake = a => { if (ui.settings.effects) camera.addShake(a); };
  match.reducedEffects = match.fx.reduced = !ui.settings.effects;
  match.fx.onShout = text => {
    if (match.demo || !ui.settings.voice || !ui.settings.sound) return;
    for (const t of match.teams) text = text.replace(new RegExp(`\\b${t.short}\\b`), t.name); // "HAM HYPE TIME" -> "Harbour Hammers hype time"
    announcer.say(text);
  };
  match.onVibrate = ms => { if (ui.settings.vibration && input.touchMode && !match.demo) navigator.vibrate?.(ms); };
  match.sfx = (n, v) => { if (!match.demo) audio.play(n, v); };
  match.onFullTime = () => {
    if (match.demo) { setTimeout(() => startDemo(), 4000); return; }
    setTimeout(() => { paused = true; ui.fullTime(match, ui.inCup); }, 2500);
  };
}
function startDemo() {
  const T = DEFAULT_TEAMS.filter(t => canField(t, FORMATS[ui.settings.format])), a = Math.floor(Math.random() * T.length);
  newMatch(T[a], T[(a + 1 + Math.floor(Math.random() * (T.length - 1))) % T.length], true);
  paused = false;
}

const ui = new Ui({
  start: (home, away, cup, m) => { newMatch(home, away, false, cup, m); ui.close(); paused = false; requestWakeLock(); },
  resume: () => { ui.close(); paused = false; },
  quit: () => { startDemo(); ui.title(); releaseWakeLock(); },
  rematch: () => { newMatch(match.teams[0], match.teams[1], false, false, mode); ui.close(); paused = false; },
  settingsChanged: st => {
    camera.mode = st.camera; audio.setMuted(!st.sound);
    match.reducedEffects = match.fx.reduced = !st.effects;
  },
});
camera.mode = ui.settings.camera;
audio.setMuted(!ui.settings.sound);

// Phones: pause when the app is hidden, and keep the screen awake during a match.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) openPause();
  else if (match && !match.demo && !paused) requestWakeLock();
});
let wakeLock: { release: () => Promise<void> } | null = null;
async function requestWakeLock() {
  try { wakeLock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof wakeLock> } }).wakeLock?.request('screen') ?? null; }
  catch { /* not supported or denied */ }
}
function releaseWakeLock() { wakeLock?.release().catch(() => {}); wakeLock = null; }

function openPause() {
  if (match.demo || ui.isOpen || match.state.kind === 'over') return;
  paused = true; ui.pause(match);
}

let W = 0, H = 0;
const camBtn = { y: 12, w: 120, h: 36 };
const pauseBtn = { y: 12, w: 44, h: 36 };
input.tapTargets.push({ y: camBtn.y, w: camBtn.w, h: camBtn.h, get x() { return W - camBtn.w - 12; }, onTap: () => camera.toggle() });
input.tapTargets.push({ y: pauseBtn.y, w: pauseBtn.w, h: pauseBtn.h, get x() { return W - camBtn.w - 12 - pauseBtn.w - 8; }, onTap: openPause });

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
    input.poll();
    const two = mode !== '1p';
    const ctl = two ? [input.read(0, true), input.read(1, true)] : input.read() ?? IDLE;
    if (input.wasPressed('KeyM')) { ui.settings.sound = !ui.settings.sound; audio.setMuted(!ui.settings.sound); if (!ui.settings.sound) speechSynthesis?.cancel(); }
    if (input.wasPressed('Escape') || input.wasPressed('KeyP') || input.wasPressed('pad:start')) openPause();
    if (!paused) match.update(STEP, ctl);
    input.endFrame();
    acc -= STEP;
  }
  camera.update(1 / 60, W, H, match.ball.x, match.ball.y);
  // Crowd noise follows the action: rises near goal, late in the shot clock and during hype.
  {
    const h = match.ball.holder, near = h ? Math.max(0, 1 - Math.abs(match.goalX(h.team) - h.x) / 10) : 0;
    const live = match.state.kind === 'play' && !paused && !match.demo;
    audio.crowd(live ? 0.15 + near * 0.5 + (match.shotClock < 8 ? 0.2 : 0) + (match.hypeTime[0] > 0 || match.hypeTime[1] > 0 ? 0.3 : 0) : 0.05);
  }
  input.hypeLevel = match.hype[match.human.team];
  render();
  requestAnimationFrame(frame);
}

function render() {
  const demo = match.demo;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  camera.apply(ctx, W, H);
  drawCourtLayer();
  match.draw(ctx);
  ctx.restore();
  if (!demo) { drawHud(); input.drawTouch(ctx); }
  match.fx.drawScreen(ctx, W, H);
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
  const P = match.periods, per = match.period > P ? `OT${match.period - P}` : P === 2 ? `H${match.period}` : `Q${match.period}`;
  const cl = Math.max(0, match.clock), mm = Math.floor(cl / 60), ss = Math.floor(cl % 60);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath(); ctx.roundRect(W / 2 - 95, 52, 190, 24, 8); ctx.fill();
  ctx.font = '800 13px ui-monospace, monospace'; ctx.fillStyle = '#fff';
  ctx.fillText(`${per}  ${mm}:${String(ss).padStart(2, '0')}`, W / 2 - 40, 64);
  if (match.possTeam >= 0 && Number.isFinite(match.shotClock)) {
    const sc = Math.ceil(Math.max(0, match.shotClock));
    ctx.fillStyle = sc <= 10 ? '#ff4040' : '#ffe14d';
    ctx.fillText(`⏱${sc}`, W / 2 + 30, 64);
    if (!match.crossedHalf && Number.isFinite(match.backcourtClock)) {
      ctx.fillStyle = match.backcourtClock <= 4 ? '#ff4040' : '#7dd3fc';
      ctx.fillText(`½${Math.ceil(Math.max(0, match.backcourtClock))}`, W / 2 + 70, 64);
    }
    // Possession arrow
    ctx.fillStyle = match.teams[match.possTeam].primary;
    ctx.fillText(match.possTeam === 0 ? '◀' : '▶', match.possTeam === 0 ? W / 2 - 142 : W / 2 + 142, 30);
  }

  // Player panels: stamina + hype. P1 top-left; P2 under it (or, in two-player games, also labelled).
  match.players.forEach((pl, pi) => {
    const p = pl.chair; if (!p) return;
    const y0 = 12 + pi * 44, two = match.players.length > 1;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(12, y0, 164, 20);
    ctx.fillStyle = p.stamina > 0.25 ? '#4ade80' : '#f87171'; ctx.fillRect(14, y0 + 2, 160 * p.stamina, 16);
    ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(`${two ? `P${pi + 1} · ` : ''}#${p.def.number} ${p.def.name} (${p.cls.toFixed(1)})`, 18, y0 + 10);
    // Hype meter (shared by the team)
    const ht = pl.team, hv = match.hypeTime[ht] > 0 ? match.hypeTime[ht] / 6 : match.hype[ht];
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(12, y0 + 24, 164, 14);
    const ready = match.hype[ht] >= 1 || match.hypeTime[ht] > 0;
    ctx.fillStyle = ready ? `hsl(${20 + Math.sin(performance.now() / 100) * 15},100%,55%)` : '#c2410c';
    ctx.fillRect(14, y0 + 26, 160 * hv, 10);
    ctx.fillStyle = '#fff'; ctx.font = '800 10px system-ui';
    const key = input.touchMode && pi === 0 ? 'TAP 🔥' : two ? (pi === 0 ? 'PRESS F' : 'PRESS /') : 'PRESS F';
    ctx.fillText(match.hypeTime[ht] > 0 ? '🔥 HYPE!' : match.hype[ht] >= 1 ? `🔥 READY: ${key}` : '🔥 HYPE', 18, y0 + 31);
  });
  // On fire badges by the score
  for (const t of [0, 1]) if (match.onFire[t]) {
    ctx.font = '20px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('🔥', t === 0 ? W / 2 - 165 : W / 2 + 165, 30);
  }

  // Camera toggle
  const x = W - camBtn.w - 12;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(x, camBtn.y, camBtn.w, camBtn.h, 8); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.fillText(camera.mode === 'full' ? '🎥 FULL COURT' : '🎥 FOLLOW BALL', x + camBtn.w / 2, camBtn.y + camBtn.h / 2);

  // Pause button + timeouts left
  const px = x - pauseBtn.w - 8;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(px, pauseBtn.y, pauseBtn.w, pauseBtn.h, 8); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(px + 15, pauseBtn.y + 10, 5, 16); ctx.fillRect(px + 24, pauseBtn.y + 10, 5, 16);
  ctx.font = '700 11px system-ui'; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`${match.fmt.id === 'fives' ? 'FIVES · ' : ''}${match.rules.name.toUpperCase()} · TO ${match.timeouts[match.human.team]}`, W - 12, camBtn.y + camBtn.h + 14);

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
    ctx.fillText(mode !== '1p'
      ? 'P1: WASD · Space push · E pass · Q bounce · F hype · L-Shift brake   |   P2: arrows · Enter push · . pass · , bounce · / hype · R-Shift brake'
      : 'W/↑ roll · A/D turn · SPACE push · E pass/switch · Q bounce · SHIFT brake · F hype · C camera · M mute · Esc pause', 12, H - 16);
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

startDemo();
ui.title();
