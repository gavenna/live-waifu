/**
 * battle/avatar.js — 拉取抖音观众真实头像（T2）
 *
 * 数据来源（2026-09-26 实机验证）：
 *   GET https://www.douyin.com/aweme/v1/web/user/profile/other/?user_id=<uid>&device_platform=webapp&aid=6383
 *   带 douyin cookie + Referer 即可（此端点实测不要 a_bogus 签名），返回 user.avatar_thumb.url_list[0]。
 *   ⚠️ 消息里的 `uid`(数字) 就是这里的 user_id；douyinLive 的弹幕 payload 不带头像，必须自己查。
 *
 * 产出：把头像缩放成 N×N PNG 存到 data/avatars/<uid>.png，返回路径给引擎的 debug.addAvatar。
 *   为什么要缩：引擎的 addAvatar 按"像素=世界单位"原生绘制，100×100 会糊半屏；缩到 ~40 才是单位量级。
 *   怎么缩：Node 无内置解码，改用 Windows 自带的 PowerShell System.Drawing（已验证可用，无 npm 依赖）。
 *
 * 失败一律返回 null（不抛），调用方静默跳过。
 */
'use strict'
const https = require('https')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const SIZE = (() => { const v = parseInt(process.env.RW_AVATAR_SIZE, 10); return Number.isFinite(v) && v > 0 ? v : 40 })()
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

function cookie () {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'secrets.json'), 'utf8'))
    return (s.douyin && s.douyin.cookie) || ''
  } catch (e) { return '' }
}

/** GET 一段文本（限 https，跟随一次跳转）。 */
function get (url, headers) {
  return new Promise((resolve) => {
    let u
    try { u = new URL(url) } catch (e) { resolve(null); return }
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers, timeout: 12000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); get(res.headers.location, headers).then(resolve); return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(res.statusCode === 200 ? Buffer.concat(chunks) : null))
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
    req.end()
  })
}

/** PowerShell System.Drawing 缩放+转 PNG。失败抛。 */
function resizeToPng (srcPath, outPath, n) {
  const ps = "Add-Type -AssemblyName System.Drawing;" +
    "$s=[System.Drawing.Image]::FromFile('" + srcPath.replace(/'/g, "''") + "');" +
    "$b=New-Object System.Drawing.Bitmap(" + n + "," + n + ",[System.Drawing.Imaging.PixelFormat]::Format32bppArgb);" +
    "$g=[System.Drawing.Graphics]::FromImage($b);" +
    "$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;" +
    "$g.DrawImage($s,0,0," + n + "," + n + ");" +
    "$b.Save('" + outPath.replace(/'/g, "''") + "',[System.Drawing.Imaging.ImageFormat]::Png);" +
    "$g.Dispose();$b.Dispose();$s.Dispose()"
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore', timeout: 15000 })
}

/**
 * 拉取某抖音用户的头像并落成 N×N PNG。
 * @param {string} userId 数字 uid（消息里的 uid）
 * @param {string} [outDir] 输出目录（默认 data/avatars）
 * @returns {Promise<string|null>} PNG 绝对路径；失败 null
 */
async function fetchAvatarPng (userId, outDir, size) {
  const id = String(userId || '').replace(/[^0-9a-zA-Z_]/g, '')
  if (!id) return null
  const n = (Number.isFinite(size) && size > 0) ? Math.round(size) : SIZE
  const dir = outDir || path.join(__dirname, '..', 'data', 'avatars')
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) { return null }
  const outPng = path.join(dir, id + '_' + n + '.png')
  // 命中缓存直接返回（头像不常变）
  try { if (fs.existsSync(outPng) && fs.statSync(outPng).size > 0) return outPng } catch (e) { /* ignore */ }

  const ck = cookie()
  if (!ck) return null
  const headers = { 'User-Agent': UA, 'Referer': 'https://www.douyin.com/', 'Cookie': ck }
  const api = 'https://www.douyin.com/aweme/v1/web/user/profile/other/?user_id=' + encodeURIComponent(id) +
    '&device_platform=webapp&aid=6383'
  const body = await get(api, headers)
  if (!body) return null
  let j
  try { j = JSON.parse(body.toString('utf8')) } catch (e) { return null }
  if (!j || j.status_code !== 0 || !j.user) return null
  const list = (j.user.avatar_thumb && j.user.avatar_thumb.url_list) || []
  const url = list[0]
  if (!url) return null

  const img = await get(url, headers)
  if (!img || img.length < 100 || img[0] !== 0xFF || img[1] !== 0xD8) {
    // 不是 JPEG（可能是错误页）——放弃
    if (!img || img.length < 100) return null
  }
  const tmp = path.join(dir, id + '.src')
  try { fs.writeFileSync(tmp, img) } catch (e) { return null }
  try {
    resizeToPng(tmp, outPng, n)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch (e2) { /* ignore */ }
    return null
  }
  try { fs.unlinkSync(tmp) } catch (e) { /* ignore */ }
  try { return fs.statSync(outPng).size > 0 ? outPng : null } catch (e) { return null }
}

module.exports = { fetchAvatarPng, SIZE, UA }
