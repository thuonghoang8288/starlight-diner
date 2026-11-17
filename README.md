# Starlight Diner — a cosmic café

Run a diner on a space station. Alien guests arrive, sit down and order
star-food. Cook dishes at the stations, serve them before patience runs
out, earn coins and tips, keep the combo alive. Three walkouts and the
day fails; hit the coin target to open the next day. Three days, then
you win. Spend coins on upgrades between days.

## Play

Open `game/index.html` in a desktop browser (or serve `game/` with any
static server — `node serve.ts` serves it on http://localhost:8080).
No network, no downloads: the game is static files only, and its sounds
are synthesized in the browser.

- **Mouse:** click a station to cook · click a cooked dish on the pass,
  then click the guest who ordered it · click buttons.
- **Keyboard:** `1-4` cook a dish · `Space`/`P` pause · `Enter` start /
  continue · `M` mute.

## The diner

- **Dishes:** Star Soup (10c), Comet Coffee (12c), Moon Pie (14c),
  Nebula Salad (18c). Faster dishes pay less; slow ones pay more.
- **Guests:** Blorps are patient, Zaps are impatient but tip well,
  Mollies and Elders order two dishes. A golden Nova VIP appears once
  a day and tips triple.
- **Days:** Day 1 target 120 coins, Day 2 target 200, Day 3 target 280.
  Rush hour hits mid-day with a burst of guests.
- **Upgrades (between days):** Turbo Oven (cook 30% faster), Extra
  Table (+1 table), Calm Music (patience +25%), Golden Tips (tips +25%).

## Build

`main.ts` (Node 22, standard library only) hands the entry in: it
copies `game/` and `screenshots/` to `/output` and writes
`/output/dossier.json` with the vendored make.fun library
(`vendor/makefun-game.ts`, the kit's copy, unchanged).

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Screenshots are deterministic scenes of the game's own code — see
`shots.json` (`?shot=start|play|rush|end`). `tools/shots.mjs` drives a
headless Chrome over CDP to play-test the game and capture them.

## License

MIT — see LICENSE.
