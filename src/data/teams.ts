export interface PlayerDef { name: string; number: number; cls: number; female?: boolean; }
export interface TeamDef { name: string; short: string; primary: string; secondary: string; players: PlayerDef[]; }

export const POINT_LIMIT = 8.0;
export const FEMALE_ALLOWANCE = 0.5; // +0.5 to the limit per female player on court

export function lineupPoints(ps: PlayerDef[]) { return ps.reduce((s, p) => s + p.cls, 0); }
export function lineupLimit(ps: PlayerDef[]) { return POINT_LIMIT + ps.filter(p => p.female).length * FEMALE_ALLOWANCE; }
export function validLineup(ps: PlayerDef[]) { return ps.length === 4 && lineupPoints(ps) <= lineupLimit(ps) + 1e-9; }

/** Best legal four: highest total points within the limit, weighted by freshness. */
export function autoLineup(roster: PlayerDef[], stamina: (p: PlayerDef) => number = () => 1): PlayerDef[] {
  let best: PlayerDef[] = roster.slice(0, 4), bestScore = -Infinity;
  const n = roster.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const ps = [roster[a], roster[b], roster[c], roster[d]];
    if (!validLineup(ps)) continue;
    const score = lineupPoints(ps) + ps.reduce((s, p) => s + stamina(p) * 3, 0);
    if (score > bestScore) { bestScore = score; best = ps; }
  }
  return best;
}

const P = (name: string, number: number, cls: number, female = false): PlayerDef => ({ name, number, cls, female });

// Fictional teams. Each roster has 8 players; the default four are chosen by autoLineup.
export const DEFAULT_TEAMS: TeamDef[] = [
  { name: 'Harbour Hammers', short: 'HAM', primary: '#2f6fe0', secondary: '#ffd23f', players: [
    P('Okafor', 7, 3.0), P('Lindqvist', 11, 2.5), P('Reyes', 4, 1.5), P('Brandt', 2, 1.0),
    P('Achterberg', 8, 3.5), P('Silva', 5, 2.0, true), P('Doyle', 14, 0.5), P('Nakamura', 10, 1.5) ] },
  { name: 'Iron Valley Rams', short: 'IVR', primary: '#e0353f', secondary: '#f5f5f5', players: [
    P('Haddad', 9, 3.5), P('Moreau', 5, 2.0), P('Tanaka', 12, 1.5), P('Kowalski', 3, 1.0),
    P('Price', 6, 3.0), P('Osei', 15, 2.5, true), P('Varga', 1, 0.5), P('Bell', 13, 1.0) ] },
  { name: 'Northside Nomads', short: 'NOM', primary: '#16a34a', secondary: '#111827', players: [
    P('Fischer', 4, 3.0), P('Mensah', 7, 3.0), P('Quinn', 9, 1.0, true), P('Rossi', 2, 1.0),
    P('Kaur', 11, 2.0, true), P('Ward', 8, 1.5), P('Sato', 3, 0.5), P('Boateng', 12, 2.5) ] },
  { name: 'Copper Coast Cyclones', short: 'CCC', primary: '#ea7c1a', secondary: '#1e3a8a', players: [
    P('Murphy', 10, 3.5), P('Lopez', 6, 2.5), P('Ivanova', 13, 1.0, true), P('Kim', 1, 1.0),
    P('Adeyemi', 5, 2.0), P('Novak', 9, 1.5), P('Hughes', 3, 0.5), P('Dubois', 15, 3.0) ] },
  { name: 'Midnight Marauders', short: 'MID', primary: '#7c3aed', secondary: '#a3e635', players: [
    P('Grant', 8, 3.0), P('Petrov', 12, 2.0), P('Ali', 4, 2.0), P('Horvat', 1, 1.0),
    P('Chen', 7, 3.5), P('Svensson', 11, 1.5, true), P('Ortiz', 2, 0.5), P('Walsh', 6, 2.5) ] },
  { name: 'Granite City Grizzlies', short: 'GCG', primary: '#64748b', secondary: '#f43f5e', players: [
    P('MacLeod', 3, 3.5), P('Bauer', 9, 2.5), P('Diallo', 14, 1.0), P('Young', 5, 1.0),
    P('Costa', 7, 3.0, true), P('Jensen', 10, 2.0), P('Park', 2, 0.5), P('Shah', 12, 1.5) ] },
];
