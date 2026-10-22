import { clampInt, isValidDateString, sanitizeTask, starterTasks } from './planner.js'

export const STORAGE_KEY = 'lecp-state-v1'
export const STATE_VERSION = 1
export const MAX_TASKS = 500
export const MAX_HISTORY = 2000

export function defaultState() {
  return {
    version: STATE_VERSION,
    tasks: [],
    history: [],
    energy: null,
    energyDate: null,
    highContrast: null,
    seeded: false
  }
}

export function starterState() {
  const base = defaultState()
  base.tasks = starterTasks()
  base.seeded = true
  return base
}

function validHistoryEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!isValidDateString(raw.date)) return null
  return {
    date: raw.date,
    cost: clampInt(raw.cost, 1, 3, 1),
    taskId: typeof raw.taskId === 'string' ? raw.taskId.slice(0, 64) : '',
    title: typeof raw.title === 'string' ? raw.title.slice(0, 140) : '',
    ts: clampInt(raw.ts, 0, Number.MAX_SAFE_INTEGER, 0)
  }
}

export function sanitizeState(raw) {
  const clean = defaultState()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean
  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks.map(sanitizeTask).filter(Boolean).slice(0, MAX_TASKS)
    : []
  const history = Array.isArray(raw.history)
    ? raw.history.map(validHistoryEntry).filter(Boolean).slice(-MAX_HISTORY)
    : []
  clean.tasks = tasks
  clean.history = history
  clean.energy = raw.energy == null ? null : clampInt(raw.energy, 1, 5, null)
  clean.energyDate = isValidDateString(raw.energyDate) ? raw.energyDate : null
  clean.highContrast = typeof raw.highContrast === 'boolean' ? raw.highContrast : null
  clean.seeded = raw.seeded === true
  return clean
}

export function loadState(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return { state: starterState(), fresh: true }
  }
  let rawText = null
  try {
    rawText = storage.getItem(STORAGE_KEY)
  } catch {
    rawText = null
  }
  if (rawText == null) {
    return { state: starterState(), fresh: true }
  }
  try {
    return { state: sanitizeState(JSON.parse(rawText)), fresh: false }
  } catch {
    return { state: starterState(), fresh: false, corrupted: true }
  }
}

export function saveState(storage, state) {
  if (!storage || typeof storage.setItem !== 'function') {
    return { ok: false, reason: 'no-storage' }
  }
  try {
    storage.setItem(STORAGE_KEY, serializeState(state))
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'write-failed', error }
  }
}

export function serializeState(state) {
  try {
    return JSON.stringify(sanitizeState(state), null, 2)
  } catch {
    return JSON.stringify(defaultState(), null, 2)
  }
}

export function parseBackup(text) {
  if (typeof text !== 'string') throw new Error('Backup files should be plain text.')
  return sanitizeState(JSON.parse(text))
}

export function clearState(storage) {
  if (!storage || typeof storage.removeItem !== 'function') {
    return { ok: false, reason: 'no-storage' }
  }
  try {
    storage.removeItem(STORAGE_KEY)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'write-failed', error }
  }
}
