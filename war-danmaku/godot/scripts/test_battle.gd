extends SceneTree

const BattleModel = preload("res://scripts/battle_model.gd")

func _initialize() -> void:
	var battle := BattleModel.new()
	battle.reset()
	for wave in 18:
		battle.spawn_squad("red", wave % 3, "红方测试%d" % wave, wave % 6 == 0)
		battle.spawn_squad("blue", (wave + 1) % 3, "蓝方测试%d" % wave, wave % 7 == 0)
		if wave % 4 == 0:
			battle.add_energy("red", 30.0, "红方点赞")
			battle.add_energy("blue", 30.0, "蓝方点赞")
		if battle.energy.red >= 100.0:
			battle.cast_skill("red", "红方测试技能")
		if battle.energy.blue >= 100.0:
			battle.cast_skill("blue", "蓝方测试技能")
		for tick in 30:
			battle.tick(0.1)
	for tick in 2400:
		battle.tick(0.1)
		if battle.winner != "":
			break
	assert(battle.winner != "", "完整对局未能产生胜方")
	assert(battle.castle_hp.red <= 0.0 or battle.castle_hp.blue <= 0.0 or battle.round_time <= 0.0, "胜负条件不合法")
	var mvp := battle.get_mvp(battle.winner)
	assert(mvp.score > 0, "胜方 MVP 贡献未记录")
	print("BATTLE_SMOKE_OK winner=%s red_hp=%d blue_hp=%d mvp=%s score=%d" % [battle.winner, battle.castle_hp.red, battle.castle_hp.blue, mvp.name, mvp.score])
	quit()