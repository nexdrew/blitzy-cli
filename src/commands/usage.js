'use strict'

const { deps } = require('../app')
const { output } = require('../format')
const { fail } = require('../errors')

async function doUsage (argv, { api }) {
  const usage = await api.usage()
  return { usage }
}

function num (n) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : '-'
}

function quotaLine (label, used, quota) {
  if (typeof used !== 'number' || typeof quota !== 'number' || quota === 0) {
    return `${label.padEnd(18)}${num(used)}`
  }
  const p = Math.round((used / quota) * 1000) / 10
  return `${label.padEnd(18)}${num(used)} / ${num(quota)} (${p}%)`
}

function renderUsage ({ usage: u }) {
  console.log(quotaLine('Lines generated', u.linesGenerated, u.quotaLinesGenerated))
  console.log(quotaLine('Lines onboarded', u.linesOnboarded, u.quotaLinesOnboarded))
  if (typeof u.linesAdded === 'number') console.log(`${'Lines added'.padEnd(18)}${num(u.linesAdded)}`)
  if (typeof u.linesEdited === 'number') console.log(`${'Lines edited'.padEnd(18)}${num(u.linesEdited)}`)
  if (typeof u.linesRemoved === 'number') console.log(`${'Lines removed'.padEnd(18)}${num(u.linesRemoved)}`)
  if (typeof u.filesOnboarded === 'number') console.log(`${'Files onboarded'.padEnd(18)}${num(u.filesOnboarded)}`)
  if (typeof u.filesTouched === 'number') console.log(`${'Files touched'.padEnd(18)}${num(u.filesTouched)}`)
  if (typeof u.hoursSaved === 'number') console.log(`${'Hours saved'.padEnd(18)}${num(u.hoursSaved)}`)
  if (typeof u.chatMessages === 'number') console.log(`${'Chat messages'.padEnd(18)}${num(u.chatMessages)}`)
}

async function handle (argv, context, d) {
  try {
    const result = await doUsage(argv, d)
    output(argv, result.usage, () => renderUsage(result))
  } catch (err) {
    return fail(argv, err, d.errio)
  }
}

module.exports = {
  flags: 'usage',
  desc: 'Show subscription usage against quota',
  run: (argv, context) => handle(argv, context, deps()),
  handle,
  doUsage,
  renderUsage
}
