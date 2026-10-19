# Shinobi Shadows 影の道

A browser stealth-action game in the spirit of **Tenchu: Return from Darkness**, rebuilt with
much faster movement and a cast of original, Naruto-inspired shinobi with their own jutsu.

Infiltrate a moonlit castle compound, stay out of the lantern light, and assassinate the corrupt
Lord Gōzan, ideally without anyone ever knowing you were there.

## Running it

It's plain HTML + JavaScript modules with no build step. Browsers block ES modules from `file://`,
so serve the folder with any static server:

```bash
cd shinobi-shadows
python3 -m http.server 8000
# then open http://localhost:8000
```

(`npx serve` or the VS Code "Live Server" extension work too.) Three.js and the add-ons it uses
are bundled in `vendor/`, so it runs offline.

**Settings** (title screen and pause menu): graphics quality (Low / Medium / High) and volume
sliders for master, music and effects. Your choices are remembered. Drop to Medium or Low if the
frame rate struggles. Low turns off bloom, shadows, grass and mist.

## Controls

| Key | Action |
| --- | --- |
| WASD / Mouse | Move / look (click to lock the mouse) |
| Shift | Shinobi sprint (fast but noisy) |
| Shift + run into a wall | Chakra wall-run straight up it |
| Space | Jump, press again in the air for a chakra double jump |
| C (toggle) / Ctrl (hold) | Crouch: slow, silent, hard to see |
| Left click | Sword combo, or **忍殺 stealth kill** when the prompt appears |
| Right click / F | Grappling hook (crosshair turns into a ring when in range) |
| 1 · 2 · 3 | Jutsu |
| Q / G / H | Kunai, smoke bomb, soldier pill |
| Esc | Pause |

## Tenchu mechanics

- **Ki meter** (top right): rises as guards get close to noticing you; `!` means you're spotted.
- **Light and shadow**: lanterns make you visible from much further away. The dot under the Ki
  meter shows how exposed you are.
- **Noise**: sprinting, combat, explosions and kunai hitting walls draw guards to investigate.
- **Guard AI**: guards patrol, get suspicious (`?`), investigate, raise the alarm (`!`) and shout for
  nearby guards, then search the area when they lose you. Bodies left in sight get discovered.
- **Stealth kills**: strike any guard who hasn't spotted you (or drop on one from above) for an
  instant, silent kill.
- **Rank**: the results screen ranks you from Academy Student up to Kage, based on stealth
  kills, how often you were spotted, bodies found and time.

## The shinobi

| | Shinobi | Jutsu | Passive |
| --- | --- | --- | --- |
| 風 | **Hayate Uzuki**, The Whirlwind Fox | Shadow Clone · Spiral Sphere · Wind Dash | Chakra regenerates 50% faster |
| 雷 | **Raiden Kurogane**, The Last Ember | Lightning Blade · Fireball · Crimson Eye | Fastest sprint |
| 桜 | **Tsubaki Hoshino**, The Blossoming Fist | Earth Splitter · Healing Palm · Substitution | Takes less damage, hits harder |
| 影 | **Kagero Mizuki**, The Drifting Shade | Shadow Bind · Shadow Step · Shadow Clone | Guards notice them 30% slower |

All characters, names and the setting are original; they're inspired by Naruto archetypes, not
copies of them.

## Graphics and sound

Nothing is loaded from image or audio files; it's all generated when the game starts.

- **Textures** (`textures.js`) are painted onto canvases: kawara roof tiles, plaster walls with
  timber frames and shoji screens that glow at night, castle stonework, wood, raked gravel, grass,
  lamellar armour, and the Lord's patterned robe.
- **Lighting**: moonlight with soft shadows, flickering stone lanterns, a gradient night sky with
  twinkling stars and a haloed moon, plus bloom and colour grading (`post.js`). Crimson Eye turns
  the world red and grey.
- **World life**: swaying grass, fireflies, falling cherry petals, drifting ground mist and clouds,
  and a rippling pond with lily pads.
- **Sound** (`audio.js`): synthesised effects that are panned and fade with distance, footsteps that
  change with the surface (grass, gravel, wood, roof tiles, stone, for you and the guards),
  crickets, wind, owls and pond frogs, and a generative score on the Japanese *in* scale with koto
  and shakuhachi. It turns tense when guards get suspicious and breaks into taiko drums when
  you're spotted.

## Code tour

| File | What's in it |
| --- | --- |
| `src/main.js` | `Game` class: menus, main loop, projectiles, smoke, stealth kills, scoring |
| `src/player.js` | Movement (sprint, double jump, wall-run, grapple, dashes), combat, items |
| `src/enemy.js` | Guard AI: perception (vision cone, light, line of sight), states, attacks |
| `src/jutsu.js` | Every jutsu, plus the shadow-clone decoy |
| `src/characters.js` | Character roster, stats and jutsu loadouts |
| `src/world.js` | Level layout, lanterns, colliders and guard patrol routes |
| `src/physics.js` | Axis-aligned box collision, raycasts and line of sight |
| `src/models.js` | Characters built from primitives, with knees/elbows and procedural animation |
| `src/effects.js` | GPU particles, shockwaves, lightning bolts, ? / ! markers |
| `src/textures.js` | Procedural canvas textures |
| `src/post.js` | Bloom, colour grading and quality presets |
| `src/audio.js` | Synthesised effects, footsteps, ambience and the adaptive score |
| `src/settings.js` | Graphics/volume settings UI and storage |
| `src/camera.js`, `src/input.js`, `src/hud.js` | Camera, controls, HUD |

Good places to start tinkering: tweak a character's `stats` in `characters.js`, add a jutsu to
`JUTSU` in `jutsu.js` and give it to someone, or add guards and patrol routes to `guardDefs` in
`world.js`.
