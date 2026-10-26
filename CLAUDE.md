# air-hockey

Tiny multiplayer air hockey for the browser. Zero runtime dependencies on the client.

## Layout

| Path | Role |
| --- | --- |
| `src/shared/constants.ts` | Field size, radii, rates, network scale, default match rules (`RULES`) |
| `src/shared/types.ts` | World, Snapshot, PlayerInfo, SocketLike, Conn |
| `src/shared/protocol.ts` | Wire format: JSON text frames + binary input/snapshot frames |
| `src/shared/physics.ts` | Fixed-step physics, shared by host and client prediction |
| `src/shared/room.ts` | One game, transport-agnostic: roster, colours, teams, tick loop, match (rounds, points, ranking) |
| `src/server/` | Node `ws` adapter (`air-hockey/server`) and its CLI |
| `src/local/` | Same-browser multiplayer over BroadcastChannel (`air-hockey/local`) |
| `src/client/` | Public `airHockey()` API, input, interpolation; `predict.ts` runs the puck and own paddle locally, `render.ts` draws the HUD bands and the end screen |
| `demo/` | Demo page, deployed to gh-pages |

## Rules

- The host (server or local host tab) is authoritative. Clients only send their pointer target.
- `dist/index.js` must stay under 15 KB gzip, `dist/local.js` under 5 KB (`npm run size`, gated in CI).
  No runtime dependency, no class hierarchy for its own sake, no assets.
- `src/shared` never touches the DOM or Node APIs.
- `erasableSyntaxOnly` is on: no enums, no parameter properties, no namespaces.
- Prettier + ESLint + `tsc --noEmit` must pass: `npm run lint`. Fix formatting with `npm run format`.

## Commands

```bash
npm start           # demo dev server (Vite)
npm run dev:server  # WebSocket server on :8787
npm test            # Vitest
npm run build       # dist/ (client, local, server, types)
npm run size        # gzip budget
```
