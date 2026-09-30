'use strict'
/**
 * mk-bullseye.js — 生成靶心 PNG（红白同心环 + 中心点），供靶子单位用。
 * 用法: node mk-bullseye.js <out.png> [size]
 * 只依赖 node:zlib —— 不引任何图像库。
 */
const fs = require('fs')
const zlib = require('zlib')

const out = process.argv[2] || 'bullseye.png'
const S = parseInt(process.argv[3] || '64', 10)

// CRC32
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c } return t })()
function crc32 (buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function chunk (type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0)
  return Buffer.concat([len, td, crc])
}

// 画靶心：中心 (cx,cy)，按半径分段（红/白交替），最外圈深灰边
const cx = (S - 1) / 2, cy = (S - 1) / 2
const R = S / 2
const raw = Buffer.alloc(S * (1 + S * 4))       // 每行: 1 字节 filter(0) + S*4(RGBA)
let p = 0
for (let y = 0; y < S; y++) {
  raw[p++] = 0
  for (let x = 0; x < S; x++) {
    const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
    let r, g, b, a = 255
    if (d > R - 0.5) { a = 0; r = g = b = 0 }        // 圆外透明
    else {
      const band = Math.floor(d / (R / 4))           // 0..3
      const red = band % 2 === 0
      if (band === 0) { r = 220; g = 40; b = 40 }    // 靶心红
      else if (red) { r = 210; g = 45; b = 45 }
      else { r = 240; g = 240; b = 240 }
      if (d > R - 2) { r = 40; g = 40; b = 40 }      // 外圈描边
    }
    raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0   // 8bit RGBA, no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
fs.writeFileSync(out, png)
console.log(`wrote ${out} (${S}x${S}, ${png.length} bytes)`)
