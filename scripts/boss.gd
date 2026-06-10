extends CharacterBody2D

## BIG KAHUNA — Marshall's boss. Wields the Sub of Destiny (fully loaded,
## toasted). Her curl bounces with managerial authority.

signal health_changed(hp: int, max_hp: int)
signal defeated

const MAX_HP := 14
const WALK_SPEED := 65.0
const GRAVITY := 900.0
const SWING_RANGE := 80.0
const ARENA_LEFT := 3180.0
const ARENA_RIGHT := 3770.0

const ShockwaveScene := preload("res://scenes/shockwave.tscn")

enum State { WAIT, CHASE, SWING, SLAM, DEAD }

var hp := MAX_HP
var state: State = State.WAIT
var attack_cooldown := 0.0
var attacks_since_slam := 0
var hurt_cooldown := 0.0
var player: Node2D

@onready var sprite: AnimatedSprite2D = $Sprite
@onready var swing_shape: CollisionShape2D = $SwingHitbox/Shape
@onready var slam_shape: CollisionShape2D = $SlamHitbox/Shape

func _ready() -> void:
	sprite.frame_changed.connect(_on_frame_changed)
	sprite.animation_finished.connect(_on_animation_finished)
	$SwingHitbox.body_entered.connect(_on_hitbox_touch)
	$SlamHitbox.body_entered.connect(_on_hitbox_touch)
	$ContactBox.body_entered.connect(_on_hitbox_touch)
	sprite.play("idle")

func activate(target: Node2D) -> void:
	player = target
	if state == State.WAIT:
		state = State.CHASE
		attack_cooldown = 0.8

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += GRAVITY * delta
	hurt_cooldown = maxf(hurt_cooldown - delta, 0.0)
	match state:
		State.CHASE:
			_chase(delta)
		_:
			velocity.x = 0.0
	move_and_slide()
	global_position.x = clampf(global_position.x, ARENA_LEFT, ARENA_RIGHT)

func _chase(delta: float) -> void:
	if player == null:
		return
	var dx := player.global_position.x - global_position.x
	_face(dx)
	attack_cooldown = maxf(attack_cooldown - delta, 0.0)
	if attack_cooldown <= 0.0:
		if attacks_since_slam >= 2 or absf(dx) > 190.0:
			_start_slam()
			return
		if absf(dx) < SWING_RANGE:
			_start_swing()
			return
	velocity.x = signf(dx) * WALK_SPEED
	if absf(dx) < 30.0:
		velocity.x = 0.0
	if sprite.animation != &"walk":
		sprite.play("walk")

func _face(dx: float) -> void:
	# Sprite sheet faces left by default.
	sprite.flip_h = dx > 0.0
	var dir := 1.0 if dx > 0.0 else -1.0
	slam_shape.position.x = absf(slam_shape.position.x) * dir

func _start_swing() -> void:
	state = State.SWING
	attacks_since_slam += 1
	sprite.play("swing")

func _start_slam() -> void:
	state = State.SLAM
	attacks_since_slam = 0
	sprite.play("slam")

func _on_frame_changed() -> void:
	match sprite.animation:
		&"swing":
			swing_shape.set_deferred("disabled", sprite.frame < 1 or sprite.frame > 4)
		&"slam":
			slam_shape.set_deferred("disabled", sprite.frame < 3)
			if sprite.frame == 3 and state == State.SLAM:
				_spawn_shockwave()

func _on_animation_finished() -> void:
	if state == State.SWING or state == State.SLAM:
		swing_shape.set_deferred("disabled", true)
		slam_shape.set_deferred("disabled", true)
		attack_cooldown = randf_range(0.9, 1.5)
		state = State.CHASE

func _spawn_shockwave() -> void:
	var wave := ShockwaveScene.instantiate()
	var dir := 1.0 if sprite.flip_h else -1.0
	wave.direction = dir
	wave.process_mode = Node.PROCESS_MODE_PAUSABLE
	get_parent().add_child(wave)
	wave.global_position = global_position + Vector2(36.0 * dir, -10.0)

func _on_hitbox_touch(body: Node2D) -> void:
	if state == State.WAIT or state == State.DEAD:
		return
	if body.has_method("take_damage"):
		body.take_damage(1, global_position.x)

func take_damage(amount: int, _from_x: float = NAN) -> void:
	if state == State.WAIT or state == State.DEAD:
		return
	if hurt_cooldown > 0.0:
		return
	hurt_cooldown = 0.35
	hp = maxi(hp - amount, 0)
	health_changed.emit(hp, MAX_HP)
	sprite.modulate = Color(6.0, 1.5, 6.0)
	var tween := create_tween()
	tween.tween_property(sprite, "modulate", Color.WHITE, 0.25)
	if hp <= 0:
		_die()

func _die() -> void:
	state = State.DEAD
	velocity.x = 0.0
	swing_shape.set_deferred("disabled", true)
	slam_shape.set_deferred("disabled", true)
	$ContactBox/Shape.set_deferred("disabled", true)
	collision_layer = 0
	sprite.play("idle")
	sprite.speed_scale = 0.5
	modulate = Color(0.65, 0.65, 0.75)
	defeated.emit()
