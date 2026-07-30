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
  const result = await download.doDownload({ uuid: '52dbb20e-5ec6-40a4-b687-82f06115e63e', aap: true }, { api, io })

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
  const result = await download.doDownload({ uuid: 'abc12345-0000-0000-0000-000000000000', guide: true, out: 'docs/here' }, { api, io })
  expect(result.dir).toBe('/work/docs/here')
  expect(Object.keys(io.files)).toEqual(['/work/docs/here/project_guide_20260729_1441.md'])
})

test('download reports unavailable artifacts but still saves the rest', async () => {
  // tech spec exists; AAP and guide do not (404)
  const api = fakeApi({ docs: { tech_spec: 'SPEC' } })
  const io = fakeIo()
  const result = await download.doDownload({ uuid: '52dbb20e-5ec6-40a4-b687-82f06115e63e' }, { api, io }) // default: all

  const savedNames = result.saved.map((r) => r.path.split('/').pop()).sort()
  expect(savedNames).toEqual(['tech_spec_20260729_1441.md', 'tech_spec_20260729_1441.pdf'])
  const skippedKeys = result.skipped.map((r) => r.key).sort()
  expect(skippedKeys).toEqual(['aap', 'build-prompt', 'guide'])
  expect(result.skipped[0].reason).toMatch(/404/)
})

test('download surfaces an empty response as not-available', async () => {
  const api = fakeApi({ docs: { project_guide: '' } }) // present but empty
  const io = fakeIo()
  const result = await download.doDownload({ uuid: 'abc12345-0000-0000-0000-000000000000', guide: true }, { api, io })
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

// --- v1.1: --stdout and --probe ---

test('download --stdout writes exactly one artifact to stdout raw', async () => {
  const api = fakeApi({ docs: { target_tech_spec: '# AAP body' } })
  const io = fakeIo()
  const chunks = []
  io.stdout = (buf) => chunks.push(buf)
  const result = await download.doDownload({ uuid: 'abcdabcd-0000-0000-0000-000000000000', aap: true, stdout: true }, { api, io })
  expect(result.mode).toBe('stdout')
  expect(result.key).toBe('aap')
  expect(Buffer.concat(chunks).toString()).toBe('# AAP body')
  expect(Object.keys(io.files)).toHaveLength(0) // nothing written to disk
})

test('download --stdout with --tech-spec picks the Markdown flavor only', () => {
  expect(download.selectedKeys({ 'tech-spec': true, stdout: true })).toEqual(['tech-spec-md'])
})

test('download --stdout rejects zero or multiple artifact selections', async () => {
  const api = fakeApi()
  const io = fakeIo()
  await expect(download.doDownload({ uuid: 'x', stdout: true }, { api, io })).rejects.toThrow(/exactly one artifact/)
  await expect(download.doDownload({ uuid: 'x', stdout: true, aap: true, guide: true }, { api, io })).rejects.toThrow(/exactly one artifact/)
  await expect(download.doDownload({ uuid: 'x', stdout: true, all: true, aap: true }, { api, io })).rejects.toThrow(/exactly one artifact/)
})

test('download --stdout rejects --json and --probe combinations', async () => {
  const api = fakeApi()
  const io = fakeIo()
  await expect(download.doDownload({ uuid: 'x', stdout: true, aap: true, json: true }, { api, io })).rejects.toThrow(/--json/)
  await expect(download.doDownload({ uuid: 'x', stdout: true, aap: true, probe: true }, { api, io })).rejects.toThrow(/--probe/)
})

test('download --stdout surfaces an unavailable artifact as an error', async () => {
  const api = fakeApi({ docs: {} })
  const io = fakeIo()
  io.stdout = () => { throw new Error('should not write') }
  await expect(download.doDownload({ uuid: 'x', aap: true, stdout: true }, { api, io })).rejects.toThrow(/aap not available/)
})

test('download --probe reports availability without writing files', async () => {
  const api = fakeApi({ docs: { target_tech_spec: '# AAP', project_guide: '# guide' } })
  const io = fakeIo()
  const result = await download.doDownload({ uuid: 'abcdabcd-0000-0000-0000-000000000000', probe: true }, { api, io })
  expect(result.mode).toBe('probe')
  expect(io.dirs).toHaveLength(0)
  expect(Object.keys(io.files)).toHaveLength(0)
  const byKey = Object.fromEntries(result.artifacts.map((a) => [a.key, a]))
  expect(byKey.aap.available).toBe(true)
  expect(byKey.aap.bytes).toBe(5)
  expect(byKey.guide.available).toBe(true)
  expect(byKey['build-prompt'].available).toBe(false)
  expect(byKey['build-prompt'].reason).toMatch(/Document not found/)
})

test('formatProbe renders availability lines', () => {
  const text = download.formatProbe({
    projectId: 'p1',
    artifacts: [
      { key: 'aap', available: true, bytes: 2048 },
      { key: 'guide', available: false, reason: 'HTTP 404' }
    ]
  })
  expect(text).toContain('aap')
  expect(text).toContain('available (2.0 KB)')
  expect(text).toContain('missing: HTTP 404')
})

test('download aborts entirely on auth errors instead of reporting them as skipped', async () => {
  const api = {
    getProject: async () => ({ name: 'P' }),
    downloadDocument: async () => { const e = new Error('Session expired.'); e.status = 401; e.kind = 'auth'; throw e }
  }
  const io = fakeIo()
  await expect(download.doDownload({ uuid: 'x', aap: true }, { api, io })).rejects.toThrow(/Session expired/)
})
