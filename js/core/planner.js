export const MIN_COST = 1
export const MAX_COST = 3

export const COST_LABELS = {
  1: 'Tiny',
  2: 'Small',
  3: 'Medium-ish'
}

export const PICKER_WEIGHTS = {
  1: 3,
  2: 2,
  3: 1
}

export const ENERGY_LABELS = {
  1: 'Running on empty',
  2: 'Low battery',
  3: 'Getting by',
  4: 'Pretty okay',
  5: 'Charged up'
}

export function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : NaN
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function clampString(value, maxLength, fallback = '') {
  if (typeof value !== 'string') return fallback
  return value.trim().slice(0, maxLength)
}

export function makeId(rng = Math.random) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = Math.floor(rng() * 4294967295).toString(36).padStart(7, '0')
    if (id !== '0') return id
  }
  return 'id' + Date.now().toString(36)
}

export function isValidDateString(value) {
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parts = value.split('-').map(part => Number(part))
  const [y, m, d] = parts
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(y, m - 1, d)
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
}

export function fmtDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function todayString(date = new Date()) {
  return fmtDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function addDays(dateStr, days) {
  if (!isValidDateString(dateStr)) return null
  const probe = parseLocalDate(dateStr)
  probe.setDate(probe.getDate() + days)
  return fmtDate(probe.getFullYear(), probe.getMonth() + 1, probe.getDate())
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(part => Number(part))
  return new Date(y, m - 1, d)
}

export function createTask(input = {}, opts = {}) {
  const rng = opts.rng ?? Math.random
  const now = opts.now ?? Date.now()
  const source = input && typeof input === 'object' ? input : {}
  const title = typeof source.title === 'string' ? source.title.trim().slice(0, 120) : ''
  if (!title) throw new Error('Every task needs a name, even a tiny one.')
  const note = typeof source.note === 'string' ? source.note.trim().slice(0, 280) : ''
  const cost = clampInt(source.cost, MIN_COST, MAX_COST, 1)
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim().slice(0, 64) : makeId(rng)
  return {
    id,
    title,
    note,
    cost,
    archived: source.archived === true,
    createdAt: clampInt(source.createdAt, 0, Number.MAX_SAFE_INTEGER, now),
    starter: source.starter === true
  }
}

export function sanitizeTask(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  try {
    return createTask(raw)
  } catch {
    return null
  }
}

export function filterFits(tasks, remaining) {
  const all = Array.isArray(tasks) ? tasks : []
  const visible = all.filter(task => task && !task.archived)
  if (remaining == null) return visible
  return visible.filter(task => task && task.cost <= remaining)
}

export function weightedPick(pool, rng = Math.random) {
  if (!Array.isArray(pool) || pool.length === 0) return null
  const total = pool.reduce((sum, task) => sum + pickWeight(task), 0)
  if (total <= 0) return pool[0]
  let threshold = rng() * total
  for (const task of pool) {
    threshold -= pickWeight(task)
    if (threshold < 0) return task
  }
  return pool[pool.length - 1]
}

function pickWeight(task) {
  const weight = task && PICKER_WEIGHTS[task.cost]
  return typeof weight === 'number' ? weight : 1
}

export function pickOneThing(tasks, opts = {}) {
  const { remaining = null, history = [], today = null, rng = Math.random } = opts
  const pool = filterFits(tasks, remaining)
  if (pool.length === 0) return null
  const fresh = today == null
    ? pool
    : pool.filter(task => !history.some(entry => entry && entry.date === today && entry.taskId === task.id))
  return weightedPick(fresh.length > 0 ? fresh : pool, rng)
}

export function spentToday(history, today) {
  return (Array.isArray(history) ? history : [])
    .filter(entry => entry && entry.date === today)
    .reduce((sum, entry) => sum + clampInt(entry.cost, MIN_COST, MAX_COST, 1), 0)
}

export function effectiveEnergy(state, today) {
  if (!isValidDateString(today)) return null
  if (!state || state.energyDate !== today) return null
  return clampInt(state.energy, 1, 5, null)
}

export function remainingSpoons(state, today) {
  const energy = effectiveEnergy(state, today)
  if (energy == null) return null
  return Math.max(0, energy - spentToday(state.history, today))
}

function isValidHistoryEntry(entry) {
  return Boolean(entry && isValidDateString(entry.date))
}

export function winsOverLastDays(history, endDay, days = 7) {
  const safeHistory = Array.isArray(history) ? history : []
  if (!isValidDateString(endDay)) return 0
  const safeDays = clampInt(days, 1, 366, 7)
  const start = addDays(endDay, -(safeDays - 1))
  const cutoff = addDays(endDay, 1)
  return safeHistory.filter(entry => {
    if (!isValidHistoryEntry(entry)) return false
    return entry.date >= start && entry.date < cutoff
  }).length
}

export function winsTotal(history) {
  return (Array.isArray(history) ? history : []).filter(isValidHistoryEntry).length
}

export function recentDays(history, endDay, days = 14) {
  const safeHistory = Array.isArray(history) ? history : []
  const safeDays = clampInt(days, 1, 366, 14)
  const list = []
  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const date = addDays(endDay, -offset)
    if (!date) continue
    const wins = safeHistory.filter(entry => isValidHistoryEntry(entry) && entry.date === date).length
    list.push({ date, wins })
  }
  return list
}

export function tinyVersion(title) {
  const clean = clampString(title, 100)
  if (!clean) return ''
  const bare = clean.replace(/[.。!?！？]+$/u, '')
  return `10-minute version of "${bare}"`
}

function mapTask(state, taskId, updater) {
  if (!state || !Array.isArray(state.tasks)) return state
  return {
    ...state,
    tasks: state.tasks.map(task => (task && task.id === taskId ? updater(task) : task))
  }
}

export function archiveTask(state, taskId) {
  return mapTask(state, taskId, task => ({ ...task, archived: true }))
}

export function restoreTask(state, taskId) {
  return mapTask(state, taskId, task => ({ ...task, archived: false }))
}

export function deleteTask(state, taskId) {
  if (!state || !Array.isArray(state.tasks)) return state
  return { ...state, tasks: state.tasks.filter(task => task && task.id !== taskId) }
}

const STARTER_DEFS = [
  ['Wipe one counter', 'Just one counter. The counter.', 1],
  ['Toss five things from a drawer', 'Count them out. Five, then stop.', 1],
  ['Swap the hand towels', 'Fresh towel, tiny victory.', 1],
  ['Water one plant', 'One. The thirsty one.', 1],
  ['Put the dishes in the washer', 'Loading counts as much as finishing.', 2],
  ['Start one load of laundry', 'Folding later is allowed.', 2],
  ['Take out the recycling if a bag is full', 'Only if a bag is already full.', 2],
  ['Reset one room for ten minutes', 'Timer on, one room, then stop.', 3]
]

export function starterTasks() {
  return STARTER_DEFS.map(([title, note, cost], index) =>
    createTask({ title, note, cost, id: `starter-${index + 1}`, starter: true, createdAt: 0 })
  )
}
