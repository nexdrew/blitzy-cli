'use strict'

const { deps } = require('../app')
const { output, relTime, table } = require('../format')
const { fail } = require('../errors')

// The teams API is unpaginated and has no single-team endpoint: /user/team
// returns every team (with full member rosters) in one response, so detail
// mode picks the requested team from the list. The user's own role per team
// comes from a second, auxiliary call and is merged in; its failure only
// blanks the role, never the command.
async function doTeams (argv, { api }) {
  const [result, roles] = await Promise.all([
    api.listTeams(),
    api.listTeamRoles().catch(() => null)
  ])
  const roleByTeam = new Map((Array.isArray(roles) ? roles : []).map((r) => [r.teamId, r.role]))
  const teams = ((result && result.teams) || []).map((t) => Object.assign({}, t, { role: roleByTeam.get(t.id) || null }))
  if (argv.uuid) {
    const team = teams.find((t) => t.id === argv.uuid)
    if (!team) {
      const err = new Error(`Team not found: ${argv.uuid}`)
      err.kind = 'not_found'
      throw err
    }
    return { mode: 'detail', team }
  }
  const totalCount = result && typeof result.totalCount === 'number' ? result.totalCount : teams.length
  return { mode: 'list', result: { teams, totalCount } }
}

function renderList ({ result }) {
  const teams = (result && result.teams) || []
  if (!teams.length) {
    console.log('No teams found.')
    return
  }
  console.log(table([
    { header: 'NAME', get: (t) => t.name || '-' },
    { header: 'ROLE', get: (t) => t.role || '-' },
    { header: 'MEMBERS', get: (t) => (typeof t.memberCount === 'number' ? t.memberCount : '-') },
    { header: 'DEFAULT', get: (t) => (t.isDefault ? 'yes' : '') },
    { header: 'ID', get: (t) => t.id || '-' }
  ], teams))
  console.log(`\n${teams.length} shown, ${result.totalCount} total.`)
}

function memberName (m) {
  return [m.firstName, m.lastName].filter(Boolean).join(' ')
}

function renderDetail ({ team: t }) {
  const line = (label, value) => { if (value !== undefined && value !== null && value !== '') console.log(`${label.padEnd(12)}${value}`) }
  console.log(t.name || '(unnamed team)')
  line('ID', t.id)
  if (t.role) line('Your role', t.role)
  line('Default', t.isDefault ? 'yes' : 'no')
  line('Members', t.memberCount)
  line('Created', relTime(t.createdAt))
  line('Updated', relTime(t.updatedAt))
  const members = t.members || []
  const owner = members.find((m) => m.userId === t.ownerId)
  if (owner) line('Owner', owner.email || memberName(owner))
  if (members.length) {
    console.log('')
    console.log(table([
      { header: 'NAME', get: (m) => memberName(m) || '-' },
      { header: 'EMAIL', get: (m) => m.email || '-' },
      { header: 'ROLE', get: (m) => m.role || '-' },
      { header: 'JOINED', get: (m) => relTime(m.joinedAt) }
    ], members))
  }
}

async function handle (argv, context, d) {
  try {
    const result = await doTeams(argv, d)
    if (result.mode === 'detail') {
      output(argv, result.team, () => renderDetail(result))
    } else {
      output(argv, result.result, () => renderList(result))
    }
  } catch (err) {
    return fail(argv, err, d.errio)
  }
}

module.exports = {
  flags: 'teams [uuid]',
  aliases: 'team',
  hints: '',
  desc: 'List teams you belong to, or show one team (with its members) by uuid',
  paramsDesc: 'Optional team uuid to show details for',
  run: (argv, context) => handle(argv, context, deps()),
  handle,
  doTeams,
  renderList,
  renderDetail
}
