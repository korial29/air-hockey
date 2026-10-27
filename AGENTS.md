# air-hockey

Tiny multiplayer air hockey for the browser, published on npm. A personal project on `korial29`: never move or mirror it to an organisation.

Read this file before any change. It records the rules agreed while building the game; change a gameplay rule only when the user asks.

## Layout

| Path | Role |
| --- | --- |
| `src/shared/constants.ts` | Field size, radii, speeds, tick rate, network scale, default rules (`RULES`) |
| `src/shared/types.ts` | World, Snapshot, Obstacle, Rules, SocketLike, Conn |
| `src/shared/arena.ts` | Scenes and obstacles: `obstacles(arena, t, size, count, seed)`, `layout(players)`, `scene()`, `fixed()`, `swirl()`, `draw()` (seeded random) |
| `src/shared/physics.ts` | Fixed-step physics, shared by the host and the client's prediction |
| `src/shared/protocol.ts` | Wire format: JSON text frames, binary input and snapshot frames |
| `src/shared/room.ts` | One game, transport-agnostic: roster, teams, rounds, points, rink size, scenes |
| `src/server/` | Node `ws` adapter (`air-hockey/server`) and its CLI |
| `src/local/` | Same-browser multiplayer over BroadcastChannel (`air-hockey/local`) |
| `src/client/` | `airHockey()` API (`index.ts`), local prediction (`predict.ts`), drawing (`render.ts`), helpers (`util.ts`) |
| `demo/` | Demo page, deployed to gh-pages on every merge to `master` |
| `docs/` | README screenshots |

## Commands

Node 24 (`.nvmrc`).

```bash
npm start           # demo with hot reload (Vite)
npm run dev:server  # WebSocket server on :8787
npm test            # Vitest
npm run lint        # Prettier + ESLint + tsc --noEmit
npm run build       # dist/: client, local, server, types
npm run size        # gzip budgets
```

The demo reads `?name=`, `?mode=local|server`, `?url=`, `?goals=` and `?rounds=`: two tabs with `?mode=local&goals=1` reach round 2 in one goal.

## Size comes first

- Budgets, gated in CI by `npm run size`: `dist/index.js` ≤ 15.5 KB gzip, `dist/local.js` ≤ 6.5 KB. Raise one only when the user agrees (last raised for the desert, from 15 and 6 KB).
- No game library, no runtime dependency, no images, fonts or assets: everything is drawn on one canvas.
- WebAssembly and Workers were ruled out for the game itself: the physics is a few circles.
- Browser bundles are built separately (client and local) and fully minified.
- Prefer plain functions and closures; reuse the drawing helpers (`fill`, `ball`, `shadow`, `line`…) before adding new ones.

## Architecture

- **The host is authoritative**: the Node server or the local host tab. Clients send only their pointer target.
- **The client predicts** its own paddle and the puck with the shared physics, rebased on each snapshot and eased on corrections. Other paddles are interpolated 35 ms behind.
- **`src/shared` never touches the DOM or Node APIs.**
- **Obstacles are a pure function of the tick** (and the round's seed): every screen computes them with no extra traffic. Their motion period divides 65536 ticks so the u16 snapshot tick wraps seamlessly. Only their state (hits, removal, flight angle) travels, plus which obstacle holds the puck, for how long still, and the last toucher (a shark spits at it). Randomness comes from `draw(seed, i)`, never `Math.random`, so host and prediction draw the same.
- **Wire format**: coordinates in fixed point (`SCALE` 16, up to 4095 units), snapshots at 60 Hz, a `match` message on every phase change carrying the round's scene, rink size, obstacle count and seed.
- **Local mode**: one tab hosts (elected with `navigator.locks`), its Room ticks from a Worker so a hidden tab keeps 240 Hz.
- `erasableSyntaxOnly` is on: no enums, no parameter properties, no namespaces.

## Physics and fairness

- Fixed step at 240 Hz, `ceil(size)` sub-steps on a bigger rink. Document the no-tunnelling arithmetic (per-step closing distance < contact distance) next to any speed or radius change.
- **Mirror symmetry**: obstacle layouts, motions and whirlwind senses mirror across the centre line; a centre mover may cross the line or wander on its own if it is fair over time.
- **Guarantees on ice**, at every size, count and seed: every gap fits a paddle and a puck side by side (144 units), serve spots, centre spot and spawn points stay clear, straight shots from the centre spot reach every point of either goal mouth.
- **Sea and desert**: the user chose a visible shark zig-zag and wandering genies over the paddle-and-puck rule; there, only the puck alone must always fit (2 · PUCK_R + 20), and serve spots and spawn points stay clear. Fixed obstacles keep the ice guarantees.
- **A served puck is not live**: obstacles let it through until a paddle touches it, so no obstacle starts a round or scores alone.
- **Serve on a free spot**: after a goal the puck goes to the first spot of its side, 160 units apart, that no paddle or obstacle crowds. Never push paddles off a served puck: they rush back and strike it.
- A paddle squeezed against a board by a mover slips to its far side rather than getting stuck.

## Gameplay rules (agreed with the user)

| Topic | Rule |
| --- | --- |
| Teams | Players alternate left and right as they join; up to 16. Names are unique (`Bob 2`). |
| Match | Rounds to 10 goals, best of 3, a "3, 2, 1, PLAY!" countdown (3 s) before each round. |
| Points | Hit +1 (only when the previous toucher was someone else, or after a serve), goal +20 (own goals credit nobody), round won +10 per player, match won +30 per player. |
| Uneven teams | The smaller team starts each round with 1 goal per missing player; an upset win multiplies its match bonus by bigger / smaller. |
| Rink size | √(players / 2), from 1 to 2. Puck and paddle radii do not scale; speeds, goals and obstacles do. |
| Obstacles | players / 2 + 2, from 3 to 7, in mirrored pairs plus a centre mover when odd. |
| When the rink changes | While waiting, at round start, and at every serve until someone touches the puck. Never while the puck is in play. |
| Scenes | One per round, in turn, each with its own play: ice (icebergs, sliding penguins), sea (vortices, zig-zag sharks), desert (whirlwinds, wandering genies). `classic` is an empty rink. |
| Vortices | Suck the puck under for 0.6 to 1.4 s (a random draw), then let it up at rest on a random spot clear of paddles and obstacles, at least 300 units from the goal lines, mirrored for a vortex right of the centre line. |
| Sharks | Eat the puck, keep it 0.6 s while swimming on, then spit it from their rim at the paddle that touched it last (ahead if that player left). Never shot out. |
| Whirlwinds | Catch the puck, turn it in their eye out of every paddle's reach for 0.6 to 1.4 s (a random draw), then fling it from the rim in a random direction. Each catch is a hit. |
| Genies | Float at random in a fixed band: along their lane, up to 30 units off it, between waypoints drawn from the round's seed. |
| Fixed obstacles | Random height each round within a band that keeps every guarantee; break after 3 hits. |
| Movers | Penguins and genies are shot out on the first hit; sharks never. |
| Respawn | 10 s after removal, intact; a ghost that blocks nothing for the last 3 s. |
| End screen | Stadium, cup for the winning team, podium of the top three (goals, then points), small points ranking. |

## Drawing

- Canvas 2D in a Shadow DOM; nothing leaks into the host page.
- Game info lives in the bands above and below the rink, never over the play area (the countdown and goal flash are the exceptions).
- Fonts never under 12 CSS px; puck drawn at least 7 CSS px in radius, paddles 11 px, whatever the rink size. Physics is unchanged by these minimums.
- The static rink is painted once per scene, size and canvas size into an offscreen canvas; only light overlays animate. Target 60 fps with 16 players.
- Check every screen at 343 px wide (phone) and on dark text against light ground (names on sand and ice).

## Tests

- Vitest. A fix comes with a test that **fails without the fix**: prove it by disabling the fix once, from a backup copy, never with `git checkout` on uncommitted work.
- Long sweeps (angles, seeds, ticks) must stay fast on CI (it is slower than a laptop): stop a run once its checks are done, and give a sweep an explicit timeout.
- Do not hard-code timings or rates that depend on the machine; tolerances must hold on a loaded runner.
- Keep the scrambled-game invariants on every scene: no overlap beyond 0.1, no stuck or pinned puck, no NaN, puck inside the rink or a goal slot.
- Visual work: render the built client with a fake socket in headless Chromium, look at the screenshot, then report.

## Git, PRs and releases

- Branch from `master`: `feature/…`, `fix/…`, `docs/…`. One PR per change; keep unrelated work apart.
- Every PR carries exactly one label: `release:major`, `release:minor`, `release:patch` or `release:skip`. Merging into `master` proposes the release; it waits for approval on the `release` environment, then a 2FA validation on npmjs.com.
- The release job publishes `master` as it is at approval time: with several runs waiting, cancel all but the last, or the same code ships under several versions.
- Stacked PRs: merge one, wait until the next shows `master` as its base, then merge it. Merged in a burst, they land in their base branches instead.
- Update a branch with a rebase on `origin/master` and `--force-with-lease`, never a merge commit.
- Pushing changes under `.github/workflows/` needs the `workflow` scope: if the shell's `GITHUB_TOKEN` lacks it, push with `env -u GITHUB_TOKEN`. Large binary pushes may need `git -c http.postBuffer=157286400 push`.
- Dependabot ignores TypeScript majors: bump TypeScript and `typescript-eslint` together, by hand.
- Conventional commit subjects (`feat(scope): …`, `fix: …`, `test: …`, `docs: …`), in English.

## Working with several agents

- Write the shared contract first (types, signatures, constants) and commit it.
- Give each agent its own worktree from that commit and a clear file ownership (for example rules: `src/shared`, `src/server`, `src/local`, `predict.ts`; drawing: `render.ts`, `util.ts`, drawing in `index.ts`, `demo/`).
- Merge by hand: fast-forward one branch, cherry-pick the other, resolve, run every check, then look at the result in a screenshot.
- Check the seams between agents (for example the turning sense of a whirlwind in physics and in the drawing).

## Writing

- English for code, comments, docs, commits and PRs.
- Comments state the non-obvious fact and stop. Lists and tables for enumerations.
