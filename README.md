# Murderball! — arcade wheelchair rugby

A fast, top-down 4v4 wheelchair rugby game for the browser and phone, built on the real IWRF rules.

**Play:** https://murderball-mu.vercel.app (installable on phones: *Install* on Android, *Share → Add to Home Screen* on iPhone; works offline).

## Features
- **Real rules:** goal = carry the ball over the line between the cones · 10 s dribble · 12 s to cross half way · 40 s shot clock ·
  10 s attacker limit in the key · max 3 defenders in the key · spinning fouls · penalty box · 8.0-point classification limit (+0.5 per female player) ·
  quarters, overtime, timeouts and substitutions. Arcade (looser) and Sim (strict IWRF) presets.
- **Arcade feel:** momentum physics and big hits, Hype meter, ON FIRE streaks, chain blocks, slow-mo, announcer callouts, synthesised sound.
- **Teams:** 6 fictional presets, plus a team editor (colours, up to 12 players with class, focus and ♀) and shareable team codes.
- **Formats:** Standard (IWRF 4v4, 8.0 points, 4 quarters) and **Fives** (GBWR CD-001: 5v5, 10.0 points, two halves, running clock except the last 2 min, 2 timeouts, max 3 in the penalty box).
- **Modes:** Quick match, Exhibition, 4-team Cup; Easy/Normal/Hard CPU with press/trap defences and picks.
- **Controls:** touch (floating stick + buttons), keyboard and gamepad. Full-court or follow-ball camera.

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Steer / roll | W A S D / arrows | Left stick | Drag on the left half |
| Push | Space | A | PUSH |
| Pass / switch player | E | X | PASS |
| Bounce | Q | Y | BOUNCE |
| Brake | Shift | B / RT | BRAKE |
| Hype | F | RB | 🔥 |
| Pause | Esc / P | Start | ⏸ |
| Camera / mute | C / M | | top-right button |

## Develop
```sh
npm install
npm run dev        # local dev server (add -- --host to test on a phone on the same Wi-Fi)
npm run build      # type-check + production build into dist/
```

TypeScript + Vite + Canvas 2D, no game engine and no runtime dependencies. Code map:

```
src/main.ts          game loop, HUD, app flow
src/core/            input (keyboard/touch/gamepad), camera, physics, effects, audio
src/entities/        Chair (class-based stats), Ball
src/game/            Match (referee, clocks, fouls, subs, hype), rules presets, court, cup
src/ai/ai.ts         team tactics and player AI
src/data/            preset teams, lineup rules, saved teams + share codes
src/ui/              DOM menus (title, teams, editor, settings, pause, subs, full time, cup)
public/              PWA manifest, service worker, icons
```
