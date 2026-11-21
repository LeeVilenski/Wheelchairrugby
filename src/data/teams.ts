export type Focus = 'balanced' | 'speed' | 'power' | 'hands';
/** Six stats from 1 to 5. Every player gets the same budget, so raising one means lowering another. */
export interface Stats { spd: number; acc: number; trn: number; hit: number; hnd: number; sta: number; }
export const STAT_KEYS: (keyof Stats)[] = ['spd', 'acc', 'trn', 'hit', 'hnd', 'sta'];
export const STAT_LABELS: Record<keyof Stats, string> = { spd: 'Speed', acc: 'Acceleration', trn: 'Turning', hit: 'Hitting', hnd: 'Handling', sta: 'Stamina' };
export const STAT_BUDGET = 18;
export const BALANCED_STATS: Stats = { spd: 3, acc: 3, trn: 3, hit: 3, hnd: 3, sta: 3 };
export const statTotal = (s: Stats) => STAT_KEYS.reduce((t, k) => t + s[k], 0);

export interface Looks { skin: number; hair: number; hairColor: number; gloves: number; }
export const SKIN = ['#f2d0b1', '#e0ac85', '#c68a5e', '#a0673f', '#7a4a2b', '#4f2e1c'];
export const HAIR_COLORS = ['#1b1b1b', '#5a3a1e', '#a0522d', '#d9b45a', '#c0c0c0', '#e04f7a'];
export const HAIR_STYLES = ['Bald', 'Short', 'Long', 'Mohawk', 'Bun'];
export const GLOVES = ['#222222', '#f5f5f5', '#ef4444', '#22c55e', '#3b82f6', '#f59e0b'];

export interface PlayerDef { name: string; number: number; cls: number; female?: boolean; focus?: Focus; stats?: Stats; looks?: Looks;
  /** Season mode: experience and earned bonus stat points (added on top of the budget). */
  xp?: number; bonus?: Partial<Stats>; }

/** Each focus trades one strength for another, so no build is strictly better. */
export const FOCUS: Record<Focus, { label: string; desc: string; speed: number; accel: number; mass: number; push: number; turn: number; hands: number }> = {
  balanced: { label: 'Balanced', desc: 'No strengths, no weaknesses', speed: 0, accel: 0, mass: 0, push: 0, turn: 0, hands: 0 },
  speed:    { label: 'Speed', desc: 'Faster, lighter (easier to knock around)', speed: 0.5, accel: 0.4, mass: -0.12, push: 0, turn: 0, hands: 0 },
  power:    { label: 'Power', desc: 'Heavier hits, bigger pushes, slower', speed: -0.4, accel: -0.2, mass: 0.15, push: 0.3, turn: 0, hands: 0 },
  hands:    { label: 'Hands', desc: 'Catches more, turns sharper, slightly slower', speed: -0.2, accel: 0, mass: -0.05, push: 0, turn: 0.4, hands: 0.15 },
};
export type Pattern = 'solid' | 'stripe' | 'hoops' | 'halves' | 'sash';
export const PATTERNS: Pattern[] = ['solid', 'stripe', 'hoops', 'halves', 'sash'];
export type LogoShape = 'shield' | 'circle' | 'star' | 'diamond' | 'bolt';
export const LOGO_SHAPES: LogoShape[] = ['shield', 'circle', 'star', 'diamond', 'bolt'];
export interface TeamDef { name: string; short: string; primary: string; secondary: string; players: PlayerDef[];
  pattern?: Pattern; logo?: LogoShape; }

/** Effective stats: explicit stats, else derived from the focus preset, plus season bonuses (capped at 7). */
export function statsOf(p: PlayerDef): Stats {
  const base = p.stats ?? FOCUS_STATS[p.focus ?? 'balanced'];
  const out = { ...base };
  for (const k of STAT_KEYS) out[k] = Math.min(7, out[k] + (p.bonus?.[k] ?? 0));
  return out;
}

/** Deterministic default looks from the player's name, so presets look varied. */
export function looksOf(p: PlayerDef): Looks {
  if (p.looks) return p.looks;
  let h = 0; for (const ch of p.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { skin: h % SKIN.length, hair: (h >> 3) % HAIR_STYLES.length, hairColor: (h >> 6) % HAIR_COLORS.length, gloves: 0 };
}

/** On-court size and classification limit. Standard IWRF: 4 players, 8.0. GBWR Fives: 5 players, 10.0. */
export interface Format { id: 'standard' | 'fives'; size: number; limit: number; }
export const STANDARD: Format = { id: 'standard', size: 4, limit: 8.0 };
// Focus presets expressed as stats (each sums to the budget).
export const FOCUS_STATS: Record<Focus, Stats> = {
  balanced: BALANCED_STATS,
  speed: { spd: 5, acc: 4, trn: 3, hit: 1, hnd: 3, sta: 2 },
  power: { spd: 2, acc: 2, trn: 3, hit: 5, hnd: 2, sta: 4 },
  hands: { spd: 2, acc: 3, trn: 5, hit: 2, hnd: 5, sta: 1 },
};
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
  { name: 'Harbour Hammers', pattern: 'stripe', logo: 'shield', short: 'HAM', primary: '#2f6fe0', secondary: '#ffd23f', players: [
    P('Okafor', 7, 3.0), P('Lindqvist', 11, 2.5), P('Reyes', 4, 1.5), P('Brandt', 2, 1.0),
    P('Achterberg', 8, 3.5), P('Silva', 5, 2.0, true), P('Doyle', 14, 0.5), P('Nakamura', 10, 1.5) ] },
  { name: 'Iron Valley Rams', pattern: 'halves', logo: 'star', short: 'IVR', primary: '#e0353f', secondary: '#f5f5f5', players: [
    P('Haddad', 9, 3.5), P('Moreau', 5, 2.0), P('Tanaka', 12, 1.5), P('Kowalski', 3, 1.0),
    P('Price', 6, 3.0), P('Osei', 15, 2.5, true), P('Varga', 1, 0.5), P('Bell', 13, 1.0) ] },
  { name: 'Northside Nomads', pattern: 'solid', logo: 'diamond', short: 'NOM', primary: '#16a34a', secondary: '#111827', players: [
    P('Fischer', 4, 3.0), P('Mensah', 7, 3.0), P('Quinn', 9, 1.0, true), P('Rossi', 2, 1.0),
    P('Kaur', 11, 2.0, true), P('Ward', 8, 1.5), P('Sato', 3, 0.5), P('Boateng', 12, 2.5) ] },
  { name: 'Copper Coast Cyclones', pattern: 'hoops', logo: 'bolt', short: 'CCC', primary: '#ea7c1a', secondary: '#1e3a8a', players: [
    P('Murphy', 10, 3.5), P('Lopez', 6, 2.5), P('Ivanova', 13, 1.0, true), P('Kim', 1, 1.0),
    P('Adeyemi', 5, 2.0), P('Novak', 9, 1.5), P('Hughes', 3, 0.5), P('Dubois', 15, 3.0) ] },
  { name: 'Midnight Marauders', pattern: 'sash', logo: 'star', short: 'MID', primary: '#7c3aed', secondary: '#a3e635', players: [
    P('Grant', 8, 3.0), P('Petrov', 12, 2.0), P('Ali', 4, 2.0), P('Horvat', 1, 1.0),
    P('Chen', 7, 3.5), P('Svensson', 11, 1.5, true), P('Ortiz', 2, 0.5), P('Walsh', 6, 2.5) ] },
  { name: 'Riverside Rollers', short: 'RIV', primary: '#0891b2', secondary: '#fef08a', pattern: 'hoops', logo: 'circle', players: [
    P('Abara', 9, 3.0), P('Lindgren', 4, 2.5, true), P('Moretti', 11, 2.0), P('Cruz', 2, 0.5),
    P('Hale', 6, 3.5), P('Nwosu', 13, 1.5), P('Becker', 1, 1.0, true), P('Sandoval', 8, 1.0) ] },
  { name: 'Steel Harbour Sentinels', short: 'SHS', primary: '#1f2937', secondary: '#f97316', pattern: 'sash', logo: 'bolt', players: [
    P('Kovac', 12, 3.5), P('Ferreira', 7, 2.0), P('Lund', 3, 1.5), P('Ito', 5, 1.0),
    P('Mbeki', 10, 3.0, true), P('Ryan', 14, 2.5), P('Duarte', 2, 0.5), P('Holm', 9, 1.5) ] },
  { name: 'Granite City Grizzlies', pattern: 'stripe', logo: 'shield', short: 'GCG', primary: '#64748b', secondary: '#f43f5e', players: [
    P('MacLeod', 3, 3.5), P('Bauer', 9, 2.5), P('Diallo', 14, 1.0), P('Young', 5, 1.0),
    P('Costa', 7, 3.0, true), P('Jensen', 10, 2.0), P('Park', 2, 0.5), P('Shah', 12, 1.5) ] },
];
