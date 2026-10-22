import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function exists(relative) {
  return fs.existsSync(path.join(ROOT, relative))
}

function collectHtmlRefs(html) {
  const refs = []
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1]
    if (/^(https?:|mailto:|data:|#)/.test(ref)) continue
    refs.push(ref)
  }
  return refs
}

function collectServiceWorkerAssets(source) {
  const block = source.match(/const ASSETS = \[([\s\S]*?)\]/)
  assert.ok(block, 'service worker must define an ASSETS precache list')
  return [...block[1].matchAll(/'([^']+)'/g)].map(match => match[1])
}

function collectJsFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.name.endsWith('.js'))
    .map(entry => path.join(dir, entry.name))
}

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`ok    ${label}`)
  } catch (error) {
    failures += 1
    console.log(`fail  ${label}`)
    console.log(`      ${error.message}`)
  }
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
for (const ref of collectHtmlRefs(html)) {
  const resolved = ref.replace(/^\.\//, '')
  check(`index.html references ${ref}`, () => assert.ok(exists(resolved), `${resolved} is missing`))
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'))
check('manifest has required fields', () => {
  for (const field of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    assert.ok(manifest[field], `${field} missing`)
  }
  assert.equal(manifest.display, 'standalone')
})
assert.ok(Array.isArray(manifest.icons))
for (const icon of manifest.icons) {
  const src = icon.src.replace(/^\.\//, '')
  check(`manifest icon ${icon.src} (${icon.sizes}) exists`, () => {
    assert.ok(exists(src), `${src} is missing`)
    assert.match(icon.type, /^image\//)
  })
}

const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')
for (const asset of collectServiceWorkerAssets(sw)) {
  const resolved = asset.replace(/^\.\//, '')
  check(`service worker precaches ${asset}`, () => {
    assert.ok(exists(resolved === '' ? '.' : resolved), `${resolved} is missing`)
  })
}
check('service worker bumps a versioned cache name', () => {
  assert.match(sw, /CACHE_NAME\s*=\s*'/)
})

for (const file of collectJsFiles(path.join(ROOT, 'js'))) {
  check(`syntax: ${path.relative(ROOT, file)}`, () => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  })
}
check('syntax: sw.js', () => {
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'sw.js')], { stdio: 'pipe' })
})

check('LICENSE carries the required copyright line', () => {
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')
  assert.match(license, /Copyright \(c\) 2026 Asdale Dynamics, LLC/)
})

check('README credits Asdale Dynamics, LLC', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  assert.match(readme, /Asdale Dynamics, LLC/)
})

check('app.js imports resolve to real modules', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')
  for (const match of app.matchAll(/from '([^']+)'/g)) {
    const target = path.join(ROOT, 'js', match[1].replace(/^\.\//, ''))
    assert.ok(fs.existsSync(target), `missing import: ${match[1]}`)
  }
})

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll static checks passed.')
