extends CanvasLayer

@onready var hearts: Control = $Hearts
@onready var title: Control = $Title
@onready var boss_bar: Control = $BossBar
@onready var boss_fill: ColorRect = $BossBar/Fill
@onready var dialogue_panel: Control = $Dialogue
@onready var dlg_name: Label = $Dialogue/Name
@onready var dlg_text: Label = $Dialogue/Text
@onready var game_over_panel: Control = $GameOver
@onready var clear_panel: Control = $Clear

func set_hearts(hp: int, _max_hp: int) -> void:
	for i in hearts.get_child_count():
		hearts.get_child(i).visible = i < hp

func show_boss_bar() -> void:
	boss_bar.visible = true

func set_boss_hp(hp: int, max_hp: int) -> void:
	boss_fill.size.x = 216.0 * float(hp) / float(max_hp)

func show_dialogue(speaker: String, text: String) -> void:
	dialogue_panel.visible = true
	dlg_name.text = speaker
	dlg_text.text = text

func hide_dialogue() -> void:
	dialogue_panel.visible = false

func show_game_over() -> void:
	game_over_panel.visible = true

func show_clear() -> void:
	boss_bar.visible = false
	clear_panel.visible = true
