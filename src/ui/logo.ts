import type { TeamDef } from '../data/teams';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Team badge as inline SVG: a shape in the primary colour, outlined in the secondary, with the short name. */
export function teamLogo(t: TeamDef, size = 36): string {
  const p = t.primary, s = t.secondary;
  const shapes: Record<string, string> = {
    shield: 'M50 4 L92 18 L86 62 Q72 88 50 96 Q28 88 14 62 L8 18 Z',
    circle: 'M50 4 A46 46 0 1 1 49.9 4 Z',
    star: 'M50 3 L62 36 L97 37 L69 58 L79 93 L50 72 L21 93 L31 58 L3 37 L38 36 Z',
    diamond: 'M50 2 L96 50 L50 98 L4 50 Z',
    bolt: 'M58 2 L18 56 L46 56 L38 98 L84 40 L54 40 Z',
  };
  const d = shapes[t.logo ?? 'shield'] ?? shapes.shield;
  const fs = t.short.length > 3 ? 22 : 28;
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${esc(t.name)} badge" style="vertical-align:middle;flex:none">
    <path d="${d}" fill="${p}" stroke="${s}" stroke-width="6" stroke-linejoin="round"/>
    <text x="50" y="${t.logo === 'star' ? 62 : 58}" text-anchor="middle" font-family="system-ui" font-weight="900" font-size="${fs}"
      fill="${s}" stroke="${p}" stroke-width="1.5" paint-order="stroke">${esc(t.short)}</text></svg>`;
}
