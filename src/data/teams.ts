export interface PlayerDef { name: string; number: number; cls: number; }
export interface TeamDef { name: string; short: string; primary: string; secondary: string; players: PlayerDef[]; }

// Classification totals must be <= 8.0 (enforced in the team editor, milestone 6).
export const DEFAULT_TEAMS: TeamDef[] = [
  {
    name: 'Harbour Hammers', short: 'HAM', primary: '#2f6fe0', secondary: '#ffd23f',
    players: [
      { name: 'Okafor', number: 7, cls: 3.0 },
      { name: 'Lindqvist', number: 11, cls: 2.5 },
      { name: 'Reyes', number: 4, cls: 1.5 },
      { name: 'Brandt', number: 2, cls: 1.0 },
    ],
  },
  {
    name: 'Iron Valley Rams', short: 'IVR', primary: '#e0353f', secondary: '#f5f5f5',
    players: [
      { name: 'Haddad', number: 9, cls: 3.5 },
      { name: 'Moreau', number: 5, cls: 2.0 },
      { name: 'Tanaka', number: 12, cls: 1.5 },
      { name: 'Kowalski', number: 3, cls: 1.0 },
    ],
  },
];
