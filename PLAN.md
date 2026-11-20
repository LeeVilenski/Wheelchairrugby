# Murderball! — Wheelchair Rugby Arcade Game

Top-down 2D browser game. Real IWRF rules, arcade feel, customisable teams.

## Decisions
- **Art:** clean vector (Canvas 2D shapes), team colours applied procedurally
- **Camera:** full court by default; toggle to follow-cam (C key / on-screen button)
- **Controls:** keyboard (tank), gamepad (stick aim), touch (floating stick + PUSH/BRAKE buttons, PASS/HIT to come)
- **Stack:** TypeScript + Vite, no engine, static deploy

## Rules implemented (target)
4v4 on 28×15 m · goal = two wheels over the line with the ball · max 3 defenders in key ·
10 s in opponent key · 10 s dribble · 12 s half-court · 40 s shot clock · classification ≤ 8.0
(+0.5 per female player) · spinning (contact behind rear axle) foul · 1-min penalty box ·
4 × 8 min quarters, 3 min OT. Arcade / Sim / Custom rule presets.

## Milestones
1. ✅ Loop, court, one chair with momentum physics, camera modes, touch controls
2. ✅ Ball: carry, pass, bounce, 10 s dribble, scoring, out of bounds, turnovers
3. ✅ 4v4 + basic AI, mass-based collisions, hits, fumbles, player switching
4. ✅ Referee: game/shot/12 s clocks, quarters + OT, key rules, spinning fouls, penalty box, Arcade/Sim presets
5. ✅ Title/team-select/settings/help menus, pause, timeouts (4/team), 8-player rosters + subs with 8.0-point check, CPU auto-subs, full-time stats + MVP, attract-mode demo
6. ✅ Team editor: name/short/colours with live preview, up to 12 players (number, class, focus, ♀), 8.0 check, saved on device, share/import codes
7. ✅ Arcade juice: Hype meter + HYPE boost, ON FIRE streaks, chain blocks, hit-stop/slow-mo, flashes, tyre trails, flames, announcer callouts, synthesised sound + crowd
8. ✅ Team AI: press/trap schemes, picks, goal-line flooding, give-and-go passing, ball strips; Easy/Normal/Hard; 4-team Cup (group + final, saved on device)
9. Polish, deploy

## Run
`npm install && npm run dev`
