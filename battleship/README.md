# Fleet Command

A Battleship-style naval game for phones and desktops. Build your own fleet from 12 ship classes, earn command points, and spend them on abilities like air strikes, sonar, torpedoes, shields and repairs. You can also bank points over several turns for bigger abilities.

Plain HTML, CSS and JavaScript with no build step and no image or sound files. The battle board is rendered in **3D with [Three.js](https://threejs.org/)**: a Gerstner-wave ocean, physical sky and per-map lighting, modelled ships, islands, bloom and particle effects. A **Classic 2D** canvas renderer is kept as a fallback for devices without WebGL. Every sound effect is generated with the Web Audio API.

Switch between **3D High**, **3D Lite** (no bloom, lower resolution, for older phones) and **Classic 2D** in Settings. If Three.js can't load, the game falls back to 2D automatically.

## Game modes

- **Battle the Computer**: three AI difficulty levels (Rookie, Veteran, Admiral).
- **Play a Friend Online**: one player hosts a room and sends the 5-letter code, the other joins. Connects phone to phone with no game server.
- **Pass & Play**: two players on one device, with a hand-off screen between turns so neither of you sees the other's fleet.

## Rules in short

- On your turn, fire one shot or use an **attack ability**. Either one ends your turn.
- **Free-action abilities** (sonar, shield, repair, mine, recon, quick shot) don't end your turn.
- You earn **+1 CP** every turn and **+2 CP** for each enemy ship you sink. You can hold up to **10 CP**.
- Each ability belongs to a ship class. If every ship of that class is sunk, you lose the ability.
- Fleets are built on a point budget that depends on the map: 3–6 ships, at most 2 of any class.

| Ship | Size | Pts | Ability | CP | Effect |
|---|---|---|---|---|---|
| Carrier | 5 | 5 | Air Strike | 5 | 5 cells in a line (rotatable) |
| Battleship | 4 | 4 | Cross Barrage | 3 | Plus-shaped 5 cells |
| Dreadnought | 5 | 7 | Doomsday Salvo | 8 | Full 3×3 |
| Cruiser | 3 | 3 | Sonar Ping | 2 | Reveal contacts in 3×3 (free) |
| Destroyer | 2 | 2 | Torpedo Run | 3 | First intact hull along a row/column |
| Submarine | 3 | 3 | Hunter Torpedo | 4 | Guaranteed hit on a random intact hull |
| Aegis Cruiser | 3 | 3 | Aegis Shield | 3 | Blocks incoming fire on a 3×3 until your next turn (free) |
| Repair Tender | 3 | 3 | Damage Control | 4 | Repairs one damaged section (free) |
| Minelayer | 2 | 2 | Deploy Mine | 2 | Hidden mine; whoever shoots it takes a hit back (free) |
| Patrol Boat | 2 | 2 | Quick Shot | 2 | Bonus shot that doesn't end your turn |
| Corvette | 2 | 2 | Recon Flight | 2 | Counts intact hull cells in a row/column (free) |
| Arsenal Ship | 4 | 4 | Missile Swarm | 5 | 4 random hits inside a 5×5 |

### Maps

| Map | Grid | Budget | Twist |
|---|---|---|---|
| Open Ocean | 10×10 | 18 | Classic |
| Archipelago | 12×12 | 22 | Islands block ships and shots |
| Minefield Strait | 11×11 | 20 | 4 hidden sea mines per side; hitting one blasts the cells around it |
| Storm Front | 10×10 | 18 | Lightning hits a random cell in both fleets every 3 rounds |
| Kraken's Deep | 14×14 | 27 | Reefs, and the Kraken attacks both fleets every 4 rounds |

## Run it locally

Any static file server works:

```sh
cd battleship
python3 -m http.server 8000
# open http://localhost:8000 on your computer, or http://<your-computer's-IP>:8000 on your phone (same Wi-Fi)
```

## Put it online (GitHub Pages)

1. Merge this folder into the default branch.
2. In the repository go to **Settings → Pages**, set **Source** to *Deploy from a branch*, pick the default branch and `/ (root)`, and save.
3. After a minute the game is at `https://<username>.github.io/<repo>/battleship/`.
4. On your phone, open that link and use **Add to Home Screen** to get a full-screen app icon.

## How online play works

Both phones run the same deterministic rules engine (`js/engine.js`). Every random roll comes from a seeded generator keyed on the game seed and the move number. Because of that, the players only need to swap their fleet layouts and their list of moves, and both phones end up with identical boards. If a phone locks or reloads mid-game, open the game again and tap **Rejoin online room**. The game replays every move and picks up where you left off.

Transport is picked automatically:

- On a normal website it uses [PeerJS](https://peerjs.com/) (WebRTC) with PeerJS's free public broker to connect the two phones directly.
- Inside a claude.ai artifact it uses the artifact's built-in `room` channel.

Both fleets are sent to both phones, so a player who opens the browser dev tools could peek. That's fine for friends, but it isn't cheat-proof.

## Customize it

Everything you're likely to tweak lives in **`js/data.js`**:

- **New ship class**: add an entry to `FC.SHIPS` (name, size, fleet points, ability, hull colour) and list its key in `FC.SHIP_ORDER`. To give it a brand-new ability, add it to `FC.ABILITIES`, add its area to `FC.patternCells` in `engine.js`, and add a `case` in `FC.applyAction`.
- **New map**: add an entry to `FC.MAPS`. `terrain` is an array of strings where `#` is an island. `seaMines` adds hidden mines. `event` adds a recurring hazard (`lightning` or `kraken`).
- **Economy**: `FC.RULES` holds CP per turn, CP per sink, the CP cap and the fleet size limits.
- **Ship artwork**: each class's sprite is an SVG in `js/art.js` (top-down, bow to the right, 40 units per cell). A class without a sprite falls back to the simple drawing in `FC.drawShip` in `js/fx.js`.

## Files

```
battleship/
  index.html        screens and overlays
  style.css         all styling
  js/data.js        ships, abilities, maps, rules
  js/engine.js      deterministic rules engine
  js/ai.js          computer opponent (probability map + ability heuristics)
  js/art.js         ship sprites (SVG, from the design canvas)
  js/fx.js          2D canvas renderer, animations, synthesized sound
  js/fx3d.js        3D renderer (Three.js, loaded from jsDelivr on demand)
  js/net.js         online transports (PeerJS / claude.ai room)
  js/main.js        screens, fleet builder, battle flow
```
