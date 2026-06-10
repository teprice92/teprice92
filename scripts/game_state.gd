extends Node

## Survives scene reloads so Marshall respawns at his last checkpoint
## and doesn't have to sit through the Big Kahuna's speech twice.

const START := Vector2(64, 320)

var checkpoint := START
var intro_done := false

func reset() -> void:
	checkpoint = START
	intro_done = false
