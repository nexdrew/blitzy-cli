'use strict'

// Emit either raw JSON (when argv.json) or a human-readable rendering.
function output (argv, data, humanFn) {
  if (argv && argv.json) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    humanFn(data)
  }
}

// Blitzy timestamps are epoch SECONDS (integers on user objects, floats on
// projects). Accepts either and returns epoch milliseconds, or null.
function toMs (epochSeconds) {
  if (typeof epochSeconds !== 'number' || !isFinite(epochSeconds)) return null
  return Math.round(epochSeconds * 1000)
}

function relFromMs (ms) {
  if (ms == null || !isFinite(ms)) return '-'
  const diff = Date.now() - ms
  const abs = Math.abs(diff)
  const units = [
    ['year', 365 * 24 * 3600e3],
    ['month', 30 * 24 * 3600e3],
    ['day', 24 * 3600e3],
    ['hour', 3600e3],
    ['minute', 60e3],
    ['second', 1e3]
  ]
  for (const [name, size] of units) {
    if (abs >= size || name === 'second') {
      const n = Math.round(abs / size)
      const label = `${n} ${name}${n === 1 ? '' : 's'}`
      return diff >= 0 ? `${label} ago` : `in ${label}`
    }
  }
  return '-'
}

// Relative time from epoch SECONDS (Blitzy project/user timestamps).
function relTime (epochSeconds) {
  return relFromMs(toMs(epochSeconds))
}

// Relative time from an ISO-8601 string (Blitzy rule/environment timestamps).
function relTimeIso (iso) {
  if (typeof iso !== 'string') return '-'
  const ms = Date.parse(iso)
  return isNaN(ms) ? '-' : relFromMs(ms)
}

function pct (n) {
  return typeof n === 'number' ? `${n}%` : '-'
}

// Render an array of row objects as a padded, left-aligned text table.
function table (columns, rows) {
  const widths = columns.map((c) => c.header.length)
  const cells = rows.map((row) =>
    columns.map((c, i) => {
      const val = c.get(row)
      const str = val == null ? '' : String(val)
      if (str.length > widths[i]) widths[i] = str.length
      return str
    })
  )
  const pad = (str, w) => str + ' '.repeat(w - str.length)
  const lines = []
  lines.push(columns.map((c, i) => pad(c.header, widths[i])).join('  '))
  for (const rowCells of cells) {
    lines.push(rowCells.map((s, i) => pad(s, widths[i])).join('  '))
  }
  return lines.join('\n')
}

module.exports = { output, relTime, relTimeIso, pct, table, toMs }
