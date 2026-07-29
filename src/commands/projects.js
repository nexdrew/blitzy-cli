'use strict'

const { deps } = require('../app')
const { output, relTime, pct, table } = require('../format')
const { mapLimit } = require('../api')
const { parseSubmodulePrs, repoFromPrUrl } = require('../gh')

// gh enrichment is one-or-more subprocess calls per PR, so cap it to the most
// recent PRs (prsFromRuns returns newest-first) to bound the cost.
const GH_ENRICH_LIMIT = 5

async function doProjects (argv, { api, gh }) {
  if (argv.uuid) {
    const full = await api.getProjectFull(argv.uuid)
    const prs = prsFromRuns(full.runs)
    // Blitzy's API doesn't expose submodule PRs; they're only in the parent PR's
    // GitHub body. Use gh to find them, unless disabled or gh isn't available.
    const useGh = !argv['no-gh'] && gh && await gh.available()
    // Mutating the sliced PR objects still updates the originals in `prs`.
    if (useGh) await attachSubmodulePrs(prs.slice(0, GH_ENRICH_LIMIT), gh)
    return { mode: 'detail', project: full.project, repos: full.repos, prs, ghUsed: !!useGh }
  }
  const result = await api.listProjectsDetailed({
    page: argv.page,
    limit: argv.limit,
    isArchived: argv.archived,
    sort: argv.sort
  })
  return { mode: 'list', result }
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
    full: org && name ? `${org}/${name}` : name || org || null,
    branch: pick.branchName || (withBranch && withBranch.branchName) || null
  }
}

// Derive the PRs associated with a project from its runs, most recent first,
// one entry per PR number.
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
    prs.push({ number: r.pr_number, link: r.pr_link, status: r.pr_status, createdAt: r.created_at })
  }
  return prs
}

function projectPercent (p) {
  const m = p.currentStatus && p.currentStatus.metering
  return m && typeof m.percentComplete === 'number' ? pct(m.percentComplete) : '-'
}

function renderList ({ result }) {
  const projects = (result && result.projects) || []
  if (!projects.length) {
    console.log('No projects found.')
    return
  }
  const text = table([
    { header: 'NAME', get: (p) => (p._error ? '(unavailable)' : p.name || '-') },
    { header: 'STATUS', get: (p) => p.status || '-' },
    { header: 'STAGE', get: (p) => (p.currentStatus && p.currentStatus.stage) || '-' },
    { header: 'DONE', get: projectPercent },
    { header: 'UPDATED', get: (p) => relTime(p.updatedAt) },
    { header: 'ID', get: (p) => p.id || '-' }
  ], projects)
  console.log(text)
  const total = result && typeof result.totalCount === 'number' ? result.totalCount : projects.length
  console.log(`\n${projects.length} shown, ${total} total${result && result.hasNextPage ? ' (more pages available)' : ''}.`)
}

// Width of the label column; the longest label ("  Lines generated") is 17 chars,
// so pad to 19 to guarantee a 2-space gap between label and value.
const LABEL_WIDTH = 19

function renderDetail ({ project: p, repos, runs, prs, ghUsed }) {
  const cs = p.currentStatus || {}
  const m = p.meteringStats || (cs.metering) || {}
  const line = (label, value) => { if (value !== undefined && value !== null && value !== '') console.log(`${label.padEnd(LABEL_WIDTH)}${value}`) }

  console.log(p.name || '(unnamed project)')
  line('ID', p.id)
  line('Status', p.status)
  line('Stage', cs.stage)
  if (cs.phase) line('Phase', cs.phase)
  line('Run status', cs.status)
  if (cs.jobType) line('Job type', cs.jobType)
  if (typeof cs.metering?.percentComplete === 'number') line('Complete', pct(cs.metering.percentComplete))
  line('Archived', p.isArchived ? 'yes' : 'no')

  console.log('\nMetering')
  line('  Lines generated', m.linesGenerated)
  line('  Lines added', m.linesAdded)
  line('  Lines edited', m.linesEdited)
  line('  Lines removed', m.linesRemoved)
  line('  Files touched', m.filesTouched)
  line('  Hours saved', m.hoursSaved)

  const repo = primaryRepo(repos)
  const prList = prs || prsFromRuns(runs)
  if (repo || prList.length) {
    console.log('\nGitHub')
    if (repo) line('  Repo', repo.full)
    if (repo && repo.branch) line('  Branch', repo.branch)
    if (prList.length) {
      console.log('  PRs')
      for (const pr of prList) {
        const label = pr.number != null ? `#${pr.number}` : 'PR'
        const bits = [pr.status, relTime(pr.createdAt)].filter((x) => x && x !== '-')
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
    } else {
      line('  PRs', 'none yet')
    }
  }

  const teams = (p.sharedTeams || []).map((t) => t.name).filter(Boolean)
  console.log('')
  if (teams.length) line('Shared with', teams.join(', '))
  line('Created', relTime(p.createdAt))
  line('Updated', relTime(p.updatedAt))
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
      .boolean('--no-gh', { desc: 'Do not use the gh CLI to look up submodule PRs' })
  },
  run: async (argv, context) => {
    try {
      const result = await doProjects(argv, deps())
      if (result.mode === 'detail') {
        const json = { ...result.project, repos: result.repos, prs: result.prs }
        output(argv, json, () => renderDetail(result))
      } else {
        output(argv, result.result, () => renderList(result))
      }
    } catch (err) {
      return context.cliMessage(err.message)
    }
  },
  doProjects,
  renderList,
  renderDetail,
  primaryRepo,
  prsFromRuns,
  GH_ENRICH_LIMIT
}
