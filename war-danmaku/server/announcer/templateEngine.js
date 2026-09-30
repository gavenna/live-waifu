/**
 * 话术模板引擎 — 事件 → 口语文本
 *
 * 每种事件类型 1-3 个模板变体，随机选取避免机械重复。
 * 附带情绪(emotion)和可选动作(motion)，驱动 waifu-agent 的表情和动作。
 *
 * 变量用 {key} 占位，由 generate() 插值填充。
 */

const TROOP_NAMES = {
  militia: '民兵', spearman: '矛兵', bowman: '弓兵', raider: '突袭兵',
  swordsman: '剑士', knight: '骑士', archer: '弓手', catapult: '投石车',
  royalGuard: '皇家卫队', fireArrow: '火矢齐射', batteringRam: '攻城锤',
  giant: '岩石巨人', dragonKnight: '龙骑士', wrathOfGod: '天神之怒',
};

const TEAM_NAMES = { red: '炎龙帝国', blue: '霜狼部落' };

// === 模板库 ===
// 每个模板: { text: string, emotion: string, motion?: { group, index, priority } }

const TEMPLATES = {

  // P10: 礼物感谢
  gift_cheap: [
    { text: '感谢 {playerName} 的 {giftName}，有心了！', emotion: 'happy' },
    { text: '谢谢 {playerName} 送的 {giftName}！', emotion: 'happy' },
    { text: '{playerName} 送出了 {giftName}，感谢支持！', emotion: 'happy', motion: { group: 'TapBody', index: 0, priority: 2 } },
  ],
  gift_medium: [
    { text: '哇，感谢 {playerName} 的 {giftName}，太给力了！', emotion: 'surprised', motion: { group: 'TapBody', index: 2, priority: 3 } },
    { text: '太棒了！{playerName} 送出了 {giftName}！', emotion: 'happy', motion: { group: 'TapBody', index: 1, priority: 3 } },
    { text: '{playerName} 大佬出手了！{giftName} 来了！', emotion: 'surprised' },
  ],
  gift_premium: [
    { text: '大哥牛逼！{playerName} 召唤了 {troopName}！！', emotion: 'surprised', motion: { group: 'TapBody', index: 4, priority: 3 } },
    { text: '来了来了！{playerName} 的 {troopName} 降临战场！！', emotion: 'surprised', motion: { group: 'TapBody', index: 3, priority: 3 } },
    { text: '全场注意！{playerName} 召唤了传说中的 {troopName}！！', emotion: 'surprised', motion: { group: 'TapBody', index: 5, priority: 3 } },
  ],

  // P9: 翻盘
  comeback: [
    { text: '{teamName}绝地反击！！战局要逆转了！', emotion: 'surprised', motion: { group: 'TapBody', index: 4, priority: 3 } },
    { text: '等等！{teamName}开始反攻了！！', emotion: 'surprised', motion: { group: 'TapBody', index: 3, priority: 3 } },
    { text: '不可思议！{teamName}打回来了！！', emotion: 'surprised' },
  ],

  // P9: 全局技能
  global_skill: [
    { text: '{ownerName} 释放了 {skillName}！！毁天灭地！', emotion: 'surprised', motion: { group: 'TapBody', index: 4, priority: 3 } },
    { text: '天哪！{ownerName} 召唤了 {skillName}！！', emotion: 'surprised', motion: { group: 'TapBody', index: 5, priority: 3 } },
    { text: '{skillName}！{ownerName} 的终极大招！！', emotion: 'surprised' },
  ],

  // P9: 盲盒
  chest_open: [
    { text: '{playerName} 开启战争宝箱，会开出什么呢？', emotion: 'surprised' },
    { text: '宝箱来了！{playerName} 正在开启战争宝箱！', emotion: 'surprised', motion: { group: 'TapBody', index: 2, priority: 2 } },
  ],
  chest_reveal: [
    { text: '哇！{playerName} 开出了 {troopName}！！', emotion: 'surprised', motion: { group: 'TapBody', index: 4, priority: 3 } },
    { text: '运气太好了！{playerName} 获得 {troopName}！！', emotion: 'happy', motion: { group: 'TapBody', index: 3, priority: 3 } },
    { text: '{playerName} 的宝箱开出了 {troopName}！！', emotion: 'surprised' },
  ],

  // P8: 高级兵预告
  spawn_preview: [
    { text: '{playerName} 正在召唤 {troopName}，即将抵达战场！', emotion: 'surprised', motion: { group: 'TapBody', index: 2, priority: 2 } },
    { text: '注意！{playerName} 的 {troopName} 正在集结中！', emotion: 'neutral' },
  ],

  // P7: 攻城
  siege: [
    { text: '攻城锤来了！{ownerName} 正在撞击城堡！', emotion: 'surprised', motion: { group: 'TapBody', index: 3, priority: 3 } },
    { text: '{ownerName} 的攻城锤砸向城堡！掉了 {damage} 血！', emotion: 'surprised' },
    { text: '轰！{ownerName} 的攻城锤对城堡造成了 {damage} 点伤害！', emotion: 'surprised' },
  ],
  castle_hit: [
    { text: '{teamName}方城堡受到攻击！掉了 {damage} 血！', emotion: 'sad' },
    { text: '{teamName}城堡正在被猛攻！扣了 {damage} 血！', emotion: 'angry' },
    { text: '小心！{teamName}城堡受损 {damage} 点！', emotion: 'sad' },
  ],

  // P6: 连杀
  kill_multikill: [
    { text: '⚔ {killerName} 正在大杀特杀！已经 {count} 连杀！', emotion: 'surprised', motion: { group: 'TapBody', index: 3, priority: 2 } },
    { text: '🔥 {killerName} 无人能挡！{count} 连杀！', emotion: 'surprised', motion: { group: 'TapBody', index: 4, priority: 2 } },
    { text: '{killerName} 已经击杀 {count} 人，势不可挡！', emotion: 'surprised' },
    { text: '{killerName} 杀疯了！{count} 连杀达成！', emotion: 'happy', motion: { group: 'TapBody', index: 3, priority: 2 } },
  ],

  // P5: 加入/随机事件
  join: [
    { text: '{playerName} 加入了{teamName}阵营！欢迎！', emotion: 'happy', motion: { group: 'TapBody', index: 0, priority: 2 } },
    { text: '又来一位！{playerName} 加入{teamName}！', emotion: 'happy' },
    { text: '{playerName} 选择了{teamName}！', emotion: 'happy' },
  ],
  random_event: [
    { text: '{text}', emotion: 'surprised' },
  ],

  // P3: 阶段切换
  game_countdown: [
    { text: '战斗即将开始！准备时间还剩 {seconds} 秒！', emotion: 'neutral', motion: { group: 'TapBody', index: 1, priority: 2 } },
    { text: '还有 {seconds} 秒开战！抓紧选阵营！', emotion: 'happy' },
  ],
  game_start: [
    { text: '战斗开始！红蓝双方，全军出击！！', emotion: 'surprised', motion: { group: 'TapBody', index: 4, priority: 3 } },
    { text: '开战！！炎龙帝国对战霜狼部落！！', emotion: 'surprised', motion: { group: 'TapBody', index: 5, priority: 3 } },
    { text: '来了来了！大战开始！！', emotion: 'happy', motion: { group: 'TapBody', index: 3, priority: 3 } },
  ],
  game_end: [
    { text: '本局结束！{teamName}方获胜！恭喜！！', emotion: 'happy', motion: { group: 'TapBody', index: 4, priority: 3 } },
    { text: '战斗结束！{teamName}拿下了这一局！', emotion: 'happy', motion: { group: 'TapBody', index: 3, priority: 3 } },
    { text: '{teamName}赢了！感谢双方将士的奋战！', emotion: 'happy' },
  ],

  // P2: 开场/中场休息/定期战况
  opening: [
    { text: '欢迎来到战场！还没选阵营的抓紧了，发1加红方，发2加蓝方！', emotion: 'happy', motion: { group: 'TapBody', index: 1, priority: 2 } },
    { text: '战争号角已吹响！选阵营的观众快上车！', emotion: 'happy', motion: { group: 'TapBody', index: 2, priority: 2 } },
  ],
  countdown_recruit: [
    { text: '新一局即将开始！发送1加入红方，2加入蓝方，准备开战！', emotion: 'happy', motion: { group: 'TapBody', index: 1, priority: 2 } },
    { text: '倒计时开始！炎龙帝国和霜狼部落正在集结，快来选阵营！', emotion: 'happy' },
    { text: '战鼓擂响！还没上车的观众抓紧了，1红2蓝！', emotion: 'happy', motion: { group: 'TapBody', index: 2, priority: 2 } },
  ],
  periodic_report: [
    { text: '当前战况：红方 {redHP} 蓝方 {blueHP}，{redPlayers}对{bluePlayers}人', emotion: 'neutral' },
    { text: '战报！红方血线 {redHP}，蓝方 {blueHP}！', emotion: 'neutral' },
    { text: '双方胶着！红方 {redHP} 蓝方 {blueHP}，{advantage}方略占优势！', emotion: 'neutral' },
  ],
  final_2min: [
    { text: '最后2分钟！现在出手还能改变战局！送礼物的抓紧了！', emotion: 'surprised', motion: { group: 'TapBody', index: 4, priority: 3 } },
    { text: '决胜时刻到了！最后2分钟！大哥们冲啊！', emotion: 'surprised', motion: { group: 'TapBody', index: 3, priority: 3 } },
  ],
  conclusion: [
    { text: '本局MVP是 {mvp}！SVP是 {svp}！感谢各位参战，下一局马上开始！', emotion: 'happy', motion: { group: 'TapBody', index: 2, priority: 2 } },
    { text: 'MVP {mvp}！SVP {svp}！恭喜上榜的将军们！', emotion: 'happy' },
  ],

  // 龙骑士专属
  dragon_breath: [
    { text: '{ownerName} 的龙骑士喷吐龙焰！！', emotion: 'surprised', motion: { group: 'TapBody', index: 4, priority: 3 } },
    { text: '龙焰降临！{ownerName} 的巨龙在焚烧战场！', emotion: 'surprised', motion: { group: 'TapBody', index: 5, priority: 3 } },
  ],
  dragon_roar: [
    { text: '{ownerName} 的龙骑士发出恐惧咆哮！！', emotion: 'surprised', motion: { group: 'TapBody', index: 3, priority: 3 } },
  ],

  // 关注
  follow: [
    { text: '{playerName} 关注了直播间！感谢支持！', emotion: 'happy', motion: { group: 'TapBody', index: 0, priority: 2 } },
    { text: '谢谢 {playerName} 的关注！', emotion: 'happy' },
  ],

  // 弹幕互动 — LLM 处理，这里只给兜底
  danmaku_fallback: [
    { text: '{playerName} 说：{text}', emotion: 'neutral' },
  ],
};

// === 公开 API ===

/**
 * 根据事件类型和数据生成话术
 * @param {string} eventType - 事件类型，如 'gift_cheap'、'kill_multikill'
 * @param {object} vars - 模板变量 { playerName, troopName, ... }
 * @returns {{ text: string, emotion: string, motion?: object } | null}
 */
function generate(eventType, vars = {}) {
  const pool = TEMPLATES[eventType];
  if (!pool || pool.length === 0) return null;

  const tpl = pool[Math.floor(Math.random() * pool.length)];
  let text = tpl.text;

  // 模板插值
  for (const [key, val] of Object.entries(vars)) {
    text = text.replace(new RegExp('\\{' + key + '\\}', 'g'), String(val != null ? val : ''));
  }

  // 安全兜底: 清除残留的 {xxx} 占位符（上游漏传变量时防止念出 "{giftName}"）
  text = text.replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, '').replace(/\s+/g, ' ').trim();

  const result = { text, emotion: tpl.emotion };
  if (tpl.motion) result.motion = tpl.motion;
  return result;
}

/**
 * 获取兵种中文名
 */
function troopName(key) {
  return TROOP_NAMES[key] || key;
}

/**
 * 获取阵营中文名
 */
function teamName(team) {
  return TEAM_NAMES[team] || team;
}

/**
 * 判断礼物属于哪个档位
 * @param {string} troopKey - 兵种 key
 * @returns {'cheap'|'medium'|'premium'}
 */
function giftTier(troopKey) {
  const premium = ['giant', 'dragonKnight', 'wrathOfGod'];
  const medium = ['royalGuard', 'fireArrow', 'batteringRam', 'warChest'];
  if (premium.includes(troopKey)) return 'premium';
  if (medium.includes(troopKey)) return 'medium';
  return 'cheap';
}

/**
 * 根据游戏阶段生成话术
 * @param {'opening'|'countdown'|'start'|'periodic'|'final2min'|'conclusion'} phase
 * @param {object} vars
 */
function generatePhase(phase, vars = {}) {
  switch (phase) {
    case 'opening': return generate('opening', vars);
    case 'countdown_recruit': return generate('countdown_recruit', vars);
    case 'countdown': return generate('game_countdown', vars);
    case 'start': return generate('game_start', vars);
    case 'periodic': return generate('periodic_report', vars);
    case 'final2min': return generate('final_2min', vars);
    case 'conclusion': return generate('conclusion', vars);
    default: return null;
  }
}

/**
 * 清洗 TTS 文本 — 去掉 emoji 和特殊符号，避免 TTS 引擎逐字朗读。
 * 只保留中文、英文、数字、常用标点。
 */
function cleanForTts(text) {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')  // emoji + pictographs (🔥⚔等)
    .replace(/[\u{2600}-\u{27BF}]/gu, '')     // 杂项符号 (U+2694 ⚔ 等)
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')     // 变体选择符
    .replace(/\u{200D}/gu, '')                // 零宽连字符
    .replace(/[\u{2500}-\u{257F}]/gu, '')     // 制表符
    .replace(/[\u{2580}-\u{259F}]/gu, '')     // 方块元素
    .replace(/[\u{25A0}-\u{25FF}]/gu, '')     // 几何图形
    .replace(/\s+/g, ' ')                     // 合并多余空格
    .trim();
}

module.exports = { generate, generatePhase, troopName, teamName, giftTier, cleanForTts };
