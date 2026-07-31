'use strict'

// Typed exit codes so scripts can branch without parsing error text:
//   0 ok · 1 general error · 2 auth required · 3 not found · 4 network failure
const EXIT = { OK: 0, ERROR: 1, AUTH: 2, NOT_FOUND: 3, NETWORK: 4 }

const KIND_EXIT = { auth: EXIT.AUTH, not_found: EXIT.NOT_FOUND, network: EXIT.NETWORK }

// Classify an error into a kind that maps to a typed exit code. An explicit
// err.kind (set at throw sites) wins; otherwise fall back to HTTP status.
function classify (err) {
  if (err && err.kind && err.kind in KIND_EXIT) return err.kind
  const status = err && err.status
  if (status === 401) return 'auth'
  if (status === 404) return 'not_found'
  return 'error'
}

function exitCodeFor (kind) {
  return KIND_EXIT[kind] || EXIT.ERROR
}

const defaultIo = {
  stderr: (line) => process.stderr.write(line + '\n'),
  exit: (code) => { process.exitCode = code }
}

// Report a command failure on stderr and set the typed exit code. With --json,
// emit a single structured object so `blitzy ... --json` consumers can parse
// stderr on failure just like they parse stdout on success.
function fail (argv, err, io = defaultIo) {
  const kind = classify(err)
  const code = exitCodeFor(kind)
  if (argv && argv.json) {
    io.stderr(JSON.stringify({
      error: {
        message: (err && err.message) || String(err),
        kind,
        status: (err && err.status) != null ? err.status : null,
        code: (err && err.code) != null ? err.code : null
      }
    }, null, 2))
  } else {
    io.stderr((err && err.message) || String(err))
  }
  io.exit(code)
  return code
}

// Report a non-exception failure: informational text on stderr + non-zero exit
// (e.g. `download` when no artifacts were available).
function failMessage (text, io = defaultIo, code = EXIT.ERROR) {
  io.stderr(text)
  io.exit(code)
  return code
}

module.exports = { EXIT, classify, exitCodeFor, fail, failMessage }
