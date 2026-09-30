extends SceneTree

func _initialize() -> void:
	var packed_scene: PackedScene = load("res://main.tscn")
	var scene: Variant = packed_scene.instantiate()
	root.add_child(scene)
	scene.demo_enabled = false
	scene.battle.reset()
	scene.receive_event({"type": "comment", "team": "red", "user": "评论观众", "lane": 0})
	assert(scene.battle.units.size() == 3, "评论事件未召唤普通小队")
	scene.receive_event({"type": "gift", "team": "blue", "user": "礼物观众", "tier": 2, "lane": 1})
	assert(scene.battle.units.size() == 7, "礼物事件未召唤冠军战团")
	var old_energy: float = scene.battle.energy.red
	scene.receive_event({"type": "like", "team": "red", "user": "点赞观众", "count": 10})
	assert(scene.battle.energy.red > old_energy, "点赞事件未增加能量")
	scene.receive_event({"type": "skill", "team": "blue", "user": "技能观众"})
	assert(scene.battle.energy.blue == 0.0, "技能事件未消耗能量")
	print("EVENT_API_OK units=%d red_energy=%.1f blue_energy=%.1f" % [scene.battle.units.size(), scene.battle.energy.red, scene.battle.energy.blue])
	quit()