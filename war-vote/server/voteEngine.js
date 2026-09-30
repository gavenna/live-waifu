// 投票状态机 —— 观众抢占阵型槽位，锁票后生成地图
//
// IDLE ──start()──→ VOTING ──倒计时──→ LOCKED ──生成──→ READY ──reset()──→ IDLE
//
// 数据模型：occupants[side] = Map<槽位号, {playerId, name}>
// 槽位坐标与预设兵种由 mapGen.formationSlots() 决定，观众只选号。

const EventEmitter = require('events');
const config = require('./config');
const mapGen = require('./mapGen');
const logger = require('./logger');

const STATE = { IDLE: 'IDLE', VOTING: 'VOTING', LOCKED: 'LOCKED', READY: 'READY' };

const CHANGE_THROTTLE_MS = 200;
const RECENT_KEEP = 30;

class VoteEngine extends EventEmitter {
  constructor() {
    super();
    this.state = STATE.IDLE;
    this.occupants = { red: new Map(), blue: new Map() };
    this.players = new Map();
    this.recentVoters = [];
    this.startedAt = 0;
    this.endsAt = 0;
    this.lastFile = null;
    this._timer = null;
    this._changeTimer = null;
  }

  // ===== 指令解析 =====

  parse(text) {
    const t = (text || '').trim();
    if (!t) return null;

    // 组合指令：红5 / 蓝12 —— 一步入阵营并占位
    for (const [word, team] of Object.entries(config.JOIN_COMMANDS)) {
      if (t.length > word.length && t.startsWith(word)) {
        const num = Number(t.slice(word.length).trim());
        if (Number.isInteger(num) && num >= 1) return { kind: 'join_take', team, slot: num };
      }
    }

    // 纯入阵营
    if (config.JOIN_COMMANDS[t]) return { kind: 'join', team: config.JOIN_COMMANDS[t] };

    // 纯数字：已入阵营时占本方的号
    const num = Number(t);
    if (Number.isInteger(num) && num >= 1 && String(num) === t) return { kind: 'take', slot: num };

    return null;
  }

  // ===== 状态机 =====

  start() {
    if (this.state === STATE.VOTING || this.state === STATE.LOCKED) return false;
    if (this.state === STATE.READY) this.reset(false);
    this.reset(false);
    this.state = STATE.VOTING;
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + config.VOTE_DURATION_MS;
    this._timer = setTimeout(() => this.lock(), config.VOTE_DURATION_MS);
    logger.info(`投票开始，窗口 ${Math.round(config.VOTE_DURATION_MS / 1000)}s，每方 ${mapGen.slotCount()} 个槽位`);
    this.emit('state');
    return true;
  }

  lock() {
    if (this.state !== STATE.VOTING) return false;
    clearTimeout(this._timer);
    this._timer = null;
    this.state = STATE.LOCKED;
    const total = this.occupants.red.size + this.occupants.blue.size;
    logger.info(`投票锁定：红 ${this.occupants.red.size} 人 / 蓝 ${this.occupants.blue.size} 人（共 ${total} 个槽位）`);
    this.emit('state');
    setTimeout(() => this.generate(), config.READY_HOLD_MS);
    return true;
  }

  generate() {
    try {
      const { grid } = mapGen.buildBattle(this.occupants);
      this.lastFile = mapGen.writeMapFile(grid, {
        redCount: this.occupants.red.size,
        blueCount: this.occupants.blue.size,
      });
      this.state = STATE.READY;
      logger.info(`地图已生成：${this.lastFile}（${grid.size} 个格子）`);
    } catch (e) {
      this.state = STATE.IDLE;
      logger.error(`地图生成失败：${e.message}`);
      this.emit('failed', e);
    }
    this.emit('state');
  }

  reset(emit) {
    clearTimeout(this._timer);
    clearTimeout(this._changeTimer);
    this._timer = null;
    this._changeTimer = null;
    this.state = STATE.IDLE;
    this.occupants = { red: new Map(), blue: new Map() };
    this.players = new Map();
    this.recentVoters = [];
    this.startedAt = 0;
    this.endsAt = 0;
    this.lastFile = null;
    if (emit !== false) this.emit('state');
  }

  // ===== 弹幕消费 =====

  handleMessage(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'join') {
      const team = msg.team === 'red' || msg.team === 'blue' ? msg.team : null;
      if (team) this.setTeam(msg.playerId, msg.playerName, team);
      return;
    }

    if (msg.type !== 'danmaku') return;
    if (this.state !== STATE.VOTING) return;

    const cmd = this.parse(msg.text);
    if (!cmd) return;

    if (cmd.kind === 'join') {
      this.setTeam(msg.playerId, msg.playerName, cmd.team);
    } else if (cmd.kind === 'take') {
      this.takeSlot(msg.playerId, msg.playerName, cmd.slot);
    } else if (cmd.kind === 'join_take') {
      this.setTeam(msg.playerId, msg.playerName, cmd.team);
      this.takeSlot(msg.playerId, msg.playerName, cmd.slot);
    }
  }

  setTeam(playerId, playerName, team) {
    if (!playerId) return;
    const p = this.players.get(playerId) || { name: playerName || playerId, slot: null };
    // 换阵营时释放原来的槽位，避免一个观众占两边
    if (p.team && p.team !== team && p.slot) {
      this.occupants[p.team].delete(p.slot);
      p.slot = null;
    }
    p.team = team;
    p.name = playerName || p.name;
    this.players.set(playerId, p);
    this.scheduleChange();
  }

  takeSlot(playerId, playerName, slot) {
    const p = this.players.get(playerId);
    if (!p || !p.team) return { ok: false, reason: 'no_team' };
    if (p.slot) return { ok: false, reason: 'already_took', slot: p.slot };

    const occ = this.occupants[p.team];
    if (occ.has(slot)) return { ok: false, reason: 'taken', by: occ.get(slot).name };

    occ.set(slot, { playerId, name: playerName || p.name });
    p.slot = slot;
    p.name = playerName || p.name;

    const unit = slot <= mapGen.slotCount()
      ? (mapGen.formationSlots(config.TEAMS[p.team].team)[slot - 1] || {}).unit
      : config.FORMATION.overflow.unit;

    this.recentVoters.unshift({
      name: p.name,
      team: p.team,
      slot,
      label: unit ? mapGen.unitLabel(unit) : '?',
      overflow: slot > mapGen.slotCount(),
    });
    if (this.recentVoters.length > RECENT_KEEP) this.recentVoters.pop();

    this.scheduleChange();
    return { ok: true, slot };
  }

  scheduleChange() {
    if (this._changeTimer) return;
    this._changeTimer = setTimeout(() => {
      this._changeTimer = null;
      this.emit('change');
    }, CHANGE_THROTTLE_MS);
  }

  // ===== 查询 =====

  playerCountOf(side) {
    let n = 0;
    for (const p of this.players.values()) if (p.team === side) n++;
    return n;
  }

  snapshot() {
    const now = Date.now();
    const { grid, slots } = mapGen.buildBattle(this.occupants);
    const gridOut = [];
    for (const [key, gid] of grid) {
      const [x, y] = key.split(',').map(Number);
      gridOut.push([x, y, gid - config.UNITS_FIRSTGID]);
    }

    return {
      type: 'vote_state',
      state: this.state,
      slots,
      slotTotal: mapGen.slotCount(),
      totals: { red: this.occupants.red.size, blue: this.occupants.blue.size },
      players: { red: this.playerCountOf('red'), blue: this.playerCountOf('blue') },
      recentVoters: this.recentVoters.slice(0, 15),
      remainingMs: this.endsAt ? Math.max(0, this.endsAt - now) : 0,
      durationMs: config.VOTE_DURATION_MS,
      mapW: config.MAP_WIDTH,
      mapH: config.MAP_HEIGHT,
      formationLabel: config.FORMATION.label,
      lastFile: this.lastFile,
      grid: gridOut,
    };
  }
}

module.exports = { VoteEngine, STATE };
