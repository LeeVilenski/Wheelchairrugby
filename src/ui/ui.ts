import './ui.css';
import { FIVES, FOCUS, FOCUS_STATS, FORMATS, GLOVES, HAIR_COLORS, HAIR_STYLES, LOGO_SHAPES, PATTERNS, SKIN, STAT_BUDGET, STAT_KEYS, STAT_LABELS, STANDARD, looksOf, statTotal, type Stats, autoLineup, canField, lineupLimit, lineupPoints, validLineup, type Focus, type TeamDef } from '../data/teams';
import { CLASSES, MAX_ROSTER, allTeams, decodeTeam, deleteTeam, encodeTeam, isCustom, newId, saveTeam, teamProblems, type StoredTeam } from '../data/store';
import { Chair } from '../entities/chair';
import { DRILLS, completedDrills } from '../game/training';
import { XP_PER_LEVEL, loadSeason, newSeason, nextOpponent as seasonOpponent, recordSeasonResult, saveSeason, table as seasonTable, type Progress, type Season } from '../game/season';
import { teamLogo } from './logo';
import { groupsOf, loadCup, newCup, nextOpponent, recordResult, saveCup, stageName, standings, type Cup } from '../game/cup';
import type { Match } from '../game/match';
import { DEFAULT_CUSTOM, type CustomRules } from '../game/rules';

export interface Settings {
  rules: 'Arcade' | 'Sim' | 'Custom';
  custom: CustomRules;
  quarterMinutes: number;
  camera: 'full' | 'follow';
  autoSubs: boolean;
  sound: boolean;
  difficulty: 'easy' | 'normal' | 'hard';
  effects: boolean;      // screen shake, flashes, slow-mo
  vibration: boolean;
  seenHelp: boolean;
  format: 'standard' | 'fives';
  voice: boolean;
}
const DEFAULTS: Settings = { custom: { ...DEFAULT_CUSTOM }, rules: 'Arcade', quarterMinutes: 3, camera: 'full', autoSubs: true, sound: true, difficulty: 'normal', effects: true, vibration: true, seenHelp: false, format: 'standard', voice: true };

export function loadSettings(): Settings {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('mb.settings') || '{}') };
    s.custom = { ...DEFAULT_CUSTOM, ...s.custom };
    return s;
  } catch { return { ...DEFAULTS, custom: { ...DEFAULT_CUSTOM } }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem('mb.settings', JSON.stringify(s)); } catch { /* private mode */ } }

export interface UiHooks {
  start(home: TeamDef, away: TeamDef, cup?: boolean, mode?: '1p' | 'vs' | 'coop', season?: boolean): void;
  resume(): void;
  quit(): void;
  rematch(): void;
  settingsChanged(s: Settings): void;
  training(drill: number): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const pts = (n: number) => n.toFixed(1);
/** Defensive (low-point, pick chair) vs attacking (high-point, winged chair) badge. Matches Chair.isDefensive. */
const role = (cls: number) => cls <= 1.5
  ? '<span class="role def" title="Defensive chair: front pick to hook and slow attackers">🛡 DEF</span>'
  : '<span class="role att" title="Attacking chair: fast ball carrier">⚡ ATT</span>';

/** DOM menus layered over the canvas. */
export class Ui {
  el = document.getElementById('ui') as HTMLDivElement;
  settings = loadSettings();
  home = 0; away = 1;
  mode: '1p' | 'vs' | 'coop' = '1p';
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
        <button class="btn alt" data-a="teams">Exhibition</button>
        <button class="btn alt" data-a="cup">🏆 Cup</button>
        <button class="btn alt" data-a="season">📅 Season</button>
        <button class="btn alt" data-a="train">🎓 Training</button>
        <button class="btn alt" data-a="editor">Team editor</button>
        <button class="btn alt" data-a="settings">Settings</button>
        <button class="btn ${this.settings.seenHelp ? 'alt' : ''}" data-a="help">${this.settings.seenHelp ? 'How to play' : '👋 New? How to play'}</button>
      </div>`, {
      quick: () => {
        const T = this.playable();
        this.home = Math.floor(Math.random() * T.length);
        do { this.away = Math.floor(Math.random() * T.length); } while (this.away === this.home);
        this.hooks.start(T[this.home], T[this.away]);
      },
      teams: () => this.teamSelect(),
      cup: () => { const c = loadCup(); c ?this.cupScreen(c) : this.cupPick(); },
      editor: () => this.teamManager(),
      train: () => this.trainingMenu(),
      season: () => { const se = loadSeason(); se ? this.seasonScreen(se) : this.seasonPick(); },
      settings: () => { this.back = () => this.title(); this.settingsScreen(); },
      help: () => {
        this.settings.seenHelp = true; saveSettings(this.settings);
        this.back = () => this.title(); this.helpScreen();
      },
    }, true);
  }

  /** Teams that can field a legal lineup in the current format. */
  playable() { const f = FORMATS[this.settings.format]; return allTeams().filter(t => canField(t, f)); }

  teamSelect() {
    const T = this.playable();
    if (this.home >= T.length) this.home = 0;
    if (this.away >= T.length || this.away === this.home) this.away = (this.home + 1) % T.length;
    const card = (i: number, who: string, side: string) => {
      const t = T[i];
      const rows = t.players.map(p => `<span class="cls">${pts(p.cls)}</span><span>${role(p.cls)} #${p.number} ${esc(p.name)}${p.female ? ' ♀' : ''}</span><span></span>`).join('');
      return `<div class="team-card" style="--c:${t.primary}">
        <div class="who">${who}</div>
        <div class="row"><button class="chip" data-a="prev" data-v="${side}">◀</button>
          <div class="name">${esc(t.name)}</div>
          <button class="chip" data-a="next" data-v="${side}">▶</button></div>
        <div>${teamLogo(t, 40)} <span class="swatch" style="background:${t.primary}"></span><span class="swatch" style="background:${t.secondary}"></span> ${t.short}</div>
        <div class="roster">${rows}</div></div>`;
    };
    const cycle = (side: string, d: number) => {
      const k = side === 'home' ? 'home' : 'away', other = side === 'home' ? this.away : this.home;
      let v = this[k];
      do { v = (v + d + T.length) % T.length; } while (v === other);
      this[k] = v; this.teamSelect();
    };
    this.show(`
      <h2>Choose teams${this.settings.format === 'fives' ? ' · Fives' : ''}</h2>
      <div class="row">${([['1p', '1 player'], ['vs', '2P versus'], ['coop', '2P co-op']] as const).map(([k, l]) =>
        `<button class="chip ${this.mode === k ? 'on' : ''}" data-a="mode" data-v="${k}">${l}</button>`).join('')}</div>
      ${this.mode !== '1p' ? '<p class="tag" style="font-size:13px">P1: WASD, Space push, E pass, Q bounce, F hype, Left Shift brake · P2: arrows, Enter push, . pass, , bounce, / hype, Right Shift brake. Two gamepads: one each.</p>' : ''}
      <div class="teams">${card(this.home, this.mode === 'coop' ? 'P1 + P2' : this.mode === 'vs' ? 'P1' : 'YOU', 'home')}<div class="vs">VS</div>${card(this.away, this.mode === 'vs' ? 'P2' : 'CPU', 'away')}</div>
      <div class="row"><button class="btn alt" data-a="back">Back</button><button class="btn alt" data-a="edit">Team editor</button><button class="btn" data-a="go">Play</button></div>`, {
      edit: () => this.teamManager(),
      prev: s => cycle(s, -1), next: s => cycle(s, 1),
      back: () => this.title(),
      go: () => this.hooks.start(T[this.home], T[this.away], false, this.mode),
      mode: v => { this.mode = v as typeof this.mode; this.teamSelect(); },
    });
  }

  // ---------------- Season ----------------
  private seasonTeam = 0;
  seasonPick(prev?: Season) {
    const T = this.playable();
    if (this.seasonTeam >= T.length) this.seasonTeam = 0;
    const t = T[this.seasonTeam];
    this.show(`
      <h2>📅 Season: choose your team</h2>
      <p class="tag">A six-team league: play every team once. Your players earn XP and level up, gaining stat points that carry into the next season.</p>
      <div class="team-card" style="--c:${t.primary};max-width:360px;margin:0 auto;width:100%">
        <div class="row"><button class="chip" data-a="prev">◀</button><div class="name">${esc(t.name)}</div><button class="chip" data-a="next">▶</button></div>
        <div>${teamLogo(t, 48)}</div>
      </div>
      <div class="row"><button class="btn alt" data-a="back">Back</button><button class="btn" data-a="go">Start season</button></div>`, {
      prev: () => { this.seasonTeam = (this.seasonTeam - 1 + T.length) % T.length; this.seasonPick(prev); },
      next: () => { this.seasonTeam = (this.seasonTeam + 1) % T.length; this.seasonPick(prev); },
      back: () => this.title(),
      go: () => { const se = newSeason(T[this.seasonTeam], T, this.settings.quarterMinutes, this.settings.format, prev); saveSeason(se); this.seasonScreen(se); },
    });
  }

  seasonScreen(se: Season, report: Progress[] = []) {
    const T = se.teams, opp = seasonOpponent(se), done = se.round >= 5;
    const rows = seasonTable(se).map((r, pos) => `<tr${r.i === 0 ? ' style="font-weight:800"' : ''}><td>${pos + 1}. ${teamLogo(T[r.i], 22)} ${esc(T[r.i].name)}${r.i === 0 ? ' (you)' : ''}</td>
      <td>${r.p}</td><td>${r.w}</td><td>${r.l}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td>${r.pts}</td></tr>`).join('');
    const champ = done ? seasonTable(se)[0].i : null;
    const squad = T[0].players.map(p => {
      const xp = p.xp ?? 0, lvl = Math.floor(xp / XP_PER_LEVEL) + 1, frac = (xp % XP_PER_LEVEL) / XP_PER_LEVEL;
      const bonus = Object.entries(p.bonus ?? {}).filter(([, v]) => v).map(([k, v]) => `${STAT_LABELS[k as keyof Stats]} +${v}`).join(', ');
      return `<div class="pcard" style="cursor:default"><span class="num">#${p.number}</span> ${esc(p.name)} <span class="cls">${pts(p.cls)}</span> ${role(p.cls)}
        <br><small>Level ${lvl}${bonus ? ` · ${bonus}` : ''}</small><div class="bar"><i style="width:${Math.round(frac * 100)}%;background:#ffe14d"></i></div></div>`;
    }).join('');
    const rep = report.filter(r => r.xp > 0).map(r => `<div>#${r.number} ${esc(r.name)}: +${r.xp} XP${r.levels ? ` · <b style="color:#ffe14d">LEVEL UP${r.gained.length ? ': ' + r.gained.map(g => STAT_LABELS[g] + ' +1').join(', ') : ''}</b>` : ''}</div>`).join('');
    this.show(`
      <h2>📅 Season ${se.year}${se.format === 'fives' ? ' · Fives' : ''}</h2>
      ${done ? `<div class="mvp">${champ === 0 ? `🏆 ${esc(T[0].name)} are league champions!` : `${esc(T[champ!].name)} win the league.`}</div>` : ''}
      ${se.champions.length ? `<div class="tag">Titles: ${se.champions.map(y => `Season ${y}`).join(', ')}</div>` : ''}
      ${rep ? `<div class="help" style="font-size:13px"><b>Last match</b>${rep}</div>` : ''}
      <table><tr><th>League</th><th>P</th><th>W</th><th>L</th><th>+/-</th><th>Pts</th></tr>${rows}</table>
      <div class="tag">Squad (XP: playing time, goals, big hits, steals and wins; every ${XP_PER_LEVEL} XP is a level and +1 stat)</div>
      <div class="lineup">${squad}</div>
      <div class="row">
        <button class="btn alt" data-a="menu">Main menu</button>
        ${opp !== null ? `<button class="btn" data-a="play">Round ${se.round + 1} of 5: vs ${esc(T[opp].short)}</button>` : ''}
        ${done ? '<button class="btn" data-a="next">Next season</button><button class="btn alt" data-a="keep">Save squad to Team editor</button>' : ''}
        <button class="btn alt" data-a="quit">${done ? 'End career' : 'Abandon season'}</button>
      </div>`, {
      menu: () => this.hooks.quit(),
      play: () => { if (opp !== null) this.hooks.start(T[0], T[opp], false, '1p', true); },
      next: () => { const pool = this.playable().filter(t => t.name !== T[0].name); const ns = newSeason(T[0], [T[0], ...pool], se.quarterMinutes, se.format, se); saveSeason(ns); this.seasonScreen(ns); },
      keep: () => { saveTeam({ ...structuredClone(T[0]), id: newId(), name: (T[0].name + ' ' + se.year).slice(0, 24) }); this.seasonScreen(se, report); alert('Saved to the Team editor.'); },
      quit: () => { if (confirm(done ? 'End this career? Progress will be lost.' : 'Abandon this season?')) { saveSeason(null); this.title(); } },
    });
  }
  inSeason = false;

  trainingMenu(msg = '') {
    const done = new Set(completedDrills());
    this.show(`
      <h2>🎓 Training</h2>
      ${msg ? `<div class="mvp">${msg}</div>` : '<p class="tag">Short drills that teach the controls and the rules. Each one leads into the next.</p>'}
      <div class="lineup">${DRILLS.map((d, i) => `<button class="pcard" data-a="go" data-v="${i}">${done.has(d.id) ? '✅' : '⬜'} <b>${esc(d.title)}</b></button>`).join('')}</div>
      <div class="btns"><button class="btn alt" data-a="back">Back</button></div>`, {
      go: v => this.hooks.training(+v),
      back: () => this.hooks.quit(),
    });
  }

  // ---------------- Cup ----------------
  private cupTeam = 0;
  private cupSize: 4 | 8 = 4;
  cupPick() {
    const T = this.playable();
    if (this.cupTeam >= T.length) this.cupTeam = 0;
    const t = T[this.cupTeam];
    this.show(`
      <h2>🏆 Cup: choose your team</h2>
      <div class="row">${([4, 8] as const).map(n => `<button class="chip ${this.cupSize === n ? 'on' : ''}" data-a="size" data-v="${n}" ${n === 8 && T.length < 8 ? 'disabled' : ''}>${n} teams</button>`).join('')}</div>
      <p class="tag">${this.cupSize === 8 ? 'Two groups of four. Group winners and runners-up go to the semi-finals, then the final.' : 'Four teams play each other once. The top two meet in the final.'}</p>
      <div class="team-card" style="--c:${t.primary};max-width:360px;margin:0 auto;width:100%">
        <div class="row"><button class="chip" data-a="prev">◀</button><div class="name">${esc(t.name)}</div><button class="chip" data-a="next">▶</button></div>
        <div>${teamLogo(t, 48)}</div>
      </div>
      <p class="tag">${this.settings.format === 'fives' ? 'Fives · ' : ''}${this.settings.quarterMinutes}-minute ${this.settings.format === 'fives' ? 'setting' : 'quarters'} · ${this.settings.difficulty} CPU · change in Settings</p>
      <div class="row"><button class="btn alt" data-a="back">Back</button><button class="btn" data-a="go">Start cup</button></div>`, {
      prev: () => { this.cupTeam = (this.cupTeam - 1 + T.length) % T.length; this.cupPick(); },
      next: () => { this.cupTeam = (this.cupTeam + 1) % T.length; this.cupPick(); },
      back: () => this.title(),
      go: () => { const c = newCup(T[this.cupTeam], T, this.settings.quarterMinutes, this.settings.format, this.cupSize); saveCup(c); this.cupScreen(c); },
      size: v => { this.cupSize = +v as 4 | 8; this.cupPick(); },
    });
  }

  cupScreen(c: Cup) {
    const T = c.teams, opp = nextOpponent(c);
    const name = (i: number) => `${teamLogo(T[i], 22)} ${esc(T[i].name)}${i === 0 ? ' (you)' : ''}`;
    const tables = groupsOf(c).map((g, gi) => `<table><tr><th>${c.size === 8 ? `Group ${'AB'[gi]}` : 'Group'}</th><th>P</th><th>W</th><th>L</th><th>+/-</th><th>Pts</th></tr>` +
      standings(c, g).map((r, pos) => `<tr${r.i === 0 ? ' style="font-weight:800"' : ''}><td>${pos + 1}. ${name(r.i)}</td>
      <td>${r.p}</td><td>${r.w}</td><td>${r.l}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td>${r.pts}</td></tr>`).join('') + '</table>').join('');
    const label = { G: '', SF: '<b>Semi:</b> ', F: '<b>Final:</b> ' };
    const res = c.results.slice(-8).map(r => `<div>${label[r.stage ?? 'G']}${esc(T[r.a].short)} ${r.sa} – ${r.sb} ${esc(T[r.b].short)}</div>`).join('');
    let headline = '';
    if (c.champion === 0) headline = `<div class="logo" style="font-size:56px">🏆</div><div class="mvp">${esc(T[0].name)} are cup champions!</div>`;
    else if (c.champion !== null) headline = `<div class="mvp">${esc(T[c.champion].name)} won the cup.${c.final?.includes(0) ? ' So close!' : ' Better luck next time!'}</div>`;
    else if (c.round === 4) headline = `<div class="mvp">THE FINAL: ${esc(T[c.final![0]].short)} vs ${esc(T[c.final![1]].short)}</div>`;
    else if (c.round === 3) headline = `<div class="mvp">SEMI-FINALS: ${c.semis!.map(([a, b]) => `${esc(T[a].short)} vs ${esc(T[b].short)}`).join(' · ')}</div>`;
    this.show(`
      <h2>🏆 ${c.format === 'fives' ? 'Fives ' : ''}Cup</h2>
      ${headline}
      ${tables}
      <div class="tag" style="font-size:13px">${res ? 'Latest results:' + res : 'No games played yet.'}</div>
      <div class="row">
        <button class="btn alt" data-a="menu">Main menu</button>
        ${c.champion !== null ? '<button class="btn" data-a="again">New cup</button>' : ''}
        ${opp !== null ? `<button class="btn" data-a="play">${stageName(c)}: vs ${esc(T[opp].short)}</button>` : ''}
        ${c.champion === null ? '<button class="btn alt" data-a="quit">Abandon cup</button>' : ''}
      </div>`, {
      menu: () => this.hooks.quit(),
      again: () => { saveCup(null); this.cupPick(); },
      play: () => { if (opp !== null) this.hooks.start(T[0], T[opp], true); },
      quit: () => { if (confirm('Abandon this cup?')) { saveCup(null); this.title(); } },
    });
  }

  teamManager(msg = '') {
    const T = allTeams();
    const rows = T.map((t, i) => `<div class="setting">
        <span>${teamLogo(t, 28)}
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
    const best5 = d.players.length >= 5 ? autoLineup(d.players, undefined, FIVES) : [];
    const fivesOk = validLineup(best5, FIVES);
    const clsOpts = (v: number) => CLASSES.map(c => `<option value="${c}" ${c === v ? 'selected' : ''}>${pts(c)}</option>`).join('');
    const focusOpts = (v: Focus, custom: boolean) => (Object.keys(FOCUS) as Focus[]).map(f => `<option value="${f}" ${!custom && f === v ? 'selected' : ''}>${FOCUS[f].label}</option>`).join('')
      + (custom ? '<option value="custom" selected>Custom</option>' : '');
    const inp = 'style="background:#0d1117;color:#fff;border:1px solid #3a4356;border-radius:8px;padding:6px 8px;font:600 14px system-ui;min-height:36px"';
    const rows = d.players.map((p, i) => `<div class="prow">
        <input data-f="p.${i}.number" type="number" min="0" max="99" value="${p.number}" style="width:64px;background:#0d1117;color:#fff;border:1px solid #3a4356;border-radius:8px;padding:6px;min-height:36px;font:600 14px system-ui" aria-label="Number">
        <input ${inp} data-f="p.${i}.name" maxlength="16" value="${esc(p.name)}" aria-label="Name" size="10">
        <select ${inp} data-f="p.${i}.cls" aria-label="Classification">${clsOpts(p.cls)}</select>
        <select ${inp} data-f="p.${i}.focus" aria-label="Focus">${focusOpts(p.focus ?? 'balanced', !!p.stats)}</select>
        <label style="font-size:13px"><input type="checkbox" data-f="p.${i}.female" ${p.female ? 'checked' : ''}> ♀</label>
        <button class="chip" data-a="player" data-v="${i}" aria-label="Customise stats and looks">✎ ${best.includes(p) ? '<small style="color:#4ade80">★</small>' : ''}</button>
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
        <span id="logo">${teamLogo(d, 72)}</span>
      </div>
      <div class="setting">Kit pattern<div class="opts">${PATTERNS.map(p => `<button class="chip ${(d.pattern ?? 'solid') === p ? 'on' : ''}" data-a="pattern" data-v="${p}">${p}</button>`).join('')}</div></div>
      <div class="setting">Badge<div class="opts">${LOGO_SHAPES.map(l => `<button class="chip ${(d.logo ?? 'shield') === l ? 'on' : ''}" data-a="logo" data-v="${l}">${teamLogo({ ...d, logo: l }, 26)}</button>`).join('')}</div></div>
      <p class="tag">Classification 0.5 (heavy blocker) to 3.5 (fast ball carrier). Starters: the best four within 8.0 points (+0.5 per female player).
        Focus: ${(Object.keys(FOCUS) as Focus[]).filter(f => f !== 'balanced').map(f => `<b>${FOCUS[f].label}</b>: ${FOCUS[f].desc.toLowerCase()}`).join(' · ')}.
        ✎ sets individual stats and looks. ★ = starter.</p>
      ${rows}
      <div class="row"><button class="chip" data-a="add" ${d.players.length >= MAX_ROSTER ? 'disabled' : ''}>+ Add player (${d.players.length}/${MAX_ROSTER})</button></div>
      ${probs.length ? `<div class="points bad">${probs.map(esc).join('<br>')}</div>` : `<div class="points">Starting four: ${pts(lineupPoints(best))} / ${pts(lineupLimit(best, STANDARD))} points ·
        Fives: ${fivesOk ? `${pts(lineupPoints(best5))} / ${pts(lineupLimit(best5, FIVES))} points` : '<span style="color:#f87171">needs 5 players within 10.0</span>'}</div>`}
      <div class="row"><button class="btn alt" data-a="cancel">Cancel</button><button class="btn" data-a="save">Save team</button></div>`, {
      add: () => {
        const used = new Set(d.players.map(p => p.number));
        let n = 1; while (used.has(n)) n++;
        d.players.push({ name: 'Rookie', number: n, cls: 1, focus: 'balanced' });
        this.rerender(() => this.editor(d));
      },
      rm: v => { d.players.splice(+v, 1); this.rerender(() => this.editor(d)); },
      player: v => this.playerEditor(d, +v),
      pattern: v => { d.pattern = v as typeof d.pattern; this.rerender(() => this.editor(d)); },
      logo: v => { d.logo = v as typeof d.logo; this.rerender(() => this.editor(d)); },
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
        if (k === 'focus' && value !== 'custom') { p.focus = value as Focus; p.stats = undefined; }
        if (k === 'female') p.female = checked;
      } else if (a === 'short') d.short = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      else if (a === 'name') d.name = value.slice(0, 24);
      else if (a === 'primary' || a === 'secondary') {
        d[a] = value; drawPreview(d);
        const lg = document.getElementById('logo'); if (lg) lg.innerHTML = teamLogo(d, 72);
      }
      if (structural) this.rerender(() => this.editor(d));
    };
    drawPreview(d);
  }

  playerEditor(d: StoredTeam, i: number) {
    const p = d.players[i];
    const st: Stats = { ...(p.stats ?? FOCUS_STATS[p.focus ?? 'balanced']) };
    const lk = { ...looksOf(p) };
    const total = statTotal(st);
    const statRows = STAT_KEYS.map(k => `<div class="setting"><span>${STAT_LABELS[k]}</span><span class="opts" style="align-items:center">
        <button class="chip" data-a="dec" data-v="${k}" ${st[k] <= 1 ? 'disabled' : ''}>−</button>
        <span style="font:900 16px ui-monospace,monospace;letter-spacing:2px">${'■'.repeat(st[k])}<span style="opacity:.25">${'■'.repeat(5 - st[k])}</span></span>
        <button class="chip" data-a="inc" data-v="${k}" ${st[k] >= 5 || total >= STAT_BUDGET ? 'disabled' : ''}>+</button></span></div>`).join('');
    const sw = (key: keyof typeof lk, colors: string[]) => colors.map((c, j) =>
      `<button class="chip ${lk[key] === j ? 'on' : ''}" data-a="look" data-v="${key}.${j}" style="background:${c};width:38px" aria-label="${key} ${j + 1}"></button>`).join('');
    this.show(`
      <h2>#${p.number} ${esc(p.name)}</h2>
      <div class="row" style="align-items:center">
        <canvas id="pprev" width="120" height="120" style="width:120px;height:120px;border-radius:12px;background:#d9a066"></canvas>
        <div class="tag">Class ${pts(p.cls)} ${role(p.cls)}${p.female ? ' · ♀' : ''}<br>Stat points: <b>${total} / ${STAT_BUDGET}</b><br>
          <span style="font-size:12px">Presets:</span> ${(Object.keys(FOCUS) as Focus[]).map(f => `<button class="chip" data-a="preset" data-v="${f}">${FOCUS[f].label}</button>`).join(' ')}</div>
      </div>
      ${statRows}
      <div class="setting">Skin<div class="opts">${sw('skin', SKIN)}</div></div>
      <div class="setting">Hair<div class="opts">${HAIR_STYLES.map((h, j) => `<button class="chip ${lk.hair === j ? 'on' : ''}" data-a="look" data-v="hair.${j}">${h}</button>`).join('')}</div></div>
      <div class="setting">Hair colour<div class="opts">${sw('hairColor', HAIR_COLORS)}</div></div>
      <div class="setting">Gloves<div class="opts">${sw('gloves', GLOVES)}</div></div>
      <div class="btns"><button class="btn" data-a="done">Done</button></div>`, {
      inc: k => { st[k as keyof Stats]++; p.stats = st; this.rerender(() => this.playerEditor(d, i)); },
      dec: k => { st[k as keyof Stats]--; p.stats = st; this.rerender(() => this.playerEditor(d, i)); },
      preset: f => { p.focus = f as Focus; p.stats = undefined; this.rerender(() => this.playerEditor(d, i)); },
      look: v => { const [k, j] = v.split('.'); (lk as Record<string, number>)[k] = +j; p.looks = lk; this.rerender(() => this.playerEditor(d, i)); },
      done: () => this.editor(d),
    });
    const cv = document.getElementById('pprev') as HTMLCanvasElement;
    const ctx = cv.getContext('2d')!; ctx.scale(70, 70);
    new Chair(0.85, 0.95, -Math.PI / 2, 0, d, p).draw(ctx);
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
      <div class="setting">Format<div class="opts">${chips('format', [['Standard 4v4', 'standard'], ['Fives 5v5', 'fives']])}</div></div>
      <div class="setting">CPU difficulty<div class="opts">${chips('difficulty', [['Easy', 'easy'], ['Normal', 'normal'], ['Hard', 'hard']])}</div></div>
      <div class="setting">Rules<div class="opts">${chips('rules', [['Arcade', 'Arcade'], ['Sim (IWRF)', 'Sim'], ['Custom', 'Custom']])}</div></div>
      ${s.rules === 'Custom' ? this.customRows() : ''}
      <div class="setting">Game length<div class="opts">${chips('quarterMinutes', this.settings.format === 'fives'
        ? [['2 × 4 min', 2], ['2 × 6 min', 3], ['2 × 10 min', 5], ['2 × 12 min (real)', 8]]
        : [['4 × 2 min', 2], ['4 × 3 min', 3], ['4 × 5 min', 5], ['4 × 8 min (real)', 8]])}</div></div>
      <div class="setting">Camera<div class="opts">${chips('camera', [['Full court', 'full'], ['Follow ball', 'follow']])}</div></div>
      <div class="setting">Sound<div class="opts">${chips('sound', [['On', true], ['Off', false]])}</div></div>
      ${'speechSynthesis' in window ? `<div class="setting">Announcer voice<div class="opts">${chips('voice', [['On', true], ['Off', false]])}</div></div>` : ''}
      <div class="setting">Screen shake &amp; flashes<div class="opts">${chips('effects', [['On', true], ['Reduced', false]])}</div></div>
      ${'vibrate' in navigator ? `<div class="setting">Vibration<div class="opts">${chips('vibration', [['On', true], ['Off', false]])}</div></div>` : ''}
      <div class="setting">Auto-subs for your team<div class="opts">${chips('autoSubs', [['On', true], ['Off', false]])}</div></div>
      <p class="tag">Fives (GBWR): 5 on court, 10.0 points, two halves, running clock except the last minutes of each half, 2 timeouts, max 3 in the penalty box.
        Arcade: shorter penalties, only big spinning hits are fouls. Sim: strict IWRF calls. Changes apply from the next match (camera: now).</p>
      <div class="btns"><button class="btn" data-a="back">Done</button></div>`, {
      set: v => {
        const [k, val] = JSON.parse(v) as [string, never];
        if (k.startsWith('custom.')) (this.settings.custom as unknown as Record<string, unknown>)[k.slice(7)] = val;
        else (this.settings[k as keyof Settings] as unknown) = val;
        saveSettings(this.settings); this.hooks.settingsChanged(this.settings); this.settingsScreen();
      },
      back: () => this.back(),
    });
  }

  private customRows() {
    const c = this.settings.custom;
    const row = (label: string, key: keyof CustomRules, opts: [string, unknown][]) =>
      `<div class="setting" style="margin-left:16px;font-weight:600">${label}<div class="opts">${opts.map(([l, v]) =>
        `<button class="chip ${c[key] === v ? 'on' : ''}" data-a="set" data-v='${JSON.stringify(['custom.' + key, v])}'>${l}</button>`).join('')}</div></div>`;
    const onOff: [string, unknown][] = [['On', true], ['Off', false]];
    return [
      row('Based on', 'base', [['Arcade', 'Arcade'], ['Sim', 'Sim']]),
      row('8 s dribble', 'dribble', onOff), row('40 s shot clock', 'shotClock', onOff), row('12 s half court', 'backcourt', onOff),
      row('Key rules', 'keyRules', onOff), row('Spinning fouls', 'spinning', onOff), row('Holding / hands fouls', 'handsFouls', onOff),
      row('Chairs tip over', 'tipping', onOff), row('Penalty length', 'longPenalties', [['30 s', false], ['60 s', true]]),
    ].join('');
  }

  helpScreen() {
    this.show(`
      <h2>How to play</h2>
      <div class="help">
        <h3>Controls</h3>
        <b>Touch:</b> drag on the left half to steer, tap PUSH for speed, PASS to pass (or switch player on defence), BOUNCE to reset the 8 s dribble clock.<br>
        <b>Keyboard:</b> W/↑ roll · A/D turn · Space push · E pass/switch · Q bounce · Shift brake · C camera · F hype · M mute · Esc pause.<br>
        <b>Gamepad:</b> left stick steer · A push · X pass · Y bounce · B brake · RB hype · Start pause.<br>
        <b>Two players (Exhibition):</b> P1 WASD, Space push, E pass, Q bounce, F hype, Left Shift brake · P2 arrows, Enter push, . pass, , bounce, / hype, Right Shift brake. Or one gamepad each.
        New to the game? Try <b>🎓 Training</b> on the title screen.
        <h3>Contact</h3>Hitting chairs is legal and part of the game. But hitting a chair behind its rear axle (spinning), holding a carrier, and reaching in from the side or behind with your hands are fouls. Really big hits can tip a chair over.
        <h3>Hype</h3>Big hits, steals, interceptions and goals fill your 🔥 meter. When it's full, hit HYPE for 6 seconds of extra speed and hits that always knock the ball loose. Score 3 in a row and your team is ON FIRE until the other team scores.
        <h3>Scoring</h3>Carry the ball over the opponents' goal line between the orange cones.
        <h3>Rules</h3>
        • Bounce or pass within <b>8 s</b>. • Inbounds: pass in from the side line within <b>8 s</b>. • Cross half way within <b>12 s</b>, and never go (or pass) back over it. • Score within <b>40 s</b>. • To score, both wheels must cross the line: once you're on it, go all the way.<br>
        • Attackers: max <b>10 s</b> in the opponents' key. • Defenders: max <b>3</b> in their own key.<br>
        • Hitting a chair <b>behind its rear axle</b> (spinning) is a foul: attackers lose the ball, defenders go to the penalty box.<br>
        • Every player has a classification from 0.5 to 3.5. Your four on court may total <b>8.0</b> (+0.5 per female player).
        Low pointers are heavy blockers, high pointers are fast ball carriers.<br>
        • Timeouts (4 per team, 2 in Fives): call one when you have the ball, or at a dead ball. Substitutions happen at dead balls and timeouts.
        <h3>Fives</h3>GB Wheelchair Rugby's five-a-side format: <b>5</b> players on court within <b>10.0</b> points (+0.5 per female player),
        two halves, a running clock that only stops in the last minutes of each half, 2 timeouts per team, and no more than
        <b>3</b> players in the penalty box at once — a 4th penalised player is substituted and waits off court.
      </div>
      <div class="btns"><button class="btn" data-a="back">Back</button></div>`, { back: () => this.back() });
  }

  pause(m: Match) {
    const teams = [...new Set(m.players.map(p => p.team))];
    const lbl = (t: number) => teams.length > 1 ? ` · ${m.teams[t].short}` : '';
    this.show(`
      <h2>Paused</h2>
      <div class="score-big">${m.teams[0].short} ${m.score[0]} – ${m.score[1]} ${m.teams[1].short}</div>
      <div class="btns">
        <button class="btn" data-a="resume">Resume</button>
        ${teams.map(t => `<button class="btn alt" data-a="timeout" data-v="${t}" ${m.canTimeout(t) ? '' : 'disabled'}>Timeout${lbl(t)} (${m.timeouts[t]} left)</button>`).join('')}
        ${teams.map(t => `<button class="btn alt" data-a="subs" data-v="${t}" ${m.isDead ? '' : 'disabled'}>Substitutions${lbl(t)}${m.isDead ? '' : ' (dead ball only)'}</button>`).join('')}
        <button class="btn alt" data-a="settings">Settings</button>
        <button class="btn alt" data-a="help">How to play</button>
        <button class="btn alt" data-a="quit">Quit to menu${(loadCup() && this.inCup) || (loadSeason() && this.inSeason) ? ' (counts as a loss)' : ''}</button>
      </div>`, {
      resume: () => this.hooks.resume(),
      timeout: v => { m.callTimeout(+v); this.subs(m, +v); },
      subs: v => this.subs(m, +v),
      settings: () => { this.back = () => this.pause(m); this.settingsScreen(); },
      help: () => { this.back = () => this.pause(m); this.helpScreen(); },
      quit: () => {
        const c = loadCup();
        if (c && this.inCup) { recordResult(c, m.score[0], Math.max(m.score[1], m.score[0] + 1)); /* quitting forfeits */ saveCup(c); }
        const se = loadSeason();
        if (se && this.inSeason) { recordSeasonResult(se, m.score[0], Math.max(m.score[1], m.score[0] + 1), []); saveSeason(se); }
        this.hooks.quit();
      },
    });
  }
  inCup = false;

  private subOut: Chair | null = null;
  subs(m: Match, team = m.human.team) {
    const lineup = m.lineup(team), bench = m.bench(team);
    const out = this.subOut && lineup.includes(this.subOut) ? this.subOut : null;
    const defs = lineup.map(c => c.def), total = lineupPoints(defs), limit = lineupLimit(defs, m.fmt);
    const bar = (v: number) => `<div class="bar ${v < 0.35 ? 'low' : ''}"><i style="width:${Math.round(v * 100)}%"></i></div>`;
    const onCards = lineup.map((c, i) => `<button class="pcard ${c === out ? 'sel' : ''}" data-a="out" data-v="${i}" ${c.penalty > 0 ? 'disabled' : ''}>
        <span class="num">#${c.def.number}</span> ${esc(c.def.name)}${c.def.female ? ' ♀' : ''} <span class="cls">${pts(c.cls)}</span> ${role(c.cls)}
        ${c.penalty > 0 ? '<br><small>In penalty box</small>' : ''}${bar(c.stamina)}</button>`).join('');
    const benchCards = bench.map((p, i) => {
      const waiting = m.waiting.has(p);
      const ok = !waiting && (!out || validLineup(defs.map(d => d === out.def ? p : d), m.fmt));
      return `<button class="pcard ${ok ? '' : 'bad'}" data-a="in" data-v="${i}" ${out && ok ? '' : 'disabled'}>
        <span class="num">#${p.number}</span> ${esc(p.name)}${p.female ? ' ♀' : ''} <span class="cls">${pts(p.cls)}</span> ${role(p.cls)}${waiting ? '<br><small>Waiting to serve penalty</small>' : ''}${bar(m.stamina.get(p) ?? 1)}</button>`;
    }).join('');
    this.show(`
      <h2>Substitutions · ${esc(m.teams[team].short)}</h2>
      <div class="points ${total > limit ? 'bad' : ''}">On court: ${pts(total)} / ${pts(limit)} points</div>
      <div class="tag">${role(0)} 0.5–1.5 point defenders &nbsp; ${role(2)} 2.0–3.5 point attackers</div>
      <div class="tag">${out ? `Pick who replaces #${out.def.number} ${esc(out.def.name)}` : 'Tap a player on court to take them off'}</div>
      <div class="lineup">${onCards}</div>
      <div class="tag">Bench</div>
      <div class="lineup">${benchCards || '<i>No bench players</i>'}</div>
      <div class="btns"><button class="btn" data-a="done">Back to the game</button></div>`, {
      out: v => { this.subOut = lineup[+v] === out ? null : lineup[+v]; this.subs(m, team); },
      in: v => { if (out && m.substitute(out, bench[+v])) this.subOut = null; this.subs(m, team); },
      done: () => { this.subOut = null; this.hooks.resume(); },
    });
  }

  fullTime(m: Match, cup = false) {
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
      <div class="score-big">${teamLogo(T[0], 56)} ${a} – ${b} ${teamLogo(T[1], 56)}</div>
      <div class="tag">${esc(T[winner].name)} win${m.inOvertime ? ' in overtime' : ''}!</div>
      ${mvp ? `<div class="mvp">MVP: #${mvp.p.number} ${esc(mvp.p.name)} (${mvp.t.short}) — ${plural(mvp.s.goals, 'goal')}, ${plural(mvp.s.hits, 'big hit')}, ${plural(mvp.s.steals, 'steal')}</div>` : ''}
      <table><tr><th>Player</th><th>Goals</th><th>Big hits</th><th>Steals</th><th>Fouls</th></tr>${rows}</table>
      <div class="tag">Turnovers: ${T[0].short} ${m.turnovers[0]} · ${T[1].short} ${m.turnovers[1]} &nbsp; Fouls: ${T[0].short} ${m.fouls[0]} · ${T[1].short} ${m.fouls[1]}</div>
      <div class="row">${this.inSeason ? '<button class="btn" data-a="season">Continue season</button>' : cup ? '<button class="btn" data-a="cup">Continue cup</button>'
        : '<button class="btn" data-a="again">Rematch</button><button class="btn alt" data-a="menu">Main menu</button>'}</div>`, {
      season: () => {
        const se = loadSeason(); if (!se) return this.title();
        const lines = m.teams[0].players.map(p => { const st = m.stat(p); return { goals: st.goals, hits: st.hits, steals: st.steals, played: m.playedBy.has(p) }; });
        const rep = recordSeasonResult(se, m.score[0], m.score[1], lines); saveSeason(se); this.seasonScreen(se, rep);
      },
      cup: () => { const c = loadCup(); if (c) { recordResult(c, m.score[0], m.score[1]); saveCup(c); this.cupScreen(c); } else this.title(); },
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
