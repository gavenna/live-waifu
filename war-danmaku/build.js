/**
 * war-danmaku 打包 — Node.js SEA 单文件 exe
 *
 * 用法: node build.js
 * 输出: dist/war-danmaku/ (一个 exe 搞定一切, zip 即可发布)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(DIST, 'war-danmaku');

console.log('=== war-danmaku SEA build ===');
console.log(`Node: ${process.version}`);

// 清理
[path.join(DIST, 'war-danmaku.exe')].forEach(f => {
  try { fs.unlinkSync(f); } catch (e) { /* ok */ }
});
try { if (fs.existsSync(RELEASE)) fs.rmSync(RELEASE, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { console.log('  [warn] Could not clean dist'); }
fs.mkdirSync(DIST, { recursive: true });

// === Step 1: sql.js WASM → base64 ===
console.log('\n[1/4] Encoding sql.js WASM...');
const wasmPath = path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const wasmB64 = fs.readFileSync(wasmPath).toString('base64');
console.log(`  ${(fs.statSync(wasmPath).size / 1024).toFixed(0)} KB WASM -> ${(wasmB64.length / 1024).toFixed(0)} KB base64`);

const dataModulePath = path.join(ROOT, 'server', 'sql-wasm-data.js');
fs.writeFileSync(dataModulePath, `module.exports = ${JSON.stringify(wasmB64)};`);

// === Step 2: esbuild 全量 bundle ===
console.log('\n[2/4] esbuild bundle...');
execSync(
  `npx esbuild server/index.js --bundle --platform=node --target=node24 --outfile="${path.join(DIST, 'bundle.js')}"`,
  { cwd: ROOT, stdio: 'inherit' }
);
fs.unlinkSync(dataModulePath);
console.log(`  bundle: ${(fs.statSync(path.join(DIST, 'bundle.js')).size / 1024).toFixed(0)} KB`);

// === Step 3: SEA blob + 注入 ===
console.log('\n[3/4] SEA blob + inject...');
fs.writeFileSync(path.join(DIST, 'sea-config.json'), JSON.stringify({
  main: path.join(DIST, 'bundle.js'),
  output: path.join(DIST, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
}, null, 2));

execSync(`node --experimental-sea-config "${path.join(DIST, 'sea-config.json')}"`, { cwd: ROOT, stdio: 'inherit' });
console.log(`  blob: ${(fs.statSync(path.join(DIST, 'sea-prep.blob')).size / 1024 / 1024).toFixed(1)} MB`);

const exePath = path.join(DIST, 'war-danmaku.exe');
fs.copyFileSync(process.execPath, exePath);
execSync(
  `npx postject "${exePath}" NODE_SEA_BLOB "${path.join(DIST, 'sea-prep.blob')}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  { cwd: ROOT, stdio: 'inherit' }
);
console.log(`  exe: ${(fs.statSync(exePath).size / 1024 / 1024).toFixed(1)} MB`);

// === Step 4: 组装分发目录 ===
console.log('\n[4/4] Assembling distribution...');
fs.mkdirSync(RELEASE, { recursive: true });
['server', 'data', 'frontend', 'assets', 'toolbox'].forEach(d =>
  fs.mkdirSync(path.join(RELEASE, d), { recursive: true })
);

// 唯一的 exe
fs.copyFileSync(exePath, path.join(RELEASE, 'war-danmaku.exe'));

// 静态文件
const cp = (src, dst) => { if (fs.existsSync(src)) execSync(`xcopy /E /I /Y "${src}" "${dst}"`, { stdio: 'pipe' }); };
cp(path.join(ROOT, 'frontend'), path.join(RELEASE, 'frontend'));
cp(path.join(ROOT, 'assets'), path.join(RELEASE, 'assets'));

// 工具箱前端 (被 :8760 HTTP 服务器 serve)
['index.html', 'style.css', 'app.js'].forEach(f => {
  fs.copyFileSync(path.join(ROOT, 'toolbox', f), path.join(RELEASE, 'toolbox', f));
});

// 配置
const dstSecrets = path.join(RELEASE, 'server', 'secrets.json');
const dstExample = path.join(RELEASE, 'server', 'secrets.json.example');
const prevSecrets = fs.existsSync(dstSecrets) ? fs.readFileSync(dstSecrets, 'utf-8') : null;

fs.writeFileSync(dstExample, JSON.stringify({
  imageApiKey: "",
  announcer: { llmApiKey: "" }
}, null, 2));

if (prevSecrets) {
  fs.writeFileSync(dstSecrets, prevSecrets);
} else {
  fs.copyFileSync(dstExample, dstSecrets);
}

// 计算大小
const getSize = dir => {
  let size = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    try { size += fs.statSync(path.join(dir, f)).size; } catch (e) { /* ok */ }
  }
  return size;
};

const totalMB = getSize(RELEASE) / 1024 / 1024;
console.log(`\n[DONE] ${RELEASE}`);
console.log(`Total: ${totalMB.toFixed(1)} MB`);

// === Step 5: Inno Setup 安装包 ===
try {
  console.log('\n[5/5] Building installer...');
  execSync('iscc setup.iss', { cwd: ROOT, stdio: 'inherit' });
  const setupPath = path.join(DIST, 'war-danmaku-setup-v1.0.exe');
  console.log(`\n[INSTALLER] ${setupPath}`);
  console.log(`Size: ${(fs.statSync(setupPath).size / 1024 / 1024).toFixed(0)} MB`);
} catch (e) {
  console.log('  [SKIP] Inno Setup not available');
}

// 清理中间产物
const KEEP = ['war-danmaku-setup-v1.0.exe', 'war-danmaku'];
fs.readdirSync(DIST).forEach(f => {
  if (!KEEP.includes(f)) {
    try { fs.rmSync(path.join(DIST, f), { recursive: true, force: true }); } catch (e) {}
  }
});
console.log('  [clean] removed intermediate build files');
