import { STAT_KEYS, statsOf, type PlayerDef, type Stats, type TeamDef } from '../data/teams';
import { simulate as simCup, type Result } from './cup';

/**
 * Season: a six-team league, everyone plays everyone once (5 rounds). Team 0 is the player's.
 * The player's squad earns XP from playing time, goals, big hits, steals and wins;
 * every 100 XP is a level, and each level adds a bonus stat point (max +2 per stat, +6 total).
 * Progression carries into the next season.
 */
export interface Season {
  year: number;
  teams: TeamDef[];
  results: Result[];
  round: number;               // 0..4, 5 = finished
  quarterMinutes: number;
  format?: 'standard' | 'fives';
  champions: number[];         // past seasons won by team 0 (years)
}

export const XP_PER_LEVEL = 100;
const KEY = 'mb.season';

/** Circle-method round robin for 6 teams: 5 rounds of 3 games. */
function roundPairs(r: number): [number, number][] {
  const ids = [0, 1, 2, 3, 4, 5];
  const rot = [ids[0], ...ids.slice(1).map((_, i) => ids[1 + ((i + r) % 5)])];
  return [[rot[0], rot[5]], [rot[1], rot[4]], [rot[2], rot[3]]];
}

export function newSeason(you: TeamDef, pool: TeamDef[], quarterMinutes: number, format: 'standard' | 'fives' = 'standard', prev?: Season): Season {
  const squad = structuredClone(you);
  const others = pool.filter(t => t.name !== you.name).sort(() => Math.random() - 0.5).slice(0, 5);
  return { year: (prev?.year ?? 0) + 1, teams: [squad, ...structuredClone(others)], results: [], round: 0, quarterMinutes, format,
    champions: prev?.champions ?? [] };
}
export function loadSeason(): Season | null {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && Array.isArray(s.teams) && s.teams.length === 6 ? s : null; }
  catch { return null; }
}
export function saveSeason(s: Season | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function nextOpponent(s: Season): number | null {
  if (s.round >= 5) return null;
  const f = roundPairs(s.round).find(p => p.includes(0))!;
  return f[0] === 0 ? f[1] : f[0];
}

export function table(s: Season) {
  const rows = s.teams.map((_, i) => ({ i, p: 0, w: 0, l: 0, gf: 0, ga: 0, pts: 0 }));
  for (const r of s.results) {
    const A = rows[r.a], B = rows[r.b];
    A.p++; B.p++; A.gf += r.sa; A.ga += r.sb; B.gf += r.sb; B.ga += r.sa;
    if (r.sa > r.sb) { A.w++; B.l++; A.pts += 3; } else { B.w++; A.l++; B.pts += 3; }
  }
  return rows.sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
}

export interface Progress { name: string; number: number; xp: number; levels: number; gained: (keyof Stats)[] }
export interface PlayerLine { goals: number; hits: number; steals: number; played: boolean }

/** Record the player's result, simulate the rest of the round, and award XP. Returns the progression report. */
export function recordSeasonResult(s: Season, you: number, them: number, lines: PlayerLine[]): Progress[] {
  const opp = nextOpponent(s);
  if (opp === null) return [];
  s.results.push({ a: 0, b: opp, sa: you, sb: them });
  const fake = { quarterMinutes: s.quarterMinutes } as Parameters<typeof simCup>[0];
  for (const [a, b] of roundPairs(s.round)) if (a !== 0 && b !== 0) s.results.push(simCup(fake, a, b));
  s.round++;
  if (s.round >= 5 && table(s)[0].i === 0) s.champions.push(s.year);

  const win = you > them;
  return s.teams[0].players.map((p, i) => {
    const l = lines[i] ?? { goals: 0, hits: 0, steals: 0, played: false };
    const gainedXp = (l.played ? 25 : 8) + l.goals * 12 + l.hits * 6 + l.steals * 10 + (win ? 20 : 0);
    const before = Math.floor((p.xp ?? 0) / XP_PER_LEVEL);
    p.xp = (p.xp ?? 0) + gainedXp;
    const levels = Math.floor(p.xp / XP_PER_LEVEL) - before;
    const gained: (keyof Stats)[] = [];
    for (let k = 0; k < levels; k++) { const g = levelUp(p); if (g) gained.push(g); }
    return { name: p.name, number: p.number, xp: gainedXp, levels, gained };
  });
}

/** Spend a level on the player's best stat that still has room (playing to their strengths). */
function levelUp(p: PlayerDef): keyof Stats | null {
  const bonus = p.bonus ?? (p.bonus = {});
  const total = STAT_KEYS.reduce((t, k) => t + (bonus[k] ?? 0), 0);
  if (total >= 6) return null;
  const st = statsOf(p);
  const k = STAT_KEYS.filter(k => (bonus[k] ?? 0) < 2).sort((a, b) => st[b] - st[a])[0];
  if (!k) return null;
  bonus[k] = (bonus[k] ?? 0) + 1;
  return k;
}
