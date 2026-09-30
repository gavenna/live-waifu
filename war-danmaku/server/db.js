/**
 * SQLite 持久化层 — sql.js (WASM) 实现
 *
 * 三张表:
 *   players       — 玩家积分/段位（跨局持久）
 *   rounds        — 对局记录
 *   round_players — 对局-玩家关联（击杀/伤害/礼物）
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let _wasmB64 = null;
try { _wasmB64 = require('./sql-wasm-data'); } catch (e) { /* dev 模式从 node_modules 加载 */ }

class DB {
  constructor(dbPath) {
    const baseDir = __dirname.endsWith('server') ? path.resolve(__dirname, '..') : __dirname;
    this._path = dbPath || path.resolve(baseDir, 'data', 'war-danmaku.db');
    this.db = null;
    this._SQL = null;
  }

  async init() {
    const opts = _wasmB64 ? { wasmBinary: Buffer.from(_wasmB64, 'base64') } : {};
    this._SQL = await initSqlJs(opts);
    let buffer;
    try { buffer = fs.readFileSync(this._path); } catch (e) { buffer = null; }
    this.db = new this._SQL.Database(buffer);
    this.db.run('PRAGMA foreign_keys = ON');
    this._migrate();
  }

  _migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        rank TEXT NOT NULL DEFAULT '新兵',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        winner TEXT NOT NULL,
        duration_sec INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS round_players (
        round_id INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        team TEXT NOT NULL,
        kills INTEGER NOT NULL DEFAULT 0,
        damage_dealt INTEGER NOT NULL DEFAULT 0,
        gift_value INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (round_id, player_id),
        FOREIGN KEY (round_id) REFERENCES rounds(id)
      )
    `);
    this._save();
  }

  _save() {
    const data = this.db.export();
    const dir = path.dirname(this._path);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._path, Buffer.from(data));
  }

  // === 玩家 ===

  upsertPlayer(playerId, playerName, score) {
    const now = Date.now();
    this.db.run(
      `INSERT INTO players (id, name, score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         score = score + excluded.score,
         updated_at = excluded.updated_at`,
      [playerId, playerName, score, now, now]
    );
    this._save();
  }

  getPlayer(playerId) {
    const stmt = this.db.prepare('SELECT * FROM players WHERE id = ?');
    stmt.bind([playerId]);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }

  getAllPlayers() {
    const result = this.db.exec('SELECT * FROM players ORDER BY score DESC');
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  // === 对局 ===

  insertRound(winner, durationSec) {
    this.db.run(
      'INSERT INTO rounds (winner, duration_sec, created_at) VALUES (?, ?, ?)',
      [winner, durationSec, Date.now()]
    );
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const rowid = result[0].values[0][0];
    this._save();
    return { lastInsertRowid: rowid };
  }

  insertRoundPlayer(roundId, playerId, team, kills, damageDealt, giftValue) {
    this.db.run(
      `INSERT INTO round_players (round_id, player_id, team, kills, damage_dealt, gift_value)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [roundId, playerId, team, kills, damageDealt, giftValue]
    );
    this._save();
  }

  // === 管理 ===

  /** 清空所有数据（管理员重置） */
  deleteAll() {
    this.db.run('DELETE FROM round_players');
    this.db.run('DELETE FROM rounds');
    this.db.run('DELETE FROM players');
    this._save();
  }

  close() {
    if (this.db) {
      this._save();
      this.db.close();
    }
  }
}

module.exports = DB;
