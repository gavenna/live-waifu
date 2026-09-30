/**
 * 精灵图生成脚本 — 按 Art Bible 统一标准生成
 *
 * 用法: node .claude/skills/artist/scripts/gen-sprites.js [--troop <key>]
 * 前提: server/secrets.json 里填好 imageApiKey
 * 标准: .claude/skills/artist/references/art-bible.md
 */

const fs = require('fs');
const path = require('path');

// === 配置 ===
const API = 'https://litechipcloud.cn/v1/images/generations';
const MODEL = 'agnes-image-2.1-flash';
const OUT = path.resolve(__dirname, '..', '..', '..', '..', 'assets', 'sprites');

// 从 Art Bible 提取的风格约束（所有 prompt 共用）
const STYLE_ANCHOR = [
  'dark fantasy pixel art game sprite',
  'side view facing right',
  '32-bit era aesthetic',
  'Kingdom Rush style clarity',
  'single character isolated',
  'transparent background',
  'top-left lighting with consistent shadows to bottom-right',
  '1px dark outline',
  'clean readable silhouette',
  'pixel-perfect edges',
  'no blur, no semi-transparent edges',
].join(', ');

// 调色板约束（注入 prompt 确保色板一致）
const PALETTE_HINT = [
  'Use a limited palette: leather browns (#8B6914 range), metal grays (#808080 range),',
  'faction colors only as accents (red faction: #CC3333-#FF6644, blue faction: #3355CC-#5588FF),',
  'stone grays for giants and castles, wood browns for siege weapons.',
].join(' ');

// === 读取 API key ===
let apiKey;
try {
  const secretsPath = path.resolve(__dirname, '..', '..', '..', '..', 'server', 'secrets.json');
  const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
  apiKey = secrets.imageApiKey;
  if (!apiKey || apiKey.includes('PLACEHOLDER')) {
    console.error('[artist] 请先在 server/secrets.json 填入真实的 imageApiKey');
    process.exit(1);
  }
} catch (e) {
  console.error('[artist] 读取 server/secrets.json 失败:', e.message);
  process.exit(1);
}

// === 兵种定义（按 Art Bible §4.2 规范） ===
const SPRITES = [
  // —— 小型单位 512×512 ——
  {
    key: 'militia',
    prompt: `A medieval peasant militia soldier. Wearing simple cloth tunic, holding a pitchfork with both hands. No armor, no helmet. Humble but determined expression. ${STYLE_ANCHOR}. ${PALETTE_HINT}`,
    label: '民兵',
  },
  {
    key: 'swordsman',
    prompt: `A medieval swordsman. Wearing chainmail armor, round wooden shield on left arm, long sword raised in right hand. Battle-ready stance. ${STYLE_ANCHOR}. ${PALETTE_HINT}`,
    label: '剑士',
  },
  {
    key: 'archer',
    prompt: `A medieval archer. Drawing a longbow fully drawn, arrow nocked and aimed to the right. Wearing leather armor, quiver of arrows on back. ${STYLE_ANCHOR}. ${PALETTE_HINT}`,
    label: '弓手',
  },
  // —— 中型单位 512×512 ——
  {
    key: 'knight',
    prompt: `A heavy cavalry knight on a brown warhorse. Knight wears full plate armor, holding a long lance couched under arm, charging to the right. Horse in full gallop. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Include both horse and rider as one unit.`,
    label: '骑士',
  },
  {
    key: 'royalGuard',
    prompt: `An elite royal guard. Ornate golden-trimmed plate armor, massive tower shield with a lion emblem on the front, long sword held upright. Imposing stance. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Gold accents on armor trim.`,
    label: '皇家卫队',
  },
  // —— 大型单位 768×768 ——
  {
    key: 'giant',
    prompt: `A massive rock golem. Body made of jagged boulders and gray stone, patches of green moss. Towering figure, fists raised high ready to smash. No weapons, fists are the weapon. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Stone grays dominant, no armor, no human skin visible.`,
    label: '岩石巨人',
    size: '768x768',
  },
  {
    key: 'dragonKnight',
    prompt: `A dragon-riding knight. Black dragon with massive wings spread wide, breathing wisps of fire. Knight on its back in dark ornate armor, holding a long lance. Epic scale, dragon fills most of the frame. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Dragon should be black with red-orange fire accents.`,
    label: '龙骑士',
    size: '768x768',
  },
  // —— 器械 768×512 ——
  {
    key: 'catapult',
    prompt: `A wooden medieval catapult siege weapon. Heavy wooden frame on four wheels, throwing arm pulled back with a large boulder loaded. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Wood and iron construction, no people needed.`,
    label: '投石车',
    size: '768x512',
  },
  {
    key: 'batteringRam',
    prompt: `A massive medieval battering ram. Long wooden beam with a bronze ram's head at the front. Covered wooden roof structure on wheels. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Wood and bronze, siege engine design.`,
    label: '攻城锤',
    size: '768x512',
  },
  // —— 技能图标 512×512 ——
  {
    key: 'fireArrow',
    prompt: `A volley of burning arrows raining down diagonally from top-left to bottom-right. Flaming arrow trails, dramatic dark sky background. Spell effect icon. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Orange-red fire tones, arrows silhouetted against bright flames.`,
    label: '火矢齐射',
  },
  {
    key: 'wrathOfGod',
    prompt: `A divine lightning bolt striking down from heaven onto a dark silhouette of a castle. Golden-white holy light, apocalyptic clouds. Spell effect icon. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Gold and white light dominant, dark background for contrast.`,
    label: '天神之怒',
  },
  // —— 盲盒图标 ——
  {
    key: 'warChest',
    prompt: `A mysterious medieval treasure chest. Dark iron-bound wooden chest with golden runes glowing on its surface, slightly open with magical light spilling out. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Dark wood, iron bands, magical gold glow.`,
    label: '战争宝箱',
  },
];

// 城堡
const CASTLES = [
  {
    key: 'castle_red',
    prompt: `A medieval stone castle fortress with RED banners and flags flying from the towers. Crimson and gold color scheme, burning fire braziers on the walls. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Red banners (#CC3333), gold trim (#DAA520), stone walls.`,
    label: '炎龙城堡',
    size: '1024x512',
  },
  {
    key: 'castle_blue',
    prompt: `A medieval stone castle fortress with BLUE banners and flags flying from the towers. Azure and silver color scheme, ice-blue crystal torches on the walls. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Blue banners (#3355CC), silver trim (#C0C0C0), stone walls.`,
    label: '霜狼城堡',
    size: '1024x512',
  },
];

// 背景
const BACKGROUNDS = [
  {
    key: 'battlefield',
    prompt: `A wide panoramic medieval battlefield landscape. Rolling green hills, a river crossing the middle, distant snow-capped mountains under a dramatic cloudy sky. Dark fantasy atmosphere. No characters, environment only. ${STYLE_ANCHOR}. ${PALETTE_HINT}. Environment art, 16:9 widescreen composition.`,
    label: '战场背景',
    size: '1920x1080',
  },
];

// === 工具函数 ===
async function generateImage(prompt, size) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, prompt, size }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  return json.data?.[0]?.url;
}

async function downloadImage(url, filePath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return buffer.length;
}

// === 验证（按 Art Bible §5） ===
async function validateSprite(filePath, troopKey, attempt) {
  // 基本检查：文件存在 + 非空
  if (!fs.existsSync(filePath)) return { ok: false, reason: '文件不存在' };
  const stat = fs.statSync(filePath);
  if (stat.size < 1024) return { ok: false, reason: `文件太小 (${stat.size}B)` };

  // 对于大型兵种（giant/dragonKnight），检查图片尺寸是否足够
  // 简单实现：文件 > 10KB 视为合理
  if (stat.size < 10240) {
    return { ok: false, reason: `文件过小 (${(stat.size / 1024).toFixed(1)}KB)，可能内容不足` };
  }

  return { ok: true };
}

// === 主流程 ===
async function run() {
  const targetKey = process.argv[3]; // --troop key

  let items = [];
  if (targetKey) {
    const found = [...SPRITES, ...CASTLES, ...BACKGROUNDS].find(s => s.key === targetKey);
    if (!found) { console.error(`未知 key: ${targetKey}`); process.exit(1); }
    items = [found];
    console.log(`[artist] 单兵种重做: ${found.label} (${found.key})\n`);
  } else {
    items = [...SPRITES, ...CASTLES, ...BACKGROUNDS];
    console.log('[artist] 全量生成精灵图\n');
  }

  const results = { ok: [], retry: [], fail: [] };
  let idx = 0;

  for (const item of items) {
    idx++;
    const size = item.size || '512x512';
    const label = item.label || item.key;

    console.log(`[${idx}/${items.length}] ${label} (${item.key}) ${size}`);

    let ok = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const url = await generateImage(item.prompt, size);
        if (!url) {
          console.error(`  ✗ 未获取到图片 URL (attempt ${attempt}/3)`);
          continue;
        }

        const ext = url.match(/\.(png|jpg|jpeg|webp)(\?|$)/i)?.[1] || 'png';
        const filePath = path.join(OUT, `${item.key}.${ext}`);
        const bytes = await downloadImage(url, filePath);

        const validation = await validateSprite(filePath, item.key, attempt);
        if (validation.ok) {
          console.log(`  ✓ ${(bytes / 1024).toFixed(1)}KB → assets/sprites/${item.key}.${ext}`);
          results.ok.push(item.key);
          ok = true;
          break;
        } else {
          console.error(`  ⚠ ${validation.reason} (attempt ${attempt}/3)`);
        }
      } catch (err) {
        console.error(`  ✗ ${err.message} (attempt ${attempt}/3)`);
      }

      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (!ok) {
      console.error(`  ✗✗✗ 3 次重试均失败 — 需人工修图`);
      results.fail.push(item.key);
    }

    // 限速
    if (idx < items.length) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  // === 交付报告 ===
  console.log('\n═══════════════════════════════════');
  console.log('  精灵图生成报告');
  console.log('═══════════════════════════════════');
  console.log(`  合格: ${results.ok.length} — ${results.ok.join(', ') || '(无)'}`);
  console.log(`  失败: ${results.fail.length} — ${results.fail.join(', ') || '(无)'}`);
  console.log(`  输出: ${OUT}`);
  console.log(`  前端引用: /assets/sprites/<key>.png`);
  console.log('═══════════════════════════════════\n');

  if (results.fail.length > 0) {
    console.log('⚠ 以下兵种需人工修图:');
    results.fail.forEach(k => console.log(`  - ${k}`));
  }
}

run().catch(err => { console.error(err); process.exit(1); });
