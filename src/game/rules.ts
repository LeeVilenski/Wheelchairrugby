// IWRF rules, with an Arcade preset that keeps the structure but shortens / loosens things.
import { FORMATS, type Format } from '../data/teams';

export interface RuleSet {
  name: 'Arcade' | 'Sim' | 'Custom';
  format: Format;
  periods: number;            // 4 quarters (standard) or 2 halves (fives)
  periodSeconds: number;
  timeouts: number;
  runningClock: boolean;      // fives: clock keeps running through stoppages...
  clockStopsLast: number;     // ...except in the last N seconds of each period
  maxInBox: number;           // fives: max 3 players serving penalties at once
  overtimeSeconds: number;
  dribbleLimit: number;       // bounce or pass within N s
  shotClock: number;          // score within N s of gaining possession
  backcourtLimit: number;     // advance over half way within N s
  attackerKeyLimit: number;   // attackers may stay in the opponents' key N s
  maxDefendersInKey: number;
  penaltySeconds: number;     // or until the other team scores
  spinFoulSpeed: number;      // approach speed (m/s) for a hit behind the rear axle to be called
  handsFouls: boolean;        // holding / illegal use of hands
  tipping: boolean;           // huge hits can tip a chair over
}

/** Rule switches for the Custom preset. */
export interface CustomRules {
  base: 'Arcade' | 'Sim';
  dribble: boolean; shotClock: boolean; backcourt: boolean; keyRules: boolean;
  spinning: boolean; handsFouls: boolean; tipping: boolean; longPenalties: boolean;
}
export const DEFAULT_CUSTOM: CustomRules = { base: 'Arcade', dribble: true, shotClock: true, backcourt: true, keyRules: true,
  spinning: true, handsFouls: true, tipping: true, longPenalties: false };

function std(periodSeconds: number) {
  return { format: FORMATS.standard, periods: 4, periodSeconds, timeouts: 4, runningClock: false, clockStopsLast: 0, maxInBox: Infinity };
}

export const RULES: Record<'Arcade' | 'Sim', RuleSet> = {
  Arcade: { name: 'Arcade', ...std(180), overtimeSeconds: 60, dribbleLimit: 10, shotClock: 40,
    backcourtLimit: 12, attackerKeyLimit: 10, maxDefendersInKey: 3, penaltySeconds: 30, spinFoulSpeed: 4.5, handsFouls: true, tipping: true },
  Sim: { name: 'Sim', ...std(480), overtimeSeconds: 180, dribbleLimit: 10, shotClock: 40,
    backcourtLimit: 12, attackerKeyLimit: 10, maxDefendersInKey: 3, penaltySeconds: 60, spinFoulSpeed: 3.2, handsFouls: true, tipping: false },
};

/**
 * Build the rules for a match. `minutes` is the quarter-length setting (2/3/5/8).
 * Fives (GBWR CD-001): 5 on court, 10.0 points, 2 x 12 min halves, running clock except the
 * last 2 min of each half, 2 timeouts, max 3 in the penalty box. Shorter halves scale down,
 * as the rules allow.
 */
export function buildRules(preset: 'Arcade' | 'Sim' | 'Custom', format: 'standard' | 'fives', minutes: number, custom: CustomRules = DEFAULT_CUSTOM): RuleSet {
  let base: RuleSet = RULES[preset === 'Custom' ? custom.base : preset];
  if (preset === 'Custom') {
    const off = Infinity;
    base = { ...base, name: 'Custom',
      dribbleLimit: custom.dribble ? base.dribbleLimit : off,
      shotClock: custom.shotClock ? base.shotClock : off,
      backcourtLimit: custom.backcourt ? base.backcourtLimit : off,
      attackerKeyLimit: custom.keyRules ? base.attackerKeyLimit : off,
      maxDefendersInKey: custom.keyRules ? base.maxDefendersInKey : off,
      spinFoulSpeed: custom.spinning ? base.spinFoulSpeed : off,
      handsFouls: custom.handsFouls, tipping: custom.tipping,
      penaltySeconds: custom.longPenalties ? 60 : 30 };
  }
  if (format === 'standard') return { ...base, periodSeconds: minutes * 60 };
  const half = minutes === 8 ? 720 : minutes * 120;
  return { ...base, format: FORMATS.fives, periods: 2, periodSeconds: half, timeouts: 2,
    runningClock: true, clockStopsLast: half === 720 ? 120 : Math.round(half / 6), maxInBox: 3 };
}
