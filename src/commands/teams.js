'use strict'

const { deps } = require('../app')
const { output, relTime, table } = require('../format')
const { fail } = require('../errors')

// Team id -> name, for commands that show which teams something is shared
// with. Enrichment only: on any failure the map is empty and callers show ids.
async function teamNames (api) {
  try {
    const result = await api.listTeams()
    return new Map(((result && result.teams) || []).map((t) => [t.id, t.name]))
  } catch {
    return new Map()
  }
}

// List mode reads /user/team: every team the user belongs to, unpaginated and
// without members. Detail mode reads one team, with its members, from
// /teams/<uuid>. The user's own role per team comes from a second, auxiliary
// call and is merged in; its failure only blanks the role, never the command.
async function doTeams (argv, { api }) {
  const [result, roles] = await Promise.all([
    argv.uuid ? getTeam(api, argv.uuid) : api.listTeams(),
    api.listTeamRoles().catch(() => null)
  ])
  const roleByTeam = new Map((Array.isArray(roles) ? roles : []).map((r) => [r.teamId, r.role]))
  const withRole = (t) => Object.assign({}, t, { role: roleByTeam.get(t.id) || null })
  if (argv.uuid) return { mode: 'detail', team: withRole(result) }
  const teams = ((result && result.teams) || []).map(withRole)
  const totalCount = result && typeof result.totalCount === 'number' ? result.totalCount : teams.length
  return { mode: 'list', result: { teams, totalCount } }
}

// The API answers 403 (not 404) for a team uuid that does not exist or that the
// user cannot access, so report both as "not found".
async function getTeam (api, id) {
  try {
    return await api.getTeam(id)
  } catch (err) {
    if (err.status !== 403 && err.status !== 404) throw err
    const notFound = new Error(`Team not found or not accessible: ${id}`)
    notFound.kind = 'not_found'
    throw notFound
  }
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
  teamNames,
  renderList,
  renderDetail
}
