import './ui.css';
import { FOCUS, autoLineup, lineupLimit, lineupPoints, validLineup, type Focus, type TeamDef } from '../data/teams';
import { CLASSES, MAX_ROSTER, allTeams, decodeTeam, deleteTeam, encodeTeam, isCustom, newId, saveTeam, teamProblems, type StoredTeam } from '../data/store';
import { Chair } from '../entities/chair';
import { TIMEOUTS_PER_GAME, type Match } from '../game/match';

export interface Settings {
  rules: 'Arcade' | 'Sim';
  quarterMinutes: number;
  camera: 'full' | 'follow';
  autoSubs: boolean;
  sound: boolean;
}
const DEFAULTS: Settings = { rules: 'Arcade', quarterMinutes: 3, camera: 'full', autoSubs: true, sound: true };

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

  private fields: (path: string, value: string, checked: boolean, structural: boolean) => void = () => {};

  constructor(private hooks: UiHooks) {
    const onField = (e: Event, structural: boolean) => {
      const t = e.target as HTMLInputElement;
      // Only dropdowns/checkboxes re-render; re-rendering on text change would steal focus mid-edit.
      const reRender = structural && (t.tagName === 'SELECT' || t.type === 'checkbox');
      if (t.dataset?.f) this.fields(t.dataset.f, t.value, t.checked, reRender);
    };
    this.el.addEventListener('input', e => onField(e, false));
    this.el.addEventListener('change', e => onField(e, true));
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
    this.fields = () => {};
    this.el.innerHTML = `<div class="panel">${html}</div>`;
    this.el.classList.add('open');
    this.el.classList.toggle('title', title);
    this.el.scrollTop = 0;
    (this.el.querySelector('.btn') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  title() {
    this.show(`
      <h1 class="logo">MURDERBALL!</h1>
      <p class="tag">Arcade wheelchair rugby</p>
      <div class="btns">
        <button class="btn" data-a="quick">Quick match</button>
        <button class="btn alt" data-a="teams">Choose teams</button>
        <button class="btn alt" data-a="editor">Team editor</button>
        <button class="btn alt" data-a="settings">Settings</button>
        <button class="btn alt" data-a="help">How to play</button>
      </div>`, {
      quick: () => {
        const T = allTeams();
        this.home = Math.floor(Math.random() * T.length);
        do { this.away = Math.floor(Math.random() * T.length); } while (this.away === this.home);
        this.hooks.start(T[this.home], T[this.away]);
      },
      teams: () => this.teamSelect(),
      editor: () => this.teamManager(),
      settings: () => { this.back = () => this.title(); this.settingsScreen(); },
      help: () => { this.back = () => this.title(); this.helpScreen(); },
    }, true);
  }

  teamSelect() {
    const T = allTeams();
    if (this.home >= T.length) this.home = 0;
    if (this.away >= T.length || this.away === this.home) this.away = (this.home + 1) % T.length;
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
      <div class="row"><button class="btn alt" data-a="back">Back</button><button class="btn alt" data-a="edit">Team editor</button><button class="btn" data-a="go">Play</button></div>`, {
      edit: () => this.teamManager(),
      prev: s => cycle(s, -1), next: s => cycle(s, 1),
      back: () => this.title(),
      go: () => this.hooks.start(T[this.home], T[this.away]),
    });
  }

  teamManager(msg = '') {
    const T = allTeams();
    const rows = T.map((t, i) => `<div class="setting">
        <span><span class="swatch" style="background:${t.primary}"></span><span class="swatch" style="background:${t.secondary}"></span>
          ${esc(t.name)} <small style="opacity:.6">${t.short}${isCustom(t) ? '' : ' · preset'}</small></span>
        <span class="opts">
          ${isCustom(t) ? `<button class="chip" data-a="edit" data-v="${i}">Edit</button>` : ''}
          <button class="chip" data-a="copy" data-v="${i}">Copy</button>
          <button class="chip" data-a="share" data-v="${i}">Share</button>
          ${isCustom(t) ? `<button class="chip" data-a="del" data-v="${i}">Delete</button>` : ''}
        </span></div>`).join('');
    this.show(`
      <h2>Team editor</h2>
      ${msg ? `<div class="mvp">${msg}</div>` : ''}
      <div class="row"><button class="btn" data-a="new">New team</button><button class="btn alt" data-a="import">Import code</button></div>
      ${rows}
      <div class="btns"><button class="btn alt" data-a="back">Back</button></div>`, {
      new: () => this.editor({ id: newId(), name: 'New Team', short: 'NEW', primary: '#0ea5e9', secondary: '#fde047',
        players: [['Ace', 1, 3], ['Blaze', 2, 2.5], ['Crash', 3, 1.5], ['Dozer', 4, 1], ['Echo', 5, 2], ['Flint', 6, 0.5]]
          .map(([name, number, cls]) => ({ name: name as string, number: number as number, cls: cls as number, focus: 'balanced' as Focus })) }),
      edit: v => this.editor(structuredClone(T[+v]) as StoredTeam),
      copy: v => { const c = structuredClone(T[+v]) as StoredTeam; c.id = newId(); c.name = (c.name + ' II').slice(0, 24); this.editor(c); },
      share: v => this.shareScreen(T[+v]),
      del: v => { const t = T[+v]; if (isCustom(t) && confirm(`Delete ${t.name}?`)) { deleteTeam(t.id); this.teamManager('Team deleted.'); } },
      import: () => this.importScreen(),
      back: () => this.title(),
    });
  }

  shareScreen(t: TeamDef) {
    const code = encodeTeam(t);
    this.show(`
      <h2>Share ${esc(t.name)}</h2>
      <p class="tag">Send this code to a friend. They paste it under Team editor → Import code.</p>
      <textarea readonly style="width:100%;min-height:110px;font:13px ui-monospace,monospace;border-radius:10px;padding:10px;background:#1a2030;color:#fff;border:0">${code}</textarea>
      <div class="row"><button class="btn" data-a="copy">Copy code</button><button class="btn alt" data-a="back">Back</button></div>`, {
      copy: async () => {
        try { await navigator.clipboard.writeText(code); this.teamManager('Code copied!'); }
        catch { (this.el.querySelector('textarea') as HTMLTextAreaElement).select(); }
      },
      back: () => this.teamManager(),
    });
  }

  importScreen(err = '') {
    this.show(`
      <h2>Import a team</h2>
      ${err ? `<div class="points bad">${err}</div>` : ''}
      <textarea id="code" placeholder="Paste a MB1… team code" style="width:100%;min-height:110px;font:13px ui-monospace,monospace;border-radius:10px;padding:10px;background:#1a2030;color:#fff;border:0"></textarea>
      <div class="row"><button class="btn" data-a="go">Import</button><button class="btn alt" data-a="back">Back</button></div>`, {
      go: () => {
        const t = decodeTeam((this.el.querySelector('#code') as HTMLTextAreaElement).value);
        if (!t) return this.importScreen("That code didn't work. Check it was copied in full.");
        const probs = teamProblems(t);
        if (probs.length) return this.importScreen(probs.join(' '));
        saveTeam(t); this.teamManager(`${esc(t.name)} imported!`);
      },
      back: () => this.teamManager(),
    });
  }

  editor(d: StoredTeam) {
    const probs = teamProblems(d);
    const best = d.players.length >= 4 ? autoLineup(d.players) : [];
    const clsOpts = (v: number) => CLASSES.map(c => `<option value="${c}" ${c === v ? 'selected' : ''}>${pts(c)}</option>`).join('');
    const focusOpts = (v: Focus) => (Object.keys(FOCUS) as Focus[]).map(f => `<option value="${f}" ${f === v ? 'selected' : ''}>${FOCUS[f].label}</option>`).join('');
    const inp = 'style="background:#0d1117;color:#fff;border:1px solid #3a4356;border-radius:8px;padding:6px 8px;font:600 14px system-ui;min-height:36px"';
    const rows = d.players.map((p, i) => `<div class="prow">
        <input data-f="p.${i}.number" type="number" min="0" max="99" value="${p.number}" style="width:64px;background:#0d1117;color:#fff;border:1px solid #3a4356;border-radius:8px;padding:6px;min-height:36px;font:600 14px system-ui" aria-label="Number">
        <input ${inp} data-f="p.${i}.name" maxlength="16" value="${esc(p.name)}" aria-label="Name" size="10">
        <select ${inp} data-f="p.${i}.cls" aria-label="Classification">${clsOpts(p.cls)}</select>
        <select ${inp} data-f="p.${i}.focus" aria-label="Focus">${focusOpts(p.focus ?? 'balanced')}</select>
        <label style="font-size:13px"><input type="checkbox" data-f="p.${i}.female" ${p.female ? 'checked' : ''}> ♀</label>
        <small style="color:#4ade80">${best.includes(p) ? 'starter' : ''}</small>
        <button class="chip" data-a="rm" data-v="${i}" ${d.players.length <= 4 ? 'disabled' : ''} aria-label="Remove">✕</button>
      </div>`).join('');
    this.show(`
      <h2>Edit team</h2>
      <div class="row" style="align-items:center">
        <canvas id="preview" width="220" height="110" style="width:220px;height:110px;border-radius:12px;background:#d9a066"></canvas>
        <div style="display:flex;flex-direction:column;gap:8px;text-align:left">
          <label>Name <input ${inp} data-f="name" maxlength="24" value="${esc(d.name)}"></label>
          <label>Short <input ${inp} data-f="short" maxlength="4" size="4" value="${esc(d.short)}"></label>
          <label>Colours <input type="color" data-f="primary" value="${d.primary}"> <input type="color" data-f="secondary" value="${d.secondary}"></label>
        </div>
      </div>
      <p class="tag">Classification 0.5 (heavy blocker) to 3.5 (fast ball carrier). Starters: the best four within 8.0 points (+0.5 per female player).
        Focus: ${(Object.keys(FOCUS) as Focus[]).filter(f => f !== 'balanced').map(f => `<b>${FOCUS[f].label}</b>: ${FOCUS[f].desc.toLowerCase()}`).join(' · ')}.</p>
      ${rows}
      <div class="row"><button class="chip" data-a="add" ${d.players.length >= MAX_ROSTER ? 'disabled' : ''}>+ Add player (${d.players.length}/${MAX_ROSTER})</button></div>
      ${probs.length ? `<div class="points bad">${probs.map(esc).join('<br>')}</div>` : `<div class="points">Starting four: ${pts(lineupPoints(best))} / ${pts(lineupLimit(best))} points</div>`}
      <div class="row"><button class="btn alt" data-a="cancel">Cancel</button><button class="btn" data-a="save">Save team</button></div>`, {
      add: () => {
        const used = new Set(d.players.map(p => p.number));
        let n = 1; while (used.has(n)) n++;
        d.players.push({ name: 'Rookie', number: n, cls: 1, focus: 'balanced' });
        this.rerender(() => this.editor(d));
      },
      rm: v => { d.players.splice(+v, 1); this.rerender(() => this.editor(d)); },
      cancel: () => this.teamManager(),
      save: () => {
        if (teamProblems(d).length) return this.rerender(() => this.editor(d));
        saveTeam(d); this.teamManager(`${esc(d.name)} saved!`);
      },
    });
    this.fields = (path, value, checked, structural) => {
      const [a, i, k] = path.split('.');
      if (a === 'p') {
        const p = d.players[+i];
        if (k === 'name') p.name = value.slice(0, 16);
        if (k === 'number') p.number = Math.max(0, Math.min(99, Math.round(+value || 0)));
        if (k === 'cls') p.cls = +value;
        if (k === 'focus') p.focus = value as Focus;
        if (k === 'female') p.female = checked;
      } else if (a === 'short') d.short = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      else if (a === 'name') d.name = value.slice(0, 24);
      else if (a === 'primary' || a === 'secondary') { d[a] = value; drawPreview(d); }
      if (structural) this.rerender(() => this.editor(d));
    };
    drawPreview(d);
  }

  /** Re-render the current screen without losing the scroll position. */
  private rerender(fn: () => void) {
    const y = this.el.scrollTop; fn(); this.el.scrollTop = y;
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
      <div class="setting">Sound<div class="opts">${chips('sound', [['On', true], ['Off', false]])}</div></div>
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
        <b>Keyboard:</b> W/↑ roll · A/D turn · Space push · E pass/switch · Q bounce · Shift brake · C camera · F hype · M mute · Esc pause.<br>
        <b>Gamepad:</b> left stick steer · A push · X pass · Y bounce · B brake · RB hype · Start pause.
        <h3>Hype</h3>Big hits, steals, interceptions and goals fill your 🔥 meter. When it's full, hit HYPE for 6 seconds of extra speed and hits that always knock the ball loose. Score 3 in a row and your team is ON FIRE until the other team scores.
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

function drawPreview(t: TeamDef) {
  const cv = document.getElementById('preview') as HTMLCanvasElement | null;
  if (!cv) return;
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#d9a066'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.scale(60, 60);
  const a = new Chair(1.0, 1.05, -0.3, 0, t, { name: '', number: 7, cls: 3 });
  const b = new Chair(2.65, 1.05, 3.0, 0, t, { name: '', number: 2, cls: 0.5 });
  a.draw(ctx); b.draw(ctx);
}
