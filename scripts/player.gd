extends CharacterBody2D

## Marshall — hero of the Neon Castle. Walks, runs, jumps, whips.

signal health_changed(hp: int, max_hp: int)
signal died

const MAX_HP := 5
const WALK_SPEED := 130.0
const RUN_SPEED := 205.0
const JUMP_VELOCITY := -360.0
const GRAVITY := 900.0

var hp := MAX_HP
var facing := 1
var attacking := false
var invincible_time := 0.0
var dead := false
var control_locked := false
var _whip_victims := {}

@onready var sprite: AnimatedSprite2D = $Sprite
@onready var whip_box: Area2D = $WhipHitbox
@onready var whip_shape: CollisionShape2D = $WhipHitbox/Shape

func _ready() -> void:
	sprite.frame_changed.connect(_on_frame_changed)
	sprite.animation_finished.connect(_on_animation_finished)
	whip_box.body_entered.connect(_on_whip_hit)

func _physics_process(delta: float) -> void:
	if invincible_time > 0.0:
		invincible_time -= delta
		sprite.visible = int(invincible_time * 14.0) % 2 == 0
		if invincible_time <= 0.0:
			sprite.visible = true
	if not is_on_floor():
		velocity.y += GRAVITY * delta
	var dir := 0.0
	if not dead and not control_locked:
		dir = Input.get_axis("move_left", "move_right")
		if Input.is_action_just_pressed("jump") and is_on_floor() and not attacking:
			velocity.y = JUMP_VELOCITY
			sprite.play("jump")
		if Input.is_action_just_pressed("attack") and not attacking:
			_start_whip()
	# Castlevania rule: no walking while whipping on the ground.
	if attacking and is_on_floor():
		dir = 0.0
	var top_speed := RUN_SPEED if Input.is_action_pressed("run") else WALK_SPEED
	velocity.x = move_toward(velocity.x, dir * top_speed, 1400.0 * delta)
	if dir != 0.0 and not attacking:
		facing = 1 if dir > 0.0 else -1
		sprite.flip_h = facing < 0
		whip_shape.position.x = absf(whip_shape.position.x) * facing
	move_and_slide()
	_update_animation()

func _update_animation() -> void:
	if dead or attacking:
		return
	if not is_on_floor():
		if sprite.animation != &"jump":
			sprite.play("jump")
	elif absf(velocity.x) > 150.0:
		sprite.play("run")
	elif absf(velocity.x) > 10.0:
		sprite.play("walk")
	else:
		sprite.play("idle")

func _start_whip() -> void:
	attacking = true
	_whip_victims.clear()
	sprite.play("whip")

func _on_frame_changed() -> void:
	if sprite.animation == &"whip":
		# Whip is extended on the later frames only.
		whip_shape.set_deferred("disabled", sprite.frame < 2)

func _on_animation_finished() -> void:
	if sprite.animation == &"whip":
		attacking = false
		whip_shape.set_deferred("disabled", true)

func _on_whip_hit(body: Node2D) -> void:
	if _whip_victims.has(body):
		return
	_whip_victims[body] = true
	if body.has_method("take_damage"):
		body.take_damage(1, global_position.x)

func take_damage(amount: int, from_x: float = NAN) -> void:
	if dead or invincible_time > 0.0:
		return
	hp = maxi(hp - amount, 0)
	health_changed.emit(hp, MAX_HP)
	invincible_time = 1.2
	velocity.y = -200.0
	var push := -facing
	if not is_nan(from_x):
		push = 1 if global_position.x > from_x else -1
	velocity.x = 160.0 * push
	if hp <= 0:
		_die()

func _die() -> void:
	dead = true
	attacking = false
	whip_shape.set_deferred("disabled", true)
	sprite.visible = true
	sprite.play("jump")
	died.emit()
