extends Node2D

## Stage director: spikes, checkpoints, the boss gate, dialogue and overlays.

const INTRO_LINES := [
	["BIG KAHUNA", "MARSHALL. There you are. You've whipped every chandelier in my casino."],
	["BIG KAHUNA", "* her curl bounces with managerial fury *"],
	["BIG KAHUNA", "The Firehouse Subs reunion event. Saturday. 0900 sharp. Attendance is MANDATORY."],
	["MARSHALL", "I didn't whip my way through a neon castle just to RSVP 'yes'."],
	["BIG KAHUNA", "Then face the SUB OF DESTINY. Fully loaded. Toasted. No refunds."],
]

const OUTRO_LINES := [
	["BIG KAHUNA", "Ugh... fine... I'll put you down as... 'tentative'."],
	["MARSHALL", "Put me down as 'whipped you with a whip'."],
	["BIG KAHUNA", "...There will be a signup sheet for side dishes. I'm just saying."],
]

@onready var player: CharacterBody2D = $Player
@onready var boss: CharacterBody2D = $Boss
@onready var hud: CanvasLayer = $HUD
@onready var gate_shape: CollisionShape2D = $Gate/Shape

var dialogue_lines: Array = []
var dialogue_index := 0
var dialogue_active := false
var _after_dialogue := Callable()
var fight_started := false
var game_over := false
var stage_clear := false
var spike_areas: Array = []

func _ready() -> void:
	player.health_changed.connect(hud.set_hearts)
	player.died.connect(_on_player_died)
	boss.health_changed.connect(hud.set_boss_hp)
	boss.defeated.connect(_on_boss_defeated)
	$ArenaTrigger.body_entered.connect(_on_arena_entered)
	$MidCheckpoint.body_entered.connect(_on_mid_checkpoint)
	spike_areas = [$SpikesA, $SpikesB]
	player.global_position = GameState.checkpoint
	hud.set_hearts(player.hp, player.MAX_HP)
	_fade_title()

func _fade_title() -> void:
	var tween := create_tween()
	tween.tween_interval(2.5)
	tween.tween_property(hud.title, "modulate:a", 0.0, 1.0)

func _physics_process(_delta: float) -> void:
	if game_over or stage_clear or dialogue_active:
		return
	for area in spike_areas:
		if area.overlaps_body(player):
			player.take_damage(1)

func _unhandled_input(event: InputEvent) -> void:
	if dialogue_active and (event.is_action_pressed("attack") or event.is_action_pressed("jump")):
		_advance_dialogue()
		get_viewport().set_input_as_handled()
	elif (game_over or stage_clear) and event.is_action_pressed("restart"):
		if stage_clear:
			GameState.reset()
		get_tree().paused = false
		get_tree().reload_current_scene()

func start_dialogue(lines: Array, after: Callable) -> void:
	dialogue_lines = lines
	dialogue_index = 0
	_after_dialogue = after
	dialogue_active = true
	get_tree().paused = true
	hud.show_dialogue(lines[0][0], lines[0][1])

func _advance_dialogue() -> void:
	dialogue_index += 1
	if dialogue_index < dialogue_lines.size():
		hud.show_dialogue(dialogue_lines[dialogue_index][0], dialogue_lines[dialogue_index][1])
	else:
		dialogue_active = false
		hud.hide_dialogue()
		get_tree().paused = false
		if _after_dialogue.is_valid():
			_after_dialogue.call()

func _on_mid_checkpoint(body: Node2D) -> void:
	if body == player and GameState.checkpoint.x < 1568.0:
		GameState.checkpoint = Vector2(1568, 320)

func _on_arena_entered(body: Node2D) -> void:
	if body != player or fight_started:
		return
	fight_started = true
	gate_shape.set_deferred("disabled", false)
	GameState.checkpoint = Vector2(3170, 320)
	if GameState.intro_done:
		_begin_fight()
	else:
		GameState.intro_done = true
		start_dialogue(INTRO_LINES, _begin_fight)

func _begin_fight() -> void:
	hud.show_boss_bar()
	hud.set_boss_hp(boss.hp, boss.MAX_HP)
	boss.activate(player)

func _on_player_died() -> void:
	game_over = true
	hud.show_game_over()

func _on_boss_defeated() -> void:
	start_dialogue(OUTRO_LINES, _show_clear)

func _show_clear() -> void:
	stage_clear = true
	hud.show_clear()
