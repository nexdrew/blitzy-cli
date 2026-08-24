'use strict'

const { test, expect } = require('bun:test')
const { captureLog, fakeContext, fakeErrio } = require('./helpers')

const login = require('../src/commands/login')
const whoami = require('../src/commands/whoami')
const logout = require('../src/commands/logout')
const usage = require('../src/commands/usage')
const rules = require('../src/commands/rules')
const envs = require('../src/commands/envs')
const teams = require('../src/commands/teams')
const projects = require('../src/commands/projects')
const download = require('../src/commands/download')

const profile = require('./fixtures/profile.json')
const usageFixture = require('./fixtures/usage.json')
const rulesList = require('./fixtures/rules-list.json')
const ruleDetail = require('./fixtures/rule-detail.json')
const envsList = require('./fixtures/envs-list.json')
const envDetail = require('./fixtures/env-detail.json')
const projectsList = require('./fixtures/projects-list.json')
const projectDetail = require('./fixtures/project-detail.json')
const teamsList = require('./fixtures/teams-list.json')
const teamRoles = require('./fixtures/team-roles.json')

// --- setup (flag definitions) ---

test('command setup() functions wire their flags without throwing', () => {
  const fakeSywac = () => {
    const s = {}
    for (const m of ['boolean', 'number', 'string']) s[m] = () => s
    return s
  }
  for (const cmd of [login, projects, download]) {
    expect(() => cmd.setup(fakeSywac())).not.toThrow()
  }
})

// --- login ---

test('login handle (token path) renders and does not error', async () => {
  const ctx = fakeContext()
  const store = { setSession: () => {}, set: () => {} }
  const api = { profile: async () => profile }
  const out = await captureLog(() => login.handle({ token: 'wtok' }, ctx, { api, store, io: { isTty: false } }))
  expect(out).toContain('Logged in as Andrew Goode')
  expect(ctx.messages).toHaveLength(0)
})

test('login handle routes errors to stderr with exit code', async () => {
  const e = fakeErrio()
  const store = { setSession: () => {}, set: () => {}, get: () => null }
  const api = { profile: async () => { throw new Error('bad token') } }
  await login.handle({ token: 'x' }, fakeContext(), { api, store, io: { isTty: false }, errio: e.io })
  expect(e.lines[0]).toBe('bad token')
  expect(e.codes[0]).toBe(1)
})

test('renderLogin falls back gracefully with a sparse profile', async () => {
  const out = await captureLog(() => login.renderLogin({ profile: { email: 'x@y.com' } }))
  expect(out).toBe('Logged in as x@y.com.')
  const bare = await captureLog(() => login.renderLogin({ profile: {} }))
  expect(bare).toContain('Blitzy')
})

// --- whoami ---

test('whoami handle renders on success', async () => {
  const ctx = fakeContext()
  const api = { profile: async () => profile }
  const out = await captureLog(() => whoami.handle({}, ctx, { api, store: { get: () => null }, env: {} }))
  expect(out).toContain('andrew.goode@livtech.com')
  expect(ctx.messages).toHaveLength(0)
})

test('whoami handle routes errors to stderr with exit code', async () => {
  const e = fakeErrio()
  const err = new Error('Not logged in. Run `blitzy login` first.')
  err.kind = 'auth'
  const api = { profile: async () => { throw err } }
  await whoami.handle({}, fakeContext(), { api, store: { get: () => null }, env: {}, errio: e.io })
  expect(e.lines[0]).toMatch(/Not logged in/)
  expect(e.codes[0]).toBe(2) // auth errors get the typed exit code
})

test('whoami handle --json emits the profile plus a session block', async () => {
  const ctx = fakeContext()
  const api = { profile: async () => profile }
  const out = await captureLog(() => whoami.handle({ json: true }, ctx, { api, store: { get: () => null }, env: {} }))
  const parsed = JSON.parse(out)
  expect(parsed.email).toBe('andrew.goode@livtech.com')
  expect(parsed.session.authenticated).toBe(true)
  expect(parsed.session.source).toBe('store')
  expect(parsed.session).toHaveProperty('workosExpiresAt')
  expect(parsed.session).toHaveProperty('platformExpiresAt')
})

// --- logout ---

test('logout handle renders result', async () => {
  const ctx = fakeContext()
  const store = { get: () => 'x', clear: () => {} }
  const out = await captureLog(() => logout.handle({}, ctx, { store, env: {} }))
  expect(out).toContain('Logged out.')
})

// --- usage ---

test('usage handle renders and errors route to stderr', async () => {
  const okOut = await captureLog(() => usage.handle({}, fakeContext(), { api: { usage: async () => usageFixture } }))
  expect(okOut).toContain('Lines generated')

  const e = fakeErrio()
  await usage.handle({}, fakeContext(), { api: { usage: async () => { throw new Error('boom') } }, errio: e.io })
  expect(e.lines[0]).toBe('boom')
  expect(e.codes[0]).toBe(1)
})

// --- rules ---

test('rules handle: list, detail, and error paths', async () => {
  const listOut = await captureLog(() => rules.handle({}, fakeContext(), { api: { listRules: async () => rulesList } }))
  expect(listOut).toContain('3 total')

  const detailOut = await captureLog(() => rules.handle({ uuid: 'x' }, fakeContext(), { api: { getRule: async () => ruleDetail } }))
  expect(detailOut).toContain('framework-neutral contract seam')

  const e = fakeErrio()
  await rules.handle({}, fakeContext(), { api: { listRules: async () => { throw new Error('nope') } }, errio: e.io })
  expect(e.lines[0]).toBe('nope')
  expect(e.codes[0]).toBe(1)
})

// --- envs ---

test('envs handle: list, detail, and error paths', async () => {
  const listOut = await captureLog(() => envs.handle({}, fakeContext(), { api: { listEnvironments: async () => envsList } }))
  expect(listOut).toContain('Alora Pilot - Linux Node')

  const detailOut = await captureLog(() => envs.handle({ uuid: 'x' }, fakeContext(), { api: { getEnvironment: async () => envDetail } }))
  expect(detailOut).toContain('Node.js 22.x LTS')

  const e = fakeErrio()
  await envs.handle({ uuid: 'x' }, fakeContext(), { api: { getEnvironment: async () => { throw new Error('gone') } }, errio: e.io })
  expect(e.lines[0]).toBe('gone')
  expect(e.codes[0]).toBe(1)
})

// --- teams ---

const teamsApi = () => ({ listTeams: async () => teamsList, listTeamRoles: async () => teamRoles })

test('teams handle: list, detail, and error paths', async () => {
  const listOut = await captureLog(() => teams.handle({}, fakeContext(), { api: teamsApi() }))
  expect(listOut).toContain('Alpha Team')
  expect(listOut).toContain('SUPER_ADMIN')
  expect(listOut).toContain('2 shown, 2 total')

  const detailOut = await captureLog(() => teams.handle({ uuid: '028eeb91-e849-4ebd-bc61-0e9083cd0ff8' }, fakeContext(), { api: teamsApi() }))
  expect(detailOut).toContain('Beta Team')
  expect(detailOut).toContain('Your role   MEMBER')
  expect(detailOut).toContain('Owner       quin.lead@example.com')
  expect(detailOut).toContain('uma.user@example.com')

  const e = fakeErrio()
  await teams.handle({}, fakeContext(), { api: { listTeams: async () => { throw new Error('nope') }, listTeamRoles: async () => teamRoles }, errio: e.io })
  expect(e.lines[0]).toBe('nope')
  expect(e.codes[0]).toBe(1)
})

test('teams detail: unknown uuid exits with the not-found code', async () => {
  const e = fakeErrio()
  await teams.handle({ uuid: 'ffffffff-0000-0000-0000-000000000000' }, fakeContext(), { api: teamsApi(), errio: e.io })
  expect(e.lines[0]).toMatch(/Team not found/)
  expect(e.codes[0]).toBe(3) // not_found errors get the typed exit code
})

test('teams tolerates a failed roles call (roles are enrichment only)', async () => {
  const api = { listTeams: async () => teamsList, listTeamRoles: async () => { throw new Error('roles down') } }
  const out = await captureLog(() => teams.handle({}, fakeContext(), { api }))
  expect(out).toContain('Alpha Team')
  expect(out).not.toContain('SUPER_ADMIN') // role column falls back to '-'
})

test('teams handle --json emits role-merged teams', async () => {
  const out = await captureLog(() => teams.handle({ json: true }, fakeContext(), { api: teamsApi() }))
  const parsed = JSON.parse(out)
  expect(parsed.totalCount).toBe(2)
  expect(parsed.teams.map((t) => t.role)).toEqual(['SUPER_ADMIN', 'MEMBER'])
})

// --- projects ---

test('projects handle: list and json detail', async () => {
  const api = {
    listProjectsDetailed: async () => Object.assign({}, projectsList, {
      projects: projectsList.projects.map((s) => Object.assign({}, projectDetail, { id: s.id }))
    })
  }
  const listOut = await captureLog(() => projects.handle({}, fakeContext(), { api, gh: null }))
  expect(listOut).toContain('AloraDL Native Port')

  const detailApi = { getProjectFull: async () => ({ project: projectDetail, repos: null, runs: null }) }
  const jsonOut = await captureLog(() => projects.handle({ uuid: 'x', json: true }, fakeContext(), { api: detailApi, gh: null }))
  expect(JSON.parse(jsonOut).name).toBe('AloraDL Native Port')
})

test('projects --teams normalizes scope tokens and passes teamIds through', async () => {
  expect(projects.normalizeTeamIds('personal, Organization ,028eeb91-e849-4ebd-bc61-0e9083cd0ff8'))
    .toBe('PERSONAL,ORGANIZATION,028eeb91-e849-4ebd-bc61-0e9083cd0ff8')
  expect(projects.normalizeTeamIds(' , ')).toBeUndefined()
  expect(projects.normalizeTeamIds(undefined)).toBeUndefined()

  let seen
  const api = { listProjectsDetailed: async (opts) => { seen = opts; return { projects: [], totalCount: 0 } } }
  await captureLog(() => projects.handle({ teams: 'personal,d1d577c3-15c8-497c-80ae-f9179f9985a7' }, fakeContext(), { api, gh: null }))
  expect(seen.teamIds).toBe('PERSONAL,d1d577c3-15c8-497c-80ae-f9179f9985a7')
})

test('projects handle routes errors to stderr with exit code', async () => {
  const e = fakeErrio()
  await projects.handle({}, fakeContext(), { api: { listProjectsDetailed: async () => { throw new Error('down') } }, gh: null, errio: e.io })
  expect(e.lines[0]).toBe('down')
  expect(e.codes[0]).toBe(1)
})

// --- download ---

const dlApi = (docs) => ({
  getProject: async () => ({ name: 'Proj' }),
  downloadDocument: async (id, doc) => {
    if (!(doc in docs)) { const e = new Error('not found'); e.status = 404; throw e }
    return { buffer: Buffer.from(docs[doc]) }
  }
})
const dlIo = () => {
  const io = { files: {}, now: () => new Date(2026, 0, 2, 3, 4), cwd: () => '/w', mkdirp: () => {}, writeFile: (p, b) => { io.files[p] = b } }
  return io
}

test('download handle --json exits 0 with structured output', async () => {
  const ctx = fakeContext()
  const api = dlApi({ project_guide: '# g' })
  const out = await captureLog(() => download.handle({ uuid: 'abcdabcd-0000-0000-0000-000000000000', guide: true, json: true }, ctx, { api, io: dlIo() }))
  const parsed = JSON.parse(out)
  expect(parsed.saved.length + parsed.skipped.length).toBeGreaterThan(0)
  expect(ctx.messages).toHaveLength(0)
})

test('download handle exits non-zero via stderr when nothing saved', async () => {
  const e = fakeErrio()
  const api = dlApi({}) // nothing available -> all skipped
  await download.handle({ uuid: 'abcdabcd-0000-0000-0000-000000000000', guide: true }, fakeContext(), { api, io: dlIo(), errio: e.io })
  expect(e.lines).toHaveLength(1)
  expect(e.lines[0]).toMatch(/skipped guide/)
  expect(e.codes[0]).toBe(1)
})

test('download handle prints normally when something saved', async () => {
  const ctx = fakeContext()
  const api = dlApi({ project_guide: '# guide' })
  const out = await captureLog(() => download.handle({ uuid: 'abcdabcd-0000-0000-0000-000000000000', guide: true }, ctx, { api, io: dlIo() }))
  expect(out).toContain('Downloaded to')
  expect(ctx.messages).toHaveLength(0)
})

test('download handle routes unexpected errors to stderr', async () => {
  const e = fakeErrio()
  const api = dlApi({ project_guide: '# g' })
  const io = dlIo()
  io.mkdirp = () => { throw new Error('EACCES: mkdir failed') }
  await download.handle({ uuid: 'abcdabcd-0000-0000-0000-000000000000', guide: true }, fakeContext(), { api, io, errio: e.io })
  expect(e.lines[0]).toMatch(/mkdir failed/)
  expect(e.codes[0]).toBe(1)
})

test('renderDownload prints the formatted result', async () => {
  const out = await captureLog(() => download.renderDownload({
    dir: '/w/proj', saved: [{ path: '/w/proj/x.md', bytes: 10 }], skipped: []
  }))
  expect(out).toContain('Downloaded to /w/proj:')
})

// --- render edge cases (empty lists / no PRs) ---

test('empty-list renders say so', async () => {
  expect(await captureLog(() => rules.renderList({ result: { rules: [] } }))).toContain('No rules found.')
  expect(await captureLog(() => envs.renderList({ result: { environments: [] } }))).toContain('No environments found.')
  expect(await captureLog(() => teams.renderList({ result: { teams: [], totalCount: 0 } }))).toContain('No teams found.')
  expect(await captureLog(() => projects.renderList({ result: { projects: [] } }))).toContain('No projects found.')
})

test('project detail renders "none yet" when the repo has no PRs', async () => {
  const out = await captureLog(() => projects.renderDetail({
    project: projectDetail,
    repos: [{ type: 'TARGET', orgName: 'o', repoName: 'r', branchName: 'main' }],
    prs: []
  }))
  expect(out).toContain('none yet')
})
