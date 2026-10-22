import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_COST,
  MAX_COST,
  COST_LABELS,
  clampInt,
  clampString,
  makeId,
  isValidDateString,
  addDays,
  todayString,
  createTask,
  sanitizeTask,
  filterFits,
  weightedPick,
  pickOneThing,
  spentToday,
  effectiveEnergy,
  remainingSpoons,
  winsOverLastDays,
  winsTotal,
  recentDays,
  tinyVersion,
  archiveTask,
  restoreTask,
  deleteTask,
  starterTasks
} from '../js/core/planner.js'

test('COST_LABELS cover the whole spoon scale', () => {
  assert.equal(MIN_COST, 1)
  assert.equal(MAX_COST, 3)
  for (let cost = MIN_COST; cost <= MAX_COST; cost += 1) {
    assert.equal(typeof COST_LABELS[cost], 'string')
  }
})

test('clampInt clamps, rounds and falls back', () => {
  assert.equal(clampInt(0, 1, 3, 1), 1)
  assert.equal(clampInt(7, 1, 3, 1), 3)
  assert.equal(clampInt(2.6, 1, 3, 1), 3)
  assert.equal(clampInt(2.2, 1, 3, 1), 2)
  assert.equal(clampInt('two', 1, 3, 1), 1)
  assert.equal(clampInt(NaN, 1, 3, 4), 4)
})

test('clampString trims and caps length', () => {
  assert.equal(clampString('  hello  ', 10), 'hello')
  assert.equal(clampString('x'.repeat(50), 10), 'x'.repeat(10))
  assert.equal(clampString(42, 10, 'backup'), 'backup')
  assert.equal(clampString(null, 10), '')
})

test('makeId is deterministic with a fake rng and non-empty normally', () => {
  let calls = 0
  const fakeRng = () => {
    calls += 1
    return 0.123456789
  }
  assert.equal(makeId(fakeRng), makeId(() => 0.123456789))
  assert.ok(makeId(fakeRng).length >= 7)
})

test('date helpers handle month and year boundaries', () => {
  assert.equal(isValidDateString('2026-02-29'), false)
  assert.equal(isValidDateString('2026-02-28'), true)
  assert.equal(isValidDateString('2026-13-01'), false)
  assert.equal(isValidDateString('not-a-date'), false)
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(addDays('2026-10-22', 9), '2026-10-31')
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(todayString(new Date(2026, 9, 5))))
  assert.equal(todayString(new Date(2026, 9, 5)), '2026-10-05')
})

test('createTask normalizes a task and throws on empty title', () => {
  const task = createTask({ title: '  Wipe one counter  ', note: 'x'.repeat(400), cost: 9 }, { now: 100 })
  assert.equal(task.title, 'Wipe one counter')
  assert.equal(task.note.length, 280)
  assert.equal(task.cost, 3)
  assert.equal(task.createdAt, 100)
  assert.equal(task.archived, false)
  assert.equal(task.starter, false)
  assert.ok(task.id.length >= 7)

  assert.throws(() => createTask({ title: '   ' }), /name/)
  assert.throws(() => createTask({}), /name/)
  assert.throws(() => createTask({ title: 42 }), /name/)

  const pinned = createTask({ title: 'A', id: 'fixed-id', cost: 'nonsense' })
  assert.equal(pinned.id, 'fixed-id')
  assert.equal(pinned.cost, 1)
})

test('sanitizeTask returns null for unusable input', () => {
  assert.equal(sanitizeTask(null), null)
  assert.equal(sanitizeTask('task'), null)
  assert.equal(sanitizeTask({ title: '' }), null)
  assert.equal(sanitizeTask({ title: 'Keep me', cost: 2 }).cost, 2)
})

test('filterFits respects remaining spoons and hides archived tasks', () => {
  const tasks = [
    { id: 'a', title: 'A', note: '', cost: 1, archived: false, createdAt: 0, starter: false },
    { id: 'b', title: 'B', note: '', cost: 2, archived: false, createdAt: 0, starter: false },
    { id: 'c', title: 'C', note: '', cost: 3, archived: true, createdAt: 0, starter: false }
  ]
  assert.equal(filterFits(tasks, null).map(t => t.id).join(','), 'a,b')
  assert.equal(filterFits(tasks, 2).map(t => t.id).join(','), 'a,b')
  assert.equal(filterFits(tasks, 1).map(t => t.id).join(','), 'a')
  assert.equal(filterFits(tasks, 0).length, 0)
  assert.equal(filterFits(null, 5).length, 0)
})

test('weightedPick is deterministic for a fixed rng', () => {
  const pool = [
    { id: 'a', cost: 1 },
    { id: 'b', cost: 2 },
    { id: 'c', cost: 3 }
  ]
  assert.equal(weightedPick(pool, () => 0).id, 'a')
  assert.equal(weightedPick(pool, () => 0.5).id, 'b')
  assert.equal(weightedPick(pool, () => 0.99999).id, 'c')
  assert.equal(weightedPick([], () => 0.5), null)
  assert.equal(weightedPick([{ id: 'only', cost: 2 }], () => 0.9).id, 'only')
})

test('pickOneThing skips tasks done today, falls back gracefully', () => {
  const tasks = [
    { id: 'a', title: 'A', note: '', cost: 1, archived: false, createdAt: 0, starter: false },
    { id: 'b', title: 'B', note: '', cost: 2, archived: false, createdAt: 0, starter: false }
  ]
  const today = '2026-10-22'
  const history = [{ date: today, taskId: 'a', cost: 1, title: 'A', ts: 1 }, { date: today, taskId: 'b', cost: 2, title: 'B', ts: 2 }]
  assert.equal(pickOneThing(tasks, { remaining: 1, today, history, rng: () => 0.5 }).id, 'a')
  const picked = pickOneThing(tasks, { remaining: 2, today, history: [{ date: today, taskId: 'a', cost: 1, ts: 1 }], rng: () => 0 })
  assert.equal(picked.id, 'b')
  const fallback = pickOneThing(tasks, { remaining: 2, today, history, rng: () => 0 })
  assert.equal(fallback.id, 'a')
  assert.equal(pickOneThing([], { remaining: null, rng: () => 0 }), null)
  const noDate = pickOneThing(tasks, { remaining: null, history, rng: () => 0 })
  assert.equal(noDate.id, 'a')
})

test('spentToday sums only that day and clamps bad costs', () => {
  const history = [
    { date: '2026-10-22', cost: 2 },
    { date: '2026-10-22', cost: 1 },
    { date: '2026-10-21', cost: 5 },
    { date: '2026-10-22', cost: 99 },
    { date: 'nope', cost: 3 }
  ]
  assert.equal(spentToday(history, '2026-10-22'), 6)
  assert.equal(spentToday(null, '2026-10-22'), 0)
})

test('effectiveEnergy resets when the stored date is stale', () => {
  const state = { energy: 3, energyDate: '2026-10-22', history: [] }
  assert.equal(effectiveEnergy(state, '2026-10-22'), 3)
  assert.equal(effectiveEnergy(state, '2026-10-23'), null)
  assert.equal(effectiveEnergy({ energy: 2, energyDate: '2026-10-22' }, '2026-10-22'), 2)
  assert.equal(effectiveEnergy(null, '2026-10-22'), null)
})

test('remainingSpoons never drops below zero', () => {
  const state = { energy: 2, energyDate: '2026-10-22', history: [{ date: '2026-10-22', cost: 1 }, { date: '2026-10-22', cost: 2 }, { date: '2026-10-22', cost: 1 }] }
  assert.equal(remainingSpoons(state, '2026-10-22'), 0)
  assert.equal(remainingSpoons({ energy: null }, '2026-10-22'), null)
})

test('win math counts a rolling window with no streak guilt', () => {
  const history = [
    { date: '2026-10-16', cost: 1 },
    { date: '2026-10-17', cost: 2 },
    { date: '2026-10-22', cost: 1 },
    { date: '2026-10-22', cost: 2 },
    { date: '2026-10-15', cost: 1 },
    { date: '2026-10-23', cost: 1 },
    { date: 'bogus', cost: 1 }
  ]
  assert.equal(winsOverLastDays(history, '2026-10-22', 7), 4)
  assert.equal(winsOverLastDays(history, '2026-10-18', 7), 3)
  assert.equal(winsOverLastDays(history, '2026-10-22', 1), 2)
  assert.equal(winsOverLastDays(null, '2026-10-22', 7), 0)
  assert.equal(winsTotal(history), 6)
})

test('recentDays builds an oldest-first day strip', () => {
  const history = [{ date: '2026-10-22', cost: 1 }, { date: '2026-10-22', cost: 1 }, { date: '2026-10-20', cost: 2 }]
  const strip = recentDays(history, '2026-10-22', 5)
  assert.equal(strip.length, 5)
  assert.deepEqual(strip.map(day => day.date), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'])
  assert.deepEqual(strip.map(day => day.wins), [0, 0, 1, 0, 2])
})

test('tinyVersion shrinks a title without being weird', () => {
  assert.equal(tinyVersion('Clean the kitchen.'), '10-minute version of "Clean the kitchen"')
  assert.equal(tinyVersion('   '), '')
  assert.equal(tinyVersion(null), '')
  const long = 'S'.repeat(200)
  assert.ok(tinyVersion(long).length < 130)
})

test('archive, restore and delete return updated task lists', () => {
  let state = { tasks: [createTask({ title: 'T', id: 't1' })] }
  state = archiveTask(state, 't1')
  assert.equal(state.tasks[0].archived, true)
  state = restoreTask(state, 't1')
  assert.equal(state.tasks[0].archived, false)
  state = deleteTask(state, 't1')
  assert.equal(state.tasks.length, 0)
  assert.equal(archiveTask(null, 't1'), null)
})

test('starterTasks ships eight gentle samples with stable ids', () => {
  const starters = starterTasks()
  assert.equal(starters.length, 8)
  assert.ok(starters.every(task => task.starter))
  assert.ok(starters.every(task => task.id.startsWith('starter-')))
  assert.ok(starters.some(task => task.cost === 3))
  assert.equal(new Set(starters.map(t => t.id)).size, 8)
})
