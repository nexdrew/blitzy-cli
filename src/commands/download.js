'use strict'

const nodefs = require('node:fs')
const nodepath = require('node:path')
const { deps } = require('../app')
const { mapLimit } = require('../api')

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
  writeFile: (path, buffer) => nodefs.writeFileSync(path, buffer)
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
function selectedKeys (argv) {
  const keys = []
  if (argv['tech-spec']) keys.push('tech-spec-md', 'tech-spec-pdf')
  if (argv['build-prompt']) keys.push('build-prompt')
  if (argv.aap) keys.push('aap')
  if (argv.guide) keys.push('guide')
  if (argv.all || keys.length === 0) return ORDER.slice()
  return ORDER.filter((k) => keys.includes(k))
}

async function doDownload (argv, { api }, io = defaultIo) {
  const id = argv.uuid
  const keys = selectedKeys(argv)

  // Resolve the output directory. With --out, use it verbatim; otherwise default
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
    try {
      const { buffer } = await api.downloadDocument(id, a.doc, a.ext)
      if (!buffer || buffer.length === 0) return { key, ok: false, reason: 'empty response (not available yet)' }
      const path = nodepath.join(dir, `${a.base}_${ts}.${a.ext}`)
      io.writeFile(path, buffer)
      return { key, ok: true, path, bytes: buffer.length }
    } catch (err) {
      const reason = err.status ? `${err.message} (HTTP ${err.status})` : err.message
      return { key, ok: false, reason }
    }
  })

  const saved = results.filter((r) => r.ok)
  const skipped = results.filter((r) => !r.ok)
  return { projectId: id, dir, saved, skipped }
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

function renderDownload (result) {
  console.log(formatDownload(result))
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
      .string('--out <dir>', { desc: 'Output directory (default: ./<project-slug>-<id>)' })
  },
  run: async (argv, context) => {
    try {
      const result = await doDownload(argv, deps())
      if (argv.json) {
        // Machine-readable path: emit the structure and exit 0; a consumer checks
        // `saved`/`skipped` rather than the exit code.
        console.log(JSON.stringify(result, null, 2))
        return
      }
      const text = formatDownload(result)
      // If nothing was downloaded, report via cliMessage so the CLI exits non-zero
      // (useful for `download ... && next-step`); otherwise print normally (exit 0).
      if (result.saved.length === 0) return context.cliMessage('%s', text)
      console.log(text)
    } catch (err) {
      return context.cliMessage(err.message)
    }
  },
  doDownload,
  renderDownload,
  formatDownload,
  selectedKeys,
  slugify,
  stamp,
  ARTIFACTS
}
