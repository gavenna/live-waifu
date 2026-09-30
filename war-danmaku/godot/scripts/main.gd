extends Node2D

const BattleModel = preload("res://scripts/battle_model.gd")
const VIEW := Vector2(1920, 1080)
const RED := Color("ff554d")
const BLUE := Color("3c9cff")
const GOLD := Color("ffd166")
const INK := Color("172033")
const PAPER := Color("f7e8c5")
const LANE_NAMES := ["北境", "王道", "河谷"]
const DEMO_NAMES := ["小桃气", "铁锅炖大鹅", "阿强", "云上看客", "七月", "不熬夜了", "团子", "北方的狼"]

var battle := BattleModel.new()
var demo_enabled := true
var demo_timer := 0.6
var demo_index := 0
var camera_shake := 0.0
var previous_red_hp := 0.0
var previous_blue_hp := 0.0
var font: Font

func _ready() -> void:
	font = ThemeDB.fallback_font
	battle.reset()
	previous_red_hp = battle.castle_hp.red
	previous_blue_hp = battle.castle_hp.blue
	set_process(true)
	queue_redraw()
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--capture="):
			_capture_after_warmup(argument.trim_prefix("--capture="))

func _process(delta: float) -> void:
	battle.tick(delta)
	if battle.castle_hp.red < previous_red_hp or battle.castle_hp.blue < previous_blue_hp:
		camera_shake = 0.22
	previous_red_hp = battle.castle_hp.red
	previous_blue_hp = battle.castle_hp.blue
	camera_shake = maxf(0.0, camera_shake - delta)
	if demo_enabled and battle.winner == "":
		_run_demo(delta)
	queue_redraw()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("spawn_red_squad"):
		battle.spawn_squad("red", demo_index % 3, "主播-红方")
	elif event.is_action_pressed("spawn_blue_squad"):
		battle.spawn_squad("blue", demo_index % 3, "主播-蓝方")
	elif event.is_action_pressed("red_skill"):
		battle.energy.red = 100.0
		battle.cast_skill("red", "红方集结")
	elif event.is_action_pressed("blue_skill"):
		battle.energy.blue = 100.0
		battle.cast_skill("blue", "蓝方集结")
	elif event.is_action_pressed("toggle_demo"):
		demo_enabled = not demo_enabled
		battle.add_feed("自动演示：%s" % ("开启" if demo_enabled else "暂停"), PAPER, true)
	elif event.is_action_pressed("restart_round"):
		battle.reset()

# 直播接入层只需把统一事件字典传进来。
# 示例：receive_event({"type":"gift", "team":"red", "user":"观众A", "tier":2, "lane":1})
func receive_event(event: Dictionary) -> void:
	var event_type: String = str(event.get("type", ""))
	var team: String = str(event.get("team", "red"))
	var user: String = str(event.get("user", "匿名观众"))
	var lane: int = int(event.get("lane", randi_range(0, 2)))
	match event_type:
		"join", "comment", "spawn":
			battle.spawn_squad(team, lane, user)
		"gift":
			battle.spawn_squad(team, lane, user, int(event.get("tier", 1)) >= 2)
		"like":
			battle.add_energy(team, float(event.get("count", 1)) * 0.6, user)
		"skill":
			battle.energy[team] = 100.0
			battle.cast_skill(team, user)

func _run_demo(delta: float) -> void:
	demo_timer -= delta
	if demo_timer > 0.0:
		return
	var team := "red" if demo_index % 2 == 0 else "blue"
	var lane := (demo_index * 2 + int(demo_index / 3.0)) % 3
	var owner: String = DEMO_NAMES[demo_index % DEMO_NAMES.size()]
	var premium := demo_index > 0 and demo_index % 7 == 0
	battle.spawn_squad(team, lane, owner, premium)
	if demo_index % 4 == 0:
		battle.add_energy(team, 18.0, owner)
	if battle.energy[team] >= 100.0 and demo_index % 3 == 0:
		battle.cast_skill(team, owner)
	demo_index += 1
	demo_timer = 2.1 + battle.rng.randf_range(-0.25, 0.55)

func _draw() -> void:
	var shake := Vector2.ZERO
	if camera_shake > 0.0:
		shake = Vector2(randf_range(-7.0, 7.0), randf_range(-4.0, 4.0)) * (camera_shake / 0.22)
	draw_set_transform(shake)
	_draw_background()
	_draw_lanes()
	_draw_castle("red")
	_draw_castle("blue")
	_draw_units()
	_draw_projectiles()
	_draw_effects()
	draw_set_transform(Vector2.ZERO)
	_draw_hud()
	if battle.winner != "":
		_draw_result()

func _draw_background() -> void:
	draw_rect(Rect2(Vector2.ZERO, VIEW), Color("121a29"))
	for index in 8:
		var y := 160.0 + index * 125.0
		draw_rect(Rect2(0, y, 1920, 125), Color("263249") if index % 2 == 0 else Color("202b40"))
	# 中央战区形成聚光区域，直播压缩后仍能保持单位清晰。
	draw_colored_polygon(PackedVector2Array([Vector2(190, 270), Vector2(1730, 270), Vector2(1810, 870), Vector2(110, 870)]), Color("34445b"))
	for x in range(0, 1920, 120):
		draw_line(Vector2(x, 270), Vector2(x - 60, 870), Color(1, 1, 1, 0.025), 2.0)

func _draw_lanes() -> void:
	for lane in 3:
		var y: float = BattleModel.LANES[lane]
		var pressure: float = battle.lane_pressure("red", lane)
		var tint := RED if pressure > 0.8 else BLUE if pressure < -0.8 else PAPER
		draw_line(Vector2(300, y + 45), Vector2(1620, y + 45), Color(tint, 0.11), 90.0, true)
		draw_dashed_line(Vector2(350, y + 45), Vector2(1570, y + 45), Color(1, 1, 1, 0.14), 3.0, 14.0)
		_draw_pill(Vector2(910, y + 76), Vector2(100, 26), Color(0.05, 0.08, 0.13, 0.8), LANE_NAMES[lane], 17, Color(PAPER, 0.8))

func _draw_castle(team: String) -> void:
	var red_side := team == "red"
	var x := 195.0 if red_side else 1725.0
	var color := RED if red_side else BLUE
	var hp_ratio: float = battle.castle_hp[team] / BattleModel.MAX_CASTLE_HP
	var hit := false
	for effect in battle.effects:
		if effect.type == "castle_hit" and effect.team == team:
			hit = true
	var glow := Color.WHITE if hit else color
	# 高辨识度的程序化城堡轮廓。
	draw_circle(Vector2(x, 586), 94, Color(0.03, 0.05, 0.09, 0.9))
	draw_rect(Rect2(x - 66, 455, 132, 230), Color("283248"), true)
	draw_rect(Rect2(x - 82, 430, 48, 255), Color("303c53"), true)
	draw_rect(Rect2(x + 34, 430, 48, 255), Color("303c53"), true)
	for offset in [-70.0, -46.0, 46.0, 70.0]:
		draw_rect(Rect2(x + offset - 10, 408, 20, 34), glow, true)
	draw_colored_polygon(PackedVector2Array([Vector2(x - 52, 520), Vector2(x, 470), Vector2(x + 52, 520)]), Color(color, 0.85))
	draw_rect(Rect2(x - 20, 612, 40, 73), Color("101725"), true)
	draw_arc(Vector2(x, 612), 20, PI, TAU, 20, Color("101725"), 40)
	if hp_ratio < 0.45:
		for index in 3:
			var smoke_x := x + sin(Time.get_ticks_msec() * 0.002 + index) * 30.0
			draw_circle(Vector2(smoke_x, 390 - index * 18), 14 + index * 5, Color(0.25, 0.28, 0.32, 0.2))
	_draw_text(Vector2(x - 95, 730), "%s王城" % ("赤焰" if red_side else "苍霜"), 25, color, 190, HORIZONTAL_ALIGNMENT_CENTER)

func _draw_units() -> void:
	var ordered := battle.units.duplicate()
	ordered.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.pos.y < b.pos.y)
	for unit in ordered:
		_draw_unit(unit)

func _draw_unit(unit: Dictionary) -> void:
	var pos: Vector2 = unit.pos
	var team_color := RED if unit.team == "red" else BLUE
	var death_scale := 1.0 - clampf(unit.death_time / 0.55, 0.0, 1.0)
	var bob := sin(unit.walk_phase) * 3.0 if not unit.dead else 0.0
	pos.y += bob
	draw_set_transform(pos, 0.0, Vector2.ONE * death_scale)
	var radius: float = unit.radius
	_draw_oval(Vector2(0, radius + 10), Vector2(radius * 1.15, 8), Color(0, 0, 0, 0.28))
	if unit.kind == "champion":
		draw_circle(Vector2.ZERO, radius + 9, Color(GOLD, 0.22))
		draw_arc(Vector2.ZERO, radius + 7, 0, TAU, 30, GOLD, 3.0)
	# 统一的玩具兵视觉语言，颜色、武器和轮廓区分兵种。
	draw_circle(Vector2(0, -10), radius * 0.62, Color.WHITE if unit.flash > 0.0 else Color("e8c79f"))
	draw_circle(Vector2(0, 8), radius, team_color.darkened(0.28))
	draw_arc(Vector2(0, 8), radius, 0, TAU, 24, team_color.lightened(0.18), 4.0)
	match unit.kind:
		"guard":
			draw_colored_polygon(PackedVector2Array([Vector2(-18, -30), Vector2(18, -30), Vector2(13, -10), Vector2(-13, -10)]), team_color)
			draw_colored_polygon(PackedVector2Array([Vector2(unit.facing * 18, -2), Vector2(unit.facing * 34, 7), Vector2(unit.facing * 18, 22)]), Color("d8bd72"))
		"ranger":
			draw_arc(Vector2(unit.facing * 20, 4), 17, -PI / 2, PI / 2, 12, Color("d6b36b"), 4.0)
			draw_line(Vector2(unit.facing * 20, -13), Vector2(unit.facing * 20, 21), PAPER, 2.0)
		"rider":
			_draw_oval(Vector2(-unit.facing * 9, 19), Vector2(31, 15), Color("765442"))
			draw_line(Vector2(unit.facing * 10, 0), Vector2(unit.facing * 42, -18), Color("e7d5a0"), 4.0)
		"champion":
			draw_colored_polygon(PackedVector2Array([Vector2(-20, -35), Vector2(-10, -52), Vector2(0, -35), Vector2(11, -52), Vector2(20, -35)]), GOLD)
			draw_line(Vector2(unit.facing * 12, -4), Vector2(unit.facing * 46, -30), Color.WHITE, 7.0)
	# HP 与署名只占很小面积，冠军署名始终可见。
	var hp_ratio: float = maxf(0.0, unit.hp / unit.max_hp)
	draw_rect(Rect2(-radius, -radius - 20, radius * 2, 5), Color("101521"), true)
	draw_rect(Rect2(-radius, -radius - 20, radius * 2 * hp_ratio, 5), Color("7ee081"), true)
	if unit.kind == "champion":
		_draw_text(Vector2(-72, -radius - 48), unit.owner, 16, GOLD, 144, HORIZONTAL_ALIGNMENT_CENTER)
	draw_set_transform(Vector2.ZERO)

func _draw_projectiles() -> void:
	for projectile in battle.projectiles:
		var color := RED if projectile.team == "red" else BLUE
		draw_line(projectile.from - Vector2(20 if projectile.team == "red" else -20, 12), projectile.from, Color("ffe9a6"), 4.0)
		draw_circle(projectile.from, 5, color)

func _draw_effects() -> void:
	for effect in battle.effects:
		var progress: float = 1.0 - effect.life / effect.max_life
		match effect.type:
			"spawn":
				var x := BattleModel.RED_GATE if effect.team == "red" else BattleModel.BLUE_GATE
				var color := RED if effect.team == "red" else BLUE
				draw_arc(Vector2(x, BattleModel.LANES[effect.lane]), 25 + progress * 70, 0, TAU, 30, Color(color, 1.0 - progress), 5.0)
			"slash":
				var color := RED if effect.team == "red" else BLUE
				draw_arc(effect.pos, 34 + progress * 18, -1.0, 1.1, 12, Color(color, 1.0 - progress), 7.0)
			"damage":
				_draw_text(effect.pos + Vector2(-30, -55 - progress * 35), "-%d" % effect.value, 19, Color(1, 0.9, 0.65, 1.0 - progress), 60, HORIZONTAL_ALIGNMENT_CENTER)
			"burst":
				var color := RED if effect.team == "red" else BLUE
				for ray in 8:
					var direction := Vector2.from_angle(ray * TAU / 8.0)
					draw_line(effect.pos + direction * 12, effect.pos + direction * (20 + progress * 35), Color(color, 1.0 - progress), 5.0)
			"meteor_warning":
				var pulse := 170.0 + sin(Time.get_ticks_msec() * 0.012) * 20.0
				draw_circle(Vector2(effect.x, 575), pulse, Color(1, 0.18, 0.08, 0.08))
				draw_arc(Vector2(effect.x, 575), pulse, 0, TAU, 50, Color("ff5a36"), 7.0)
				_draw_text(Vector2(effect.x - 160, 570), "⚠ 火雨预警", 29, Color("ffcc66"), 320, HORIZONTAL_ALIGNMENT_CENTER)
			"meteor":
				draw_line(effect.pos + Vector2(110, -280) * (1.0 - progress), effect.pos, Color("fff1a8"), 12.0)
				draw_circle(effect.pos, 28 + progress * 40, Color(1, 0.26, 0.08, 0.65 * (1.0 - progress)))

func _draw_hud() -> void:
	# 顶部比分栏
	draw_rect(Rect2(0, 0, 1920, 138), Color("0b111d"), true)
	draw_colored_polygon(PackedVector2Array([Vector2(0, 0), Vector2(720, 0), Vector2(850, 138), Vector2(0, 138)]), Color(RED, 0.22))
	draw_colored_polygon(PackedVector2Array([Vector2(1920, 0), Vector2(1200, 0), Vector2(1070, 138), Vector2(1920, 138)]), Color(BLUE, 0.22))
	_draw_text(Vector2(54, 35), "赤焰军团", 38, RED, 300)
	_draw_text(Vector2(1566, 35), "苍霜军团", 38, BLUE, 300, HORIZONTAL_ALIGNMENT_RIGHT)
	_draw_hp_bar("red", Rect2(54, 87, 650, 23))
	_draw_hp_bar("blue", Rect2(1216, 87, 650, 23), true)
	var minutes := int(battle.round_time) / 60
	var seconds := int(battle.round_time) % 60
	_draw_text(Vector2(810, 22), "%02d:%02d" % [minutes, seconds], 51, PAPER, 300, HORIZONTAL_ALIGNMENT_CENTER)
	_draw_text(Vector2(810, 82), "三路攻城 · 摧毁敌方王城", 18, Color(PAPER, 0.65), 300, HORIZONTAL_ALIGNMENT_CENTER)
	_draw_energy("red", Vector2(42, 920))
	_draw_energy("blue", Vector2(1438, 920))
	_draw_feed()
	_draw_controls()

func _draw_hp_bar(team: String, rect: Rect2, reverse := false) -> void:
	var ratio: float = battle.castle_hp[team] / BattleModel.MAX_CASTLE_HP
	var color := RED if team == "red" else BLUE
	draw_rect(rect, Color("172033"), true)
	var filled := Rect2(rect.position, Vector2(rect.size.x * ratio, rect.size.y))
	if reverse: filled.position.x = rect.end.x - filled.size.x
	draw_rect(filled, color, true)
	_draw_text(rect.position + Vector2(0, -28), "王城 %d / %d" % [battle.castle_hp[team], BattleModel.MAX_CASTLE_HP], 18, PAPER, rect.size.x, HORIZONTAL_ALIGNMENT_RIGHT if reverse else HORIZONTAL_ALIGNMENT_LEFT)

func _draw_energy(team: String, pos: Vector2) -> void:
	var color := RED if team == "red" else BLUE
	var value: float = battle.energy[team]
	draw_rect(Rect2(pos, Vector2(440, 112)), Color(0.04, 0.07, 0.12, 0.92), true)
	draw_rect(Rect2(pos + Vector2(16, 54), Vector2(408, 28)), Color("202a3b"), true)
	draw_rect(Rect2(pos + Vector2(16, 54), Vector2(408 * value / 100.0, 28)), color, true)
	_draw_text(pos + Vector2(16, 14), "%s阵营技能" % ("红方" if team == "red" else "蓝方"), 22, PAPER, 210)
	_draw_text(pos + Vector2(225, 14), "流星火雨 %d%%" % value, 22, GOLD if value >= 100 else color, 200, HORIZONTAL_ALIGNMENT_RIGHT)
	_draw_text(pos + Vector2(16, 87), "满能量自动释放 · 点赞可充能", 15, Color(PAPER, 0.58), 408, HORIZONTAL_ALIGNMENT_CENTER)

func _draw_feed() -> void:
	var y := 152.0
	for item in battle.feed:
		var width := 620.0 if item.important else 520.0
		var x := (1920.0 - width) / 2.0
		draw_rect(Rect2(x, y, width, 38), Color(0.03, 0.05, 0.09, 0.84), true)
		draw_rect(Rect2(x, y, 5, 38), item.color, true)
		_draw_text(Vector2(x + 16, y + 7), item.text, 19 if not item.important else 21, item.color, width - 32, HORIZONTAL_ALIGNMENT_CENTER)
		y += 44.0

func _draw_controls() -> void:
	var label := "自动演示 ON" if demo_enabled else "自动演示暂停"
	_draw_pill(Vector2(780, 1018), Vector2(360, 38), Color(0.04, 0.07, 0.12, 0.88), "%s  |  Q/P 出兵  W/O 技能  R 重开" % label, 15, Color(PAPER, 0.65))

func _draw_result() -> void:
	draw_rect(Rect2(Vector2.ZERO, VIEW), Color(0.02, 0.03, 0.06, 0.78), true)
	var color := RED if battle.winner == "red" else BLUE
	var team_name := "赤焰军团" if battle.winner == "red" else "苍霜军团"
	var mvp := battle.get_mvp(battle.winner)
	draw_circle(Vector2(960, 510), 235, Color(color, 0.12))
	draw_arc(Vector2(960, 510), 230, 0, TAU, 80, color, 8.0)
	_draw_text(Vector2(650, 345), "王城陷落", 34, GOLD, 620, HORIZONTAL_ALIGNMENT_CENTER)
	_draw_text(Vector2(560, 420), "%s 获胜" % team_name, 62, color, 800, HORIZONTAL_ALIGNMENT_CENTER)
	_draw_text(Vector2(650, 520), "本局 MVP", 22, Color(PAPER, 0.65), 620, HORIZONTAL_ALIGNMENT_CENTER)
	_draw_text(Vector2(650, 558), "%s  ·  %d贡献" % [mvp.name, mvp.score], 32, PAPER, 620, HORIZONTAL_ALIGNMENT_CENTER)
	_draw_pill(Vector2(790, 650), Vector2(340, 52), color.darkened(0.55), "按 R 开始下一局", 22, PAPER)

func _draw_pill(center: Vector2, size: Vector2, color: Color, text: String, text_size: int, text_color: Color) -> void:
	var rect := Rect2(center - size / 2.0, size)
	draw_style_box(_rounded_box(color, minf(size.y / 2.0, 18.0)), rect)
	_draw_text(Vector2(rect.position.x, rect.position.y + (size.y - text_size) * 0.42), text, text_size, text_color, size.x, HORIZONTAL_ALIGNMENT_CENTER)

func _rounded_box(color: Color, radius: float) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = color
	box.corner_radius_top_left = int(radius)
	box.corner_radius_top_right = int(radius)
	box.corner_radius_bottom_left = int(radius)
	box.corner_radius_bottom_right = int(radius)
	return box

func _draw_oval(center: Vector2, radii: Vector2, color: Color) -> void:
	var points := PackedVector2Array()
	for index in 24:
		var angle := index * TAU / 24.0
		points.append(center + Vector2(cos(angle) * radii.x, sin(angle) * radii.y))
	draw_colored_polygon(points, color)

func _draw_text(pos: Vector2, text: String, size: int, color: Color, width := -1.0, alignment := HORIZONTAL_ALIGNMENT_LEFT) -> void:
	draw_string(font, pos + Vector2(0, size), text, alignment, width, size, color)

func _capture_after_warmup(output_path: String) -> void:
	await get_tree().create_timer(7.0).timeout
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	var error := image.save_png(output_path)
	if error != OK:
		push_error("截图保存失败：%s" % error_string(error))
		get_tree().quit(1)
		return
	print("CAPTURE_SAVED units=%d red_hp=%d blue_hp=%d path=%s" % [battle.units.size(), battle.castle_hp.red, battle.castle_hp.blue, output_path])
	get_tree().quit()