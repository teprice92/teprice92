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

### Playing it online (and on a phone)

The repo can host the game itself with GitHub Pages: in the repository's **Settings → Pages**,
set **Source** to *Deploy from a branch*, then pick the branch that has the game and the `/ (root)`
folder. A minute later it's live at `https://<your-username>.github.io/<repo>/shinobi-shadows/`.

**Settings** (title screen and pause menu): graphics quality (Low / Medium / High) and volume
sliders for master, music and effects. Your choices are remembered. Drop to Medium or Low if the
frame rate struggles. Low turns off bloom, shadows, grass and mist.

## Menus

The title screen (key art generated with Higgsfield, `assets/art/title.jpg`) offers **Story Mission**
(solo), **Online Co-op**, **Settings** and **Controls**. On the character select screen your
shinobi stands in front of the castle gate. Pick one from the roster to see their stats and jutsu,
then press Choose (or pick the same tile again).

## Online co-op

Two players on two devices, anywhere:

1. One player picks **Online Co-op → Host a Game** and gets a four-letter room code (and a
   **Share Invite Link** button that opens the phone's share sheet).
2. The other picks **Online Co-op**, types the code and taps **Join** (or just opens the invite
   link).
3. Both choose a shinobi; the host presses **Deploy**.

You infiltrate the same castle together and see each other with a name tag; the partner's health
is under your own. If one of you falls, the other revives them by standing next to them for two
seconds. The mission fails only if you both fall, and killing Lord Gōzan wins it for both of you.
Pausing doesn't stop the world in an online game.

How it works: the two browsers connect directly with WebRTC using [PeerJS](https://peerjs.com)
(`vendor/peerjs.min.js`). PeerJS's free public server only introduces the two players, and its
relay server helps on strict networks such as some mobile data connections. The host runs the
guards and sends their state about 20 times a second. Each player runs their own shinobi and
sends where they are, and attacks on guards go to the host. To test on one computer, open the game
in two tabs with `?net=local` added to the address; the tabs then talk to each other directly.

## Controls

On a phone or tablet the touch controls switch on as soon as you touch the screen (landscape works
best): the left thumb moves (push the stick to the edge to sprint), the right thumb drags to look,
and the buttons are 斬 strike / stealth kill, 跳 jump, 鉤 grappling hook and 伏 crouch. Tap a jutsu
or an item in the HUD to use it, and ❚❚ to pause.

With a keyboard and mouse:

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

**Game controllers** (Bluetooth or USB, including on phones) work as soon as you press a button.
The D-pad or left stick moves through the menus, A selects, B goes back.

| Button | Action |
| --- | --- |
| Left stick | Move; push it all the way to sprint (L3 toggles sprint) |
| Right stick | Look |
| A | Jump / double jump |
| X or RT | Strike / 忍殺 stealth kill |
| B or LT | Grappling hook |
| Y or D-pad ↓ | Crouch |
| LB + X / Y / B | Jutsu 1 / 2 / 3 |
| RB or D-pad ↑ | Throw kunai |
| D-pad ← / → | Smoke bomb / soldier pill |
| Start | Pause |

The controller rumbles when you're hit or land a stealth kill, where the browser supports it.

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

**3D characters**: the four shinobi and the guards are 3D models generated with
[Higgsfield](https://higgsfield.ai): concept art in a T-pose, then image-to-3D with automatic
humanoid rigging (`assets/models/*.glb`, about 1 MB each after compression). `src/rigged.js`
drives their skeletons with the game's own procedural animation, so the Naruto run, crouching,
slashes, hand seals and guard deaths all work without hand-made animation clips. One guard model
is recoloured for the archers, and the elite model doubles as the Lord. If the model files are
missing, the game falls back to characters built from simple shapes.
`tools/fetch-models.sh` re-downloads the original models.

**Sound effects and voices** were generated with [ElevenLabs](https://elevenlabs.io)
(`assets/audio/`): sword swings and clashes, kunai, jutsu, footsteps on each surface, a night
ambience loop with crickets and wind, the pond, owls, and Japanese voice lines for the guards
(「曲者だ！出会え、出会え！」 when they spot you, 「気のせいか…」 when they give up searching) and
the Lord. Effects are panned and fade with distance.

**Music**: an original soundtrack made with Suno (`assets/audio/music/`): 「月夜の足音」 on the
menus, 「静夜の潜入」 while you sneak, 「薄暗い廊下」 when guards grow suspicious, 「雷鳴の合図」 when
you're spotted, and 「凱歌の扇」 / 「風の呼吸」 for victory and defeat. The tracks crossfade as the
situation changes. That folder's README lists the file names and the prompts, so you can swap in
your own; any missing track falls back to the generated score.

Every recorded sound has a synthesised fallback, so the game still works if a file is missing.
Apart from the models and audio, nothing is loaded from files; textures and the rest are
generated when the game starts.

- **Textures** (`textures.js`) are painted onto canvases: kawara roof tiles, plaster walls with
  timber frames and shoji screens that glow at night, castle stonework, wood, raked gravel, grass,
  lamellar armour, and the Lord's patterned robe.
- **Lighting**: moonlight with soft shadows, flickering stone lanterns, a gradient night sky with
  twinkling stars and a haloed moon, plus bloom and colour grading (`post.js`). Crimson Eye turns
  the world red and grey.
- **World life**: swaying grass, fireflies, falling cherry petals, drifting ground mist and clouds,
  and a rippling pond with lily pads.
- **Sound** (`audio.js`): footsteps that change with the surface (grass, gravel, wood, roof tiles,
  stone, for you and the guards), and an adaptive score. Without music files it's generated on the
  Japanese *in* scale with koto and shakuhachi. Either way it turns tense when guards get
  suspicious and switches to battle music when you're spotted.
- **Performance**: guards far away or off screen animate less often, and only nearby ones cast
  shadows. Phones start on the Medium graphics preset.

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
| `src/models.js` | Procedural animation, primitive fallback characters, props and model selection |
| `src/rigged.js` | Loads the rigged GLB characters and maps the animation onto their skeletons |
| `src/effects.js` | GPU particles, shockwaves, lightning bolts, ? / ! markers |
| `src/textures.js` | Procedural canvas textures |
| `src/post.js` | Bloom, colour grading and quality presets |
| `src/audio.js` | Sound effects (recorded, with synthesised fallbacks), voices, ambience and the adaptive music |
| `src/touch.js` | Touch controls for phones and tablets |
| `src/gamepad.js` | Game controller support (Gamepad API) for play and menu navigation |
| `src/net.js` | Online co-op connection (PeerJS / WebRTC, or `?net=local` between tabs) |
| `src/coop.js` | The partner's shinobi as seen on your screen, and the network snapshots |
| `src/settings.js` | Graphics/volume settings UI and storage |
| `src/camera.js`, `src/input.js`, `src/hud.js` | Camera, controls, HUD |

Good places to start tinkering: tweak a character's `stats` in `characters.js`, add a jutsu to
`JUTSU` in `jutsu.js` and give it to someone, or add guards and patrol routes to `guardDefs` in
`world.js`.
