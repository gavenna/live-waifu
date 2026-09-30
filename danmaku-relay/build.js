/**
 * danmaku-relay 打包 — Node.js SEA 单文件 exe
 *
 * 用法: node build.js
 * 输出: dist/danmaku-relay/ (一个 exe + 外部文件)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(DIST, 'danmaku-relay');

console.log('=== danmaku-relay SEA build ===');
console.log(`Node: ${process.version}`);

// 清理
[path.join(DIST, 'bundle.js'), path.join(DIST, 'sea-prep.blob'),
 path.join(DIST, 'sea-config.json'), path.join(DIST, 'danmaku-relay.exe')].forEach(f => {
  try { fs.unlinkSync(f); } catch (e) {}
});
try { if (fs.existsSync(RELEASE)) fs.rmSync(RELEASE, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { console.log('  [warn] Could not clean dist'); }
fs.mkdirSync(DIST, { recursive: true });

// Step 1: esbuild bundle
console.log('\n[1/3] esbuild bundle...');
execSync(
  `npx esbuild index.js --bundle --platform=node --target=node24 --outfile="${path.join(DIST, 'bundle.js')}"`,
  { cwd: ROOT, stdio: 'inherit' }
);
console.log(`  bundle: ${(fs.statSync(path.join(DIST, 'bundle.js')).size / 1024).toFixed(0)} KB`);

// Step 2: SEA blob + inject
console.log('\n[2/3] SEA blob + inject...');
fs.writeFileSync(path.join(DIST, 'sea-config.json'), JSON.stringify({
  main: path.join(DIST, 'bundle.js'),
  output: path.join(DIST, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
}, null, 2));

execSync(`node --experimental-sea-config "${path.join(DIST, 'sea-config.json')}"`, { cwd: ROOT, stdio: 'inherit' });
console.log(`  blob: ${(fs.statSync(path.join(DIST, 'sea-prep.blob')).size / 1024 / 1024).toFixed(1)} MB`);

const exePath = path.join(DIST, 'danmaku-relay.exe');
fs.copyFileSync(process.execPath, exePath);
execSync(
  `npx postject "${exePath}" NODE_SEA_BLOB "${path.join(DIST, 'sea-prep.blob')}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  { cwd: ROOT, stdio: 'inherit' }
);
console.log(`  exe: ${(fs.statSync(exePath).size / 1024 / 1024).toFixed(1)} MB`);

// Step 3: 组装分发目录
console.log('\n[3/3] Assembling distribution...');
fs.mkdirSync(RELEASE, { recursive: true });
['server', 'data', 'tools', 'toolbox'].forEach(d => fs.mkdirSync(path.join(RELEASE, d), { recursive: true }));

fs.copyFileSync(exePath, path.join(RELEASE, 'danmaku-relay.exe'));

// toolbox 控制面板
fs.cpSync(path.join(ROOT, 'toolbox'), path.join(RELEASE, 'toolbox'), { recursive: true });

// douyinLive
const dlPath = path.join(ROOT, 'tools', 'douyinLive.exe');
if (fs.existsSync(dlPath)) fs.copyFileSync(dlPath, path.join(RELEASE, 'tools', 'douyinLive.exe'));

// secrets
const dstSecrets = path.join(RELEASE, 'server', 'secrets.json');
const dstExample = path.join(RELEASE, 'server', 'secrets.json.example');
const prevSecrets = fs.existsSync(dstSecrets) ? fs.readFileSync(dstSecrets, 'utf-8') : null;

fs.writeFileSync(dstExample, JSON.stringify({
  bilibili: { roomId: 0, uid: 0, cookie: "", giftMap: {} },
  douyin: { enabled: false, roomId: "", proxyUrl: "ws://localhost:1088", giftMap: {}, cookie: "" }
}, null, 2));

if (prevSecrets) {
  fs.writeFileSync(dstSecrets, prevSecrets);
} else {
  fs.copyFileSync(dstExample, dstSecrets);
}

const totalMB = (() => {
  let size = 0;
  if (!fs.existsSync(RELEASE)) return 0;
  for (const f of fs.readdirSync(RELEASE, { recursive: true })) {
    try { size += fs.statSync(path.join(RELEASE, f)).size; } catch (e) {}
  }
  return size / 1024 / 1024;
})();

console.log(`\n[DONE] ${RELEASE}`);
console.log(`Total: ${totalMB.toFixed(1)} MB`);

// 清理
const KEEP = ['danmaku-relay'];
fs.readdirSync(DIST).forEach(f => {
  if (!KEEP.includes(f)) {
    try { fs.rmSync(path.join(DIST, f), { recursive: true, force: true }); } catch (e) {}
  }
});
console.log('  [clean] removed intermediate build files');
