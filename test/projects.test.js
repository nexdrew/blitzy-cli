'use strict'

// Project list and detail output added after the 2026-11 API audit: flags,
// sharing, provider names, per-PR metering, attached environments and rules,
// the tech spec, and run progress.

const { test, expect } = require('bun:test')
const { BlitzyApi } = require('../src/api')
const { Store } = require('../src/store')
const { MemBacking, routeClient, makeJwt, captureLog, fakeContext } = require('./helpers')
const projects = require('../src/commands/projects')

const projectDetail = require('./fixtures/project-detail.json')
const projectRepos = require('./fixtures/project-repos.json')
const projectRuns = require('./fixtures/project-runs.json')
const projectsList = require('./fixtures/projects-list.json')
const projectEnvs = require('./fixtures/project-environments.json')
const projectRules = require('./fixtures/project-rules.json')
const techSpec = require('./fixtures/tech-spec-latest.json')
const ingestion = require('./fixtures/ingestion-progress.json')
const codeGen = require('./fixtures/code-gen.json')
const codeGenProgress = require('./fixtures/code-gen-progress.json')
const teamsList = require('./fixtures/teams-list.json')

const ID = '50930af1-5165-41e6-89a3-7d4445ba4593'
const futureJwt = () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
const ok = (body) => ({ status: 200, body })

// A real BlitzyApi over a route table. `project` overrides fields of the detail.
function setup ({ project = {}, routes = {} } = {}) {
  const detail = Object.assign({}, projectDetail, project)
  const client = routeClient(Object.assign({
    'POST /auth': ok({ access_token: futureJwt() }),
    'GET /github/repos': ok(projectRepos),
    'GET /runs/metering': ok(projectRuns),
    [`GET /project/${ID}/environments`]: ok(projectEnvs),
    [`GET /projects/${ID}/rules`]: ok(projectRules),
    'GET /tech-spec/latest': ok(techSpec),
    'GET /projects/': ok(detail)
  }, routes))
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  return { api: new BlitzyApi({ client, store, env: {} }), client }
}

const detailOut = async (opts, argv = {}) => {
  const { api, client } = setup(opts)
  const result = await projects.doProjects(Object.assign({ uuid: ID }, argv), { api, gh: opts && opts.gh })
  return { result, client, out: await captureLog(() => projects.renderDetail(result)) }
}

// --- detail: status, flags, sharing ---

test('detail does not print the constant project status', async () => {
  const { out } = await detailOut()
  expect(out).not.toContain('GITHUB_COMPLETED')
  expect(out).toMatch(/^Stage +CODEGEN$/m)
  expect(out).toMatch(/^Run status +DONE$/m)
})

test('detail prints a flag line only when the flag is set', async () => {
  const plain = (await detailOut()).out
  for (const label of ['Locked', 'Demo', 'Access', 'Disabled']) expect(plain).not.toMatch(new RegExp(`^${label} `, 'm'))

  const { out } = await detailOut({ project: { isLocked: true, isDemo: true, isViewOnly: true, isDisabled: true, disableReason: 'Subscription ended' } })
  expect(out).toMatch(/^Locked +yes$/m)
  expect(out).toMatch(/^Demo +yes$/m)
  expect(out).toMatch(/^Access +view only$/m)
  expect(out).toMatch(/^Disabled +Subscription ended$/m)
})

test('projectSharing: organization, teams, private, and no data', () => {
  const teams = [{ name: 'Alpha Team' }, { name: 'Beta Team' }]
  expect(projects.projectSharing({ sharedWithCompany: true, sharedTeams: teams })).toBe('Organization, Alpha Team, Beta Team')
  expect(projects.projectSharing({ sharedWithCompany: false, sharedTeams: teams })).toBe('Alpha Team, Beta Team')
  expect(projects.projectSharing({ sharedWithCompany: false, sharedTeams: [] })).toBe('Private')
  expect(projects.projectSharing({ name: 'old shape' })).toBe('')
})

test('detail prints metering with thousands separators', async () => {
  const { out } = await detailOut()
  expect(out).toMatch(/^ {2}Lines generated +1,627$/m)
})

// --- detail: provider ---

test('detail names the provider from svcType and uses displayPath', async () => {
  const azure = [{ type: 'TARGET', svcType: 'AZURE_DEVOPS', displayPath: 'contoso/Billing/_git/api', orgName: 'contoso', repoName: 'api', branchName: 'main' }]
  const { out } = await detailOut({ routes: { 'GET /github/repos': ok(azure) } })
  expect(out).toContain('\nAzure DevOps\n')
  expect(out).toMatch(/^ {2}Repo +contoso\/Billing\/_git\/api$/m)
  expect(out).not.toContain('\nGitHub\n')
})

test('providerName covers every provider code and has safe fallbacks', () => {
  const name = (svcType) => projects.providerName({ svcType }, [])
  expect(['GITHUB', 'GITHUB_ENTERPRISE_SERVER', 'GITLAB', 'GITLAB_SELF_HOSTED', 'BITBUCKET_CLOUD', 'BITBUCKET_DC', 'AZURE_DEVOPS', 'AZURE_DEVOPS_SERVER'].map(name))
    .toEqual(['GitHub', 'GitHub Enterprise Server', 'GitLab', 'GitLab Self-Managed', 'Bitbucket', 'Bitbucket Data Center', 'Azure DevOps', 'Azure DevOps Server'])
  expect(name('SOMETHING_NEW')).toBe('Source control')
  // no repo entry: a github.com PR link still means GitHub
  expect(projects.providerName(null, [{ link: 'https://github.com/o/r/pull/1' }])).toBe('GitHub')
  expect(projects.providerName(null, [{ link: 'https://dev.azure.com/o/p/_git/r/pullrequest/1' }])).toBe('Source control')
})

test('gh is not called for a project on another provider', async () => {
  const gh = {
    available: async () => { throw new Error('available() should not be called') },
    authenticated: async () => { throw new Error('authenticated() should not be called') },
    prView: async () => { throw new Error('prView() should not be called') }
  }
  const gitlab = [{ type: 'TARGET', svcType: 'GITLAB', orgName: 'group', repoName: 'app', branchName: 'main' }]
  const { result, out } = await detailOut({ routes: { 'GET /github/repos': ok(gitlab) }, gh })
  expect(result.gh.enabled).toBe(false)
  expect(result.ghUsed).toBe(false)
  expect(out).toContain('\nGitLab\n')
  expect(out).not.toContain('gh installed')
})

// --- detail: per-PR metering ---

test('each PR keeps the type and metering of its most recent run', () => {
  const prs = projects.prsFromRuns({
    runs: [
      { created_at: 1, pr_number: 7, pr_link: 'u', pr_status: 'PENDING', run_type: 'REFACTOR_CODE', metering: { linesGenerated: 100, filesTouched: 4 } },
      { created_at: 2, pr_number: 7, pr_link: 'u', pr_status: 'MERGED', run_type: 'REFINE_PR', metering: { linesGenerated: 250, filesTouched: 9 } }
    ]
  })
  expect(prs).toEqual([{ number: 7, link: 'u', status: 'MERGED', createdAt: 2, runType: 'REFINE_PR', metering: { linesGenerated: 250, filesTouched: 9 } }])
})

test('detail prints the lines and files of each PR on the PR line', async () => {
  const { out } = await detailOut()
  expect(out).toMatch(/#19 {2}\(PENDING, [^)]*, 1,627 lines, 22 files\) {2}https:\/\/github\.com\//)
  expect(out).toMatch(/#18 {2}\(MERGED, [^)]*, 5,110 lines, 61 files\)/)
})

test('a PR without metering prints as before', async () => {
  const runs = { runs: [{ created_at: 1, pr_number: 3, pr_link: 'https://github.com/o/r/pull/3', pr_status: 'MERGED' }] }
  const out = await captureLog(() => projects.renderDetail({ project: projectDetail, repos: null, runs }))
  expect(out).toMatch(/#3 {2}\(MERGED, [^,)]*\) {2}https/)
})

// --- detail: environments, rules, tech spec ---

test('detail lists the attached environments in priority order, and the rules', async () => {
  const { out } = await detailOut()
  expect(out).toContain('\nEnvironments\n  1. Windows Base (rev 7)  bbbbbbbb-0000-4000-8000-000000000001\n  2. Linux Node (rev 2)  4cd123bf-54b5-4857-a0b1-2a18696c55bb\n')
  expect(out).toContain('\nRules\n  Locale and Time Zone Independent Tests  12775763-a828-4fd7-8403-9bfe9f898565\n')
})

test('detail shows the tech spec version and state', async () => {
  const { out } = await detailOut()
  expect(out).toContain('\nTech spec\n')
  expect(out).toMatch(/^ {2}Version +4$/m)
  expect(out).toMatch(/^ {2}Status +DONE$/m)
})

test('detail still renders when every auxiliary call fails', async () => {
  const down = { status: 500, body: { error: 'down' } }
  const { result, out } = await detailOut({
    routes: {
      'GET /github/repos': down,
      'GET /runs/metering': down,
      [`GET /project/${ID}/environments`]: down,
      [`GET /projects/${ID}/rules`]: down,
      'GET /tech-spec/latest': down
    }
  })
  expect([result.repos, result.runs, result.environments, result.rules, result.techSpec, result.progress]).toEqual([null, null, null, null, null, null])
  expect(out).toContain('AloraDL Native Port')
  for (const block of ['Environments', 'Rules', 'Tech spec', 'GitHub']) expect(out).not.toContain(`\n${block}\n`)
})

// --- detail: run progress ---

const running = (stage) => ({ currentStatus: Object.assign({}, projectDetail.currentStatus, { stage, status: 'IN_PROGRESS' }) })

test('no progress call is made for a run that is DONE', async () => {
  const { result, client } = await detailOut()
  expect(result.progress).toBe(null)
  expect(client.countOf('GET', '/ingestion-progress')).toBe(0)
  expect(client.countOf('GET', '/code-gen')).toBe(0)
})

test('a tech spec run in progress shows the ingestion progress', async () => {
  const { result, out } = await detailOut({ project: running('TECH_SPEC'), routes: { 'GET /ingestion-progress': ok(ingestion) } })
  expect(result.progress.stage).toBe('TECH_SPEC')
  expect(out).toContain('\nTech spec progress\n')
  expect(out).toMatch(/^ {2}Step +SECURITY_SCANNING$/m)
  expect(out).toMatch(/^ {2}Files +1,204 \/ 5,310$/m)
  expect(out).toMatch(/^ {2}Lines +310,455$/m)
})

test('a code generation in progress shows its stages and percent', async () => {
  const { result, client, out } = await detailOut({
    project: running('CODEGEN'),
    routes: {
      [`GET /tech-spec/${techSpec.id}/code-gen`]: ok(codeGen),
      [`GET /code-gen/${codeGen.id}/progress`]: ok(Object.assign({}, codeGenProgress, { estimated_time_remaining: 'value from the API' }))
    }
  })
  expect(result.progress.stage).toBe('CODEGEN')
  expect(client.countOf('GET', `/code-gen/${codeGen.id}/progress`)).toBe(1)
  expect(out).toContain('\nCode generation progress\n')
  expect(out).toMatch(/^ {2}Complete +42\.5%$/m)
  expect(out).toMatch(/^ {2}Time remaining +value from the API$/m)
  expect(out).toMatch(/^ {2}Scoping changes +DONE$/m)
  expect(out).toMatch(/^ {2}Managing dependencies +DONE$/m)
  expect(out).toMatch(/^ {2}Code generation +IN_PROGRESS$/m)
  expect(out).toMatch(/^ {2}Qa +PENDING$/m)
})

test('progress is left out when Blitzy gives none', async () => {
  // no code-gen route: the stub answers 404, like a tech spec without a code generation
  const { result, out } = await detailOut({ project: running('CODEGEN') })
  expect(result.progress).toBe(null)
  expect(out).not.toContain('progress')
})

test('a failed run prints the error text', async () => {
  const out = await captureLog(() => projects.renderProgress({
    stage: 'CODEGEN',
    codeGen: { status: 'FAILED', failure_reason: 'Build did not pass' },
    codeGenProgress: null
  }))
  expect(out).toMatch(/^ {2}Status +FAILED$/m)
  expect(out).toMatch(/^ {2}Error +Build did not pass$/m)
})

// --- detail: --json ---

test('detail --json adds environments, rules, techSpec, and progress', async () => {
  const { api } = setup()
  const out = await captureLog(() => projects.handle({ uuid: ID, json: true, 'no-gh': true }, fakeContext(), { api, gh: null }))
  const json = JSON.parse(out)
  expect(json.status).toBe('GITHUB_COMPLETED') // raw fields stay in the JSON
  expect(json.environments.map((e) => e.name)).toEqual(['Linux Node', 'Windows Base'])
  expect(json.rules).toHaveLength(2)
  expect(json.techSpec.version).toBe(4)
  expect(json.progress).toBe(null)
  expect(json.prs[0].metering.linesGenerated).toBe(1627)
})

// --- list ---

const listOf = (items) => ({ result: { projects: items, totalCount: items.length } })

test('list shows a FLAGS column only when a project has a flag', async () => {
  const plain = await captureLog(() => projects.renderList(listOf([projectDetail])))
  expect(plain).not.toContain('FLAGS')

  const flagged = [projectDetail, Object.assign({}, projectDetail, { name: 'Locked one', isLocked: true, isViewOnly: true }), Object.assign({}, projectDetail, { name: 'Demo one', isDemo: true })]
  const out = await captureLog(() => projects.renderList(listOf(flagged)))
  expect(out.split('\n')[0]).toMatch(/DONE\s+FLAGS\s+UPDATED/)
  expect(out).toMatch(/Locked one .*locked, view-only/)
  expect(out).toMatch(/Demo one .*demo/)
})

test('an empty list names the --teams ids that are not the user\'s teams', async () => {
  const { api } = setup({ routes: { 'GET /projects': ok({ projects: [], totalCount: 0, page: 1, hasNextPage: false }), 'GET /user/team': ok(teamsList) } })
  const known = teamsList.teams[0].id
  const result = await projects.doProjects({ teams: `${known},ffffffff-0000-0000-0000-000000000000,personal` }, { api })
  expect(result.unknownTeams).toEqual(['ffffffff-0000-0000-0000-000000000000'])
  const out = await captureLog(() => projects.renderList(result))
  expect(out).toContain('No projects found.')
  expect(out).toContain('Note: ffffffff-0000-0000-0000-000000000000 is not one of your teams.')
  expect(out).not.toContain(known)
})

test('no team hint when the team list is not available, or when projects were found', async () => {
  const empty = ok({ projects: [], totalCount: 0, page: 1, hasNextPage: false })
  const noTeams = setup({ routes: { 'GET /projects': empty } }) // /user/team answers 404
  expect((await projects.doProjects({ teams: 'ffffffff-0000-0000-0000-000000000000' }, { api: noTeams.api })).unknownTeams).toEqual([])

  const found = setup({ routes: { 'GET /projects': ok(projectsList), 'GET /user/team': ok(teamsList) } })
  const result = await projects.doProjects({ teams: 'ffffffff-0000-0000-0000-000000000000' }, { api: found.api })
  expect(result.unknownTeams).toEqual([])
  expect(found.client.countOf('GET', '/user/team')).toBe(0)
})
