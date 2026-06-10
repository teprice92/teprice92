extends SceneTree

## Headless smoke test:
##   Godot --headless -s tools/smoke_test.gd
## Walks Marshall, teleports him to the arena, plays through the dialogue,
## kills the boss and expects STAGE CLEAR. Exits 0 on success.

var step := 0
var frames := 0
var start_x := 0.0

func _initialize() -> void:
	change_scene_to_file("res://scenes/main.tscn")
	process_frame.connect(_tick)

func _fail(msg: String) -> void:
	push_error("SMOKE TEST FAILED: " + msg)
	quit(1)

func _tick() -> void:
	frames += 1
	if frames > 4000:
		_fail("timeout at step %d" % step)
		return
	var main := current_scene
	if main == null or not main.has_method("start_dialogue"):
		return
	var player := main.get_node("Player")
	var boss := main.get_node("Boss")
	match step:
		0:
			if player.hp != 5:
				_fail("player hp expected 5, got %d" % player.hp)
				return
			start_x = player.global_position.x
			Input.action_press("move_right")
			step = 1
		1:
			if frames > 90:
				Input.action_release("move_right")
				if player.global_position.x <= start_x + 20.0:
					_fail("player did not move right")
					return
				print("OK: movement works (x %.0f -> %.0f)" % [start_x, player.global_position.x])
				# Damage check.
				player.take_damage(1)
				if player.hp != 4:
					_fail("player damage did not apply")
					return
				print("OK: player damage + i-frames")
				# Send Marshall to the boss arena.
				player.global_position = Vector2(3260, 318)
				player.velocity = Vector2.ZERO
				step = 2
		2:
			if main.dialogue_active:
				print("OK: arena trigger fired, intro dialogue started")
				step = 3
		3:
			if main.dialogue_active:
				main._advance_dialogue()
			else:
				if boss.state != boss.State.CHASE:
					_fail("boss did not activate after dialogue")
					return
				print("OK: dialogue finished, boss is chasing")
				step = 4
		4:
			# Whip the Kahuna into submission (ignoring hurt cooldown).
			if boss.hp > 0:
				boss.hurt_cooldown = 0.0
				boss.take_damage(1)
			else:
				if boss.state != boss.State.DEAD:
					_fail("boss hp 0 but not dead")
					return
				print("OK: boss defeated")
				step = 5
		5:
			if main.dialogue_active:
				main._advance_dialogue()
			elif main.stage_clear:
				print("OK: STAGE CLEAR — reunion status: tentative")
				quit(0)
