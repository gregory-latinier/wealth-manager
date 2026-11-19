// Generates the PWA PNG icons and favicon.ico from public/favicon.svg.
// One-off script (outputs are committed):
//   pnpm --filter client generate-icons
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(here, '..', 'public')
const source = readFileSync(path.join(publicDir, 'favicon.svg'), 'utf8')

// Full-bleed variant: no rounded corners (Android and iOS apply their own mask).
// Content is scaled down so it stays inside the 80% maskable safe zone.
const fullBleed = (scale) =>
  source
    .replace(/<rect width="512" height="512" rx="112"/, '<rect width="512" height="512"')
    .replace('<g>', `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">`)

const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png()

await png(source, 192).toFile(path.join(publicDir, 'pwa-192x192.png'))
await png(source, 512).toFile(path.join(publicDir, 'pwa-512x512.png'))
await png(fullBleed(0.82), 512).toFile(path.join(publicDir, 'pwa-maskable-512x512.png'))
await png(fullBleed(0.9), 180).toFile(path.join(publicDir, 'apple-touch-icon.png'))

// favicon.ico: a PNG-compressed single-image ICO (supported by all current browsers)
const ico32 = await png(source, 32).toBuffer()
const header = Buffer.alloc(22)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(1, 4) // image count
header.writeUInt8(32, 6) // width
header.writeUInt8(32, 7) // height
header.writeUInt16LE(1, 10) // color planes
header.writeUInt16LE(32, 12) // bits per pixel
header.writeUInt32LE(ico32.length, 14) // image size in bytes
header.writeUInt32LE(22, 18) // image offset
writeFileSync(path.join(publicDir, 'favicon.ico'), Buffer.concat([header, ico32]))

console.log('icons written to', publicDir)
