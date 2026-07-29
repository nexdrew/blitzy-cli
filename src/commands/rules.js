'use strict'

const { deps } = require('../app')
const { output, relTimeIso, table } = require('../format')

async function doRules (argv, { api }) {
  if (argv.uuid) {
    return { mode: 'detail', rule: await api.getRule(argv.uuid) }
  }
  return { mode: 'list', result: await api.listRules() }
}

function renderList ({ result }) {
  const rules = (result && result.rules) || []
  if (!rules.length) {
    console.log('No rules found.')
    return
  }
  console.log(table([
    { header: 'NAME', get: (r) => r.name || '-' },
    { header: 'SCOPE', get: (r) => r.scope || '-' },
    { header: 'ID', get: (r) => r.id || '-' }
  ], rules))
  const total = result && typeof result.totalCount === 'number' ? result.totalCount : rules.length
  console.log(`\n${rules.length} shown, ${total} total.`)
}

function renderDetail ({ rule: r }) {
  const line = (label, value) => { if (value !== undefined && value !== null && value !== '') console.log(`${label.padEnd(12)}${value}`) }
  console.log(r.name || '(unnamed rule)')
  line('ID', r.id)
  if (r.scope) line('Scope', r.scope)
  line('Created', relTimeIso(r.created_at))
  line('Updated', relTimeIso(r.updated_at))
  const projects = (r.projects || []).map((p) => p.projectName).filter(Boolean)
  if (projects.length) line('Used by', projects.join(', '))
  if (r.content) console.log('\n' + String(r.content).trimEnd())
}

async function handle (argv, context, d) {
  try {
    const result = await doRules(argv, d)
    if (result.mode === 'detail') {
      output(argv, result.rule, () => renderDetail(result))
    } else {
      output(argv, result.result, () => renderList(result))
    }
  } catch (err) {
    return context.cliMessage(err.message)
  }
}

module.exports = {
  flags: 'rules [uuid]',
  aliases: 'rule',
  hints: '',
  desc: 'List reusable rules, or show one rule (with its full content) by uuid',
  paramsDesc: 'Optional rule uuid to show details for',
  run: (argv, context) => handle(argv, context, deps()),
  handle,
  doRules,
  renderList,
  renderDetail
}
