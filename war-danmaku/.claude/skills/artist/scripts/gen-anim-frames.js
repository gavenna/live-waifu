/**
 * 动画帧生成脚本 — 图生图 (img2img) 逐帧生成
 *
 * 用法: node .claude/skills/artist/scripts/gen-anim-frames.js [--troop <key>]
 * 前提: frontend/assets/sprites/<key>.png 已存在（作为输入底图）
 *       server/secrets.json 里填好 imageApiKey
 *
 * 工作流程:
 *   1. 读现有精灵图 → base64 data URI
 *   2. 用 agnes-image-2.0-flash (img2img) 生成 16 帧
 *   3. 保存到 frontend/assets/sprites/frames/
 *   4. 全部完成后运行 stitch-sprites.py 拼接 sprite sheet
 */

const fs = require('fs');
const path = require('path');

const API = 'https://litechipcloud.cn/v1/images/generations';
const MODEL = 'agnes-image-2.0-flash';
const OUT = path.resolve(__dirname, '..', '..', '..', '..', 'frontend', 'assets', 'sprites', 'frames');
const BASE = path.resolve(__dirname, '..', '..', '..', '..', 'frontend', 'assets', 'sprites');

// === API key ===
let apiKey;
try {
  const secretsPath = path.resolve(__dirname, '..', '..', '..', '..', 'server', 'secrets.json');
  apiKey = JSON.parse(fs.readFileSync(secretsPath, 'utf-8')).imageApiKey;
  if (!apiKey || apiKey.includes('PLACEHOLDER')) {
    console.error('[anim-frames] 请在 server/secrets.json 填入 imageApiKey');
    process.exit(1);
  }
} catch (e) {
  console.error('[anim-frames] secrets.json:', e.message);
  process.exit(1);
}

// === 战斗兵种 ===
const TROOPS = [
  { key: 'militia',      size: '512x512',  label: '民兵' },
  { key: 'swordsman',    size: '512x512',  label: '剑士' },
  { key: 'knight',       size: '512x512',  label: '骑士' },
  { key: 'archer',       size: '512x512',  label: '弓手' },
  { key: 'catapult',     size: '768x512',  label: '投石车' },
  { key: 'royalGuard',   size: '512x512',  label: '皇家卫队' },
  { key: 'giant',        size: '768x768',  label: '岩石巨人' },
  { key: 'dragonKnight', size: '768x768',  label: '龙骑士' },
];

// === 帧定义 ===
function buildFrames() {
  const frames = [];
  // idle: 3 新帧 (帧 0 复用现有精灵图)
  ['chest slightly expanded, inhaling, body rising',
   'neutral standing, weight balanced, slight sway',
   'chest slightly contracted, exhaling, body lowering']
    .forEach((p, i) => frames.push({ state: 'idle', index: i + 1, prompt: p }));

  // walk: 6 帧（完整闭口走步循环）
  ['right leg stepping forward, left arm back, walking stride',
   'weight down on right foot, knees bent, mid-walk low point',
   'feet crossing beneath body, passing position, neutral height',
   'body rising, left leg lifting, walking bounce up',
   'left leg stepping forward, right arm back, opposite contact',
   'weight down on left foot, knees bent, opposite low point']
    .forEach((p, i) => frames.push({ state: 'walk', index: i, prompt: p }));

  // attack: 4 帧
  ['weapon pulled back, body leaning back, anticipation wind-up',
   'weapon swinging forward mid-arc, body rotating into strike',
   'weapon at impact point, arm extended, hit frame, action peak',
   'weapon following through, body starting to recover']
    .forEach((p, i) => frames.push({ state: 'attack', index: i, prompt: p }));

  // death: 4 帧
  ['staggering backward from impact, arms flung out, taking hit',
   'losing balance, body tilting backward, beginning to fall',
   'collapsed on ground, body horizontal, defeated',
   'lying flat, motionless, final death pose']
    .forEach((p, i) => frames.push({ state: 'death', index: i, prompt: p }));

  return frames;
}

// === 工具 ===
function imageToDataURI(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buffer.toString('base64')}`;
}

async function img2img(prompt, inputDataURI, size) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, image: [inputDataURI], size }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`API ${res.status}: ${t.slice(0, 200)}`); }
  const json = await res.json();
  return json.data?.[0]?.url;
}

async function download(url, filePath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${res.status}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
}

// === 主流程 ===
async function run() {
  const targetKey = process.argv[3];
  let items = TROOPS;
  if (targetKey) {
    const found = TROOPS.find(t => t.key === targetKey);
    if (!found) { console.error(`未知兵种: ${targetKey}`); process.exit(1); }
    items = [found];
    console.log(`[anim-frames] 单兵种: ${found.label}\n`);
  } else {
    console.log(`[anim-frames] 全量 ${TROOPS.length} 兵种动画帧\n`);
  }

  const allFrames = buildFrames();
  console.log(`每兵种 ${allFrames.length} 帧 (idle×3 walk×6 attack×4 death×4)\n`);

  const results = { ok: [], fail: [] };

  for (let ti = 0; ti < items.length; ti++) {
    const item = items[ti];
    const basePath = path.join(BASE, `${item.key}.png`);

    if (!fs.existsSync(basePath)) {
      console.error(`[${ti + 1}/${items.length}] ${item.label} — 底图不存在，跳过`);
      results.fail.push(item.key);
      continue;
    }

    console.log(`\n[${ti + 1}/${items.length}] ${item.label} (${item.key})`);

    let dataURI;
    try { dataURI = imageToDataURI(basePath); }
    catch (e) { console.error(`  读底图失败: ${e.message}`); results.fail.push(item.key); continue; }

    let ok = 0, fail = 0;
    for (const f of allFrames) {
      if (ok + fail > 0) await new Promise(r => setTimeout(r, 1100)); // 限速

      const fileName = `${item.key}_${f.state}_${f.index}.png`;
      const filePath = path.join(OUT, fileName);
      const prompt = `Same character, same art style, identical appearance. Only change pose: ${f.prompt}. Keep same pixel art, same outfit, same weapon. Transparent background.`;

      try {
        process.stdout.write(`  ${f.state}_${f.index} `);
        const url = await img2img(prompt, dataURI, item.size);
        if (!url) { console.log('✗'); fail++; continue; }
        await download(url, filePath);
        console.log('✓');
        ok++;
      } catch (err) {
        console.log(`✗ ${err.message.slice(0, 80)}`);
        fail++;
      }
    }
    console.log(`  → ${ok}/${allFrames.length} OK, ${fail} FAIL`);
    if (fail === 0) results.ok.push(item.key);
    else results.fail.push(`${item.key}(${ok}/${allFrames.length})`);
  }

  console.log(`\n═════════════════════════`);
  console.log(`  OK: ${results.ok.length} — ${results.ok.join(', ') || '(无)'}`);
  console.log(`  FAIL: ${results.fail.length} — ${results.fail.join(', ') || '(无)'}`);
  console.log(`  输出: ${OUT}/`);
  console.log(`  下一步: python server/stitch-sprites.py`);
  console.log(`═════════════════════════\n`);
}

run().catch(err => { console.error(err); process.exit(1); });
