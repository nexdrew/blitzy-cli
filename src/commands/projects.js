'use strict'

const { deps } = require('../app')
const { output, relTime, pct, num, table } = require('../format')
const { mapLimit } = require('../api')
const { parseSubmodulePrs, repoFromPrUrl } = require('../gh')
const { teamNames } = require('./teams')
const { fail } = require('../errors')

// gh enrichment is one-or-more subprocess calls per PR, so cap it to the most
// recent PRs (prsFromRuns returns newest-first) to bound the cost.
const GH_ENRICH_LIMIT = 5

// Display names for the `svcType` codes of the source-control providers.
const PROVIDERS = {
  GITHUB: 'GitHub',
  GITHUB_ENTERPRISE_SERVER: 'GitHub Enterprise Server',
  GITLAB: 'GitLab',
  GITLAB_SELF_HOSTED: 'GitLab Self-Managed',
  BITBUCKET_CLOUD: 'Bitbucket',
  BITBUCKET_DC: 'Bitbucket Data Center',
  AZURE_DEVOPS: 'Azure DevOps',
  AZURE_DEVOPS_SERVER: 'Azure DevOps Server'
}

async function doProjects (argv, { api, gh }) {
  if (argv.uuid) {
    const full = await api.getProjectFull(argv.uuid)
    const prs = prsFromRuns(full.runs)
    // Blitzy's API doesn't expose submodule PRs; they're only in the parent PR's
    // GitHub body. Use gh to find them, unless disabled, missing, or logged out.
    // gh works for GitHub only, so skip it for a project on another provider.
    const repo = primaryRepo(full.repos)
    const onGithub = !repo || !repo.svcType || repo.svcType === 'GITHUB'
    const enabled = !argv['no-gh'] && !!gh && onGithub
    const available = enabled ? await gh.available() : null
    const authenticated = available === true ? await gh.authenticated() : null
    const useGh = authenticated === true
    // Mutating the sliced PR objects still updates the originals in `prs`.
    if (useGh) await attachSubmodulePrs(prs.slice(0, GH_ENRICH_LIMIT), gh)
    const ghMeta = {
      enabled,
      available,
      authenticated,
      used: useGh,
      truncatedAt: useGh && prs.length > GH_ENRICH_LIMIT ? GH_ENRICH_LIMIT : null
    }
    return Object.assign({ mode: 'detail' }, full, { prs, gh: ghMeta, ghUsed: useGh })
  }
  const teamIds = normalizeTeamIds(argv.teams)
  const result = await api.listProjectsDetailed({
    page: argv.page,
    limit: argv.limit,
    isArchived: argv.archived,
    sort: argv.sort,
    teamIds
  })
  // The server accepts an unknown team id and returns an empty list with no
  // error. When the list is empty, name the ids that are not the user's teams.
  const empty = !((result && result.projects) || []).length
  const unknownTeams = empty && teamIds ? await unknownTeamIds(api, teamIds) : []
  return { mode: 'list', result, unknownTeams }
}

// The API's teamIds filter takes team uuids plus the synthetic scopes PERSONAL
// (unshared, owner-only projects) and ORGANIZATION (company-shared projects),
// uppercase. Uppercase those two tokens so `--teams personal` works; anything
// else passes through verbatim and the server stays the validator.
function normalizeTeamIds (teams) {
  if (typeof teams !== 'string') return undefined
  const ids = teams.split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (/^(personal|organization)$/i.test(t) ? t.toUpperCase() : t))
  return ids.length ? ids.join(',') : undefined
}

// Team ids from a --teams filter that are not in the user's team list. Returns
// [] when the team list is not available, so a lookup failure gives no false hint.
async function unknownTeamIds (api, teamIds) {
  const names = await teamNames(api)
  if (!names.size) return []
  return teamIds.split(',').filter((t) => t !== 'PERSONAL' && t !== 'ORGANIZATION' && !names.has(t))
}

// For each parent PR, read its GitHub body via gh, parse the "Submodule PR
// created: <url>" lines, and best-effort fetch each submodule PR's state. Any
// gh failure for a given PR is swallowed so the detail view still renders.
async function attachSubmodulePrs (prs, gh) {
  await mapLimit(prs, 4, async (pr) => {
    const parent = repoFromPrUrl(pr.link)
    if (!parent) return
    let body
    try {
      body = (await gh.prView(parent.repo, pr.number, ['body'])).body
    } catch {
      return
    }
    const subs = parseSubmodulePrs(body)
    await mapLimit(subs, 4, async (sub) => {
      try {
        sub.state = (await gh.prView(sub.repo, sub.number, ['state'])).state
      } catch { /* leave state undefined */ }
    })
    pr.submodules = subs
  })
}

// Pick the repo a PR would target: prefer TARGET, then SOURCE, then whatever's first.
function primaryRepo (repos) {
  if (!Array.isArray(repos) || !repos.length) return null
  const pick = repos.find((r) => r.type === 'TARGET') || repos.find((r) => r.type === 'SOURCE') || repos[0]
  const org = pick.orgName || pick.org
  const name = pick.repoName || pick.repo
  // The TARGET entry often has an empty branch; fall back to any entry that has one.
  const withBranch = repos.find((r) => r.branchName)
  return {
    // `displayPath` is the provider's own path (for example an Azure DevOps
    // project path); it is empty for GitHub.
    full: pick.displayPath || (org && name ? `${org}/${name}` : name || org || null),
    branch: pick.branchName || (withBranch && withBranch.branchName) || null,
    svcType: pick.svcType || null
  }
}

// Heading for the repo and PR block: the provider name when the API gives one.
// Without a repo entry, a github.com PR link still means GitHub.
function providerName (repo, prs) {
  if (repo && repo.svcType) return PROVIDERS[repo.svcType] || 'Source control'
  return (prs || []).some((pr) => repoFromPrUrl(pr.link)) ? 'GitHub' : 'Source control'
}

// Derive the PRs associated with a project from its runs, most recent first,
// one entry per PR number. Each PR keeps the type and metering of its most
// recent run.
function prsFromRuns (runs) {
  const list = (runs && runs.runs) || []
  const sorted = list
    .filter((r) => r.pr_number != null || r.pr_link)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  const seen = new Set()
  const prs = []
  for (const r of sorted) {
    const key = r.pr_number != null ? String(r.pr_number) : r.pr_link
    if (seen.has(key)) continue
    seen.add(key)
    prs.push({
      number: r.pr_number,
      link: r.pr_link,
      status: r.pr_status,
      createdAt: r.created_at,
      runType: r.run_type || null,
      metering: r.metering || null
    })
  }
  return prs
}

function projectPercent (p) {
  const m = p.currentStatus && p.currentStatus.metering
  return m && typeof m.percentComplete === 'number' ? pct(m.percentComplete) : '-'
}

// Short markers for the list: locked, demo, view-only, disabled.
function projectFlags (p) {
  const flags = []
  if (p.isLocked) flags.push('locked')
  if (p.isDemo) flags.push('demo')
  if (p.isViewOnly) flags.push('view-only')
  if (p.isDisabled) flags.push('disabled')
  return flags.join(', ')
}

function renderList ({ result, unknownTeams }) {
  const projects = (result && result.projects) || []
  if (!projects.length) {
    console.log('No projects found.')
    for (const id of unknownTeams || []) {
      console.log(`Note: ${id} is not one of your teams. Run \`blitzy teams\` to see your teams.`)
    }
    return
  }
  const columns = [
    { header: 'NAME', get: (p) => (p._error ? '(unavailable)' : p.name || '-') },
    // `p.status` is the same value (GITHUB_COMPLETED) for every project, so the
    // list shows the status of the current run instead (DONE, IN_PROGRESS, ...).
    { header: 'STAGE', get: (p) => (p.currentStatus && p.currentStatus.stage) || '-' },
    { header: 'RUN STATUS', get: (p) => (p.currentStatus && p.currentStatus.status) || '-' },
    { header: 'DONE', get: projectPercent },
    { header: 'UPDATED', get: (p) => relTime(p.updatedAt) },
    { header: 'ID', get: (p) => p.id || '-' }
  ]
  // Most projects have no flag, so show the column only when one does.
  if (projects.some(projectFlags)) columns.splice(4, 0, { header: 'FLAGS', get: projectFlags })
  console.log(table(columns, projects))
  const total = result && typeof result.totalCount === 'number' ? result.totalCount : projects.length
  console.log(`\n${projects.length} shown, ${total} total${result && result.hasNextPage ? ' (more pages available)' : ''}.`)
}

// Width of the label column; the longest label ("  Lines generated") is 17 chars,
// so pad to 19 to guarantee a 2-space gap between label and value. The progress
// blocks have longer labels ("  Managing dependencies", 23 chars).
const LABEL_WIDTH = 19
const PROGRESS_LABEL_WIDTH = 25

// Who the project is shared with: Organization, team names, or Private. Returns
// '' when the API gave no sharing data.
function projectSharing (p) {
  const teams = (p.sharedTeams || []).map((t) => t.name).filter(Boolean)
  const names = (p.sharedWithCompany ? ['Organization'] : []).concat(teams)
  if (names.length) return names.join(', ')
  return 'sharedWithCompany' in p || Array.isArray(p.sharedTeams) ? 'Private' : ''
}

// "Scoping changes" from SCOPING_CHANGES.
function humanize (code) {
  const s = String(code || '').toLowerCase().replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// A count for a run that is in progress, such as "1,204 / 5,310".
function ofTotal (done, total) {
  if (typeof done !== 'number') return null
  return typeof total === 'number' ? `${num(done)} / ${num(total)}` : num(done)
}

function renderProgress (progress) {
  if (!progress) return
  const line = (label, value) => { if (value !== undefined && value !== null && value !== '') console.log(`${label.padEnd(PROGRESS_LABEL_WIDTH)}${value}`) }
  if (progress.stage === 'TECH_SPEC' && progress.ingestion) {
    const g = progress.ingestion
    console.log('\nTech spec progress')
    line('  Status', g.status)
    line('  Phase', g.phase)
    line('  Step', g.progress_stage)
    line('  Files', ofTotal(g.files_processed, g.total_files))
    if (typeof g.lines_processed === 'number') line('  Lines', num(g.lines_processed))
    line('  Error', g.error_message)
  }
  if (progress.stage === 'CODEGEN' && (progress.codeGen || progress.codeGenProgress)) {
    const c = progress.codeGen || {}
    const g = progress.codeGenProgress || {}
    console.log('\nCode generation progress')
    line('  Status', c.status)
    line('  Run type', g.project_run_type)
    if (typeof g.execution_percent_complete === 'number') line('  Complete', pct(g.execution_percent_complete))
    // Blitzy does not document the unit of this value, so print it as given.
    line('  Time remaining', g.estimated_time_remaining)
    for (const [stage, status] of Object.entries(g.stages || {})) line(`  ${humanize(stage)}`, status)
    line('  Error', g.error_message || c.failure_reason)
  }
}

function renderDetail ({ project: p, repos, runs, prs, environments, rules, techSpec, progress, gh, ghUsed }) {
  const cs = p.currentStatus || {}
  const m = p.meteringStats || (cs.metering) || {}
  const line = (label, value) => { if (value !== undefined && value !== null && value !== '') console.log(`${label.padEnd(LABEL_WIDTH)}${value}`) }
  const count = (label, n) => { if (typeof n === 'number') line(label, num(n)) }

  console.log(p.name || '(unnamed project)')
  line('ID', p.id)
  line('Stage', cs.stage)
  if (cs.phase) line('Phase', cs.phase)
  line('Run status', cs.status)
  if (cs.jobType) line('Job type', cs.jobType)
  if (typeof cs.metering?.percentComplete === 'number') line('Complete', pct(cs.metering.percentComplete))
  line('Archived', p.isArchived ? 'yes' : 'no')
  if (p.isLocked) line('Locked', 'yes')
  if (p.isDemo) line('Demo', 'yes')
  if (p.isViewOnly) line('Access', 'view only')
  if (p.isDisabled) line('Disabled', p.disableReason || 'yes')

  console.log('\nMetering')
  count('  Lines generated', m.linesGenerated)
  count('  Lines added', m.linesAdded)
  count('  Lines edited', m.linesEdited)
  count('  Lines removed', m.linesRemoved)
  count('  Files touched', m.filesTouched)
  count('  Hours saved', m.hoursSaved)

  if (techSpec && (techSpec.version != null || techSpec.status)) {
    console.log('\nTech spec')
    line('  Version', techSpec.version)
    line('  Status', techSpec.status)
    line('  Job type', techSpec.jobType)
    if (techSpec.updatedAt != null) line('  Updated', relTime(techSpec.updatedAt))
  }
  renderProgress(progress)

  const repo = primaryRepo(repos)
  const prList = prs || prsFromRuns(runs)
  if (repo || prList.length) {
    console.log(`\n${providerName(repo, prList)}`)
    if (repo) line('  Repo', repo.full)
    if (repo && repo.branch) line('  Branch', repo.branch)
    if (prList.length) {
      console.log('  PRs')
      for (const pr of prList) {
        const label = pr.number != null ? `#${pr.number}` : 'PR'
        const pm = pr.metering || {}
        const bits = [
          pr.status,
          relTime(pr.createdAt),
          typeof pm.linesGenerated === 'number' ? `${num(pm.linesGenerated)} lines` : null,
          typeof pm.filesTouched === 'number' ? `${num(pm.filesTouched)} files` : null
        ].filter((x) => x && x !== '-')
        const suffix = bits.length ? `  (${bits.join(', ')})` : ''
        console.log(`    ${label}${suffix}${pr.link ? `  ${pr.link}` : ''}`)
        for (const sub of pr.submodules || []) {
          const s = sub.state ? ` (${sub.state})` : ''
          console.log(`      submodule ${sub.repo}#${sub.number}${s}  ${sub.url}`)
        }
      }
      if (ghUsed && prList.length > GH_ENRICH_LIMIT) {
        console.log(`    (submodule PRs looked up for the ${GH_ENRICH_LIMIT} most recent PRs only)`)
      }
      if (gh && gh.enabled && gh.available && gh.authenticated === false) {
        console.log('    (gh installed but not authenticated — submodule PRs not looked up; run `gh auth login`)')
      }
    } else {
      line('  PRs', 'none yet')
    }
  }

  // Environments in priority order: position 1 is the highest priority.
  const envs = ((environments && environments.environments) || []).slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0))
  if (envs.length) {
    console.log('\nEnvironments')
    for (const e of envs) {
      const rev = e.revision != null ? ` (rev ${e.revision})` : ''
      console.log(`  ${e.position != null ? `${e.position}. ` : ''}${e.name || '-'}${rev}  ${e.id || ''}`.trimEnd())
    }
  }
  const ruleList = (rules && rules.rules) || []
  if (ruleList.length) {
    console.log('\nRules')
    for (const r of ruleList) console.log(`  ${r.name || '-'}  ${r.id || ''}`.trimEnd())
  }

  console.log('')
  line('Shared with', projectSharing(p))
  line('Created', relTime(p.createdAt))
  line('Updated', relTime(p.updatedAt))
}

async function handle (argv, context, d) {
  try {
    const result = await doProjects(argv, d)
    if (result.mode === 'detail') {
      const json = {
        ...result.project,
        repos: result.repos,
        runs: result.runs,
        prs: result.prs,
        environments: result.environments ? result.environments.environments : null,
        rules: result.rules ? result.rules.rules : null,
        techSpec: result.techSpec || null,
        progress: result.progress || null,
        gh: result.gh
      }
      output(argv, json, () => renderDetail(result))
    } else {
      output(argv, result.result, () => renderList(result))
    }
  } catch (err) {
    return fail(argv, err, d.errio)
  }
}

module.exports = {
  flags: 'projects [uuid]',
  aliases: 'project',
  hints: '',
  desc: 'List projects, or show details for one by uuid',
  paramsDesc: 'Optional project uuid to show details for',
  setup: (sywac) => {
    sywac
      .boolean('--archived', { desc: 'List archived projects instead of active ones' })
      .number('--limit <n>', { desc: 'Projects per page', defaultValue: 50 })
      .number('--page <n>', { desc: 'Page number', defaultValue: 1 })
      .string('--sort <field>', { desc: 'Sort field', defaultValue: '-updatedAt' })
      .string('--teams <ids>', { desc: 'Filter by comma-delimited team uuids and/or PERSONAL, ORGANIZATION' })
      .boolean('--no-gh', { desc: 'Do not use the gh CLI to look up submodule PRs' })
  },
  run: (argv, context) => handle(argv, context, deps()),
  handle,
  doProjects,
  renderList,
  renderDetail,
  renderProgress,
  primaryRepo,
  providerName,
  prsFromRuns,
  projectFlags,
  projectSharing,
  normalizeTeamIds,
  GH_ENRICH_LIMIT
}
