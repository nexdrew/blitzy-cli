'use strict'

const { deps } = require('../app')
const { output, relTimeIso, table } = require('../format')

async function doEnvs (argv, { api }) {
  if (argv.uuid) {
    return { mode: 'detail', env: await api.getEnvironment(argv.uuid) }
  }
  return { mode: 'list', result: await api.listEnvironments() }
}

function renderList ({ result }) {
  const envs = (result && result.environments) || []
  if (!envs.length) {
    console.log('No environments found.')
    return
  }
  console.log(table([
    { header: 'NAME', get: (e) => e.name || '-' },
    { header: 'REV', get: (e) => (e.revision != null ? String(e.revision) : '-') },
    { header: 'ID', get: (e) => e.id || '-' }
  ], envs))
  console.log(`\n${envs.length} shown.`)
}

function renderDetail ({ env: e }) {
  const line = (label, value) => { if (value !== undefined && value !== null && value !== '') console.log(`${label.padEnd(12)}${value}`) }
  console.log(e.name || '(unnamed environment)')
  line('ID', e.id)
  if (e.target_os) line('OS', e.target_os)
  if (e.revision != null) line('Revision', e.revision)
  line('Created', relTimeIso(e.createdAt))
  line('Updated', relTimeIso(e.updatedAt))
  const projects = (e.projects || []).map((p) => p.projectName).filter(Boolean)
  if (projects.length) line('Used by', projects.join(', '))

  const varKeys = e.variables ? Object.keys(e.variables) : []
  if (varKeys.length) {
    console.log('\nVariables')
    for (const k of varKeys) console.log(`  ${k}=${e.variables[k]}`)
  }
  const secretKeys = e.secrets ? Object.keys(e.secrets) : []
  if (secretKeys.length) console.log(`\nSecrets     ${secretKeys.join(', ')}`)

  if (e.instructions) console.log('\n' + String(e.instructions).trimEnd())
}

async function handle (argv, context, d) {
  try {
    const result = await doEnvs(argv, d)
    if (result.mode === 'detail') {
      output(argv, result.env, () => renderDetail(result))
    } else {
      output(argv, result.result, () => renderList(result))
    }
  } catch (err) {
    return context.cliMessage(err.message)
  }
}

module.exports = {
  flags: 'envs [uuid]',
  // aliases: ['env', 'environments'],
  aliases: 'env',
  hints: '',
  desc: 'List environments, or show one environment (with its setup instructions) by uuid',
  paramsDesc: 'Optional environment uuid to show details for',
  run: (argv, context) => handle(argv, context, deps()),
  handle,
  doEnvs,
  renderList,
  renderDetail
}
