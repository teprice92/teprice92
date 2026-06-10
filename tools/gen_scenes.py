#!/usr/bin/env python3
"""Generates scenes/player.tscn, scenes/boss.tscn and scenes/main.tscn.

The character scenes slice the sprite sheets into SpriteFrames, and the
level scene encodes the stage layout into TileMapLayer byte data.
Run from the repo root:  python3 tools/gen_scenes.py
"""
import os
import struct

ROOT = os.path.join(os.path.dirname(__file__), "..")


# ---------------------------------------------------------------- characters

def sprite_frames_scene(name, texture_path, script_path, frame_size, anims,
                        body_rect, body_pos, extra_nodes, extra_subres):
    """Builds a .tscn for a CharacterBody2D with an AnimatedSprite2D."""
    fw, fh = frame_size
    atlas_refs = []   # (subres_id, region)
    anim_blocks = []
    for anim_name, row, count, speed, loop in anims:
        frame_ids = []
        for i in range(count):
            sid = f"Atlas_{anim_name}_{i}"
            atlas_refs.append((sid, (i * fw, row * fh, fw, fh)))
            frame_ids.append(sid)
        frames = ", ".join(
            '{\n"duration": 1.0,\n"texture": SubResource("%s")\n}' % sid
            for sid in frame_ids)
        anim_blocks.append(
            '{\n"frames": [%s],\n"loop": %s,\n"name": &"%s",\n"speed": %s\n}'
            % (frames, "true" if loop else "false", anim_name, float(speed)))

    load_steps = 2 + len(atlas_refs) + 2 + len(extra_subres) + 1
    out = [f'[gd_scene load_steps={load_steps} format=3]', '']
    out.append(f'[ext_resource type="Texture2D" path="{texture_path}" id="1_tex"]')
    out.append(f'[ext_resource type="Script" path="{script_path}" id="2_script"]')
    out.append('')
    for sid, (x, y, w, h) in atlas_refs:
        out.append(f'[sub_resource type="AtlasTexture" id="{sid}"]')
        out.append('atlas = ExtResource("1_tex")')
        out.append(f'region = Rect2({x}, {y}, {w}, {h})')
        out.append('')
    out.append('[sub_resource type="SpriteFrames" id="SpriteFrames_main"]')
    out.append('animations = [%s]' % ", ".join(anim_blocks))
    out.append('')
    out.append('[sub_resource type="RectangleShape2D" id="Shape_body"]')
    out.append(f'size = Vector2({body_rect[0]}, {body_rect[1]})')
    out.append('')
    for block in extra_subres:
        out.append(block)
        out.append('')
    out.append(f'[node name="{name}" type="CharacterBody2D"]')
    out.append('process_mode = 1')
    out.append(extra_nodes['root_props'])
    out.append('script = ExtResource("2_script")')
    out.append('')
    out.append('[node name="Sprite" type="AnimatedSprite2D" parent="."]')
    out.append(f'position = Vector2(0, {-fh // 2})')
    out.append('sprite_frames = SubResource("SpriteFrames_main")')
    out.append('animation = &"idle"')
    out.append('autoplay = "idle"')
    out.append('')
    out.append('[node name="Body" type="CollisionShape2D" parent="."]')
    out.append(f'position = Vector2({body_pos[0]}, {body_pos[1]})')
    out.append('shape = SubResource("Shape_body")')
    out.append('')
    out.append(extra_nodes['children'])
    return "\n".join(out) + "\n"


PLAYER_EXTRA_SUBRES = [
    '[sub_resource type="RectangleShape2D" id="Shape_whip"]\nsize = Vector2(48, 16)',
]

PLAYER_CHILDREN = """[node name="WhipHitbox" type="Area2D" parent="."]
collision_layer = 0
collision_mask = 4

[node name="Shape" type="CollisionShape2D" parent="WhipHitbox"]
position = Vector2(38, -30)
shape = SubResource("Shape_whip")
disabled = true

[node name="Camera" type="Camera2D" parent="."]
position = Vector2(0, -24)
limit_left = 0
limit_top = -96
limit_right = 3840
limit_bottom = 416
position_smoothing_enabled = true
position_smoothing_speed = 8.0
"""

BOSS_EXTRA_SUBRES = [
    '[sub_resource type="RectangleShape2D" id="Shape_swing"]\nsize = Vector2(140, 36)',
    '[sub_resource type="RectangleShape2D" id="Shape_slam"]\nsize = Vector2(64, 32)',
    '[sub_resource type="RectangleShape2D" id="Shape_contact"]\nsize = Vector2(30, 50)',
]

BOSS_CHILDREN = """[node name="SwingHitbox" type="Area2D" parent="."]
collision_layer = 0
collision_mask = 2

[node name="Shape" type="CollisionShape2D" parent="SwingHitbox"]
position = Vector2(0, -40)
shape = SubResource("Shape_swing")
disabled = true

[node name="SlamHitbox" type="Area2D" parent="."]
collision_layer = 0
collision_mask = 2

[node name="Shape" type="CollisionShape2D" parent="SlamHitbox"]
position = Vector2(-52, -18)
shape = SubResource("Shape_slam")
disabled = true

[node name="ContactBox" type="Area2D" parent="."]
collision_layer = 0
collision_mask = 2

[node name="Shape" type="CollisionShape2D" parent="ContactBox"]
position = Vector2(0, -26)
shape = SubResource("Shape_contact")
"""


def gen_player():
    return sprite_frames_scene(
        "Player", "res://assets/hero.png", "res://scripts/player.gd", (64, 64),
        [("idle", 0, 4, 6, True),
         ("walk", 1, 6, 8, True),
         ("run", 2, 6, 10, True),
         ("jump", 3, 4, 10, False),
         ("whip", 4, 5, 12, False)],
        (14, 36), (0, -18),
        {"root_props": "collision_layer = 2\ncollision_mask = 1",
         "children": PLAYER_CHILDREN},
        PLAYER_EXTRA_SUBRES)


def gen_boss():
    return sprite_frames_scene(
        "Boss", "res://assets/boss.png", "res://scripts/boss.gd", (96, 96),
        [("idle", 0, 4, 5, True),
         ("walk", 1, 6, 7, True),
         ("swing", 2, 6, 9, False),
         ("slam", 3, 5, 8, False)],
        (34, 50), (0, -25),
        {"root_props": "collision_layer = 4\ncollision_mask = 1",
         "children": BOSS_CHILDREN},
        BOSS_EXTRA_SUBRES)


# --------------------------------------------------------------------- level

T = {
    'stone': (0, 0), 'stone_top': (1, 0), 'stone_left': (2, 0),
    'stone_right': (3, 0), 'stone_tl': (4, 0), 'stone_tr': (5, 0),
    'stone_cracked': (6, 0), 'stone_bg': (7, 0),
    'plat_l': (0, 1), 'plat_m': (1, 1), 'plat_r': (2, 1), 'plat_mag': (3, 1),
    'carpet': (4, 1), 'carpet_l': (5, 1), 'carpet_r': (6, 1), 'lace': (7, 1),
    'gold': (0, 2), 'win_gothic': (1, 2), 'win_stained': (2, 2),
    'win_neon': (3, 2), 'torch': (4, 2), 'candelabra': (5, 2),
    'chandelier': (6, 2), 'pe_sign': (7, 2),
    'arrow': (0, 3), 'slot_top': (1, 3), 'slot_bot': (2, 3), 'dice': (3, 3),
    'card': (4, 3), 'bg_night': (5, 3), 'bg_stars': (6, 3),
    'bg_skyline': (7, 3),
    'curtain': (0, 4), 'spikes': (1, 4), 'stairs': (2, 4), 'railing': (3, 4),
    'chain': (4, 4), 'door': (5, 4), 'corner': (6, 4),
}

W = 120          # level width in tiles
GY = 10          # ground top row
PIT_A = range(30, 34)
PIT_B = range(58, 62)


def build_layers():
    solid, decor, bg = {}, {}, {}

    def fill(layer, xs, ys, tile):
        for x in xs:
            for y in ys:
                layer[(x, y)] = T[tile]

    # --- ground: top row + two fill rows, with pits ----------------------
    for x in range(W):
        in_pit = x in PIT_A or x in PIT_B
        if not in_pit:
            if 12 <= x <= 27:
                top = 'carpet_l' if x == 12 else 'carpet_r' if x == 27 else 'carpet'
            elif 98 <= x <= 118:
                top = 'gold'
            else:
                top = 'stone'
            solid[(x, GY)] = T[top]
        else:
            decor[(x, GY)] = T['spikes']
        solid[(x, 11)] = T['stone_cracked' if x % 9 == 4 else 'stone']
        solid[(x, 12)] = T['stone']

    # --- entry castle -----------------------------------------------------
    fill(bg, range(0, 8), range(5, 10), 'stone_bg')
    fill(solid, range(0, 8), [4], 'stone')          # castle roof
    for x in (0, 2, 4, 6):                          # merlons
        solid[(x, 3)] = T['stone']
    fill(solid, [0], range(5, 10), 'stone')         # left wall
    decor[(1, 6)] = T['torch']
    decor[(3, 6)] = T['win_stained']
    decor[(5, 6)] = T['win_gothic']
    decor[(2, 9)] = T['door']
    decor[(6, 9)] = T['candelabra']

    # --- sky signage -------------------------------------------------------
    decor[(33, 2)] = T['pe_sign']
    decor[(35, 2)] = T['arrow']
    decor[(93, 5)] = T['arrow']

    # --- floating neon platforms ------------------------------------------
    for (px, py) in [(36, 8), (41, 6), (46, 8)]:
        solid[(px, py)] = T['plat_l']
        solid[(px + 1, py)] = T['plat_m']
        solid[(px + 2, py)] = T['plat_r']
    decor[(37, 7)] = T['dice']
    decor[(47, 7)] = T['card']
    # chandelier hanging over the middle platform
    decor[(42, 1)] = T['chain']
    decor[(42, 2)] = T['chain']
    decor[(42, 3)] = T['chandelier']

    # --- staircase up to the slot-machine pillar ---------------------------
    solid[(50, 9)] = T['stone']
    fill(solid, [51], range(8, 10), 'stone')
    fill(solid, [52], range(7, 10), 'stone')
    solid[(53, 6)] = T['plat_l']
    solid[(54, 6)] = T['plat_m']
    solid[(55, 6)] = T['plat_r']
    fill(solid, range(53, 56), range(7, 10), 'stone')
    decor[(54, 4)] = T['slot_top']
    decor[(54, 5)] = T['slot_bot']
    fill(solid, [56], range(8, 10), 'stone')        # step down
    solid[(57, 9)] = T['stone']

    # --- casino strip -------------------------------------------------------
    fill(bg, range(8, 96), [9], 'bg_skyline')
    fill(decor, range(66, 69), [9], 'railing')
    decor[(72, 9)] = T['torch']
    decor[(80, 9)] = T['torch']
    decor[(70, 8)] = T['dice']
    decor[(84, 8)] = T['card']
    decor[(74, 5)] = T['win_neon']
    decor[(78, 4)] = T['chain']
    decor[(78, 5)] = T['chain']
    decor[(78, 6)] = T['chain']
    decor[(78, 7)] = T['chandelier']
    decor[(89, 8)] = T['slot_top']
    decor[(89, 9)] = T['slot_bot']
    # bonus ledge
    solid[(85, 8)] = T['plat_l']
    solid[(86, 8)] = T['plat_m']
    solid[(87, 8)] = T['plat_mag']
    solid[(88, 8)] = T['plat_r']

    # --- boss gate -----------------------------------------------------------
    fill(solid, [96], range(3, 8), 'stone')

    # --- boss arena ------------------------------------------------------------
    fill(bg, range(106, 117), range(5, 10), 'curtain')
    fill(bg, range(98, 106), [9], 'bg_skyline')
    decor[(103, 9)] = T['candelabra']
    decor[(116, 9)] = T['candelabra']
    decor[(109, 1)] = T['chain']
    decor[(109, 2)] = T['chain']
    decor[(109, 3)] = T['chandelier']
    solid[(107, 8)] = T['plat_l']
    solid[(108, 8)] = T['plat_mag']
    solid[(109, 8)] = T['plat_r']
    fill(solid, [119], range(0, 10), 'stone')       # right wall

    # --- stars ---------------------------------------------------------------
    for (sx, sy) in [(10, 1), (16, 4), (18, 2), (25, 0), (28, 3), (34, 5),
                     (44, 1), (50, 2), (57, 1), (63, 3), (68, 0), (75, 2),
                     (82, 4), (88, 1), (94, 3), (101, 1), (108, 0), (114, 2)]:
        bg[(sx, sy)] = T['bg_stars']

    return solid, decor, bg


def encode_tile_map(cells):
    """TileMapLayer.tile_map_data: u16 format version, then 12 bytes per cell
    (s16 x, s16 y, u16 source, u16 atlas_x, u16 atlas_y, u16 alternative)."""
    data = struct.pack("<H", 0)
    for (x, y) in sorted(cells):
        ax, ay = cells[(x, y)]
        data += struct.pack("<hhHHHH", x, y, 0, ax, ay, 0)
    return "PackedByteArray(" + ", ".join(str(b) for b in data) + ")"


STRIPES = [
    (-96, 0, "0.086, 0.067, 0.16"),
    (0, 96, "0.106, 0.082, 0.2"),
    (96, 192, "0.125, 0.098, 0.235"),
    (192, 288, "0.149, 0.118, 0.27"),
    (288, 416, "0.11, 0.086, 0.2"),
]


def gen_main():
    solid, decor, bg = build_layers()
    out = []
    out.append('[gd_scene load_steps=13 format=3]')
    out.append('')
    out.append('[ext_resource type="Script" path="res://scripts/game.gd" id="1_game"]')
    out.append('[ext_resource type="TileSet" path="res://tileset.tres" id="2_tiles"]')
    out.append('[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="3_player"]')
    out.append('[ext_resource type="PackedScene" path="res://scenes/boss.tscn" id="4_boss"]')
    out.append('[ext_resource type="Script" path="res://scripts/hud.gd" id="5_hud"]')
    out.append('[ext_resource type="Texture2D" path="res://assets/sign.png" id="6_sign"]')
    out.append('[ext_resource type="Texture2D" path="res://assets/tileset.png" id="7_tileset"]')
    out.append('')
    out.append('[sub_resource type="AtlasTexture" id="Atlas_heart"]')
    out.append('atlas = ExtResource("7_tileset")')
    out.append('region = Rect2(128, 96, 32, 32)')
    out.append('')
    out.append('[sub_resource type="RectangleShape2D" id="Shape_gate"]')
    out.append('size = Vector2(32, 64)')
    out.append('')
    out.append('[sub_resource type="RectangleShape2D" id="Shape_spikes_a"]')
    out.append('size = Vector2(122, 20)')
    out.append('')
    out.append('[sub_resource type="RectangleShape2D" id="Shape_spikes_b"]')
    out.append('size = Vector2(122, 20)')
    out.append('')
    out.append('[sub_resource type="RectangleShape2D" id="Shape_trigger"]')
    out.append('size = Vector2(64, 320)')
    out.append('')

    out.append('[node name="Main" type="Node2D"]')
    out.append('process_mode = 3')
    out.append('script = ExtResource("1_game")')
    out.append('')

    out.append('[node name="Backdrop" type="Node2D" parent="."]')
    out.append('')
    for i, (top, bottom, color) in enumerate(STRIPES):
        out.append(f'[node name="Stripe{i}" type="ColorRect" parent="Backdrop"]')
        out.append('offset_left = -64.0')
        out.append(f'offset_top = {float(top)}')
        out.append('offset_right = 3904.0')
        out.append(f'offset_bottom = {float(bottom)}')
        out.append(f'color = Color({color}, 1)')
        out.append('')

    out.append('[node name="Sign" type="Sprite2D" parent="."]')
    out.append('position = Vector2(330, 156)')
    out.append('scale = Vector2(0.5, 0.5)')
    out.append('texture = ExtResource("6_sign")')
    out.append('')

    for name, cells in [("BG", bg), ("Decor", decor), ("Solid", solid)]:
        out.append(f'[node name="{name}" type="TileMapLayer" parent="."]')
        out.append(f'tile_map_data = {encode_tile_map(cells)}')
        out.append('tile_set = ExtResource("2_tiles")')
        out.append('')

    out.append('[node name="Gate" type="StaticBody2D" parent="."]')
    out.append('position = Vector2(3088, 288)')
    out.append('')
    out.append('[node name="Shape" type="CollisionShape2D" parent="Gate"]')
    out.append('shape = SubResource("Shape_gate")')
    out.append('disabled = true')
    out.append('')

    for name, shape, pos in [("SpikesA", "Shape_spikes_a", (1024, 342)),
                             ("SpikesB", "Shape_spikes_b", (1920, 342)),
                             ("ArenaTrigger", "Shape_trigger", (3260, 180)),
                             ("MidCheckpoint", "Shape_trigger", (1568, 180))]:
        out.append(f'[node name="{name}" type="Area2D" parent="."]')
        out.append(f'position = Vector2({pos[0]}, {pos[1]})')
        out.append('collision_layer = 0')
        out.append('collision_mask = 2')
        out.append('')
        out.append(f'[node name="Shape" type="CollisionShape2D" parent="{name}"]')
        out.append(f'shape = SubResource("{shape}")')
        out.append('')

    out.append('[node name="Player" parent="." instance=ExtResource("3_player")]')
    out.append('position = Vector2(64, 320)')
    out.append('')
    out.append('[node name="Boss" parent="." instance=ExtResource("4_boss")]')
    out.append('position = Vector2(3640, 320)')
    out.append('')

    # ------------------------------------------------------------------ HUD
    out.append('[node name="HUD" type="CanvasLayer" parent="."]')
    out.append('script = ExtResource("5_hud")')
    out.append('')
    out.append('[node name="Hearts" type="Control" parent="HUD"]')
    out.append('offset_left = 10.0')
    out.append('offset_top = 8.0')
    out.append('offset_right = 150.0')
    out.append('offset_bottom = 36.0')
    out.append('')
    for i in range(5):
        out.append(f'[node name="H{i + 1}" type="TextureRect" parent="HUD/Hearts"]')
        out.append(f'offset_left = {float(i * 26)}')
        out.append('offset_top = 0.0')
        out.append(f'offset_right = {float(i * 26 + 24)}')
        out.append('offset_bottom = 24.0')
        out.append('texture = SubResource("Atlas_heart")')
        out.append('expand_mode = 1')
        out.append('stretch_mode = 5')
        out.append('')

    out.append('[node name="Title" type="Control" parent="HUD"]')
    out.append('offset_right = 640.0')
    out.append('offset_bottom = 360.0')
    out.append('mouse_filter = 2')
    out.append('')
    out.append('[node name="Big" type="Label" parent="HUD/Title"]')
    out.append('offset_left = 0.0')
    out.append('offset_top = 70.0')
    out.append('offset_right = 640.0')
    out.append('offset_bottom = 110.0')
    out.append('theme_override_colors/font_color = Color(1, 0.4, 0.85, 1)')
    out.append('theme_override_font_sizes/font_size = 30')
    out.append('text = "NEON CASTLE"')
    out.append('horizontal_alignment = 1')
    out.append('')
    out.append('[node name="Sub" type="Label" parent="HUD/Title"]')
    out.append('offset_left = 0.0')
    out.append('offset_top = 110.0')
    out.append('offset_right = 640.0')
    out.append('offset_bottom = 130.0')
    out.append('theme_override_colors/font_color = Color(0.5, 0.95, 1, 1)')
    out.append('theme_override_font_sizes/font_size = 13')
    out.append('text = "STAGE 1 — THE STRIP        [arrows] move  [shift] run  [space] jump  [X] whip"')
    out.append('horizontal_alignment = 1')
    out.append('')

    out.append('[node name="BossBar" type="Control" parent="HUD"]')
    out.append('visible = false')
    out.append('offset_left = 210.0')
    out.append('offset_top = 318.0')
    out.append('offset_right = 430.0')
    out.append('offset_bottom = 348.0')
    out.append('mouse_filter = 2')
    out.append('')
    out.append('[node name="Label" type="Label" parent="HUD/BossBar"]')
    out.append('offset_left = 0.0')
    out.append('offset_top = -16.0')
    out.append('offset_right = 220.0')
    out.append('offset_bottom = 0.0')
    out.append('theme_override_colors/font_color = Color(1, 0.4, 0.85, 1)')
    out.append('theme_override_font_sizes/font_size = 11')
    out.append('text = "BIG KAHUNA"')
    out.append('horizontal_alignment = 1')
    out.append('')
    out.append('[node name="Back" type="ColorRect" parent="HUD/BossBar"]')
    out.append('offset_left = 0.0')
    out.append('offset_top = 0.0')
    out.append('offset_right = 220.0')
    out.append('offset_bottom = 14.0')
    out.append('color = Color(0.08, 0.06, 0.14, 0.9)')
    out.append('')
    out.append('[node name="Fill" type="ColorRect" parent="HUD/BossBar"]')
    out.append('offset_left = 2.0')
    out.append('offset_top = 2.0')
    out.append('offset_right = 218.0')
    out.append('offset_bottom = 12.0')
    out.append('color = Color(1, 0.25, 0.7, 1)')
    out.append('')

    out.append('[node name="Dialogue" type="Control" parent="HUD"]')
    out.append('visible = false')
    out.append('offset_left = 20.0')
    out.append('offset_top = 258.0')
    out.append('offset_right = 620.0')
    out.append('offset_bottom = 348.0')
    out.append('mouse_filter = 2')
    out.append('')
    out.append('[node name="Panel" type="ColorRect" parent="HUD/Dialogue"]')
    out.append('offset_right = 600.0')
    out.append('offset_bottom = 90.0')
    out.append('color = Color(0.06, 0.04, 0.12, 0.92)')
    out.append('')
    out.append('[node name="Name" type="Label" parent="HUD/Dialogue"]')
    out.append('offset_left = 12.0')
    out.append('offset_top = 6.0')
    out.append('offset_right = 588.0')
    out.append('offset_bottom = 24.0')
    out.append('theme_override_colors/font_color = Color(1, 0.78, 0.25, 1)')
    out.append('theme_override_font_sizes/font_size = 13')
    out.append('text = "BIG KAHUNA"')
    out.append('')
    out.append('[node name="Text" type="Label" parent="HUD/Dialogue"]')
    out.append('offset_left = 12.0')
    out.append('offset_top = 26.0')
    out.append('offset_right = 588.0')
    out.append('offset_bottom = 70.0')
    out.append('theme_override_font_sizes/font_size = 13')
    out.append('text = ""')
    out.append('autowrap_mode = 3')
    out.append('')
    out.append('[node name="Hint" type="Label" parent="HUD/Dialogue"]')
    out.append('offset_left = 12.0')
    out.append('offset_top = 70.0')
    out.append('offset_right = 588.0')
    out.append('offset_bottom = 86.0')
    out.append('theme_override_colors/font_color = Color(0.5, 0.95, 1, 1)')
    out.append('theme_override_font_sizes/font_size = 10')
    out.append('text = "[X] next"')
    out.append('horizontal_alignment = 2')
    out.append('')

    for panel, lines in [
        ("GameOver", [("Big", "GAME OVER", 28, "1, 0.3, 0.4"),
                      ("Sub", "Marshall has been auto-RSVP'd to the reunion...", 13, "1, 1, 1"),
                      ("Hint", "Press R to try again", 12, "0.5, 0.95, 1")]),
        ("Clear", [("Big", "STAGE CLEAR", 28, "1, 0.78, 0.25"),
                   ("Sub", "REUNION STATUS: TENTATIVE", 13, "1, 0.4, 0.85"),
                   ("Hint", "Press R to play again", 12, "0.5, 0.95, 1")]),
    ]:
        out.append(f'[node name="{panel}" type="Control" parent="HUD"]')
        out.append('visible = false')
        out.append('offset_right = 640.0')
        out.append('offset_bottom = 360.0')
        out.append('mouse_filter = 2')
        out.append('')
        out.append(f'[node name="Dim" type="ColorRect" parent="HUD/{panel}"]')
        out.append('offset_right = 640.0')
        out.append('offset_bottom = 360.0')
        out.append('color = Color(0, 0, 0, 0.65)')
        out.append('')
        for j, (lname, text, size, color) in enumerate(lines):
            top = 130 + j * 44
            out.append(f'[node name="{lname}" type="Label" parent="HUD/{panel}"]')
            out.append(f'offset_top = {float(top)}')
            out.append('offset_right = 640.0')
            out.append(f'offset_bottom = {float(top + 40)}')
            out.append(f'theme_override_colors/font_color = Color({color}, 1)')
            out.append(f'theme_override_font_sizes/font_size = {size}')
            out.append(f'text = "{text}"')
            out.append('horizontal_alignment = 1')
            out.append('')

    return "\n".join(out)


def main():
    with open(os.path.join(ROOT, "scenes", "player.tscn"), "w") as f:
        f.write(gen_player())
    with open(os.path.join(ROOT, "scenes", "boss.tscn"), "w") as f:
        f.write(gen_boss())
    with open(os.path.join(ROOT, "scenes", "main.tscn"), "w") as f:
        f.write(gen_main())
    print("generated player.tscn, boss.tscn, main.tscn")


if __name__ == "__main__":
    main()
