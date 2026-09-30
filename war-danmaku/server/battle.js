/**
 * 战斗逻辑 — 兵种生成、交战计算、战线推进
 *
 * 性能敏感：10tps 固定频率，不过度遍历。
 * 用「战线聚合模型」：兵种独立移动 + 碰撞交战 + 战线推拉。
 */

const config = require('./config');
const logger = require('./logger');
const assert = require('./assert');

const CANVAS_W = config.CANVAS_WIDTH;        // 1920
const CANVAS_H = config.CANVAS_HEIGHT;       // 1080
const CENTER_X = CANVAS_W / 2;               // 960 — 中线
const RED_SPAWN_X = 100;                      // 红方出生点
const BLUE_SPAWN_X = CANVAS_W - 100;         // 蓝方出生点 (1820)
const GROUND_Y = CANVAS_H * 0.55;            // 地面线 y 坐标（单线模式，三线模式用 LANES.Y）

const LANE_COUNT = config.LANES.COUNT;
const LANE_Y = config.LANES.Y;              // [390, 575, 760]

class Battle {
  constructor() {
    /** @type {Array<{id: number, team: string, key: string, damage: number, hp: number, maxHp: number, speed: number, x: number, y: number, ownerId: string, createdAt: number, counters: string[], ranged: boolean, aoe: boolean, fear: boolean, siege: boolean, globalSkill: boolean, showAvatar: boolean, avatarSize: string, avatarTime: number}>} */
    this.troops = [];
    this.frontLines = [0, 0, 0];      // 三线各自战线 [-1000, +1000], 0=中线
    this.frontLine = 0;              // 向后兼容：三线均值
    this._laneRoundRobin = 0;         // 兵种 round-robin 分线计数器
    this.events = [];                // 本 tick 战斗事件
    this._lastCastleShot = { red: 0, blue: 0 };  // 箭塔上次射击时间
  }

  /** 生成兵种 */
  spawnTroop(team, troopKey, playerId, playerName, lane = null) {
    assert.validTeam(team);

    const troopDef = config.TROOPS[troopKey];
    assert.troopExists(troopDef, troopKey);

    // 盲盒 → 随机兵种
    let actualKey = troopKey;
    let actualDef = troopDef;
    if (troopDef.random) {
      actualKey = weightedRandom(config.WAR_CHEST_POOL, config.WAR_CHEST_WEIGHTS);
      actualDef = config.TROOPS[actualKey];
      assert.troopExists(actualDef, actualKey);
      logger.info(`[BATTLE] ${playerName || playerId} 开盲盒 → ${actualDef.name}`);
    }

    // 三线分线：显式指定 > round-robin
    const assignedLane = (lane !== null && lane >= 0 && lane < LANE_COUNT)
      ? lane
      : (this._laneRoundRobin++ % LANE_COUNT);
    const laneY = LANE_Y[assignedLane];

    const x = team === 'red' ? RED_SPAWN_X : BLUE_SPAWN_X;
    const y = laneY + (Math.random() - 0.5) * 20;  // ±10px 微抖

    const troop = {
      id: Date.now() + Math.random(),
      team,
      lane: assignedLane,         // 0/1/2 所属兵线
      key: actualKey,
      damage: actualDef.damage,
      hp: actualDef.hp,
      maxHp: actualDef.hp,
      speed: actualDef.speed,
      x,
      y,
      ownerId: playerId,
      ownerName: playerName || playerId,
      createdAt: Date.now(),
      counters: actualDef.counters || [],
      ranged: actualDef.ranged || false,
      attackRange: actualDef.attackRange || config.BALANCE.COLLISION_RANGE,
      aoe: actualDef.aoe || false,
      fear: actualDef.fear || false,
      siege: actualDef.siege || false,
      globalSkill: actualDef.globalSkill || false,
      dragonBreath: actualDef.dragonBreath || false,
      breathBurn: actualDef.breathBurn || 0,
      breathTime: actualDef.breathTime || 0,
      roarInterval: actualDef.roarInterval || 0,
      _lastRoarTime: 0,
      showAvatar: actualDef.showAvatar || false,
      avatarSize: actualDef.avatarSize || 0,
      avatarTime: actualDef.avatarTime || 0,
      // 动画状态
      animState: 'idle',
      _deathStartedAt: 0,
    };

    // 全局技能立即生效，不加入 troops 数组
    if (troop.globalSkill) {
      this.events.push({
        type: 'global_skill',
        team,
        key: actualKey,
        ownerId: playerId,
        ownerName: playerName || playerId,
        damage: actualDef.damage,
        slow: actualDef.slow || 0,
        slowTime: actualDef.slowTime || 0,
        castleDmg: actualDef.castleDmg || 0,
        time: Date.now(),
      });
      logger.info(`[BATTLE] ${playerName || playerId} 释放全局技能: ${actualDef.name} (伤害:${actualDef.damage})`);
      return troop;
    }

    // 攻城兵种：直接对城堡造成伤害
    if (troop.siege) {
      this.events.push({
        type: 'siege',
        team,
        key: actualKey,
        ownerId: playerId,
        ownerName: playerName || playerId,
        damage: actualDef.damage,
        time: Date.now(),
      });
      logger.info(`[BATTLE] ${playerName || playerId} 派出攻城兵种: ${actualDef.name} (城堡伤害:${actualDef.damage})`);
      return troop;
    }

    this.troops.push(troop);

    this.events.push({
      type: 'spawn',
      team,
      key: actualKey,
      ownerId: playerId,
      ownerName: playerName || playerId,
      showAvatar: troop.showAvatar,
      avatarSize: troop.avatarSize,
      avatarTime: troop.avatarTime,
      time: Date.now(),
    });

    logger.debug(`[BATTLE] ${actualDef.name} 生成 — ${team}方 (${playerName || playerId}) x=${Math.round(x)} dmg=${actualDef.damage} hp=${actualDef.hp} speed=${actualDef.speed}`);

    return troop;
  }

  /** 每 tick 更新战斗状态 (100ms) */
  update(deltaMs, castleHpRed, castleHpBlue) {
    const dt = deltaMs / 1000;
    const bal = config.BALANCE;

    // === 1. 清理过期/死亡兵种 ===
    const now = Date.now();
    const anim = config.ANIMATION;
    const oldLen = this.troops.length;

    // 移除已完成死亡动画的兵种
    this.troops = this.troops.filter(t => {
      if (t.animState === 'death') {
        if (now - t._deathStartedAt > anim.DEATH_DURATION) {
          return false;
        }
        return true; // 保留，继续播放死亡动画
      }
      const age = now - t.createdAt;
      if (age > bal.MAX_TROOP_AGE) {
        this.events.push({ type: 'expire', troopId: t.id, team: t.team, key: t.key, time: now });
        return false;
      }
      return true;
    });
    if (oldLen !== this.troops.length) {
      logger.debug(`[BATTLE] 清理: ${oldLen - this.troops.length} 兵种 (剩余 ${this.troops.length})`);
    }

    // === 2. 兵种移动 + 动画状态 ===

    // 先收集所有存活兵种位置，用于判定是否应停止
    const allAlive = this.troops.filter(t => t.animState !== 'death' && t.hp > 0);

    for (const t of this.troops) {
      if (t.animState === 'death') continue;
      if (t.speed <= 0) continue;

      // 检查是否到达敌方城堡（士兵在城堡射程内即可）
      const enemyCastleX = t.team === 'red' ? CANVAS_W - 90 : 90;
      const atEnemyCastle = Math.abs(t.x - enemyCastleX) < 120;

      // 检查前方是否有同线敌人（远程用远程距离，近战用近战距离）
      const enemies = allAlive.filter(e => e.team !== t.team && e.lane === t.lane);
      let hasEnemyNearby = false;
      for (const enemy of enemies) {
        if (Math.abs(t.x - enemy.x) < t.attackRange) {
          hasEnemyNearby = true;
          break;
        }
      }

      if (!hasEnemyNearby && !atEnemyCastle) {
        const moveX = t.speed * bal.SPEED_FACTOR;
        if (t.team === 'red') {
          t.x = Math.min(t.x + moveX, CANVAS_W - 50);
        } else {
          t.x = Math.max(t.x - moveX, 50);
        }
      }

      // 出生后短暂 idle，然后切 walk（有敌人在附近时切 attack）
      if (now - t.createdAt < anim.IDLE_AFTER_SPAWN) {
        t.animState = 'idle';
      } else {
        t.animState = (hasEnemyNearby || atEnemyCastle) ? 'attack' : 'walk';
      }
    }

    // === 3. 攻击动画判定（在交战计算之前，确保攻击状态可见） ===
    const aliveTroops = this.troops.filter(t => t.animState !== 'death');
    const redTroops = aliveTroops.filter(t => t.team === 'red' && t.hp > 0);
    const blueTroops = aliveTroops.filter(t => t.team === 'blue' && t.hp > 0);
    const attackRangeFactor = anim.ATTACK_RANGE_FACTOR;

    for (const t of aliveTroops) {
      if (t.hp <= 0) continue;
      const enemies = (t.team === 'red' ? blueTroops : redTroops).filter(e => e.lane === t.lane);
      for (const enemy of enemies) {
        if (enemy.hp <= 0) continue;
        if (Math.abs(t.x - enemy.x) < t.attackRange * attackRangeFactor) {
          t.animState = 'attack';
          enemy.animState = 'attack'; // 双方都显示攻击动画
          break;
        }
      }
    }

    // === 4. 交战计算 ===

    let redTotalDmg = 0;
    let blueTotalDmg = 0;

    for (const rt of redTroops) {
      let closest = null, closestDist = Infinity;
      for (const bt of blueTroops) {
        if (bt.hp <= 0) continue;
        if (bt.lane !== rt.lane) continue;  // 同线交战
        const dist = Math.abs(rt.x - bt.x);
        if (dist < closestDist) { closest = bt; closestDist = dist; }
      }

      if (closest && closestDist < rt.attackRange) {
        const redDmg = getCounterDamage(rt, closest, bal.COUNTER_MULTIPLIER);
        const blueDmg = getCounterDamage(closest, rt, bal.COUNTER_MULTIPLIER);

        closest.hp -= redDmg;
        closest._lastHitAt = now;
        rt.hp -= blueDmg;
        rt._lastHitAt = now;

        if (closest.hp <= 0) {
          this.events.push({ type: 'kill', troopId: closest.id, team: 'blue', key: closest.key, killerId: rt.ownerId, killerName: rt.ownerName, time: now });
        }
        if (rt.hp <= 0) {
          this.events.push({ type: 'kill', troopId: rt.id, team: 'red', key: rt.key, killerId: closest.ownerId, killerName: closest.ownerName, time: now });
        }
      }

      if (rt.hp > 0) {
        redTotalDmg += rt.damage;
        if (rt.aoe) {
          for (const bt of blueTroops) {
            if (bt.hp <= 0) continue;
            if (Math.abs(rt.x - bt.x) < rt.attackRange * 2 && bt.lane === rt.lane) {
              const splashDmg = rt.damage * 0.3;
              bt.hp -= splashDmg;
              bt._lastHitAt = now;
              if (bt.hp <= 0) {
                this.events.push({ type: 'kill', troopId: bt.id, team: 'blue', key: bt.key, killerId: rt.ownerId, killerName: rt.ownerName, time: now });
              }
            }
          }
        }
      }
    }

    for (const bt of blueTroops) {
      if (bt.hp > 0) {
        blueTotalDmg += bt.damage;
        if (bt.aoe) {
          for (const rt of redTroops) {
            if (rt.hp <= 0) continue;
            if (Math.abs(bt.x - rt.x) < bt.attackRange * 2 && rt.lane === bt.lane) {
              rt.hp -= bt.damage * 0.3;
              rt._lastHitAt = now;
              if (rt.hp <= 0) {
                this.events.push({ type: 'kill', troopId: rt.id, team: 'red', key: rt.key, killerId: bt.ownerId, killerName: bt.ownerName, time: now });
              }
            }
          }
        }
      }
    }

    // === 5. 龙骑士：龙焰吐息 + 恐惧咆哮 ===
    for (const t of this.troops) {
      if (t.animState === 'death' || t.hp <= 0) continue;
      if (!t.dragonBreath) continue;

      const enemies = (t.team === 'red' ? blueTroops : redTroops)
        .filter(e => e.hp > 0 && e.lane === t.lane);
      const facingDir = t.team === 'red' ? 1 : -1;

      // 5a. 龙焰吐息 — AOE 攻击同线敌人（1s 冷却）
      if (t.animState === 'attack' && (!t._lastBreathTime || now - t._lastBreathTime > 1000)) {
        t._lastBreathTime = now;
        let hitCount = 0;
        for (const enemy of enemies) {
          const dist = Math.abs(t.x - enemy.x);
          const dir = Math.sign(enemy.x - t.x);
          // 只打前方扇形区域（同方向 + 范围内）
          if (dist < t.attackRange && dir === facingDir) {
            enemy.hp -= t.damage;
            enemy._lastHitAt = now;
            hitCount++;
            // 施加灼烧 debuff
            enemy._burnUntil = now + t.breathTime;
            enemy._burnDmg = t.breathBurn;
            if (enemy.hp <= 0) {
              this.events.push({ type: 'kill', troopId: enemy.id, team: enemy.team, key: enemy.key, killerId: t.ownerId, killerName: t.ownerName, time: now });
            }
          }
        }
        if (hitCount > 0) {
          this.events.push({ type: 'dragon_breath', team: t.team, lane: t.lane, x: t.x, ownerName: t.ownerName, hitCount, time: now });
        }
      }

      // 5b. 恐惧咆哮 — 周期性 shockwave
      if (now - t._lastRoarTime > t.roarInterval) {
        t._lastRoarTime = now;
        let feared = 0;
        for (const enemy of enemies) {
          const dist = Math.abs(t.x - enemy.x);
          if (dist < t.attackRange * 2) {
            enemy._fearedUntil = now + 3000;
            enemy._origSpeed = enemy.speed;
            enemy.speed = enemy.speed * 0.5;
            feared++;
          }
        }
        if (feared > 0) {
          this.events.push({ type: 'dragon_roar', team: t.team, lane: t.lane, x: t.x, ownerName: t.ownerName, fearedCount: feared, time: now });
        }
      }
    }

    // 灼烧伤害 tick
    for (const t of this.troops) {
      if (t.animState === 'death' || t.hp <= 0) continue;
      if (t._burnUntil && t._burnUntil > now && t._burnDmg > 0) {
        t.hp -= t._burnDmg;
        t._lastHitAt = now;
        if (t.hp <= 0) {
          this.events.push({ type: 'kill', troopId: t.id, team: t.team, key: t.key, killerId: 'dragonFire', killerName: '龙焰', time: now });
        }
      }
    }
    // 清理过期 debuff（恐惧 + 灼烧）
    for (const t of this.troops) {
      if (t.animState === 'death') continue;
      if (t._fearedUntil && t._fearedUntil < now && t._origSpeed !== undefined) {
        t.speed = t._origSpeed;
        t._fearedUntil = null;
        t._origSpeed = undefined;
      }
      if (t._burnUntil && t._burnUntil < now) {
        t._burnUntil = null;
        t._burnDmg = 0;
      }
    }

    // === 6. 城堡箭塔防御（HP越低越猛） ===
    const castleCfg = config.CASTLE_DEFENSE;
    const now6 = Date.now();
    for (const team of ['red', 'blue']) {
      var hpPct = team === 'red' ? (castleHpRed || 1) : (castleHpBlue || 1);
      var interval = castleCfg.INTERVAL;
      var dmg = castleCfg.DAMAGE;
      if (hpPct < 0.2) { interval *= 0.5; dmg *= 2.4; }       // 绝境: 1s/箭, 12伤害
      else if (hpPct < 0.4) { interval *= 0.75; dmg *= 1.6; }  // 强化: 1.5s/箭, 8伤害
      if (now6 - this._lastCastleShot[team] < interval) continue;
      const castleX = team === 'red' ? 90 : CANVAS_W - 90;
      const enemies = aliveTroops.filter(t => t.team !== team && t.hp > 0);
      let closest = null, closestDist = castleCfg.RANGE;
      for (const e of enemies) {
        const dist = Math.abs(e.x - castleX);
        if (dist < closestDist) { closest = e; closestDist = dist; }
      }
      if (closest) {
        closest.hp -= dmg;
        closest._lastHitAt = now6;
        this._lastCastleShot[team] = now6;
        this.events.push({
          type: 'castle_arrow',
          team,
          targetId: closest.id,
          targetX: closest.x,
          targetY: closest.y,
          targetLane: closest.lane,
          damage: dmg,
          castleX,
          time: now6,
        });
      }
    }

    // === 7. 士兵攻城（到达城堡射程内 + 攻击状态 → 造成实际伤害） ===
    const now7 = Date.now();
    for (const t of this.troops) {
      if (t.animState === 'death' || t.hp <= 0) continue;
      const enemyCastleX = t.team === 'red' ? CANVAS_W - 90 : 90;
      if (Math.abs(t.x - enemyCastleX) < 120
          && t.animState === 'attack') {
        if (!t._lastCastleAttack || now7 - t._lastCastleAttack > 500) {
          t._lastCastleAttack = now7;
          this.events.push({
            type: 'soldier_attack_castle',
            team: t.team,
            lane: t.lane,
            x: t.x,
            y: t.y,
            damage: t.damage,
            ownerId: t.ownerId,
            ownerName: t.ownerName,
            time: now7,
          });
        }
      }
    }

    // === 8. 标记死亡兵种（保留播死亡动画） ===
    let deadCount = 0;
    for (const t of this.troops) {
      if (t.animState === 'death') continue; // 已在死亡动画中
      if (t.hp <= 0) {
        t.animState = 'death';
        t._deathStartedAt = now;
        deadCount++;
      }
    }

    // === 9. 更新战线（三线独立计算） ===
    const laneDmg = [{ red: 0, blue: 0 }, { red: 0, blue: 0 }, { red: 0, blue: 0 }];
    for (const t of redTroops) {
      if (t.hp > 0) laneDmg[t.lane].red += t.damage;
    }
    for (const t of blueTroops) {
      if (t.hp > 0) laneDmg[t.lane].blue += t.damage;
    }

    for (let i = 0; i < LANE_COUNT; i++) {
      const { red, blue } = laneDmg[i];
      const dmgDiff = red - blue;
      const totalDmg = red + blue;
      const pushAmount = totalDmg > 0
        ? (dmgDiff / totalDmg) * bal.PUSH_FACTOR * 1000
        : 0;
      this.frontLines[i] = Math.max(-bal.FRONTLINE_MAX, Math.min(bal.FRONTLINE_MAX, this.frontLines[i] + pushAmount));
    }

    // 全局均值（向后兼容）
    this.frontLine = this.frontLines.reduce((a, b) => a + b, 0) / LANE_COUNT;

    // 仅在战线变化显著时记日志
    const maxFL = Math.max(...this.frontLines.map(Math.abs));
    const avgPush = this.frontLines.map((fl, i) => {
      const { red, blue } = laneDmg[i];
      return red + blue > 0 ? (red - blue) / (red + blue) * bal.PUSH_FACTOR * 1000 : 0;
    }).reduce((a, b) => a + Math.abs(b), 0) / LANE_COUNT;
    if (maxFL > 500 && avgPush > 5) {
      logger.debug(`[BATTLE] 战线: [${this.frontLines.map(f => Math.round(f)).join(',')}] 红dmg:${redTotalDmg} 蓝dmg:${blueTotalDmg} 兵:${this.troops.length} 死:${deadCount}`);
    }

    const tickEvents = [...this.events];
    this.events = [];
    return {
      frontLines: this.frontLines,
      frontLine: this.frontLine,
      troops: this.troops,
      events: tickEvents,
    };
  }

  /** 计算双方当前总伤害输出 */
  getDamageOutput() {
    let redDmg = 0, blueDmg = 0;
    for (const t of this.troops) {
      if (t.hp <= 0) continue;
      if (t.team === 'red') redDmg += t.damage;
      else blueDmg += t.damage;
    }
    return { red: redDmg, blue: blueDmg };
  }

  /** 获取战线位置（向后兼容） */
  getFrontLine() {
    return this.frontLine;
  }

  /** 获取三线战线 */
  getFrontLines() {
    return this.frontLines;
  }

  /** 计算某线压力值（正=红优，负=蓝优，用于前端渲染） */
  getLanePressure(laneIndex) {
    let score = 0;
    for (const t of this.troops) {
      if (t.animState === 'death' || t.hp <= 0) continue;
      if (t.lane !== laneIndex) continue;
      const value = t.hp / t.maxHp + t.damage / 30;
      score += t.team === 'red' ? value : -value;
    }
    return score;
  }
}

/** 计算克制伤害 */
function getCounterDamage(attacker, defender, multiplier) {
  let dmg = attacker.damage;
  if (attacker.counters && attacker.counters.includes(defender.key)) {
    dmg *= multiplier;
  }
  return dmg;
}

/** 加权随机 */
function weightedRandom(items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

module.exports = { Battle };
