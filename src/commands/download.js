'use strict'

const nodefs = require('node:fs')
const nodepath = require('node:path')
const { deps } = require('../app')
const { mapLimit } = require('../api')
const { fail, failMessage } = require('../errors')

// Selectable artifacts: flag -> API document_type/extension and output basename.
// `target_tech_spec` is Blitzy's internal name for the Agent Action Plan.
const ARTIFACTS = {
  'tech-spec-md': { doc: 'tech_spec', ext: 'md', base: 'tech_spec' },
  'tech-spec-pdf': { doc: 'tech_spec', ext: 'pdf', base: 'tech_spec' },
  'build-prompt': { doc: 'build_prompt', ext: 'md', base: 'build_prompt' },
  aap: { doc: 'target_tech_spec', ext: 'md', base: 'agent_action_plan' },
  guide: { doc: 'project_guide', ext: 'md', base: 'project_guide' }
}
// Order artifacts appear in output.
const ORDER = ['tech-spec-md', 'tech-spec-pdf', 'build-prompt', 'aap', 'guide']

const defaultIo = {
  now: () => new Date(),
  cwd: () => process.cwd(),
  mkdirp: (dir) => nodefs.mkdirSync(dir, { recursive: true }),
  writeFile: (path, buffer) => nodefs.writeFileSync(path, buffer),
  // Binary-safe raw write for --stdout (artifact bytes, no trailing newline).
  stdout: (buffer) => process.stdout.write(buffer)
}

function slugify (name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Local-time stamp like 20260729_1441.
function stamp (date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`
}

// Which artifacts did the user select? No selection flags == everything.
// With --stdout, --tech-spec means the Markdown flavor only (one artifact ==
// one byte stream; the PDF is reachable by redirecting a normal download).
function selectedKeys (argv) {
  const keys = []
  if (argv['tech-spec']) {
    if (argv.stdout) keys.push('tech-spec-md')
    else keys.push('tech-spec-md', 'tech-spec-pdf')
  }
  if (argv['build-prompt']) keys.push('build-prompt')
  if (argv.aap) keys.push('aap')
  if (argv.guide) keys.push('guide')
  if (argv.all || keys.length === 0) return ORDER.slice()
  return ORDER.filter((k) => keys.includes(k))
}

// Fetch one artifact without writing anything. Shared by probe/stdout/save paths.
async function fetchArtifact (api, id, key) {
  const a = ARTIFACTS[key]
  try {
    const { buffer } = await api.downloadDocument(id, a.doc, a.ext)
    if (!buffer || buffer.length === 0) return { key, ok: false, reason: 'empty response (not available yet)' }
    return { key, ok: true, buffer }
  } catch (err) {
    // Auth/network failures abort the whole command; a plain HTTP error just
    // means "this document isn't available".
    if (err.kind === 'auth' || err.kind === 'network' || err.status === 401) throw err
    const reason = err.status ? `${err.message} (HTTP ${err.status})` : err.message
    return { key, ok: false, reason }
  }
}

async function doDownload (argv, { api, io = defaultIo }) {
  const id = argv.uuid
  const keys = selectedKeys(argv)

  if (argv.stdout && argv.probe) throw new Error('--stdout and --probe cannot be combined.')
  if (argv.stdout && argv.json) throw new Error('--stdout writes the raw artifact; it cannot be combined with --json.')

  // --stdout: print exactly one artifact's bytes, nothing else.
  if (argv.stdout) {
    if (argv.all || keys.length !== 1) {
      throw new Error('--stdout requires exactly one artifact flag (--aap, --guide, --tech-spec, or --build-prompt).')
    }
    const r = await fetchArtifact(api, id, keys[0])
    if (!r.ok) throw new Error(`${r.key} not available: ${r.reason}`)
    io.stdout(r.buffer)
    return { projectId: id, mode: 'stdout', key: r.key, bytes: r.buffer.length }
  }

  // --probe: report availability without writing files.
  if (argv.probe) {
    const results = await mapLimit(keys, 4, (key) => fetchArtifact(api, id, key))
    const artifacts = results.map((r) => (r.ok
      ? { key: r.key, available: true, bytes: r.buffer.length }
      : { key: r.key, available: false, reason: r.reason }))
    return { projectId: id, mode: 'probe', artifacts }
  }

  // Default: save to a directory. With --out, use it verbatim; otherwise default
  // to ./<slug>-<shortid> under the cwd, deriving the slug from the project name.
  let dir
  if (argv.out) {
    dir = nodepath.resolve(io.cwd(), argv.out)
  } else {
    let slug = ''
    try { slug = slugify((await api.getProject(id)).name) } catch { /* fall back to id only */ }
    const short = id.slice(0, 8)
    dir = nodepath.join(io.cwd(), slug ? `${slug}-${short}` : short)
  }

  const ts = stamp(io.now())
  io.mkdirp(dir)

  const results = await mapLimit(keys, 4, async (key) => {
    const a = ARTIFACTS[key]
    const r = await fetchArtifact(api, id, key)
    if (!r.ok) return r
    const path = nodepath.join(dir, `${a.base}_${ts}.${a.ext}`)
    io.writeFile(path, r.buffer)
    return { key, ok: true, path, bytes: r.buffer.length }
  })

  const saved = results.filter((r) => r.ok)
  const skipped = results.filter((r) => !r.ok).map(({ key, ok, reason }) => ({ key, ok, reason }))
  return { projectId: id, mode: 'save', dir, saved, skipped }
}

function human (bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDownload ({ dir, saved, skipped }) {
  const lines = []
  if (saved.length) {
    lines.push(`Downloaded to ${dir}:`)
    for (const r of saved) lines.push(`  ${nodepath.basename(r.path)}  (${human(r.bytes)})`)
  } else {
    lines.push(`No artifacts downloaded to ${dir}.`)
  }
  for (const r of skipped) lines.push(`  skipped ${r.key}: ${r.reason}`)
  return lines.join('\n')
}

function formatProbe ({ projectId, artifacts }) {
  const lines = [`Artifacts for ${projectId}:`]
  for (const a of artifacts) {
    lines.push(a.available
      ? `  ${a.key.padEnd(14)}available (${human(a.bytes)})`
      : `  ${a.key.padEnd(14)}missing: ${a.reason}`)
  }
  return lines.join('\n')
}

function renderDownload (result) {
  console.log(formatDownload(result))
}

async function handle (argv, context, d) {
  try {
    const result = await doDownload(argv, d)
    if (result.mode === 'stdout') return // bytes already written; nothing else on stdout
    if (result.mode === 'probe') {
      if (argv.json) console.log(JSON.stringify(result, null, 2))
      else console.log(formatProbe(result))
      return // probe is informational: exit 0 even when artifacts are missing
    }
    if (argv.json) {
      // Machine-readable path: emit the structure and exit 0; a consumer checks
      // `saved`/`skipped` rather than the exit code.
      console.log(JSON.stringify(result, null, 2))
      return
    }
    const text = formatDownload(result)
    // If nothing was downloaded, report on stderr and exit non-zero (useful for
    // `download ... && next-step`); otherwise print normally (exit 0).
    if (result.saved.length === 0) return failMessage(text, d.errio)
    console.log(text)
  } catch (err) {
    return fail(argv, err, d.errio)
  }
}

module.exports = {
  flags: 'download <uuid>',
  desc: 'Download generated project artifacts (AAP, Project Guide, tech spec, build prompt)',
  paramsDesc: 'Project uuid',
  setup: (sywac) => {
    sywac
      .boolean('--aap', { desc: 'Agent Action Plan (review before code-gen)' })
      .boolean('--guide', { desc: 'Project Guide (review after code-gen)' })
      .boolean('--tech-spec', { desc: 'Tech spec (Markdown + PDF)' })
      .boolean('--build-prompt', { desc: 'Build prompt' })
      .boolean('--all', { desc: 'All available artifacts (the default when no artifact flag is given)' })
      .boolean('--stdout', { desc: 'Write one artifact to stdout instead of a file (pick exactly one artifact flag)' })
      .boolean('--probe', { desc: 'Report which artifacts exist without saving files' })
      .string('--out <dir>', { desc: 'Output directory (default: ./<project-slug>-<id>)' })
  },
  run: (argv, context) => handle(argv, context, deps()),
  handle,
  doDownload,
  renderDownload,
  formatDownload,
  formatProbe,
  selectedKeys,
  slugify,
  stamp,
  ARTIFACTS
}
