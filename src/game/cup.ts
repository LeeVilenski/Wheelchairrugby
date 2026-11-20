import type { TeamDef } from '../data/teams';

/**
 * Cup. Team 0 is always the player's team. CPU-vs-CPU games are simulated.
 *  - 4 teams: one round-robin group (3 rounds), top two play the final.
 *  - 8 teams: two groups of four, then semi-finals (A1 v B2, B1 v A2) and a final.
 */
export type Stage = 'G' | 'SF' | 'F';
export interface Result { a: number; b: number; sa: number; sb: number; stage?: Stage; }
export interface Cup {
  teams: TeamDef[];
  size?: 4 | 8;
  results: Result[];
  round: number;               // 0..2 group rounds, 3 semi-finals, 4 final
  semis?: [number, number][];
  final: [number, number] | null;
  champion: number | null;
  quarterMinutes: number;
  format?: 'standard' | 'fives';
}

const ROUNDS: [number, number][][] = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
const KEY = 'mb.cup';

export const groupsOf = (c: Cup): number[][] => (c.size === 8 ? [[0, 1, 2, 3], [4, 5, 6, 7]] : [[0, 1, 2, 3]]);

export function newCup(you: TeamDef, pool: TeamDef[], quarterMinutes: number, format: 'standard' | 'fives' = 'standard', size: 4 | 8 = 4): Cup {
  const n = Math.min(size, pool.length) >= 8 ? 8 : 4;
  const others = pool.filter(t => t !== you).sort(() => Math.random() - 0.5).slice(0, n - 1);
  return { teams: [you, ...others], size: n as 4 | 8, results: [], round: 0, final: null, champion: null, quarterMinutes, format };
}
export function loadCup(): Cup | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null') as Cup | null;
    if (!c || !Array.isArray(c.teams) || (c.teams.length !== 4 && c.teams.length !== 8)) return null;
    if (!c.size) { // migrate cups saved before 8-team support (round 3 used to mean the final)
      c.size = 4;
      if (c.round === 3) c.round = 4;
      c.results.forEach((r, i) => { r.stage = i < 6 ? 'G' : 'F'; });
    }
    return c;
  } catch { return null; }
}
export function saveCup(c: Cup | null) {
  try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** All fixtures in the current round. */
function fixtures(c: Cup): [number, number][] {
  if (c.champion !== null) return [];
  if (c.round < 3) return groupsOf(c).flatMap(g => ROUNDS[c.round].map(([a, b]) => [g[a], g[b]] as [number, number]));
  if (c.round === 3) return c.semis ?? [];
  return c.final ? [c.final] : [];
}

/** The player's next opponent, or null if the player is out / the cup is over. */
export function nextOpponent(c: Cup): number | null {
  const f = fixtures(c).find(x => x.includes(0));
  return f ? (f[0] === 0 ? f[1] : f[0]) : null;
}
export function stageName(c: Cup) { return c.round < 3 ? `Round ${c.round + 1}` : c.round === 3 ? 'Semi-final' : 'Final'; }

export function simulate(c: Cup, a: number, b: number, stage: Stage = 'G'): Result {
  // Real wheelchair rugby averages roughly 1.6 goals per team per minute.
  const mean = c.quarterMinutes * 4 * 1.6;
  let sa = Math.round(mean * (0.8 + Math.random() * 0.4)), sb = Math.round(mean * (0.8 + Math.random() * 0.4));
  if (sa === sb) Math.random() < 0.5 ? sa++ : sb++; // overtime
  return { a, b, sa, sb, stage };
}

export function standings(c: Cup, group = groupsOf(c)[0]) {
  const rows = group.map(i => ({ i, p: 0, w: 0, l: 0, gf: 0, ga: 0, pts: 0 }));
  const row = (i: number) => rows.find(r => r.i === i);
  for (const r of c.results) {
    if ((r.stage ?? 'G') !== 'G') continue;
    const A = row(r.a), B = row(r.b);
    if (!A || !B) continue;
    A.p++; B.p++; A.gf += r.sa; A.ga += r.sb; B.gf += r.sb; B.ga += r.sa;
    if (r.sa > r.sb) { A.w++; B.l++; A.pts += 3; } else { B.w++; A.l++; B.pts += 3; }
  }
  return rows.sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
}

const winner = (r: Result) => (r.sa > r.sb ? r.a : r.b);

/** Record the player's match result and advance the cup, simulating everything the player isn't in. */
export function recordResult(c: Cup, you: number, them: number) {
  const opp = nextOpponent(c);
  if (opp === null) return;
  const stage: Stage = c.round < 3 ? 'G' : c.round === 3 ? 'SF' : 'F';
  const mine = fixtures(c).find(f => f.includes(0))!;
  const res: Result = mine[0] === 0 ? { a: 0, b: opp, sa: you, sb: them, stage } : { a: opp, b: 0, sa: them, sb: you, stage };
  const played: Result[] = [res, ...fixtures(c).filter(f => !f.includes(0)).map(([a, b]) => simulate(c, a, b, stage))];
  c.results.push(...played);
  advance(c, played);
}

function advance(c: Cup, played: Result[]) {
  if (c.round < 2) { c.round++; return; }
  if (c.round === 2) {
    if (c.size === 8) {
      const [A, B] = groupsOf(c).map(g => standings(c, g));
      c.semis = [[A[0].i, B[1].i], [B[0].i, A[1].i]];
      c.round = 3;
    } else {
      const [x, y] = standings(c);
      c.final = [x.i, y.i]; c.round = 4;
    }
  } else if (c.round === 3) {
    const winners = c.semis!.map(([a, b]) => winner(played.find(r => (r.a === a && r.b === b) || (r.a === b && r.b === a))!));
    c.final = [winners[0], winners[1]]; c.round = 4;
  } else {
    c.champion = winner(played[0]);
    return;
  }
  // The player is out: play out the rest of the cup.
  if (nextOpponent(c) === null && c.champion === null) {
    const rest = fixtures(c).map(([a, b]) => simulate(c, a, b, c.round === 3 ? 'SF' : 'F'));
    c.results.push(...rest);
    advance(c, rest);
  }
}
