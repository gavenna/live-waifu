/**
 * 精灵图批量生成脚本
 *
 * 调用 litechipcloud API 生成全部游戏精灵图。
 * 用法: node server/generate-sprites.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const SECRETS = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'secrets.json'), 'utf-8'));
const API_KEY = SECRETS.imageApiKey;
const API_HOST = 'litechipcloud.cn';
const API_PATH = '/v1/images/generations';
const MODEL = 'agnes-image-2.1-flash';
const OUT_DIR = path.resolve(__dirname, '..', 'frontend', 'assets', 'sprites');

// Art Bible 风格关键词
const STYLE = [
  'dark fantasy pixel art game sprite',
  'side view facing right',
  '32-bit era aesthetic',
  'Kingdom Rush style clarity',
  'single character isolated',
  'transparent background',
  'consistent top-left lighting',
  '1px dark outline',
  'clean readable silhouette',
].join(', ');

// 生成任务定义
const TASKS = [
  // === 8 兵种 ===
  { key: 'militia', size: '512x512', desc: 'A militia soldier holding a pitchfork, wearing a simple cloth tunic, no armor, humble peasant warrior appearance.' },
  { key: 'swordsman', size: '512x512', desc: 'A medieval warrior in chainmail armor with a round wooden shield, confident battle stance, epic fantasy style.' },
  { key: 'knight', size: '512x512', desc: 'A knight riding a brown warhorse, wearing full plate armor, holding a long cavalry lance, majestic.' },
  { key: 'archer', size: '512x512', desc: 'An archer in leather armor, drawing a longbow with an arrow ready, quiver on back, agile stance.' },
  { key: 'catapult', size: '768x512', desc: 'A wooden catapult siege engine with 4 wheels, loaded with a stone projectile, medieval war machine.' },
  { key: 'royalGuard', size: '512x512', desc: 'An elite royal guard in ornate golden plate armor, holding a tall tower shield with a lion crest and a longsword, imposing.' },
  { key: 'giant', size: '768x768', desc: 'A massive rock giant made of stone and boulders with moss, huge fists, towering monster, no armor.' },
  { key: 'dragonKnight', size: '768x768', desc: 'A dragon knight riding a black dragon with large spread wings, holding a lance, dragon breathing fire, epic dark fantasy.' },

  // === 2 城堡 ===
  { key: 'castle_red', size: '1024x512', desc: 'A medieval stone castle with warm red banners and golden accents, fortress with towers and battlements, red team stronghold.' },
  { key: 'castle_blue', size: '1024x512', desc: 'A medieval stone castle with cold blue banners and silver accents, fortress with towers and battlements, blue team stronghold.' },

  // === 背景 ===
  { key: 'battlefield', size: '1920x1080', desc: 'A panoramic medieval battlefield landscape, dramatic sky with clouds, distant mountains, green grassland, dark fantasy atmosphere, no characters.' },

  // === 技能特效 ===
  { key: 'fireArrow_effect', size: '512x512', desc: 'Multiple burning arrows flying through the sky with fire trails, dark background, dramatic volley shot effect.' },
  { key: 'wrathOfGod_effect', size: '512x512', desc: 'A divine golden lightning bolt striking down from the sky, holy light beam, apocalyptic atmosphere, sacred wrath effect.' },
  { key: 'siege_impact', size: '512x512', desc: 'An orange circular shockwave impact effect with debris and dust, siege weapon impact, radial burst pattern.' },
];

let generated = 0;
let failed = [];

function generateImage(task) {
  return new Promise((resolve, reject) => {
    const prompt = `${STYLE}. ${task.desc}`;
    const body = JSON.stringify({
      model: MODEL,
      prompt,
      n: 1,
      size: task.size,
    });

    const options = {
      hostname: API_HOST,
      path: API_PATH,
      method: 'POST',
      rejectUnauthorized: false,  // SSL 证书过期时绕过
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.data || !json.data[0]) {
            reject(new Error(`API response missing data: ${data.slice(0, 200)}`));
            return;
          }
          const imageUrl = json.data[0].url || json.data[0].b64_json;
          if (!imageUrl) {
            reject(new Error(`No URL in response: ${JSON.stringify(json.data[0]).slice(0, 200)}`));
            return;
          }
          resolve(imageUrl);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message} | raw: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const reqOptions = url.startsWith('https') ? { rejectUnauthorized: false } : {};
    proto.get(url, reqOptions, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, filePath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        fs.writeFileSync(filePath, Buffer.concat(chunks));
        resolve();
      });
    }).on('error', reject);
  });
}

async function run() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  console.log(`[Gen] 开始生成 ${TASKS.length} 张精灵图...\n`);

  for (const task of TASKS) {
    const outPath = path.join(OUT_DIR, `${task.key}.png`);
    if (fs.existsSync(outPath) && !process.argv.includes('--force')) {
      console.log(`[Gen] ⏭ ${task.key} — 已存在，跳过`);
      generated++;
      continue;
    }

    console.log(`[Gen] 🎨 ${task.key} (${task.size}) — 生成中...`);
    try {
      const url = await generateImage(task);
      console.log(`[Gen] ⬇ ${task.key} — 下载中...`);
      await downloadFile(url, outPath);
      console.log(`[Gen] ✅ ${task.key} → ${outPath}`);
      generated++;
    } catch (err) {
      console.error(`[Gen] ❌ ${task.key} — ${err.message}`);
      failed.push(task.key);
    }

    // 避免频率限制
    if (TASKS.indexOf(task) < TASKS.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n[Gen] 完成: ${generated}/${TASKS.length} 生成成功`);
  if (failed.length) {
    console.log(`[Gen] 失败: ${failed.join(', ')}`);
  }
}

run().catch(console.error);
