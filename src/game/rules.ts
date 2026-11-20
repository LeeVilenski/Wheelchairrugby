// IWRF rules, with an Arcade preset that keeps the structure but shortens / loosens things.
export interface RuleSet {
  name: 'Arcade' | 'Sim';
  quarterSeconds: number;
  overtimeSeconds: number;
  dribbleLimit: number;       // bounce or pass within N s
  shotClock: number;          // score within N s of gaining possession
  backcourtLimit: number;     // advance over half way within N s
  attackerKeyLimit: number;   // attackers may stay in the opponents' key N s
  maxDefendersInKey: number;
  penaltySeconds: number;     // or until the other team scores
  spinFoulSpeed: number;      // approach speed (m/s) for a hit behind the rear axle to be called
}

export const RULES: Record<'Arcade' | 'Sim', RuleSet> = {
  Arcade: { name: 'Arcade', quarterSeconds: 180, overtimeSeconds: 60, dribbleLimit: 10, shotClock: 40,
    backcourtLimit: 12, attackerKeyLimit: 10, maxDefendersInKey: 3, penaltySeconds: 30, spinFoulSpeed: 4.5 },
  Sim: { name: 'Sim', quarterSeconds: 480, overtimeSeconds: 180, dribbleLimit: 10, shotClock: 40,
    backcourtLimit: 12, attackerKeyLimit: 10, maxDefendersInKey: 3, penaltySeconds: 60, spinFoulSpeed: 3.2 },
};
