import type { TeamDef } from '../data/teams';

/**
 * Four-team cup: a round-robin group (3 rounds), then the top two meet in the final.
 * Team 0 is always the player's team. CPU-vs-CPU games are simulated.
 */
export interface Result { a: number; b: number; sa: number; sb: number; }
export interface Cup {
  teams: TeamDef[];
  results: Result[];
  round: number;               // 0..2 group rounds, 3 = final
  final: [number, number] | null;
  champion: number | null;
  quarterMinutes: number;
  format?: 'standard' | 'fives';
}

const ROUNDS: [number, number][][] = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
const KEY = 'mb.cup';

export function newCup(you: TeamDef, pool: TeamDef[], quarterMinutes: number, format: 'standard' | 'fives' = 'standard'): Cup {
  const others = pool.filter(t => t !== you).sort(() => Math.random() - 0.5).slice(0, 3);
  return { teams: [you, ...others], results: [], round: 0, final: null, champion: null, quarterMinutes, format };
}
export function loadCup(): Cup | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c && Array.isArray(c.teams) && c.teams.length === 4 ? c : null;
  } catch { return null; }
}
export function saveCup(c: Cup | null) {
  try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The player's next opponent, or null if the player is out / the cup is over. */
export function nextOpponent(c: Cup): number | null {
  if (c.champion !== null) return null;
  if (c.round < 3) return ROUNDS[c.round].find(f => f[0] === 0)![1];
  if (c.final && c.final.includes(0)) return c.final[0] === 0 ? c.final[1] : c.final[0];
  return null;
}

export function simulate(c: Cup, a: number, b: number): Result {
  // Real wheelchair rugby averages roughly 1.6 goals per team per minute.
  const mean = c.quarterMinutes * 4 * 1.6; // fives halves are ~twice a quarter, so the game length is similar
  let sa = Math.round(mean * (0.8 + Math.random() * 0.4)), sb = Math.round(mean * (0.8 + Math.random() * 0.4));
  if (sa === sb) Math.random() < 0.5 ? sa++ : sb++; // overtime
  return { a, b, sa, sb };
}

export function standings(c: Cup) {
  const rows = c.teams.map((_, i) => ({ i, p: 0, w: 0, l: 0, gf: 0, ga: 0, pts: 0 }));
  for (const r of c.results.slice(0, 6)) {
    const A = rows[r.a], B = rows[r.b];
    A.p++; B.p++; A.gf += r.sa; A.ga += r.sb; B.gf += r.sb; B.ga += r.sa;
    if (r.sa > r.sb) { A.w++; B.l++; A.pts += 3; } else { B.w++; A.l++; B.pts += 3; }
  }
  return rows.sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
}

/** Record the player's match result and advance the cup (simulating the other games). */
export function recordResult(c: Cup, you: number, them: number) {
  const opp = nextOpponent(c);
  if (opp === null) return;
  if (c.round < 3) {
    c.results.push({ a: 0, b: opp, sa: you, sb: them });
    for (const [a, b] of ROUNDS[c.round]) if (a !== 0) c.results.push(simulate(c, a, b));
    c.round++;
    if (c.round === 3) {
      const [first, second] = standings(c);
      c.final = [first.i, second.i];
      if (!c.final.includes(0)) finishFinal(c, simulate(c, first.i, second.i));
    }
  } else {
    const [a, b] = c.final!;
    finishFinal(c, a === 0 ? { a, b, sa: you, sb: them } : { a, b, sa: them, sb: you });
  }
}
function finishFinal(c: Cup, r: Result) { c.results.push(r); c.champion = r.sa > r.sb ? r.a : r.b; }
