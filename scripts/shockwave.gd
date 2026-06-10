extends Area2D

## Sub-slam shockwave: a sizzling sandwich spark that skims along the floor.

const SPEED := 230.0
const LIFETIME := 2.2

var direction := 1.0
var _age := 0.0

func _ready() -> void:
	body_entered.connect(_on_body_entered)

func _physics_process(delta: float) -> void:
	_age += delta
	if _age > LIFETIME:
		queue_free()
		return
	position.x += SPEED * direction * delta
	$Visual.position.y = sin(_age * 25.0) * 1.5

func _on_body_entered(body: Node2D) -> void:
	if body.has_method("take_damage"):
		body.take_damage(1, global_position.x)
	queue_free()
