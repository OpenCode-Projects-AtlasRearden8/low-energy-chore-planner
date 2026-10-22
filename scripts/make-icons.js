import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ICON_DIR = path.join(ROOT, 'icons')

const TEAL = [47, 125, 109]
const WHITE = [255, 255, 255]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function pngEncode(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function insideRoundedSquare(sample, size, radius) {
  if (sample.x < 0 || sample.y < 0 || sample.x > size || sample.y > size) return false
  if (sample.x < radius && sample.y < radius) return dist(sample.x, sample.y, radius, radius) <= radius
  if (sample.x > size - radius && sample.y < radius) return dist(sample.x, sample.y, size - radius, radius) <= radius
  if (sample.x < radius && sample.y > size - radius) return dist(sample.x, sample.y, radius, size - radius) <= radius
  if (sample.x > size - radius && sample.y > size - radius) return dist(sample.x, sample.y, size - radius, size - radius) <= radius
  return true
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2)
}

function insideCapsule(sample, ax, ay, bx, by, radius) {
  const abx = bx - ax
  const aby = by - ay
  const lengthSquared = abx * abx + aby * aby
  let t = lengthSquared === 0 ? 0 : ((sample.x - ax) * abx + (sample.y - ay) * aby) / lengthSquared
  t = Math.max(0, Math.min(1, t))
  return dist(sample.x, sample.y, ax + abx * t, ay + aby * t) <= radius
}

function glyphCoverage(x, y, size) {
  const samples = [
    { x: x + 0.25, y: y + 0.25 },
    { x: x + 0.75, y: y + 0.25 },
    { x: x + 0.25, y: y + 0.75 },
    { x: x + 0.75, y: y + 0.75 }
  ]
  let hit = 0
  for (const sample of samples) {
    const bowl = dist(sample.x, sample.y, size * 0.5, size * 0.6) <= size * 0.135
    const handle = insideCapsule(sample, size * 0.5, size * 0.16, size * 0.5, size * 0.6, size * 0.045)
    if (bowl || handle) hit += 1
  }
  return hit / 4
}

function backgroundCoverage(x, y, size, solid) {
  if (solid) return x >= 0 && y >= 0 && x <= size && y <= size ? 1 : 0
  const samples = [
    { x: x + 0.25, y: y + 0.25 },
    { x: x + 0.75, y: y + 0.25 },
    { x: x + 0.25, y: y + 0.75 },
    { x: x + 0.75, y: y + 0.75 }
  ]
  let hit = 0
  for (const sample of samples) {
    if (insideRoundedSquare(sample, size, size * 0.22)) hit += 1
  }
  return hit / 4
}

function drawIcon(size, solid) {
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const bgCov = backgroundCoverage(x, y, size, solid)
      const glyphCov = glyphCoverage(x, y, size)
      const offset = (y * size + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const base = TEAL[channel] + (WHITE[channel] - TEAL[channel]) * glyphCov
        pixels[offset + channel] = Math.round(base)
      }
      pixels[offset + 3] = Math.round(255 * bgCov)
    }
  }
  return pixels
}

fs.mkdirSync(ICON_DIR, { recursive: true })
const outputs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-512-maskable.png', 512, true]
]
for (const [name, size, solid] of outputs) {
  const png = pngEncode(size, size, drawIcon(size, solid))
  const file = path.join(ICON_DIR, name)
  fs.writeFileSync(file, png)
  const header = png.subarray(0, 8)
  const ok = header[0] === 0x89 && header[1] === 0x50
  console.log(`${ok ? 'OK' : 'FAIL'} ${name} (${size}x${size}, ${png.length} bytes)`)
  if (!ok) process.exitCode = 1
}
