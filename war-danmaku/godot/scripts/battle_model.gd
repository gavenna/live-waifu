class_name BattleModel
extends RefCounted

const RED_GATE := 285.0
const BLUE_GATE := 1635.0
const MAX_CASTLE_HP := 2400.0
const ROUND_DURATION := 180.0
const LANES := [390.0, 575.0, 760.0]
const UNIT_DATA := {
	"guard": {"name": "盾卫", "hp": 190.0, "damage": 18.0, "speed": 42.0, "range": 54.0, "cooldown": 0.9, "radius": 22.0},
	"ranger": {"name": "弩手", "hp": 95.0, "damage": 25.0, "speed": 36.0, "range": 230.0, "cooldown": 1.3, "radius": 18.0},
	"rider": {"name": "骑兵", "hp": 140.0, "damage": 34.0, "speed": 76.0, "range": 58.0, "cooldown": 1.05, "radius": 24.0},
	"champion": {"name": "冠军", "hp": 430.0, "damage": 54.0, "speed": 48.0, "range": 70.0, "cooldown": 0.8, "radius": 31.0},
}

var units: Array[Dictionary] = []
var projectiles: Array[Dictionary] = []
var effects: Array[Dictionary] = []
var feed: Array[Dictionary] = []
var contributors := {"red": {}, "blue": {}}
var castle_hp := {"red": MAX_CASTLE_HP, "blue": MAX_CASTLE_HP}
var energy := {"red": 35.0, "blue": 35.0}
var round_time := ROUND_DURATION
var winner := ""
var next_unit_id := 1
var rng := RandomNumberGenerator.new()

func _init() -> void:
	rng.seed = 20260716

func reset() -> void:
	units.clear()
	projectiles.clear()
	effects.clear()
	feed.clear()
	contributors = {"red": {}, "blue": {}}
	castle_hp = {"red": MAX_CASTLE_HP, "blue": MAX_CASTLE_HP}
	energy = {"red": 35.0, "blue": 35.0}
	round_time = ROUND_DURATION
	winner = ""
	next_unit_id = 1
	add_feed("新一轮开始，发送红/蓝加入战场", Color("f2d49b"), true)

func tick(delta: float) -> void:
	_update_effects(delta)
	_update_projectiles(delta)
	if winner != "": return
	round_time = maxf(0.0, round_time - delta)
	energy.red = minf(100.0, energy.red + delta * 2.0)
	energy.blue = minf(100.0, energy.blue + delta * 2.0)
	for unit in units:
		if unit.dead: continue
		unit.flash = maxf(0.0, unit.flash - delta)
		unit.attack_timer = maxf(0.0, unit.attack_timer - delta)
		var target := _find_target(unit)
		if target.is_empty(): _move_or_attack_castle(unit, delta)
		else: _move_or_attack_unit(unit, target, delta)
	for unit in units:
		if unit.dead: unit.death_time += delta
	units = units.filter(func(unit: Dictionary) -> bool: return not unit.dead or unit.death_time < 0.55)
	if castle_hp.red <= 0.0: _finish_round("blue")
	elif castle_hp.blue <= 0.0: _finish_round("red")
	elif round_time <= 0.0: _finish_round("red" if castle_hp.red > castle_hp.blue else "blue")

func spawn_squad(team: String, lane: int, owner: String, premium := false) -> void:
	if winner != "": return
	lane = clampi(lane, 0, LANES.size() - 1)
	var composition := ["guard", "guard", "ranger"]
	if premium: composition = ["guard", "ranger", "rider", "champion"]
	for index in composition.size(): _spawn_unit(team, composition[index], lane, owner, index * 24.0)
	_record_contribution(team, owner, 30 if premium else 8)
	energy[team] = minf(100.0, energy[team] + (12.0 if premium else 5.0))
	add_feed("%s 为%s方召唤%s" % [owner, _team_name(team), "冠军战团" if premium else "突击小队"], _team_color(team), premium)
	effects.append({"type": "spawn", "team": team, "lane": lane, "life": 0.9, "max_life": 0.9})

func cast_skill(team: String, owner: String) -> bool:
	if winner != "" or energy[team] < 100.0: return false
	energy[team] = 0.0
	var center_x := _enemy_front_x(team)
	add_feed("%s 释放流星火雨！" % owner, Color("ffcf5a"), true)
	effects.append({"type": "meteor_warning", "team": team, "owner": owner, "x": center_x, "life": 1.8, "max_life": 1.8, "triggered": false})
	_record_contribution(team, owner, 50)
	return true

func add_energy(team: String, amount: float, owner := "观众点赞") -> void:
	if winner != "": return
	energy[team] = minf(100.0, energy[team] + amount)
	_record_contribution(team, owner, int(amount))

func lane_pressure(team: String, lane: int) -> float:
	var score := 0.0
	for unit in units:
		if unit.dead or unit.lane != lane: continue
		var value: float = unit.hp / unit.max_hp + unit.damage / 30.0
		score += value if unit.team == team else -value
	return score

func get_mvp(team: String) -> Dictionary:
	var best := {"name": "暂无", "score": 0}
	for player_name in contributors[team]:
		var score: int = contributors[team][player_name]
		if score > best.score: best = {"name": player_name, "score": score}
	return best

func _spawn_unit(team: String, kind: String, lane: int, owner: String, offset: float) -> void:
	var data: Dictionary = UNIT_DATA[kind]
	var direction := 1.0 if team == "red" else -1.0
	var spawn_x := RED_GATE if team == "red" else BLUE_GATE
	var comeback := 1.15 if castle_hp[team] < MAX_CASTLE_HP * 0.35 else 1.0
	units.append({"id": next_unit_id, "team": team, "kind": kind, "owner": owner, "lane": lane,
		"pos": Vector2(spawn_x - direction * offset, LANES[lane] + rng.randf_range(-20.0, 20.0)),
		"hp": data.hp * comeback, "max_hp": data.hp * comeback, "damage": data.damage * comeback,
		"speed": data.speed, "range": data.range, "cooldown": data.cooldown, "radius": data.radius,
		"attack_timer": rng.randf_range(0.0, 0.35), "flash": 0.0, "dead": false, "death_time": 0.0,
		"facing": direction, "walk_phase": rng.randf_range(0.0, TAU)})
	next_unit_id += 1

func _find_target(unit: Dictionary) -> Dictionary:
	var nearest: Dictionary = {}
	var nearest_distance := INF
	for candidate in units:
		if candidate.dead or candidate.team == unit.team or candidate.lane != unit.lane: continue
		var distance: float = absf(candidate.pos.x - unit.pos.x)
		if distance < nearest_distance:
			nearest = candidate
			nearest_distance = distance
	return nearest

func _move_or_attack_unit(unit: Dictionary, target: Dictionary, delta: float) -> void:
	var distance: float = absf(target.pos.x - unit.pos.x)
	if distance <= unit.range + target.radius:
		if unit.attack_timer <= 0.0:
			unit.attack_timer = unit.cooldown
			_attack(unit, target)
	else:
		var direction: float = signf(target.pos.x - unit.pos.x)
		unit.facing = direction
		unit.pos.x += direction * unit.speed * delta
		unit.walk_phase += delta * unit.speed * 0.08

func _move_or_attack_castle(unit: Dictionary, delta: float) -> void:
	var target_x := BLUE_GATE if unit.team == "red" else RED_GATE
	var direction: float = signf(target_x - unit.pos.x)
	unit.facing = direction
	if absf(target_x - unit.pos.x) <= unit.range + 28.0:
		if unit.attack_timer <= 0.0:
			unit.attack_timer = unit.cooldown
			var enemy := _other_team(unit.team)
			castle_hp[enemy] = maxf(0.0, castle_hp[enemy] - unit.damage)
			effects.append({"type": "castle_hit", "team": enemy, "life": 0.4, "max_life": 0.4})
			_record_contribution(unit.team, unit.owner, int(unit.damage))
	else:
		unit.pos.x += direction * unit.speed * delta
		unit.walk_phase += delta * unit.speed * 0.08

func _attack(attacker: Dictionary, target: Dictionary) -> void:
	if attacker.kind == "ranger":
		projectiles.append({"from": attacker.pos + Vector2(attacker.facing * 18.0, -18.0), "to_id": target.id, "team": attacker.team, "damage": attacker.damage, "owner": attacker.owner, "life": 0.65})
	else:
		_apply_damage(target, attacker.damage, attacker.team, attacker.owner)
		effects.append({"type": "slash", "pos": target.pos, "team": attacker.team, "life": 0.25, "max_life": 0.25})

func _apply_damage(target: Dictionary, damage: float, source_team: String, owner: String) -> void:
	if target.dead: return
	target.hp -= damage
	target.flash = 0.12
	effects.append({"type": "damage", "pos": target.pos, "value": int(damage), "team": source_team, "life": 0.75, "max_life": 0.75})
	_record_contribution(source_team, owner, int(damage))
	if target.hp <= 0.0:
		target.dead = true
		target.death_time = 0.0
		effects.append({"type": "burst", "pos": target.pos, "team": target.team, "life": 0.65, "max_life": 0.65})

func _update_projectiles(delta: float) -> void:
	for projectile in projectiles:
		projectile.life -= delta
		var target := _get_unit(projectile.to_id)
		if not target.is_empty(): projectile.from = projectile.from.lerp(target.pos + Vector2(0, -10), minf(1.0, delta * 9.0))
		if projectile.life <= 0.0 and not target.is_empty(): _apply_damage(target, projectile.damage, projectile.team, projectile.owner)
	projectiles = projectiles.filter(func(projectile: Dictionary) -> bool: return projectile.life > 0.0)

func _update_effects(delta: float) -> void:
	for effect in effects:
		effect.life -= delta
		if effect.type == "meteor_warning" and effect.life <= 0.72 and not effect.triggered:
			effect.triggered = true
			_trigger_meteor(effect.team, effect.x, effect.owner)
	effects = effects.filter(func(effect: Dictionary) -> bool: return effect.life > 0.0)
	for item in feed: item.life -= delta
	feed = feed.filter(func(item: Dictionary) -> bool: return item.life > 0.0)

func _trigger_meteor(team: String, center_x: float, owner: String) -> void:
	for unit in units:
		if unit.dead or unit.team == team or absf(unit.pos.x - center_x) > 300.0: continue
		_apply_damage(unit, 115.0, team, owner)
	for lane_y in LANES:
		effects.append({"type": "meteor", "pos": Vector2(center_x + rng.randf_range(-220.0, 220.0), lane_y), "team": team, "life": 0.8, "max_life": 0.8})

func _enemy_front_x(team: String) -> float:
	var enemy_positions: Array[float] = []
	for unit in units:
		if not unit.dead and unit.team != team: enemy_positions.append(unit.pos.x)
	if enemy_positions.is_empty(): return 1320.0 if team == "red" else 600.0
	enemy_positions.sort()
	return enemy_positions[enemy_positions.size() / 2]

func _get_unit(unit_id: int) -> Dictionary:
	for unit in units:
		if unit.id == unit_id: return unit
	return {}

func _record_contribution(team: String, player_name: String, score: int) -> void:
	contributors[team][player_name] = contributors[team].get(player_name, 0) + score

func _finish_round(team: String) -> void:
	winner = team
	add_feed("%s方攻破王城！" % _team_name(team), _team_color(team), true)

func add_feed(text: String, color: Color, important := false) -> void:
	feed.push_front({"text": text, "color": color, "life": 6.0 if important else 4.0, "important": important})
	if feed.size() > 5: feed.resize(5)

func _other_team(team: String) -> String: return "blue" if team == "red" else "red"
func _team_name(team: String) -> String: return "赤焰" if team == "red" else "苍霜"
func _team_color(team: String) -> Color: return Color("ff5b4d") if team == "red" else Color("45a7ff")
