'use strict'

const { test, expect } = require('bun:test')
const { BlitzyApi } = require('../src/api')
const { Store } = require('../src/store')
const { MemBacking, routeClient, makeJwt } = require('./helpers')
const download = require('../src/commands/download')

const futureJwt = () => makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
const FIXED = new Date(2026, 6, 29, 14, 41) // 2026-07-29 14:41 local

// A fake io that records writes instead of touching disk.
function fakeIo () {
  const io = {
    dirs: [],
    files: {},
    now: () => FIXED,
    cwd: () => '/work',
    mkdirp: (d) => io.dirs.push(d),
    writeFile: (p, buf) => { io.files[p] = buf }
  }
  return io
}

// Fake api with a downloadDocument keyed by document_type, plus getProject for the slug.
function fakeApi ({ docs = {}, name = 'AloraDL Native Port' } = {}) {
  const calls = []
  return {
    calls,
    getProject: async () => ({ id: 'x', name }),
    downloadDocument: async (id, doc, ext) => {
      calls.push({ id, doc, ext })
      if (!(doc in docs)) { const e = new Error('Document not found'); e.status = 404; throw e }
      return { status: 200, contentType: ext === 'pdf' ? 'application/pdf' : 'text/markdown', buffer: Buffer.from(docs[doc]) }
    }
  }
}

test('selectedKeys defaults to everything, honors flags, and --all', () => {
  expect(download.selectedKeys({})).toEqual(['tech-spec-md', 'tech-spec-pdf', 'build-prompt', 'aap', 'guide'])
  expect(download.selectedKeys({ aap: true })).toEqual(['aap'])
  expect(download.selectedKeys({ guide: true, 'build-prompt': true })).toEqual(['build-prompt', 'guide'])
  expect(download.selectedKeys({ 'tech-spec': true })).toEqual(['tech-spec-md', 'tech-spec-pdf'])
  expect(download.selectedKeys({ all: true })).toEqual(['tech-spec-md', 'tech-spec-pdf', 'build-prompt', 'aap', 'guide'])
})

test('slugify and stamp', () => {
  expect(download.slugify('AloraDL Native Port')).toBe('aloradl-native-port')
  expect(download.slugify('  Weird__Name!! ')).toBe('weird-name')
  expect(download.stamp(FIXED)).toBe('20260729_1441')
})

test('download --aap writes one timestamped file to the default slug dir', async () => {
  const api = fakeApi({ docs: { target_tech_spec: '# Agent Action Plan\n' } })
  const io = fakeIo()
  const result = await download.doDownload({ uuid: '52dbb20e-5ec6-40a4-b687-82f06115e63e', aap: true }, { api }, io)

  expect(result.dir).toBe('/work/aloradl-native-port-52dbb20e')
  expect(io.dirs).toContain('/work/aloradl-native-port-52dbb20e')
  const paths = Object.keys(io.files)
  expect(paths).toEqual(['/work/aloradl-native-port-52dbb20e/agent_action_plan_20260729_1441.md'])
  expect(result.saved).toHaveLength(1)
  expect(result.skipped).toHaveLength(0)
})

test('download --out overrides the directory', async () => {
  const api = fakeApi({ docs: { project_guide: '# Guide\n' } })
  const io = fakeIo()
  const result = await download.doDownload({ uuid: 'abc12345-0000-0000-0000-000000000000', guide: true, out: 'docs/here' }, { api }, io)
  expect(result.dir).toBe('/work/docs/here')
  expect(Object.keys(io.files)).toEqual(['/work/docs/here/project_guide_20260729_1441.md'])
})

test('download reports unavailable artifacts but still saves the rest', async () => {
  // tech spec exists; AAP and guide do not (404)
  const api = fakeApi({ docs: { tech_spec: 'SPEC' } })
  const io = fakeIo()
  const result = await download.doDownload({ uuid: '52dbb20e-5ec6-40a4-b687-82f06115e63e' }, { api }, io) // default: all

  const savedNames = result.saved.map((r) => r.path.split('/').pop()).sort()
  expect(savedNames).toEqual(['tech_spec_20260729_1441.md', 'tech_spec_20260729_1441.pdf'])
  const skippedKeys = result.skipped.map((r) => r.key).sort()
  expect(skippedKeys).toEqual(['aap', 'build-prompt', 'guide'])
  expect(result.skipped[0].reason).toMatch(/404/)
})

test('download surfaces an empty response as not-available', async () => {
  const api = fakeApi({ docs: { project_guide: '' } }) // present but empty
  const io = fakeIo()
  const result = await download.doDownload({ uuid: 'abc12345-0000-0000-0000-000000000000', guide: true }, { api }, io)
  expect(result.saved).toHaveLength(0)
  expect(result.skipped[0].reason).toMatch(/not available/i)
})

test('formatDownload lists saved files and skipped reasons', () => {
  const saved = download.formatDownload({
    dir: '/work/proj-abc',
    saved: [{ path: '/work/proj-abc/agent_action_plan_20260729_1441.md', bytes: 2048 }],
    skipped: []
  })
  expect(saved).toContain('Downloaded to /work/proj-abc:')
  expect(saved).toContain('agent_action_plan_20260729_1441.md  (2.0 KB)')

  const nothing = download.formatDownload({
    dir: '/work/proj-abc',
    saved: [],
    skipped: [{ key: 'guide', reason: 'No code generation found (HTTP 404)' }]
  })
  expect(nothing).toContain('No artifacts downloaded to /work/proj-abc.')
  expect(nothing).toContain('skipped guide: No code generation found (HTTP 404)')
})

test('api.downloadDocument returns raw bytes and throws on HTTP error', async () => {
  const store = new Store(new MemBacking({ workosToken: 'wtok' }))
  const client = routeClient({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'POST /documents/download': (url, init) => {
      const parsed = JSON.parse(init.body)
      // echo which doc was asked for, as raw markdown
      return { status: 200, body: `# ${parsed.document_types[0].document_type}`, headers: { 'content-type': 'text/markdown' } }
    }
  })
  const api = new BlitzyApi({ client, store, env: {} })
  const { buffer, contentType } = await api.downloadDocument('pid', 'project_guide', 'md')
  expect(contentType).toMatch(/markdown/)
  expect(buffer.toString('utf8')).toBe('# project_guide')

  const client2 = routeClient({
    'POST /auth': { status: 200, body: { access_token: futureJwt() } },
    'POST /documents/download': { status: 404, body: { message: 'Document not available' } }
  })
  const api2 = new BlitzyApi({ client: client2, store: new Store(new MemBacking({ workosToken: 'wtok' })), env: {} })
  await expect(api2.downloadDocument('pid', 'project_guide', 'md')).rejects.toThrow(/Document not available/)
})
