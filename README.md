# air-hockey

[![npm version](https://img.shields.io/npm/v/air-hockey.svg)](https://www.npmjs.com/package/air-hockey)
[![npm downloads](https://img.shields.io/npm/dm/air-hockey.svg)](https://www.npmjs.com/package/air-hockey)
[![bundle size](https://img.shields.io/bundlephobia/minzip/air-hockey)](https://bundlephobia.com/package/air-hockey)
[![CI](https://github.com/korial29/air-hockey/actions/workflows/ci.yml/badge.svg)](https://github.com/korial29/air-hockey/actions/workflows/ci.yml)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![license](https://img.shields.io/npm/l/air-hockey.svg)](LICENSE)
[![play the demo](https://img.shields.io/badge/demo-play%20now-ff6b35)](https://korial29.github.io/air-hockey/)

A multiplayer air hockey game for the browser, written in TypeScript with no game library and no runtime dependency. Players join with a name, get a colour of their own, and play in teams through three scenes, one per round: an ice rink with icebergs and sliding penguins, the sea with vortices and sharks, and an Arabian Nights desert with whirlwinds and genies.

![Air hockey on the ice: four players, icebergs, penguins, the puck hitting an iceberg](https://raw.githubusercontent.com/korial29/air-hockey/master/docs/screenshot-ice.png)

![Round 2 at sea: vortices, sharks and the gold doubloon puck](https://raw.githubusercontent.com/korial29/air-hockey/master/docs/screenshot-sea.png)

![Round 3 in the desert: whirlwinds, genies, the ruby puck and a zellige star](https://raw.githubusercontent.com/korial29/air-hockey/master/docs/screenshot-desert.png)

## Framework-agnostic, light to add

`airHockey()` mounts the game into any element, inside its own Shadow DOM: React, Vue, Angular, Svelte or a plain page, nothing leaks in or out. Everything is drawn on one canvas, with no images, fonts or assets to serve.

| Entry | What it is | Size (gzip) |
| --- | --- | --- |
| `air-hockey` | The game client: rendering, input, prediction | ~15.7 KB |
| `air-hockey/local` | Same-browser multiplayer, no server | ~6.6 KB |
| `air-hockey/server` | Node WebSocket server (needs `ws`) | Node only |

The budgets (20 KB and 8 KB) are checked in CI on every pull request.

## Live demo

https://korial29.github.io/air-hockey/

Open the page in two or more tabs of the same browser, pick a name in each, and play. Add `?goals=2` to the first tab's URL for short rounds.

---

## Installation

```sh
npm install air-hockey
```

The server entry also needs [`ws`](https://github.com/websockets/ws), an optional peer dependency:

```sh
npm install ws
```

---

## Basic usage

### Tabs of the same browser, no server

```ts
import { airHockey } from 'air-hockey';
import { localSocket } from 'air-hockey/local';

const game = airHockey(document.getElementById('game')!, {
  name: 'Ana',
  socket: localSocket('my-room'),
});
```

Every tab that opens `localSocket('my-room')` joins the same game over a [`BroadcastChannel`](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel). One tab hosts the match, elected with [`navigator.locks`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API); when it closes, another tab takes over. `navigator.locks` needs a secure context: on `http://` from a LAN address, each tab plays alone.

### Across devices, with a WebSocket server

```ts
// server.ts (Node)
import { serve } from 'air-hockey/server';

const stop = serve({ port: 8787 }); // or serve({ server: existingHttpServer })
```

```ts
// in the browser
import { airHockey } from 'air-hockey';

airHockey(document.getElementById('game')!, {
  name: 'Ana',
  url: 'wss://your-host.example/my-room',
});
```

One room per URL path: `/my-room` and `/other` are two separate games. A ready-made server ships as a command:

```sh
PORT=8787 npx air-hockey-server
```

### Sizing

The game fills the width of its container and keeps its aspect ratio (4:3, score band and rosters included). Give the container a width; to fit a screen, cap it by the height too:

```css
#game {
  max-width: calc((100dvh - 100px) * 4 / 3);
  margin: 0 auto;
}
```

A full-screen button sits in the top-right corner of the game.

---

## API

### `airHockey(container, options)`

Mounts the game and joins. Returns `{ on, destroy }`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | — | Player name shown above the paddle (16 characters max). A taken name gets a suffix (`Bob 2`). |
| `url` | `string` | — | WebSocket URL, room in the path. Ignored when `socket` is given. |
| `socket` | `SocketLike` | — | Any WebSocket-like object, e.g. `localSocket('room')`. |
| `fullscreen` | `boolean` | `true` | Show the full-screen button (hidden anyway where the browser does not allow it). |

### Events

`on(event, callback)` returns a function that removes the listener.

| Event | Payload | When |
| --- | --- | --- |
| `open` | — | Connected. |
| `close` | — | Disconnected. |
| `roster` | `{ you, players }` | A player joined or left. `players` are `{ id, name, color, team }`. |
| `score` | `[left, right]` | The score of the round changed. |
| `goal` | `{ team, score }` | A goal was scored. |
| `match` | `MatchState` | The phase changed: `wait`, `ready` (countdown), `play`, `break`, `end`. `break` and `end` carry the winner and the full ranking. |

```ts
game.on('match', m => {
  if (m.phase === 'end') saveResults(m.ranking);
});
```

### `destroy()`

Leaves the game, stops rendering, removes every listener and the game's DOM. Safe to call twice.

### `localSocket(room, rules?)` — `air-hockey/local`

A same-browser socket for `airHockey`. `rules` apply to the match the tab hosts: pass the same ones from every tab.

### `serve({ port | server, rules? })` — `air-hockey/server`

Starts the WebSocket server and returns an async `stop()`. `rules` apply to every room.

---

## Rules

Every field is optional; missing ones keep their default.

| Rule | Default | Description |
| --- | --- | --- |
| `arena` | `['ice', 'sea', 'desert']` | Scene, or scenes taking turns from one round to the next: `'ice'`, `'sea'`, `'desert'`, `'classic'` (empty rink). |
| `rounds` | `3` | Rounds in a match, all of them played, one scene each: the team that wins the most wins the match. |
| `goals` | `5` | Goals that win a round. |
| `hit` | `1` | Points for a hit, when the previous toucher was someone else. |
| `goal` | `20` | Points for the scorer of a goal. |
| `ownGoal` | `10` | Points taken from the last toucher of an own goal. |
| `roundWin` | `10` | Points for each player of the team that wins a round. |
| `matchWin` | `30` | Points for each player of the team that wins the match. |
| `headStart` | `1` | Uneven teams: goals the smaller team starts each round with, per missing player. |
| `readySec` | `3` | "3, 2, 1, PLAY!" countdown before each round (`0` turns it off). |
| `breakSec` | `3` | Pause between rounds. |
| `endSec` | `15` | Time the final podium stays on screen. |

```ts
serve({ port: 8787, rules: { arena: 'sea', goals: 5, rounds: 1 } });
```

---

## How a match plays

- **Teams**: players are spread left and right as they join, each with a paddle in their half. Up to 16 players.
- **The rink grows with the players**, so everybody keeps the same room: ×1 at 2 players, ×1.41 at 4, ×1.73 at 6, ×2 from 8. Obstacles go from 3 to 7 with the player count. The rink adapts while waiting, at round start and at every serve until someone touches the puck.
- **Three scenes, one per round**: ice, sea, desert.
- **Obstacles bounce the puck like pinball bumpers**, except those that grab it. Icebergs, vortices and whirlwinds stand in front of the goals, each on a random square of a grid there, every game and every round: one side's in the top half, the other's in the bottom half. They break after 3 hits and come back on another square. Penguins cross the width and are shot out on the first hit. Genies float at random along their lane and never go: a genie hit makes the puck vanish, served again in front of the shooter's opponents, and the genie stops to strike the shooter with lightning, a bolt between them, a countdown on the paddle: both stand still for 5 s, then the genie floats on. One victim at a time: a genie under its spell bounces the puck. Everything comes back after 10 s, with a ghost for the last 3 s.
- **Some obstacles grab the puck.** A whirlwind spins it round for about a second and flings it out in a random direction. A vortex sucks it under the water and lets it up, at rest, somewhere else on the rink. A shark, zig-zagging across the width, eats it and spits it out in a random direction; sharks are never shot out. A puck that comes up splashes and pops back to its size.
- **One goalie per crease**: in the half-disc marked in front of each goal, only the defender nearest the goal stops the puck. The other defenders in it turn see-through and the puck goes through them, so a wall of paddles cannot shut a goal.
- **Serves**: a served puck ignores obstacles until a player touches it, and is never served under a paddle.
- **End of match**: a stadium screen with the winning team's cup, a podium of the top scorers and the points ranking.

---

## Features

- [x] Multiplayer over WebSocket, or between tabs of one browser with no server
- [x] Unique colour per player, name above the paddle, team rosters
- [x] Teams, 3-round matches (one scene each), individual points ranking, podium screen
- [x] One goalie per crease: no wall of defenders in front of a goal
- [x] Three scenes taking turns, each with its own play: ice (icebergs, sliding penguins), sea (vortices that swallow the puck, zig-zagging sharks that spit it out, wooden goals), Arabian Nights desert (whirlwinds that catch and fling the puck, wandering genies whose lightning paralyses the shooter, Moorish arches)
- [x] Breakable obstacles with respawn and ghost
- [x] Rink that grows with the number of players
- [x] Client-side prediction: your paddle and the puck react at once
- [x] "3, 2, 1, PLAY!" countdown, goal flash, puck beacon and trail
- [x] Full-screen button, mouse and touch, phone-sized screens
- [x] Shadow DOM, zero runtime dependencies, size-gated in CI

---

## Development

Node 24 (see `.nvmrc`).

```sh
npm install
npm start            # demo with hot reload (Vite)
npm run dev:server   # WebSocket server on :8787
npm test             # Vitest
npm run lint         # Prettier, ESLint, tsc
npm run build        # dist/: client, local, server, types
npm run size         # gzip budgets
```

The demo reads `?name=`, `?mode=local|server`, `?url=`, `?goals=`, `?rounds=` and `?arena=` (for example `desert`, or `ice,sea`) from its URL, which makes testing several players in several tabs quick.

Pull requests need one release label (`release:major`, `release:minor`, `release:patch` or `release:skip`); merging one into `master` proposes the matching npm release. See [`.github/CI.md`](.github/CI.md).

---

## License

[Apache-2.0](LICENSE)
