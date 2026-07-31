'use strict'

const { execFile } = require('node:child_process')

// Run the gh CLI, resolving stdout. Rejects on non-zero exit, missing binary,
// or timeout — callers are expected to treat any rejection as "gh unavailable
// for this lookup" and degrade gracefully. `bin` is injectable for testing.
function runGh (args, { timeout = 15000, bin = 'gh' } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr
        return reject(err)
      }
      resolve(stdout)
    })
  })
}

// A thin gh wrapper. `run` is injectable for tests.
function createGh ({ run = runGh } = {}) {
  let availability
  let authStatus
  return {
    // Cached: is the gh binary present and runnable?
    available () {
      if (availability === undefined) {
        availability = run(['--version'], { timeout: 5000 }).then(() => true, () => false)
      }
      return availability
    },
    // Cached: is gh actually logged in? (`gh auth status` exits non-zero when
    // not.) Distinguishes "no submodule PRs found" from "gh couldn't look".
    authenticated () {
      if (authStatus === undefined) {
        authStatus = run(['auth', 'status'], { timeout: 5000 }).then(() => true, () => false)
      }
      return authStatus
    },
    // gh pr view <number> --repo <owner/name> --json <fields...>
    async prView (repo, number, fields) {
      const out = await run(['pr', 'view', String(number), '--repo', repo, '--json', fields.join(',')])
      return JSON.parse(out)
    }
  }
}

// Extract a { owner/repo, number } from a GitHub pull-request URL.
function repoFromPrUrl (url) {
  const m = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/.exec(url || '')
  return m ? { repo: `${m[1]}/${m[2]}`, number: Number(m[3]) } : null
}

// Parse "Submodule PR created: <github pull url>" lines out of a PR body.
// Tolerant of wording ("created"/"opened"/"updated") and lists multiple.
function parseSubmodulePrs (body) {
  const out = []
  if (!body) return out
  const re = /submodule pr[^\n]*?(https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+))/gi
  let m
  while ((m = re.exec(body)) !== null) {
    out.push({ repo: `${m[2]}/${m[3]}`, number: Number(m[4]), url: m[1] })
  }
  return out
}

module.exports = { createGh, parseSubmodulePrs, repoFromPrUrl, runGh }
