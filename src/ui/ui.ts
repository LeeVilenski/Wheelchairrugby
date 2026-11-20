import './ui.css';
import { DEFAULT_TEAMS, lineupLimit, lineupPoints, validLineup, type TeamDef } from '../data/teams';
import { TIMEOUTS_PER_GAME, type Match } from '../game/match';
import type { Chair } from '../entities/chair';

export interface Settings {
  rules: 'Arcade' | 'Sim';
  quarterMinutes: number;
  camera: 'full' | 'follow';
  autoSubs: boolean;
}
const DEFAULTS: Settings = { rules: 'Arcade', quarterMinutes: 3, camera: 'full', autoSubs: true };

export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('mb.settings') || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem('mb.settings', JSON.stringify(s)); } catch { /* private mode */ } }

export interface UiHooks {
  start(home: TeamDef, away: TeamDef): void;
  resume(): void;
  quit(): void;
  rematch(): void;
  settingsChanged(s: Settings): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const pts = (n: number) => n.toFixed(1);

/** DOM menus layered over the canvas. */
export class Ui {
  el = document.getElementById('ui') as HTMLDivElement;
  settings = loadSettings();
  home = 0; away = 1;
  private back: () => void = () => this.title();
  private actions: Record<string, (arg: string) => void> = {};

  constructor(private hooks: UiHooks) {
    this.el.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (!t || (t as HTMLButtonElement).disabled) return;
      this.actions[t.dataset.a!]?.(t.dataset.v ?? '');
    });
  }

  get isOpen() { return this.el.classList.contains('open'); }
  close() { this.el.classList.remove('open', 'title'); this.el.innerHTML = ''; }
  private show(html: string, actions: Record<string, (arg: string) => void>, title = false) {
    this.actions = actions;
    this.el.innerHTML = `<div class="panel">${html}</div>`;
    this.el.classList.add('open');
    this.el.classList.toggle('title', title);
    (this.el.querySelector('.btn') as HTMLElement | null)?.focus();
  }

  title() {
    this.show(`
      <h1 class="logo">MURDERBALL!</h1>
      <p class="tag">Arcade wheelchair rugby</p>
      <div class="btns">
        <button class="btn" data-a="quick">Quick match</button>
        <button class="btn alt" data-a="teams">Choose teams</button>
        <button class="btn alt" data-a="settings">Settings</button>
        <button class="btn alt" data-a="help">How to play</button>
      </div>`, {
      quick: () => {
        this.home = Math.floor(Math.random() * DEFAULT_TEAMS.length);
        do { this.away = Math.floor(Math.random() * DEFAULT_TEAMS.length); } while (this.away === this.home);
        this.hooks.start(DEFAULT_TEAMS[this.home], DEFAULT_TEAMS[this.away]);
      },
      teams: () => this.teamSelect(),
      settings: () => { this.back = () => this.title(); this.settingsScreen(); },
      help: () => { this.back = () => this.title(); this.helpScreen(); },
    }, true);
  }

  teamSelect() {
    const T = DEFAULT_TEAMS;
    const card = (i: number, who: string, side: string) => {
      const t = T[i];
      const rows = t.players.map(p => `<span class="cls">${pts(p.cls)}</span><span>#${p.number} ${esc(p.name)}${p.female ? ' ♀' : ''}</span><span></span>`).join('');
      return `<div class="team-card" style="--c:${t.primary}">
        <div class="who">${who}</div>
        <div class="row"><button class="chip" data-a="prev" data-v="${side}">◀</button>
          <div class="name">${esc(t.name)}</div>
          <button class="chip" data-a="next" data-v="${side}">▶</button></div>
        <div><span class="swatch" style="background:${t.primary}"></span><span class="swatch" style="background:${t.secondary}"></span> ${t.short}</div>
        <div class="roster">${rows}</div></div>`;
    };
    const cycle = (side: string, d: number) => {
      const k = side === 'home' ? 'home' : 'away', other = side === 'home' ? this.away : this.home;
      let v = this[k];
      do { v = (v + d + T.length) % T.length; } while (v === other);
      this[k] = v; this.teamSelect();
    };
    this.show(`
      <h2>Choose teams</h2>
      <div class="teams">${card(this.home, 'YOU', 'home')}<div class="vs">VS</div>${card(this.away, 'CPU', 'away')}</div>
      <div class="row"><button class="btn alt" data-a="back">Back</button><button class="btn" data-a="go">Play</button></div>`, {
      prev: s => cycle(s, -1), next: s => cycle(s, 1),
      back: () => this.title(),
      go: () => this.hooks.start(T[this.home], T[this.away]),
    });
  }

  settingsScreen() {
    const s = this.settings;
    const chips = (key: keyof Settings, opts: [string, unknown][]) => opts.map(([label, v]) =>
      `<button class="chip ${s[key] === v ? 'on' : ''}" data-a="set" data-v='${JSON.stringify([key, v])}'>${label}</button>`).join('');
    this.show(`
      <h2>Settings</h2>
      <div class="setting">Rules<div class="opts">${chips('rules', [['Arcade', 'Arcade'], ['Sim (IWRF)', 'Sim']])}</div></div>
      <div class="setting">Quarter length<div class="opts">${chips('quarterMinutes', [['2 min', 2], ['3 min', 3], ['5 min', 5], ['8 min (real)', 8]])}</div></div>
      <div class="setting">Camera<div class="opts">${chips('camera', [['Full court', 'full'], ['Follow ball', 'follow']])}</div></div>
      <div class="setting">Auto-subs for your team<div class="opts">${chips('autoSubs', [['On', true], ['Off', false]])}</div></div>
      <p class="tag">Arcade: shorter penalties, only big spinning hits are fouls. Sim: strict IWRF calls. Changes apply from the next match (camera: now).</p>
      <div class="btns"><button class="btn" data-a="back">Done</button></div>`, {
      set: v => {
        const [k, val] = JSON.parse(v) as [keyof Settings, never];
        (this.settings[k] as unknown) = val;
        saveSettings(this.settings); this.hooks.settingsChanged(this.settings); this.settingsScreen();
      },
      back: () => this.back(),
    });
  }

  helpScreen() {
    this.show(`
      <h2>How to play</h2>
      <div class="help">
        <h3>Controls</h3>
        <b>Touch:</b> drag on the left half to steer, tap PUSH for speed, PASS to pass (or switch player on defence), BOUNCE to reset the 10 s dribble clock.<br>
        <b>Keyboard:</b> W/↑ roll · A/D turn · Space push · E pass/switch · Q bounce · Shift brake · C camera · Esc pause.<br>
        <b>Gamepad:</b> left stick steer · A push · X pass · Y bounce · B brake · Start pause.
        <h3>Scoring</h3>Carry the ball over the opponents' goal line between the orange cones.
        <h3>Rules</h3>
        • Bounce or pass within <b>10 s</b>. • Cross half way within <b>12 s</b>. • Score within <b>40 s</b>.<br>
        • Attackers: max <b>10 s</b> in the opponents' key. • Defenders: max <b>3</b> in their own key.<br>
        • Hitting a chair <b>behind its rear axle</b> (spinning) is a foul: attackers lose the ball, defenders go to the penalty box.<br>
        • Every player has a classification from 0.5 to 3.5. Your four on court may total <b>8.0</b> (+0.5 per female player).
        Low pointers are heavy blockers, high pointers are fast ball carriers.<br>
        • Each team has ${TIMEOUTS_PER_GAME} timeouts: call one when you have the ball, or at a dead ball. Substitutions happen at dead balls and timeouts.
      </div>
      <div class="btns"><button class="btn" data-a="back">Back</button></div>`, { back: () => this.back() });
  }

  pause(m: Match) {
    const team = m.human.team;
    this.show(`
      <h2>Paused</h2>
      <div class="score-big">${m.teams[0].short} ${m.score[0]} – ${m.score[1]} ${m.teams[1].short}</div>
      <div class="btns">
        <button class="btn" data-a="resume">Resume</button>
        <button class="btn alt" data-a="timeout" ${m.canTimeout(team) ? '' : 'disabled'}>Timeout (${m.timeouts[team]} left)</button>
        <button class="btn alt" data-a="subs" ${m.isDead ? '' : 'disabled'}>Substitutions${m.isDead ? '' : ' (dead ball only)'}</button>
        <button class="btn alt" data-a="settings">Settings</button>
        <button class="btn alt" data-a="help">How to play</button>
        <button class="btn alt" data-a="quit">Quit to menu</button>
      </div>`, {
      resume: () => this.hooks.resume(),
      timeout: () => { m.callTimeout(team); this.subs(m); },
      subs: () => this.subs(m),
      settings: () => { this.back = () => this.pause(m); this.settingsScreen(); },
      help: () => { this.back = () => this.pause(m); this.helpScreen(); },
      quit: () => this.hooks.quit(),
    });
  }

  private subOut: Chair | null = null;
  subs(m: Match) {
    const team = m.human.team, lineup = m.lineup(team), bench = m.bench(team);
    const out = this.subOut && lineup.includes(this.subOut) ? this.subOut : null;
    const defs = lineup.map(c => c.def), total = lineupPoints(defs), limit = lineupLimit(defs);
    const bar = (v: number) => `<div class="bar ${v < 0.35 ? 'low' : ''}"><i style="width:${Math.round(v * 100)}%"></i></div>`;
    const onCards = lineup.map((c, i) => `<button class="pcard ${c === out ? 'sel' : ''}" data-a="out" data-v="${i}" ${c.penalty > 0 ? 'disabled' : ''}>
        <span class="num">#${c.def.number}</span> ${esc(c.def.name)}${c.def.female ? ' ♀' : ''} <span class="cls">${pts(c.cls)}</span>
        ${c.penalty > 0 ? '<br><small>In penalty box</small>' : ''}${bar(c.stamina)}</button>`).join('');
    const benchCards = bench.map((p, i) => {
      const ok = !out || validLineup(defs.map(d => d === out.def ? p : d));
      return `<button class="pcard ${ok ? '' : 'bad'}" data-a="in" data-v="${i}" ${out && ok ? '' : 'disabled'}>
        <span class="num">#${p.number}</span> ${esc(p.name)}${p.female ? ' ♀' : ''} <span class="cls">${pts(p.cls)}</span>${bar(m.stamina.get(p) ?? 1)}</button>`;
    }).join('');
    this.show(`
      <h2>Substitutions</h2>
      <div class="points ${total > limit ? 'bad' : ''}">On court: ${pts(total)} / ${pts(limit)} points</div>
      <div class="tag">${out ? `Pick who replaces #${out.def.number} ${esc(out.def.name)}` : 'Tap a player on court to take them off'}</div>
      <div class="lineup">${onCards}</div>
      <div class="tag">Bench</div>
      <div class="lineup">${benchCards || '<i>No bench players</i>'}</div>
      <div class="btns"><button class="btn" data-a="done">Back to the game</button></div>`, {
      out: v => { this.subOut = lineup[+v] === out ? null : lineup[+v]; this.subs(m); },
      in: v => { if (out && m.substitute(out, bench[+v])) this.subOut = null; this.subs(m); },
      done: () => { this.subOut = null; this.hooks.resume(); },
    });
  }

  fullTime(m: Match) {
    m.banner = null;
    const [a, b] = m.score, T = m.teams;
    const winner = a > b ? 0 : 1;
    const all = T.flatMap((t, ti) => t.players.map(p => ({ p, t, ti, s: m.stat(p) })));
    const mvp = all.slice().sort((x, y) => score(y.s) - score(x.s))[0];
    const rows = all.filter(r => score(r.s) > 0 || r.s.fouls > 0).sort((x, y) => score(y.s) - score(x.s)).slice(0, 10)
      .map(r => `<tr><td><span class="swatch" style="background:${r.t.primary}"></span> #${r.p.number} ${esc(r.p.name)}</td>
        <td>${r.s.goals}</td><td>${r.s.hits}</td><td>${r.s.steals}</td><td>${r.s.fouls}</td></tr>`).join('');
    this.show(`
      <h2>FULL TIME</h2>
      <div class="score-big"><span style="color:${T[0].primary}">${T[0].short}</span> ${a} – ${b} <span style="color:${T[1].primary}">${T[1].short}</span></div>
      <div class="tag">${esc(T[winner].name)} win${m.period > 4 ? ' in overtime' : ''}!</div>
      ${mvp ? `<div class="mvp">MVP: #${mvp.p.number} ${esc(mvp.p.name)} (${mvp.t.short}) — ${plural(mvp.s.goals, 'goal')}, ${plural(mvp.s.hits, 'big hit')}, ${plural(mvp.s.steals, 'steal')}</div>` : ''}
      <table><tr><th>Player</th><th>Goals</th><th>Big hits</th><th>Steals</th><th>Fouls</th></tr>${rows}</table>
      <div class="tag">Turnovers: ${T[0].short} ${m.turnovers[0]} · ${T[1].short} ${m.turnovers[1]} &nbsp; Fouls: ${T[0].short} ${m.fouls[0]} · ${T[1].short} ${m.fouls[1]}</div>
      <div class="row"><button class="btn" data-a="again">Rematch</button><button class="btn alt" data-a="menu">Main menu</button></div>`, {
      again: () => this.hooks.rematch(),
      menu: () => this.hooks.quit(),
    });
  }
}

function score(s: { goals: number; hits: number; steals: number; fouls: number }) { return s.goals * 3 + s.hits + s.steals * 2 - s.fouls; }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
