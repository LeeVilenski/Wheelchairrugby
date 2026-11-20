import { DEFAULT_TEAMS, FOCUS, GLOVES, HAIR_COLORS, HAIR_STYLES, LOGO_SHAPES, PATTERNS, SKIN, STAT_BUDGET, STAT_KEYS, autoLineup, statTotal, validLineup,
  type Focus, type Looks, type LogoShape, type Pattern, type PlayerDef, type Stats, type TeamDef } from './teams';

const KEY = 'mb.teams';
export const MAX_ROSTER = 12;
export const CLASSES = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];

export interface StoredTeam extends TeamDef { id: string; }

export function customTeams(): StoredTeam[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.map(sanitize).filter((t): t is StoredTeam => !!t) : [];
  } catch { return []; }
}
function write(ts: StoredTeam[]) { try { localStorage.setItem(KEY, JSON.stringify(ts)); } catch { /* storage unavailable */ } }

export function allTeams(): TeamDef[] { return [...DEFAULT_TEAMS, ...customTeams()]; }
export function isCustom(t: TeamDef): t is StoredTeam { return 'id' in t; }

export function saveTeam(t: StoredTeam) {
  const ts = customTeams(), i = ts.findIndex(x => x.id === t.id);
  if (i >= 0) ts[i] = t; else ts.push(t);
  write(ts);
}
export function deleteTeam(id: string) { write(customTeams().filter(t => t.id !== id)); }
export function newId() { return Math.random().toString(36).slice(2, 10); }

/** Problems that stop a team being saved (empty = OK). */
export function teamProblems(t: TeamDef): string[] {
  const out: string[] = [];
  if (!t.name.trim()) out.push('Give the team a name.');
  if (!/^[A-Z0-9]{2,4}$/.test(t.short)) out.push('Short name must be 2–4 letters or numbers.');
  if (t.players.length < 4) out.push('A team needs at least 4 players.');
  if (t.players.length > MAX_ROSTER) out.push(`Rosters are limited to ${MAX_ROSTER} players.`);
  const nums = t.players.map(p => p.number);
  if (new Set(nums).size !== nums.length) out.push('Shirt numbers must be unique.');
  if (t.players.some(p => !p.name.trim())) out.push('Every player needs a name.');
  if (t.players.length >= 4 && !validLineup(autoLineup(t.players))) out.push('No four players fit the 8.0-point limit: add lower-point players.');
  for (const p of t.players) if (p.stats && statTotal(p.stats) > STAT_BUDGET) out.push(`#${p.number} ${p.name} uses more than ${STAT_BUDGET} stat points.`);
  return out;
}

// --- Share codes: compact JSON, base64url ---
export function encodeTeam(t: TeamDef): string {
  const c = { n: t.name, s: t.short, p: t.primary, q: t.secondary, t: t.pattern ?? 'solid', l: t.logo ?? 'shield',
    r: t.players.map(p => [p.name, p.number, p.cls, p.female ? 1 : 0, p.focus ?? 'balanced',
      p.stats ? STAT_KEYS.map(k => p.stats![k]) : 0, p.looks ? [p.looks.skin, p.looks.hair, p.looks.hairColor, p.looks.gloves] : 0]) };
  const bytes = new TextEncoder().encode(JSON.stringify(c));
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  return 'MB1.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeTeam(code: string): StoredTeam | null {
  try {
    const body = code.trim().replace(/^MB1\./, '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(body + '==='.slice((body.length + 3) % 4));
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
    return sanitize({ id: newId(), name: c.n, short: c.s, primary: c.p, secondary: c.q, pattern: c.t, logo: c.l,
      players: (c.r || []).map((r: unknown[]) => {
        const st = Array.isArray(r[5]) ? Object.fromEntries(STAT_KEYS.map((k, i) => [k, (r[5] as number[])[i]])) : undefined;
        const lk = Array.isArray(r[6]) ? { skin: r[6][0], hair: r[6][1], hairColor: r[6][2], gloves: r[6][3] } : undefined;
        return { name: r[0], number: r[1], cls: r[2], female: !!r[3], focus: r[4], stats: st, looks: lk };
      }) });
  } catch { return null; }
}

const COLOR = /^#[0-9a-f]{6}$/i;
/** Never trust stored or pasted data: coerce every field to something safe. */
function sanitize(x: unknown): StoredTeam | null {
  if (!x || typeof x !== 'object') return null;
  const t = x as Record<string, unknown>;
  const players = Array.isArray(t.players) ? t.players.slice(0, MAX_ROSTER).map((p: Record<string, unknown>): PlayerDef => ({
    name: String(p?.name ?? '').slice(0, 16),
    number: Math.max(0, Math.min(99, Math.round(Number(p?.number) || 0))),
    cls: CLASSES.includes(Number(p?.cls)) ? Number(p.cls) : 1,
    female: !!p?.female,
    focus: (Object.keys(FOCUS) as Focus[]).includes(p?.focus as Focus) ? p.focus as Focus : 'balanced',
    stats: cleanStats(p?.stats),
    looks: cleanLooks(p?.looks),
    xp: Math.max(0, Math.min(1e6, Number(p?.xp) || 0)) || undefined,
    bonus: cleanBonus(p?.bonus),
  })) : [];
  return {
    id: typeof t.id === 'string' ? t.id.slice(0, 16) : newId(),
    name: String(t.name ?? '').slice(0, 24),
    short: String(t.short ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4),
    primary: COLOR.test(String(t.primary)) ? String(t.primary) : '#2f6fe0',
    secondary: COLOR.test(String(t.secondary)) ? String(t.secondary) : '#ffffff',
    players,
    pattern: PATTERNS.includes(t.pattern as Pattern) ? t.pattern as Pattern : 'solid',
    logo: LOGO_SHAPES.includes(t.logo as LogoShape) ? t.logo as LogoShape : 'shield',
  };
}

const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
function cleanStats(x: unknown): Stats | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const st = Object.fromEntries(STAT_KEYS.map(k => [k, int(o[k], 1, 5, 3)])) as unknown as Stats;
  return statTotal(st) <= STAT_BUDGET ? st : undefined;
}
function cleanBonus(x: unknown): Partial<Stats> | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>, out: Partial<Stats> = {};
  for (const k of STAT_KEYS) if (o[k] !== undefined) out[k] = int(o[k], 0, 2, 0);
  return out;
}
function cleanLooks(x: unknown): Looks | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  return { skin: int(o.skin, 0, SKIN.length - 1, 2), hair: int(o.hair, 0, HAIR_STYLES.length - 1, 1),
    hairColor: int(o.hairColor, 0, HAIR_COLORS.length - 1, 0), gloves: int(o.gloves, 0, GLOVES.length - 1, 0) };
}
