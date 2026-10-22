import {
  COST_LABELS,
  createTask,
  tinyVersion,
  filterFits,
  pickOneThing,
  spentToday,
  effectiveEnergy,
  remainingSpoons,
  recentDays,
  winsOverLastDays,
  todayString,
  archiveTask,
  restoreTask,
  deleteTask
} from './core/planner.js'
import {
  loadState,
  saveState,
  parseBackup,
  serializeState,
  starterState,
  clearState
} from './core/storage.js'
const $ = selector => document.querySelector(selector)
const energyButtons = $('#energy-buttons')
const spoonLine = $('#spoon-line')
const spentLine = $('#spent-line')
const pickerResult = $('#picker-result')
const pickerEmpty = $('#picker-empty')
const fitsNote = $('#fits-note')
const fitsList = $('#fits-list')
const taskGroups = $('#task-groups')
const archivedDetails = $('#archived-details')
const archivedList = $('#archived-list')
const archivedCount = $('#archived-count')
const weekWins = $('#week-wins')
const allWins = $('#all-wins')
const dayStrip = $('#day-strip')
const addForm = $('#add-form')
const addTitle = $('#add-title')
const addNote = $('#add-note')
const makeSmallerBtn = $('#make-smaller-btn')
const hcToggle = $('#hc-toggle')
const settingsBtn = $('#settings-btn')
const settingsDialog = $('#settings-dialog')
const eraseDialog = $('#erase-dialog')
const importInput = $('#import-input')
const announcer = $('#announcer')

let state = starterState()
let pickerTaskId = null
let storage = null

function detectStorage() {
  try {
    const probe = '__lecp_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    return null
  }
}

function announce(message) {
  announcer.textContent = ''
  window.setTimeout(() => {
    announcer.textContent = message
  }, 30)
}

function persistAndRender() {
  const result = saveState(storage, state)
  if (!result.ok) {
    announce('Heads up: this device would not save changes, so they may not survive a refresh.')
  }
  render()
}

function update(fn) {
  fn(state)
  persistAndRender()
}

function findTask(taskId) {
  return state.tasks.find(task => task && task.id === taskId) ?? null
}

function completeTask(task) {
  if (!task) return
  const today = todayString()
  state.history.push({
    date: today,
    taskId: task.id,
    title: task.title,
    cost: task.cost,
    ts: Date.now()
  })
}

function spoonsWord(n) {
  return `${n} ${n === 1 ? 'spoon' : 'spoons'}`
}

function costDots(cost) {
  return `${'\u25CF'.repeat(cost)}${'\u25CB'.repeat(3 - cost)}`
}

function isDoneToday(task, today) {
  return state.history.some(entry => entry && entry.date === today && entry.taskId === task.id)
}

function taskRow(task, today, { canComplete = true } = {}) {
  const done = isDoneToday(task, today)
  const row = document.createElement('li')
  row.className = 'task'
  row.dataset.id = task.id

  const main = document.createElement('div')
  main.className = 'task-main'
  const title = document.createElement('span')
  title.className = 'task-title'
  if (done) title.classList.add('is-done')
  title.textContent = task.title
  main.appendChild(title)
  if (task.note) {
    const note = document.createElement('span')
    note.className = 'task-note'
    note.textContent = task.note
    main.appendChild(note)
  }
  row.appendChild(main)

  const side = document.createElement('div')
  side.className = 'task-side'

  const dots = document.createElement('span')
  dots.className = 'cost-dots'
  dots.textContent = costDots(task.cost)
  dots.setAttribute('aria-label', spoonsWord(task.cost))
  side.appendChild(dots)
  if (done) {
    const badge = document.createElement('span')
    badge.className = 'done-badge'
    badge.textContent = 'done today'
    side.appendChild(badge)
  } else if (canComplete) {
    const doneBtn = document.createElement('button')
    doneBtn.type = 'button'
    doneBtn.className = 'btn btn-ghost btn-small'
    doneBtn.dataset.action = 'complete'
    doneBtn.dataset.id = task.id
    doneBtn.textContent = 'Done'
    doneBtn.setAttribute('aria-label', `Mark ${task.title} done for today`)
    side.appendChild(doneBtn)
  }

  const archiveBtn = document.createElement('button')
  archiveBtn.type = 'button'
  archiveBtn.className = 'btn btn-ghost btn-small'
  archiveBtn.dataset.action = canComplete ? 'archive' : 'restore'
  archiveBtn.dataset.id = task.id
  archiveBtn.textContent = canComplete ? 'Archive' : 'Restore'
  archiveBtn.setAttribute('aria-label', `${canComplete ? 'Archive' : 'Restore'} ${task.title}`)
  side.appendChild(archiveBtn)

  row.appendChild(side)
  return row
}

function emptyLine(message) {
  const item = document.createElement('li')
  item.className = 'empty-line'
  item.textContent = message
  return item
}

function renderEnergy() {
  const today = todayString()
  const energy = effectiveEnergy(state, today)
  for (const button of energyButtons.querySelectorAll('[data-action="set-energy"]')) {
    button.setAttribute('aria-pressed', String(energy != null && Number(button.dataset.value) === energy))
  }
  if (energy == null) {
    spoonLine.textContent = 'How many spoons do you have today? A guess is fine, and you can change it any time.'
    spentLine.hidden = true
    return
  }
  const spent = spentToday(state.history, today)
  const left = Math.max(0, energy - spent)
  spoonLine.textContent = `You said ${spoonsWord(energy)} for today.`
  if (left === 0) {
    spentLine.textContent = `All of them are spent now. Rest counts as a plan.`
  } else {
    spentLine.textContent = `${spoonsWord(left)} left (${spent} spent today).`
  }
  spentLine.hidden = false
}

function renderPicker() {
  pickerResult.hidden = true
  pickerEmpty.hidden = true
  const task = pickerTaskId ? findTask(pickerTaskId) : null
  if (!task) return
  $('#picked-title').textContent = task.title
  $('#picked-cost').textContent = `${costDots(task.cost)} ${COST_LABELS[task.cost]} · ${spoonsWord(task.cost)}`
  const noteEl = $('#picked-note')
  noteEl.hidden = !task.note
  noteEl.textContent = task.note
  pickerResult.hidden = false
}

function showPickerEmpty(message) {
  pickerTaskId = null
  pickerResult.hidden = true
  pickerEmpty.hidden = false
  pickerEmpty.textContent = message
}

function renderFits() {
  const today = todayString()
  const remaining = remainingSpoons(state, today)
  const anyVisibleTasks = state.tasks.some(task => task && !task.archived)
  fitsList.replaceChildren()

  if (remaining == null) {
    if (!anyVisibleTasks) {
      fitsNote.textContent = 'No tasks yet. Add one below, smallest possible version.'
    } else {
      fitsNote.textContent = 'Choose your spoons above and this list will narrow to what fits right now.'
    }
    return
  }
  const fits = filterFits(state.tasks, remaining)
  if (fits.length === 0) {
    if (anyVisibleTasks) {
      fitsNote.textContent =
        remaining === 0
          ? 'You have spent all your spoons for today. Rest counts as a plan.'
          : 'Everything left needs more spoons than you have. That is information, not failure.'
      const doneToday = state.history.filter(entry => entry && entry.date === today)
      if (doneToday.length > 0) {
        const recap = emptyLine(`Already done today (${doneToday.length}):`)
        fitsList.appendChild(recap)
        for (const entry of doneToday) {
          const item = document.createElement('li')
          item.className = 'task'
          const main = document.createElement('div')
          main.className = 'task-main'
          const title = document.createElement('span')
          title.className = 'task-title is-done'
          title.textContent = entry.title
          main.appendChild(title)
          item.appendChild(main)
          const side = document.createElement('div')
          side.className = 'task-side'
          const dots = document.createElement('span')
          dots.className = 'cost-dots'
          dots.textContent = costDots(entry.cost)
          dots.setAttribute('aria-label', spoonsWord(entry.cost))
          side.appendChild(dots)
          const badge = document.createElement('span')
          badge.className = 'done-badge'
          badge.textContent = 'done today'
          side.appendChild(badge)
          item.appendChild(side)
          fitsList.appendChild(item)
        }
      }
    } else {
      fitsNote.textContent = 'No tasks yet. Add one below, smallest possible version.'
    }
    return
  }
  fitsNote.textContent = `These need ${spoonsWord(remaining)} or fewer.`
  for (const task of fits) fitsList.appendChild(taskRow(task, today))
}

function renderGroups() {
  taskGroups.replaceChildren()
  const today = todayString()
  for (let cost = 1; cost <= 3; cost += 1) {
    const group = document.createElement('div')
    const heading = document.createElement('h3')
    heading.className = 'group-heading'
    heading.textContent = `${COST_LABELS[cost]} · ${spoonsWord(cost)}`
    group.appendChild(heading)
    const list = document.createElement('ul')
    list.className = 'task-list'
    const members = state.tasks.filter(task => task && !task.archived && task.cost === cost)
    if (members.length === 0) {
      const messages = {
        1: 'No 1-spoon tasks yet. Add the smallest chore you can think of.',
        2: 'No 2-spoon tasks yet. Two spoons is a whole notch up from tiny.',
        3: 'No 3-spoon tasks yet. If a chore feels huge, this is where it lives.'
      }
      list.appendChild(emptyLine(messages[cost]))
    } else {
      for (const task of members) list.appendChild(taskRow(task, today))
    }
    group.appendChild(list)
    taskGroups.appendChild(group)
  }

  const archived = state.tasks.filter(task => task && task.archived)
  archivedDetails.hidden = archived.length === 0
  archivedCount.textContent = String(archived.length)
  archivedList.replaceChildren()
  for (const task of archived) {
    const row = taskRow(task, today, { canComplete: false })
    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className = 'btn btn-danger btn-small'
    deleteBtn.dataset.action = 'delete-row'
    deleteBtn.dataset.id = task.id
    deleteBtn.textContent = 'Delete'
    deleteBtn.setAttribute('aria-label', `Delete ${task.title} forever`)
    row.querySelector('.task-side').appendChild(deleteBtn)
    archivedList.appendChild(row)
  }
}

function renderProgress() {
  const today = todayString()
  const week = winsOverLastDays(state.history, today, 7)
  const total = state.history.length
  weekWins.textContent =
    week === 0
      ? 'Zero wins in the past 7 days, and zero pressure.'
      : `${week} ${week === 1 ? 'win' : 'wins'} in the past 7 days.`
  allWins.textContent =
    total === 0 ? 'Your win shelf is ready and waiting.' : `${total} all-time wins. Every one of them counted.`
  dayStrip.replaceChildren()
  for (const day of recentDays(state.history, today, 14)) {
    const dot = document.createElement('li')
    dot.className = 'day-dot'
    if (day.wins > 0) dot.classList.add('is-filled')
    dot.setAttribute('aria-label', `${day.wins} ${day.wins === 1 ? 'win' : 'wins'} on ${day.date}`)
    dayStrip.appendChild(dot)
  }
}

function render() {
  renderEnergy()
  renderPicker()
  renderFits()
  renderGroups()
  renderProgress()
}

function handlePick() {
  const today = todayString()
  const remaining = remainingSpoons(state, today)
  let pool = state.tasks
  if (pickerTaskId) {
    const others = pool.filter(task => task && task.id !== pickerTaskId)
    if (others.length > 0) pool = others
  }
  const picked = pickOneThing(pool, { remaining, history: state.history, today })
  if (!picked) {
    if (remaining === 0) {
      showPickerEmpty('Every spoon is spent today. Come back tomorrow; resting is part of the routine.')
      announce('All spoons spent for today. Rest is part of the routine.')
    } else if (remaining != null) {
      showPickerEmpty('Nothing fits the spoons you have left. Add a 1-spoon task, or rest and come back tomorrow.')
      announce('Nothing fits the spoons you have left right now.')
    } else {
      showPickerEmpty('Add a tiny task first, then the picker gets busy.')
      announce('Add a tiny task first, then the picker gets busy.')
    }
    render()
    return
  }
  pickerTaskId = picked.id
  pickerEmpty.hidden = true
  render()
  announce(`Try this: ${picked.title}`)
}

function wireEvents() {
  document.body.addEventListener('click', event => {
    const button = event.target.closest('[data-action]')
    if (!button) return
    const { action, id, value } = button.dataset
    const today = todayString()
    switch (action) {
      case 'set-energy': {
        const n = Number(value)
        update(target => {
          target.energy = n
          target.energyDate = today
        })
        announce(`Energy set to ${spoonsWord(n)}.`)
        break
      }
      case 'pick': {
        handlePick()
        break
      }
      case 'pick-again': {
        handlePick()
        break
      }
      case 'picked-done': {
        const task = findTask(pickerTaskId)
        update(() => completeTask(task))
        pickerTaskId = null
        renderPicker()
        if (task) announce(`Done. ${task.title} counts.`)
        break
      }
      case 'complete': {
        const task = findTask(id)
        update(() => completeTask(task))
        if (task) announce(`Done. ${task.title} counts.`)
        break
      }
      case 'archive': {
        const task = findTask(id)
        update(() => {
          const next = archiveTask(state, id)
          state.tasks = next.tasks
        })
        if (task) announce(`${task.title} is archived. It will not show up until you restore it.`)
        break
      }
      case 'restore': {
        update(() => {
          const next = restoreTask(state, id)
          state.tasks = next.tasks
        })
        announce('Task restored.')
        break
      }
      case 'delete-row': {
        update(() => {
          const next = deleteTask(state, id)
          state.tasks = next.tasks
        })
        announce('Deleted for good.')
        break
      }
      case 'remove-samples': {
        update(current => {
          current.tasks = current.tasks.filter(task => task && !task.starter)
        })
        announce('Sample tasks removed.')
        settingsDialog.close()
        break
      }
      case 'export': {
        exportBackup()
        break
      }
      case 'import': {
        importInput.click()
        break
      }
      case 'erase': {
        eraseDialog.showModal()
        break
      }
      case 'erase-confirmed': {
        clearState(storage)
        pickerTaskId = null
        state = starterState()
        persistAndRender()
        announce('Fresh start. Sample tasks are back if you want them.')
        eraseDialog.close()
        settingsDialog.close()
        break
      }
      case 'erase-cancel': {
        eraseDialog.close()
        break
      }
      case 'close-settings': {
        settingsDialog.close()
        break
      }
      default:
        break
    }
  })

  makeSmallerBtn.addEventListener('click', () => {
    if (!addTitle.value.trim()) {
      announce('Type the big version first, and I will shrink it.')
      addTitle.focus()
      return
    }
    addTitle.value = tinyVersion(addTitle.value)
    announce('Title shrunk to a starter version. Edit it freely.')
    addTitle.focus()
  })

  addForm.addEventListener('submit', event => {
    event.preventDefault()
    try {
      const costRadio = addForm.querySelector('input[name="add-cost"]:checked')
      const task = createTask(
        { title: addTitle.value, note: addNote.value, cost: Number(costRadio ? costRadio.value : 1) },
        { now: Date.now() }
      )
      update(current => {
        current.tasks.push(task)
      })
      addTitle.value = ''
      addNote.value = ''
      announce(`Added: ${task.title}.`)
      addTitle.focus()
    } catch (error) {
      announce(error.message)
    }
  })

  settingsBtn.addEventListener('click', () => settingsDialog.showModal())

  hcToggle.addEventListener('change', () => {
    update(current => {
      current.highContrast = hcToggle.checked
    })
    applyTheme()
    announce(hcToggle.checked ? 'High-contrast mode on.' : 'Standard colors restored.')
  })

  importInput.addEventListener('change', () => {
    const file = importInput.files && importInput.files[0]
    importInput.value = ''
    if (!file) return
    file
      .text()
      .then(text => {
        const imported = parseBackup(text)
        imported.highContrast = state.highContrast
        state = imported
        pickerTaskId = null
        persistAndRender()
        announce('Backup restored. Everything is here.')
        applyTheme()
      })
      .catch(() => announce('That file did not look like a planner backup. Nothing changed.'))
  })
}

function exportBackup() {
  const blob = new Blob([serializeState(state)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'low-energy-chore-planner-backup.json'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  announce('Backup downloaded. Keep it wherever you like.')
}

function applyTheme() {
  let prefersHighContrast = false
  try {
    prefersHighContrast = window.matchMedia('(prefers-contrast: more)').matches
  } catch {
    prefersHighContrast = false
  }
  const highContrast = state.highContrast == null ? prefersHighContrast : state.highContrast
  document.documentElement.dataset.theme = highContrast ? 'high-contrast' : 'default'
  hcToggle.checked = Boolean(highContrast)
}

function init() {
  storage = detectStorage()
  const loaded = loadState(storage)
  state = loaded.state
  applyTheme()
  render()
  wireEvents()
  if (loaded.fresh) {
    saveState(storage, state)
    announce('Welcome. This is yours now, and it lives on this device.')
  } else if (loaded.corrupted) {
    announce('Your saved file was unreadable, so starter tasks came back. Nothing else was lost.')
  }
  if ('serviceWorker' in navigator) {
    const local =
      location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    if (local) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {})
      })
    }
  }
}

init()
