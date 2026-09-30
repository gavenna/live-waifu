/**
 * 积分 & 段位 & 排行榜
 *
 * Phase 4: SQLite 持久化（重启不丢失）
 */

const config = require('./config');
const logger = require('./logger');

class Ranking {
  /**
   * @param {import('./db')} [db] 可选 SQLite 实例
   */
  constructor(db) {
    /** @type {Map<string, PlayerStats>} */
    this.players = new Map();
    this.db = db || null;
  }

  /** 从 SQLite 恢复数据 */
  load() {
    if (!this.db) return;
    const rows = this.db.getAllPlayers();
    let loaded = 0;
    for (const row of rows) {
      this.players.set(row.id, {
        id: row.id,
        name: row.name || row.id,
        totalScore: row.score,
        kills: 0,
        wins: 0,
        games: 0,
        streak: 0,
      });
      loaded++;
    }
    if (loaded > 0) {
      logger.info(`[RANKING] 从 DB 恢复 ${loaded} 名玩家`);
    }
  }

  /** 获取或创建玩家记录 */
  getOrCreate(playerId, playerName) {
    if (!this.players.has(playerId)) {
      this.players.set(playerId, {
        id: playerId,
        name: playerName || playerId,
        totalScore: 0,
        kills: 0,
        wins: 0,
        games: 0,
        streak: 0,
      });
    }
    return this.players.get(playerId);
  }

  /** 加分，自动同步 DB */
  addScore(playerId, amount, playerName) {
    const p = this.getOrCreate(playerId, playerName);
    p.totalScore += amount;
    if (playerName) p.name = playerName;

    if (this.db) {
      this.db.upsertPlayer(playerId, p.name, amount);
    }
    return p.totalScore;
  }

  /** 获取当前段位 */
  getRank(playerId) {
    const p = this.players.get(playerId);
    if (!p) return config.RANKS[0];
    const ranks = config.RANKS;
    let rank = ranks[0];
    for (const r of ranks) {
      if (p.totalScore >= r.minScore) rank = r;
    }
    return rank;
  }

  /** 重置所有排行榜数据 */
  reset() {
    this.players.clear();
    if (this.db) {
      this.db.deleteAll();
    }
  }

  /** 获取排行榜（Top N） */
  getLeaderboard(n = 10) {
    const sorted = [...this.players.values()]
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, n);
    return sorted.map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name || p.id,
      score: p.totalScore,
      kills: p.kills,
      wins: p.wins,
    }));
  }
}

module.exports = { Ranking };
