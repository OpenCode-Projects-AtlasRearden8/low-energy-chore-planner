import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STORAGE_KEY,
  STATE_VERSION,
  defaultState,
  starterState,
  sanitizeState,
  loadState,
  saveState,
  serializeState,
  parseBackup,
  clearState
} from '../js/core/storage.js'

class MemStorage {
  constructor() {
    this.map = new Map()
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }
  setItem(key, value) {
    this.map.set(key, String(value))
  }
  removeItem(key) {
    this.map.delete(key)
  }
}

class ThrowingStorage {
  getItem() {
    throw new Error('blocked')
  }
  setItem() {
    throw new Error('blocked')
  }
  removeItem() {
    throw new Error('blocked')
  }
}

test('defaultState is a clean slate at the current version', () => {
  assert.deepEqual(defaultState(), {
    version: STATE_VERSION,
    tasks: [],
    history: [],
    energy: null,
    energyDate: null,
    highContrast: null,
    seeded: false
  })
})

test('starterState seeds sample tasks exactly once via the seeded flag', () => {
  const seeded = starterState()
  assert.equal(seeded.seeded, true)
  assert.ok(seeded.tasks.length >= 6)
  assert.ok(seeded.tasks.every(task => task.starter))
})

test('first load with no storage starts fresh with sample tasks', () => {
  const result = loadState(null)
  assert.equal(result.fresh, true)
  assert.equal(result.state.seeded, true)
  assert.ok(result.state.tasks.length > 0)
  assert.equal(result.corrupted, undefined)
})

test('save then load round-trips through a mock localStorage', () => {
  const storage = new MemStorage()
  const first = loadState(storage)
  assert.equal(first.fresh, true)
  first.state.energy = 3
  first.state.energyDate = '2026-10-22'
  first.state.highContrast = true
  first.state.tasks.push({
    id: 'custom-1',
    title: 'Wipe the sink',
    note: '',
    cost: 1,
    archived: false,
    createdAt: 10,
    starter: false
  })
  first.state.history.push({ date: '2026-10-22', cost: 1, taskId: 'custom-1', title: 'Wipe the sink', ts: 20 })
  const saveResult = saveState(storage, first.state)
  assert.deepEqual(saveResult, { ok: true })
  const second = loadState(storage)
  assert.equal(second.fresh, false)
  assert.equal(second.state.energy, 3)
  assert.equal(second.state.energyDate, '2026-10-22')
  assert.equal(second.state.highContrast, true)
  assert.equal(second.state.tasks.length, first.state.tasks.length)
  assert.equal(second.state.history.length, 1)
  assert.equal(second.state.tasks.at(-1).id, 'custom-1')
})

test('corrupt JSON falls back to a starter state with a corrupted flag', () => {
  const storage = new MemStorage()
  storage.setItem(STORAGE_KEY, '{not json at all')
  const result = loadState(storage)
  assert.equal(result.corrupted, true)
  assert.equal(result.fresh, false)
  assert.ok(result.state.tasks.length > 0)
})

test('loadState survives a storage that throws on read', () => {
  const result = loadState(new ThrowingStorage())
  assert.equal(result.fresh, true)
  assert.ok(result.state.tasks.length > 0)
})

test('saveState reports failure instead of throwing', () => {
  assert.deepEqual(saveState(null, defaultState()), { ok: false, reason: 'no-storage' })
  const result = saveState(new ThrowingStorage(), defaultState())
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'write-failed')
})

test('sanitizeState drops junk and clamps values', () => {
  const raw = {
    version: 99,
    tasks: [null, 'junk', { title: '' }, { title: 'Keep me', cost: 12, archived: true }],
    history: [null, { date: 'nope' }, { date: '2026-10-22', cost: 88, taskId: 'x', title: 'ok' }],
    energy: 99,
    energyDate: 'not-a-date',
    highContrast: 'yes',
    seeded: 'truthy'
  }
  const clean = sanitizeState(raw)
  assert.equal(clean.version, STATE_VERSION)
  assert.equal(clean.tasks.length, 1)
  assert.equal(clean.tasks[0].title, 'Keep me')
  assert.equal(clean.tasks[0].cost, 3)
  assert.equal(clean.tasks[0].archived, true)
  assert.equal(clean.history.length, 1)
  assert.equal(clean.history[0].cost, 3)
  assert.equal(clean.energy, 5)
  assert.equal(clean.energyDate, null)
  assert.equal(clean.highContrast, null)
  assert.equal(clean.seeded, false)
  assert.deepEqual(sanitizeState(null), defaultState())
  assert.deepEqual(sanitizeState('junk'), defaultState())
  assert.deepEqual(sanitizeState([1, 2]), defaultState())
})

test('sanitizeState caps runaway arrays', () => {
  const raw = { tasks: [], history: [] }
  for (let i = 0; i < 600; i += 1) raw.tasks.push({ title: `Task ${i}`, id: `id-${i}` })
  for (let i = 0; i < 2600; i += 1) raw.history.push({ date: '2026-10-22', cost: 1, ts: i })
  const clean = sanitizeState(raw)
  assert.equal(clean.tasks.length, 500)
  assert.equal(clean.history.length, 2000)
  assert.equal(clean.tasks[0].id, 'id-0')
  assert.equal(clean.history[0].ts, 600)
})

test('serialize and parseBackup round-trip a full state', () => {
  const storage = new MemStorage()
  const loaded = loadState(storage)
  loaded.state.energy = 5
  loaded.state.energyDate = '2026-10-22'
  const text = serializeState(loaded.state)
  const restored = parseBackup(text)
  assert.equal(restored.energy, 5)
  assert.equal(restored.energyDate, '2026-10-22')
  assert.equal(restored.tasks.length, loaded.state.tasks.length)
  assert.equal(restored.seeded, true)
})

test('parseBackup rejects garbage instead of poisoning the app', () => {
  assert.throws(() => parseBackup('nope'))
  assert.throws(() => parseBackup(null))
  assert.equal(parseBackup(JSON.stringify({ tasks: [{ title: 'Fine' }] })).tasks.length, 1)
})

test('clearState removes stored data and tolerates missing storage', () => {
  const storage = new MemStorage()
  saveState(storage, starterState())
  assert.equal(storage.getItem(STORAGE_KEY).length > 0, true)
  assert.deepEqual(clearState(storage), { ok: true })
  assert.equal(storage.getItem(STORAGE_KEY), null)
  assert.deepEqual(clearState(null), { ok: false, reason: 'no-storage' })
})
