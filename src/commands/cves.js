'use strict'

const { deps } = require('../app')
const { output, relTimeIso, num, table } = require('../format')
const { fail } = require('../errors')

// Longest finding title shown in the table; the API has titles of 100+ chars.
const TITLE_WIDTH = 70

// Blitzy calls this feature Proactive Insights. Without an argument, list the
// repository branches that have a scan. With a branch id, list the findings of
// that branch. The filters go to the server as they are; the server validates
// them (an unknown sort field gives HTTP 400, an unknown branch gives 404).
async function doCves (argv, { api }) {
  if (argv.uuid) {
    const result = await api.listCveFindings(argv.uuid, {
      severity: listArg(argv.severity),
      reachability: listArg(argv.reachability),
      isKev: argv.kev ? true : undefined,
      search: argv.search || undefined,
      sort: argv.sort,
      page: argv.page,
      pageSize: argv.limit
    })
    return { mode: 'findings', result }
  }
  return { mode: 'branches', result: await api.listCveBranches() }
}

// "critical, high" -> "CRITICAL,HIGH". Returns undefined for no value.
function listArg (value) {
  if (typeof value !== 'string') return undefined
  const items = value.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean)
  return items.length ? items.join(',') : undefined
}

// One row for each branch, with the repository it belongs to.
function branchRows (result) {
  const rows = []
  for (const repo of (result && result.repos) || []) {
    const name = [repo.org_name, repo.repo_name].filter(Boolean).join('/')
    for (const b of repo.branches || []) rows.push(Object.assign({ repo: name }, b))
  }
  return rows
}

function renderBranches ({ result }) {
  const rows = branchRows(result)
  if (!rows.length) {
    console.log('No scanned branches found.')
    return
  }
  console.log(table([
    { header: 'REPO', get: (b) => b.repo || '-' },
    { header: 'BRANCH', get: (b) => b.branch_name || '-' },
    { header: 'FINDINGS', get: (b) => num(b.finding_count) },
    { header: 'BLITZY', get: (b) => num(b.blitzy_count) },
    { header: 'KEV', get: (b) => num(b.kev_count) },
    { header: 'SCANNED', get: (b) => (b.is_scanning ? 'scanning now' : relTimeIso(b.last_scanned_at)) },
    { header: 'ID', get: (b) => b.branch_pattern_id || '-' }
  ], rows))
  console.log(`\n${rows.length} ${rows.length === 1 ? 'branch' : 'branches'} shown. Run \`blitzy cves <id>\` to list the findings of a branch.`)
}

function truncate (text, width) {
  const s = String(text || '')
  return s.length > width ? s.slice(0, width - 1) + '…' : s
}

function renderFindings ({ result }) {
  const findings = (result && result.findings) || []
  const scanned = relTimeIso(result && result.last_scanned_at)
  const commit = result && result.commit_sha ? `Commit ${String(result.commit_sha).slice(0, 12)}` : ''
  const header = [commit, scanned !== '-' ? `scanned ${scanned}` : ''].filter(Boolean).join(', ')
  if (header) console.log(header + '\n')
  if (!findings.length) {
    console.log('No findings found.')
    return
  }
  const columns = [
    { header: 'SEVERITY', get: (f) => f.severity || '-' },
    { header: 'ID', get: (f) => f.cve_id || f.id || '-' },
    { header: 'REACHABILITY', get: (f) => f.reachability || '-' },
    { header: 'STATUS', get: (f) => f.status || '-' },
    { header: 'TITLE', get: (f) => truncate(f.title, TITLE_WIDTH) }
  ]
  // A finding with no package is in the project's own code. Show the columns
  // for packages and for the exploited-vulnerability list only when used.
  if (findings.some((f) => (f.packages || []).length)) {
    columns.splice(4, 0, { header: 'PACKAGE', get: (f) => truncate((f.packages || []).join(', '), 30) })
  }
  if (findings.some((f) => f.is_kev)) columns.splice(1, 0, { header: 'KEV', get: (f) => (f.is_kev ? 'yes' : '') })
  console.log(table(columns, findings))
  const total = typeof result.total_count === 'number' ? result.total_count : findings.length
  const page = typeof result.page === 'number' ? ` (page ${result.page})` : ''
  console.log(`\n${num(findings.length)} shown, ${num(total)} total${page}.`)
}

async function handle (argv, context, d) {
  try {
    const result = await doCves(argv, d)
    output(argv, result.result, () => (result.mode === 'findings' ? renderFindings(result) : renderBranches(result)))
  } catch (err) {
    return fail(argv, err, d.errio)
  }
}

module.exports = {
  flags: 'cves [uuid]',
  aliases: 'cve',
  hints: '',
  desc: 'List branches with security findings, or show the findings of one branch by id',
  paramsDesc: 'Optional branch id to show findings for',
  setup: (sywac) => {
    sywac
      .string('--severity <list>', { desc: 'Filter by severity: critical, high, medium, low, info (comma-delimited)' })
      .string('--reachability <list>', { desc: 'Filter by reachability: internet, internal (comma-delimited)' })
      .boolean('--kev', { desc: 'Only findings in the Known Exploited Vulnerabilities catalog' })
      .string('--search <text>', { desc: 'Search the finding ids and descriptions' })
      .string('--sort <expr>', { desc: 'Sort expression', defaultValue: 'severity desc' })
      .number('--limit <n>', { desc: 'Findings per page (maximum 100)', defaultValue: 25 })
      .number('--page <n>', { desc: 'Page number', defaultValue: 1 })
  },
  run: (argv, context) => handle(argv, context, deps()),
  handle,
  doCves,
  renderBranches,
  renderFindings,
  branchRows,
  listArg
}
