/**
 * 断言模块 — 数据流关键节点的边界哨兵
 *
 * 断言失败 = 当场抛错 + 写 ERROR 日志 + stack trace。
 * 不让脏数据静默往下传。
 */

const logger = require('./logger');

class AssertionError extends Error {
  constructor(message) {
    super(`[ASSERT FAIL] ${message}`);
    this.name = 'AssertionError';
  }
}

/**
 * 基础断言
 * @param {boolean} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) {
    const err = new AssertionError(message);
    logger.error(`[ENGINE] ${err.message}`);
    logger.error(`[ENGINE] ${err.stack}`);
    throw err;
  }
}

/** 兵种定义必须存在 */
function troopExists(troopDef, troopKey) {
  if (!troopDef) {
    const msg = `未知兵种: "${troopKey}" — config.TROOPS 中不存在此 key`;
    logger.error(`[BATTLE] ${msg}`);
    throw new AssertionError(msg);
  }
}

/** team 必须是 'red' 或 'blue' */
function validTeam(team) {
  if (team !== 'red' && team !== 'blue') {
    const msg = `非法阵营: "${team}" — 必须是 'red' 或 'blue'`;
    logger.error(`[ENGINE] ${msg}`);
    throw new AssertionError(msg);
  }
}

/** 状态必须在合法范围内 */
function stateIn(actual, allowed) {
  if (!allowed.includes(actual)) {
    const msg = `非法状态: "${actual}" — 允许的状态: [${allowed.join(', ')}]`;
    logger.error(`[ENGINE] ${msg}`);
    throw new AssertionError(msg);
  }
}

/** 城堡 HP >= 0 */
function castleHP(hp, side) {
  if (hp < 0 || !Number.isFinite(hp)) {
    const msg = `城堡 HP 异常: ${side}=${hp} — 应 >= 0`;
    logger.error(`[ENGINE] ${msg}`);
    throw new AssertionError(msg);
  }
}

/** playerId 非空 */
function playerId(id, context) {
  if (!id || typeof id !== 'string') {
    const msg = `playerId 缺失或非法: "${id}" (context: ${context})`;
    logger.error(`[ENGINE] ${msg}`);
    throw new AssertionError(msg);
  }
}

/** playerId 非空字符串（别名，语义更清晰） */
const playerIdNotEmpty = playerId;

/** msg.type 已知 */
function knownMsgType(type) {
  const known = ['join', 'danmaku', 'gift'];
  if (!known.includes(type)) {
    logger.warn(`[WS] 未知消息类型: "${type}" — 忽略`);
    return false;
  }
  return true;
}

module.exports = {
  assert,
  troopExists,
  validTeam,
  stateIn,
  castleHP,
  playerId,
  playerIdNotEmpty,
  knownMsgType,
  AssertionError,
};
