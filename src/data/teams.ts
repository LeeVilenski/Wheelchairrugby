export type Focus = 'balanced' | 'speed' | 'power' | 'hands';
export interface PlayerDef { name: string; number: number; cls: number; female?: boolean; focus?: Focus; }

/** Each focus trades one strength for another, so no build is strictly better. */
export const FOCUS: Record<Focus, { label: string; desc: string; speed: number; accel: number; mass: number; push: number; turn: number; hands: number }> = {
  balanced: { label: 'Balanced', desc: 'No strengths, no weaknesses', speed: 0, accel: 0, mass: 0, push: 0, turn: 0, hands: 0 },
  speed:    { label: 'Speed', desc: 'Faster, lighter (easier to knock around)', speed: 0.5, accel: 0.4, mass: -0.12, push: 0, turn: 0, hands: 0 },
  power:    { label: 'Power', desc: 'Heavier hits, bigger pushes, slower', speed: -0.4, accel: -0.2, mass: 0.15, push: 0.3, turn: 0, hands: 0 },
  hands:    { label: 'Hands', desc: 'Catches more, turns sharper, slightly slower', speed: -0.2, accel: 0, mass: -0.05, push: 0, turn: 0.4, hands: 0.15 },
};
export interface TeamDef { name: string; short: string; primary: string; secondary: string; players: PlayerDef[]; }

/** On-court size and classification limit. Standard IWRF: 4 players, 8.0. GBWR Fives: 5 players, 10.0. */
export interface Format { id: 'standard' | 'fives'; size: number; limit: number; }
export const STANDARD: Format = { id: 'standard', size: 4, limit: 8.0 };
export const FIVES: Format = { id: 'fives', size: 5, limit: 10.0 };
export const FORMATS = { standard: STANDARD, fives: FIVES };
export const POINT_LIMIT = STANDARD.limit;
export const FEMALE_ALLOWANCE = 0.5; // +0.5 to the limit per female player on court (both formats)

export function lineupPoints(ps: PlayerDef[]) { return ps.reduce((s, p) => s + p.cls, 0); }
export function lineupLimit(ps: PlayerDef[], f: Format = STANDARD) { return f.limit + ps.filter(p => p.female).length * FEMALE_ALLOWANCE; }
export function validLineup(ps: PlayerDef[], f: Format = STANDARD) { return ps.length === f.size && lineupPoints(ps) <= lineupLimit(ps, f) + 1e-9; }
export function canField(t: TeamDef, f: Format) { return validLineup(autoLineup(t.players, undefined, f), f); }

/** Best legal lineup: highest total points within the limit, weighted by freshness. */
export function autoLineup(roster: PlayerDef[], stamina: (p: PlayerDef) => number = () => 1, f: Format = STANDARD): PlayerDef[] {
  let best: PlayerDef[] = roster.slice(0, f.size), bestScore = -Infinity;
  const pick: PlayerDef[] = [];
  const rec = (start: number) => {
    if (pick.length === f.size) {
      if (!validLineup(pick, f)) return;
      const score = lineupPoints(pick) + pick.reduce((s, p) => s + stamina(p) * 3, 0);
      if (score > bestScore) { bestScore = score; best = pick.slice(); }
      return;
    }
    for (let i = start; i <= roster.length - (f.size - pick.length); i++) { pick.push(roster[i]); rec(i + 1); pick.pop(); }
  };
  rec(0);
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
