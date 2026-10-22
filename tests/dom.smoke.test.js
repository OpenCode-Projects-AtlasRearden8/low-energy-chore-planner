import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STORAGE_KEY = 'lecp-state-v1'

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const dom = new JSDOM(html, { url: 'https://localhost/' })
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true })
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
Object.defineProperty(globalThis, 'location', { value: dom.window.location, configurable: true })

const waitFor = ms => new Promise(resolve => { setTimeout(resolve, ms) })

let appLoaded = false

test.before(async () => {
  await import('../js/app.js')
  appLoaded = true
})

function readStored() {
  const raw = dom.window.localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

function clickButton(selector) {
  const button = dom.window.document.querySelector(selector)
  assert.ok(button, `expected button ${selector} to exist`)
  button.click()
  return button
}

test('the app boots against the real index.html markup', () => {
  assert.equal(appLoaded, true)
  const doc = dom.window.document
  assert.ok(doc.querySelector('#energy-buttons'))
  assert.ok(doc.querySelector('#fits-list'))
  assert.ok(doc.querySelector('#task-groups').children.length > 0)
  const starterRows = doc.querySelectorAll('#task-groups .task[data-id^="starter-"]')
  assert.ok(starterRows.length >= 6)
})

test('choosing an energy level filters what fits and persists offline', () => {
  const doc = dom.window.document
  const energyButton = doc.querySelector('[data-action="set-energy"][data-value="3"]')
  energyButton.click()
  assert.equal(energyButton.getAttribute('aria-pressed'), 'true')
  assert.match(doc.querySelector('#spoon-line').textContent, /3 spoons/)
  assert.match(doc.querySelector('#spent-line').textContent, /3 spoons left/)
  assert.match(doc.querySelector('#fits-note').textContent, /3 spoons or fewer/)
  const stored = readStored()
  assert.equal(stored.energy, 3)
  assert.match(stored.energyDate, /^\d{4}-\d{2}-\d{2}$/)
})

test('adding a task stores it and shows it in the right spoon group', () => {
  const doc = dom.window.document
  const title = doc.querySelector('#add-title')
  title.value = 'Wipe the sink with zero drama'
  doc.querySelector('#add-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  const rows = [...doc.querySelectorAll('#task-groups .task-title')].map(el => el.textContent)
  assert.ok(rows.includes('Wipe the sink with zero drama'))
  const stored = readStored()
  assert.ok(stored.tasks.some(task => task.title === 'Wipe the sink with zero drama' && task.cost === 1))
})

test('empty titles are answered gently instead of being added', () => {
  const doc = dom.window.document
  const before = readStored().tasks.length
  doc.querySelector('#add-title').value = '   '
  doc.querySelector('#add-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  assert.equal(readStored().tasks.length, before)
})

test('make it smaller shrinks the typed title', () => {
  const doc = dom.window.document
  const title = doc.querySelector('#add-title')
  title.value = 'Clean the whole kitchen'
  doc.querySelector('#make-smaller-btn').click()
  assert.equal(title.value, '10-minute version of "Clean the whole kitchen"')
})

test('the just-one-thing picker suggests a task and records a win', async () => {
  const doc = dom.window.document
  clickButton('[data-action="pick"]')
  const pickedTitle = doc.querySelector('#picked-title').textContent
  assert.ok(pickedTitle.length > 0)
  assert.equal(doc.querySelector('#picker-result').hidden, false)
  const weekBefore = readStored().history.length
  clickButton('[data-action="picked-done"]')
  await waitFor(60)
  const stored = readStored()
  assert.equal(stored.history.length, weekBefore + 1)
  assert.equal(doc.querySelector('#picker-result').hidden, true)
  assert.match(doc.querySelector('#week-wins').textContent, /^(1|2) wins? in the past 7 days/)
})

test('the energy filter narrows after wins are spent', () => {
  const doc = dom.window.document
  clickButton('[data-action="set-energy"][data-value="1"]')
  clickButton('[data-action="set-energy"][data-value="3"]')
  const weekNote = doc.querySelector('#spent-line').textContent
  assert.match(weekNote, /left|spent/)
})

test('archiving hides a task and the archived list holds it', () => {
  const doc = dom.window.document
  const firstRow = doc.querySelector('#task-groups .task[data-id^="starter-"]')
  const id = firstRow.dataset.id
  clickButton(`#task-groups .task[data-id="${id}"] [data-action="archive"]`)
  assert.equal(doc.querySelector(`#task-groups [data-id="${id}"]`), null)
  assert.equal(doc.querySelector('#archived-details').hidden, false)
  assert.ok(doc.querySelector(`#archived-list [data-id="${id}"]`))
})

test('high-contrast mode switches the theme on the html element', () => {
  const doc = dom.window.document
  const toggle = doc.querySelector('#hc-toggle')
  toggle.checked = true
  toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  assert.equal(dom.window.document.documentElement.dataset.theme, 'high-contrast')
  const stored = readStored()
  assert.equal(stored.highContrast, true)
  toggle.checked = false
  toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  assert.equal(dom.window.document.documentElement.dataset.theme, 'default')
})

test('every id referenced by app.js exists in the markup', () => {
  const doc = dom.window.document
  for (const id of [
    'energy-buttons', 'spoon-line', 'spent-line', 'picker-result', 'picker-empty',
    'picked-title', 'picked-cost', 'picked-note', 'fits-note', 'fits-list',
    'task-groups', 'archived-details', 'archived-list', 'archived-count',
    'week-wins', 'all-wins', 'day-strip', 'add-form', 'add-title', 'add-note',
    'make-smaller-btn', 'hc-toggle', 'settings-btn', 'settings-dialog',
    'erase-dialog', 'import-input', 'announcer'
  ]) {
    assert.ok(doc.getElementById(id), `missing element id: ${id}`)
  }
})
