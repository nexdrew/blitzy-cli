'use strict'

const { deps } = require('../app')
const { output, num } = require('../format')
const { fail } = require('../errors')

// Width of the label column; the longest label ("Generated overage") is 17 chars.
const LABEL_WIDTH = 19
const label = (text) => text.padEnd(LABEL_WIDTH)

async function doUsage (argv, { api }) {
  const usage = await api.usage()
  return { usage }
}

// One quota line, such as "283,799 / 8,000,000 (3.5%, 7,716,201 left)". The
// Blitzy docs say that a missing quota is not an unlimited one, so say that the
// API reported no quota instead of printing the used amount alone.
function quotaLine (name, used, quota, remaining) {
  if (typeof used !== 'number' || typeof quota !== 'number' || quota === 0) {
    return `${label(name)}${num(used)} (no quota reported)`
  }
  const p = Math.round((used / quota) * 1000) / 10
  const left = typeof remaining === 'number' ? `, ${num(remaining)} left` : ''
  return `${label(name)}${num(used)} / ${num(quota)} (${p}%${left})`
}

// An overage line, printed only when there is an overage. `cost` is the total
// and `rate` is the charge for each line over the quota. Blitzy does not
// document the currency, so the numbers are printed as the API gives them.
function overageLine (name, cost, rate) {
  if (typeof cost !== 'number' || cost <= 0) return null
  return `${label(name)}${num(cost)}${typeof rate === 'number' ? ` (rate ${rate} per line)` : ''}`
}

function renderUsage ({ usage: u }) {
  const count = (name, n) => { if (typeof n === 'number') console.log(`${label(name)}${num(n)}`) }
  console.log(quotaLine('Lines generated', u.linesGenerated, u.quotaLinesGenerated, u.quotaLinesGeneratedRemaining))
  console.log(quotaLine('Lines onboarded', u.linesOnboarded, u.quotaLinesOnboarded, u.quotaLinesOnboardedRemaining))
  // Lines that a run in progress holds back from the generation quota.
  if (u.reservedLinesGenerated > 0) count('Lines reserved', u.reservedLinesGenerated)
  for (const text of [
    overageLine('Generated overage', u.costLinesGeneratedOverage, u.chargeLinesGeneratedOverage),
    overageLine('Onboarded overage', u.costLinesOnboardedOverage, u.chargeLinesOnboardedOverage)
  ]) if (text) console.log(text)
  count('Lines added', u.linesAdded)
  count('Lines edited', u.linesEdited)
  count('Lines removed', u.linesRemoved)
  count('Files onboarded', u.filesOnboarded)
  count('Files touched', u.filesTouched)
  count('Hours saved', u.hoursSaved)
  count('Chat messages', u.chatMessages)
}

async function handle (argv, context, d) {
  try {
    const result = await doUsage(argv, d)
    output(argv, result.usage, () => renderUsage(result))
  } catch (err) {
    // The Blitzy docs say that only an Admin or a Super Admin can see usage.
    if (err && err.status === 403) err.message += ' Usage statistics are for the Admin and Super Admin roles.'
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
