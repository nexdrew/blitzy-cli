# blitzy-cli

A command-line interface for the [Blitzy](https://blitzy.com) platform API. Log in,
check who you are, and inspect your projects from the terminal.

> Unofficial. This is a third-party client for Blitzy's private platform API, built
> for and by a Blitzy customer. Endpoints are undocumented and may change.

## Install

```sh
npm install -g blitzy-cli
# or run without installing
npx blitzy-cli --help
```

Requires Node.js >= 20. Or install a standalone binary (no Node needed) via
[Homebrew](https://brew.sh) on macOS/Linux:

```sh
brew install nexdrew/tap/blitzy-cli
```

## Usage

```
blitzy <command> [options]

Commands:
  login            Authenticate with Blitzy and store credentials
  whoami           Show the currently authenticated user
  auth             Show local authentication status without calling the API
  logout           Clear stored credentials
  projects [uuid]  List projects, or show details for one by uuid
  rules [uuid]     List reusable rules, or show one rule's full content by uuid
  envs [uuid]      List environments, or show one environment's setup by uuid
  teams [uuid]     List teams you belong to, or show one team's members by uuid
  cves [uuid]      List branches with security findings, or show one branch's findings by id
  download <uuid>  Download generated project artifacts
  usage            Show subscription usage against quota

Project options (projects):
  --archived       List archived projects
  --limit <n>      Projects per page (default 50)
  --page <n>       Page number (default 1)
  --sort <field>   Sort field (default -updatedAt)
  --teams <ids>    Filter by comma-delimited team uuids and/or PERSONAL, ORGANIZATION
  --no-gh          Don't use the gh CLI to look up submodule PRs

Security finding options (cves <id>):
  --severity <list>      Filter by severity: critical, high, medium, low, info
  --reachability <list>  Filter by reachability: internet, internal
  --kev                  Only findings in the Known Exploited Vulnerabilities catalog
  --search <text>        Search the finding ids and descriptions
  --sort <expr>          Sort expression (default "severity desc")
  --limit <n>            Findings per page (default 25, maximum 100)
  --page <n>             Page number (default 1)

Download options (download):
  --aap            Agent Action Plan (review before code-gen)
  --guide          Project Guide (delivered with each pull request)
  --tech-spec      Tech spec (Markdown + PDF)
  --build-prompt   Build prompt
  --all            All available artifacts (the default)
  --stdout         Write one artifact to stdout instead of a file
  --probe          Report which artifacts exist without saving files
  --out <dir>      Output directory (default: ./<project-slug>-<id>)

Global Options:
  --json           Output raw JSON instead of formatted text
  -h, --help       Show help
  -v, --version    Show version number
```

### Log in

Blitzy sign-in uses a code that Blitzy sends to your email. There is no password.

```sh
blitzy login
# Work email: you@company.com
# Sign-in code sent to you@company.com: 123456
# Logged in as You <you@company.com> at Your Company.
```

Scripts and agents have no interactive terminal. For these, do the login in two steps:

```sh
blitzy login --email you@company.com                 # Step 1: Blitzy sends the code
blitzy login --email you@company.com --code 123456   # Step 2: complete the login
```

The CLI stores credentials with [configstore](https://github.com/yeoman/configstore) at
`~/.config/configstore/blitzy-cli.json` (mode `0600`). The CLI never stores the sign-in code.

A login gives the CLI three tokens:

- A WorkOS access token (about 30 minutes).
- A platform token (about 1 hour).
- A refresh token.

The CLI uses the refresh token to renew the other two tokens automatically (the same
`/auth/refresh` endpoint that the Blitzy web app uses). Run `blitzy login` again only if
Blitzy rejects the refresh.

Check your auth state without touching the network (handy for scripts and agents):

```sh
blitzy auth          # human-readable status; exit code 2 when not authenticated
blitzy auth --json   # {"authenticated":…,"source":…,"workosExpiresAt":…,…}
```

#### Log in with browser tokens

Use this procedure if you cannot use the email code (for example, your account uses SSO):

1. Sign in at <https://platform.blitzy.com>.
2. Open the browser developer tools.
3. Go to **Application > Local Storage > `https://platform.blitzy.com`**.
4. Copy the values of `workos_session_token` and `workos_refresh_token`.
5. Run `blitzy login --token`. The CLI asks for the two tokens and does not show them:

```sh
blitzy login --token
# Access token (workos_session_token):
# Refresh token (workos_refresh_token, press Enter to skip):
# Logged in as You <you@company.com> at Your Company.
```

The refresh token is optional. Without it, the session cannot renew itself and ends after
90 minutes at most.

You can also give the tokens as flag values, for example in a script. The values are then
visible in the shell history and in the process list:

```sh
blitzy login --token <workos_session_token> --refresh-token <workos_refresh_token>
```

The browser and the CLI then share one session. If you sign out in the browser, the CLI
session can also end.

### Look around

```sh
blitzy whoami
blitzy projects
blitzy projects 50930af1-5165-41e6-89a3-7d4445ba4593
blitzy rules                                           # list reusable rules
blitzy rules ce7a92db-affa-4520-9794-0ebaba84c23d      # one rule + its full content
blitzy envs                                            # list environments
blitzy envs 4cd123bf-54b5-4857-a0b1-2a18696c55bb       # one env + its setup instructions
blitzy teams                                           # list your teams (with your role)
blitzy teams d1d577c3-15c8-497c-80ae-f9179f9985a7      # one team + its member roster
blitzy usage
```

`rules`, `envs`, and `teams` mirror `projects`: no argument lists them; a uuid shows the
details. The detail views print the rule's full content, the environment's setup
instructions, variables, and which projects use it, and the team's member roster —
handy for deciding which rules/environments to attach when scoping a new project.

The rule and environment detail views also show a `Shared with` line: `Organization`,
team names, or `Private`. A team marked `(via project)` has access only because one of
its projects uses the rule or environment.

In the project list, `STAGE` is the lifecycle stage of the project and `RUN STATUS` is the
status of its current run (for example `IN_PROGRESS` or `DONE`). A `FLAGS` column appears
when a project is `locked`, `demo`, `view-only`, or `disabled`.

`blitzy projects <uuid>` shows one project in blocks:

- **Summary:** the stage, the run status, and a line for each flag that is set.
- **Metering:** the lines, files, and hours for the project.
- **Tech spec:** the version and the state of the latest tech spec.
- **Progress:** shown only while a run is in progress. A tech spec run shows the files and
  lines that Blitzy has processed. A code generation shows its percent and its stages.
- **Source control:** the provider name (for example `GitHub` or `Azure DevOps`), the
  repository, the branch, and the PRs. Each PR line shows the lines and files of its run.
- **Environments:** the environments attached to the project, in priority order.
- **Rules:** the rules attached to the project.
- **Shared with:** `Organization`, team names, or `Private`.

If a block has no data, the CLI does not print it.

If `--teams` gives no projects, the CLI names each team id that is not one of your teams.

Filter the project list by team — comma-delimited team uuids and/or the synthetic
scopes `PERSONAL` (your unshared projects) and `ORGANIZATION` (company-shared):

```sh
blitzy projects --teams PERSONAL                                 # only your unshared projects
blitzy projects --teams d1d577c3-15c8-497c-80ae-f9179f9985a7     # one team's projects
blitzy projects --teams personal,organization                    # scopes are case-insensitive
```

`blitzy usage` shows each quota with the amount that is left. It shows reserved lines
and overage only when they are more than zero. Blitzy does not document the currency of
the overage numbers, so the CLI prints them as the API gives them.

Add `--json` to any command to get the raw API response for scripting:

```sh
blitzy projects --json | jq '.projects[] | {name, stage: .currentStatus.stage, run: .currentStatus.status}'
```

### Security findings

Blitzy scans your repository branches for vulnerabilities. Blitzy calls this feature
Proactive Insights.

```sh
blitzy cves                                            # branches that have a scan
blitzy cves eeeeeeee-0000-4000-8000-000000000001       # findings of one branch
blitzy cves <id> --severity critical,high --reachability internet
blitzy cves <id> --kev                                 # known exploited vulnerabilities only
blitzy cves <id> --search sql --limit 100 --page 2
```

Without an argument, `cves` lists each scanned branch with its number of findings. The
`BLITZY` column is the number of findings that Blitzy discovered itself, and the `KEV`
column is the number in the Known Exploited Vulnerabilities catalog. Use the `ID` of a
branch to list its findings.

Each finding has a severity, an id, a reachability, and a status:

- An id that starts with `BLITZY-` is a finding that Blitzy discovered. Other ids (for
  example `CVE-` or `GHSA-`) are publicly known.
- `INTERNET` means that the finding is reachable from an external path. `INTERNAL` means
  that it is reachable only inside your network.
- A finding with no package is in your own code.

The table shows a short title. Use `--json` for the full data of each finding, which
includes the summary and the severity rationale.

### Download artifacts

Blitzy generates documents for a project — the tech spec, the build prompt, the Agent
Action Plan (reviewed before code-gen), and the Project Guide (the statement of work that
Blitzy delivers with each pull request). These are separate from the code committed in
PRs. Download them for offline review:

```sh
blitzy download <uuid> --aap      # just the Agent Action Plan
blitzy download <uuid> --guide    # just the Project Guide
blitzy download <uuid>            # everything available (default)
```

Each artifact is fetched individually and written as its own file — no zip. Files are
timestamped so downloads taken at different points in the project lifecycle don't clobber
each other:

```
Downloaded to ./aloradl-native-port-52dbb20e:
  agent_action_plan_20260729_1441.md  (56.5 KB)
```

By default files go to `./<project-slug>-<short-id>/` under the current directory; use
`--out <dir>` to choose your own. Artifacts that don't exist yet for the project (e.g. the
Project Guide before code-gen has run) are reported as skipped, and the rest still download.
If Blitzy denies access to the project (HTTP 403), the command stops with the message
`Project not found or not accessible` and exit code 3. Blitzy gives this answer for a
project that you cannot access and for a uuid that does not exist.

For scripting, `--stdout` streams a single artifact's raw bytes to stdout (pick exactly
one artifact flag; with `--tech-spec` it picks the Markdown flavor), and `--probe` reports
which artifacts exist without writing anything:

```sh
blitzy download <uuid> --aap --stdout > aap.md
blitzy download <uuid> --probe --json   # {"artifacts":[{"key":"aap","available":true,…},…]}
```

### Submodule PRs (optional gh integration)

This integration is for projects on GitHub only. For a project on a different provider,
the CLI does not call `gh`.

A Blitzy project's parent PR often opens follow-up PRs in submodule repos, recorded
only in the parent PR's GitHub description (not in Blitzy's API). If the
[`gh`](https://cli.github.com) CLI is installed and authenticated, `blitzy projects <uuid>`
reads each parent PR's body, surfaces those submodule PRs (with their current state),
and nests them under the parent:

```
GitHub
  Repo             LivTech-Alora/blitzy-pilot-parent
  Branch           main
  PRs
    #19  (PENDING, 5 days ago, 1,627 lines, 22 files)  https://github.com/LivTech-Alora/blitzy-pilot-parent/pull/19
      submodule LivTech-Alora/alora-plus#265 (OPEN)  https://github.com/LivTech-Alora/alora-plus/pull/265
```

To bound the number of `gh` subprocess calls, submodule lookups run only for the 5 most
recent PRs; when a project has more, the output says so.

This is best-effort: if `gh` is missing, unauthenticated, or a lookup fails, the rest of
the detail still renders (with a note when `gh` is installed but not logged in). Pass
`--no-gh` to skip the gh calls entirely. `--json` detail output includes the raw `runs`
payload, the `environments`, `rules`, `techSpec`, and `progress` of the project, plus a `gh` block (`{enabled, available, authenticated, used, truncatedAt}`) so
scripts can tell "no submodule PRs" apart from "gh couldn't look".

## Scripting and exit codes

The CLI is built to be driven by scripts and AI agents:

- **Errors go to stderr**, never stdout. With `--json`, failures are emitted as a single
  structured object (`{"error":{"message","kind","status","code"}}`), so stdout is always
  parseable on success and stderr is always parseable on failure.
- **Typed exit codes**: `0` success · `1` general error · `2` auth required (run
  `blitzy login`) · `3` not found · `4` network failure.
- **Strict argument handling**: unknown commands, flags, and extra arguments exit `1`
  with an error instead of being silently ignored.
- `blitzy auth --json` is the cheapest pre-flight: no network, exit `2` when a login is
  needed.

## Environment variables

| Variable            | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `BLITZY_TOKEN`      | A WorkOS access token that overrides stored credentials. It expires after about 30 minutes and cannot renew itself. |
| `BLITZY_API_URL`    | Override the API base URL (default `https://platform.api.blitzy.com/v1`). |
| `BLITZY_TRANSPORT`  | `impit` (default) or `fetch`. See below.                                |
| `BLITZY_REFRESH_URL` | Override the session-refresh endpoint (default `{BLITZY_API_URL}/auth/refresh`). |

### About the transport

Blitzy's API host is behind Cloudflare Bot Management, which challenges HTTP clients
that don't present a browser's TLS fingerprint — a plain `fetch` from Node or curl is
blocked with an HTTP 403 challenge regardless of headers or token. This CLI uses
[`impit`](https://github.com/apify/impit), which impersonates a browser fingerprint, so
requests reach the API. `BLITZY_TRANSPORT=fetch` selects a plain-`fetch` transport and
is provided for the day Blitzy allow-lists non-browser clients directly.

`impit` ships prebuilt native binaries (napi) as per-platform optional dependencies, so
`npm install` fetches the right one for your OS/arch automatically — no compiler or
`node-gyp` needed.

## Distribution

There are four ways to ship this CLI, and they get `impit` to the user differently:

1. **npm package (default).** `npm install -g blitzy-cli` installs a Node-compatible
   bundle (`dist/cli.js`, with `impit` kept external) plus `impit` itself; npm resolves
   the correct prebuilt `impit-<platform>` binary for the user's machine. Users need
   Node >= 20.

2. **Standalone executable (`bun build --compile`).** `bun run compile` produces a single
   ~67 MB binary (`dist/blitzy`) that embeds the Bun runtime, the app, and `impit`'s
   native addon. Users need nothing installed — not Node, not Bun, not npm — just the
   binary for their platform. Release binaries are attached to each
   [GitHub Release](https://github.com/nexdrew/blitzy-cli/releases)
   (`blitzy-darwin-arm64`, `blitzy-darwin-x64`, `blitzy-linux-x64`,
   `blitzy-linux-arm64`, `blitzy-linux-x64-musl`, `blitzy-windows-x64.exe`,
   `blitzy-windows-arm64.exe`).

   The x64 binaries are Bun **baseline** builds (no AVX/AVX2 requirement), so they run
   cleanly on older x86 CPUs and under Rosetta 2 on Apple Silicon — where an x86_64
   Homebrew or shell would otherwise select an x64 build that warns about (and risks)
   AVX-related crashes.

   **These binaries are not code-signed or notarized.** npm is the recommended install
   path; only use a binary if you've decided you trust it. Each binary is built by this
   repo's public release workflow and carries a GitHub build-provenance attestation —
   verify what you downloaded before running it:

   ```sh
   gh attestation verify blitzy-darwin-arm64 --repo nexdrew/blitzy-cli
   ```

   On macOS, Gatekeeper quarantines the download and the ad-hoc signature won't
   validate after transfer, so a binary you've chosen to trust needs:

   ```sh
   codesign --remove-signature blitzy-darwin-arm64
   codesign --force --sign - blitzy-darwin-arm64
   xattr -cr blitzy-darwin-arm64
   chmod +x blitzy-darwin-arm64
   ```

   Caveat: `--compile` embeds only the `impit` native binary that is **installed at build
   time**, so a binary must be built **on** (or with the optional dependency installed
   for) each target platform. Cross-compiling with `--target=bun-linux-x64` from macOS
   builds without error but produces a binary that throws "native bindings not compiled
   for your platform" at runtime. To publish standalone binaries for every platform, run
   the compile step in a CI matrix — one runner per OS/arch (macOS arm64/x64, Linux
   x64/arm64, Windows x64/arm64) — and attach the outputs to a GitHub Release.

3. **Homebrew tap.** `brew install nexdrew/tap/blitzy-cli` delivers the standalone
   binary for the user's platform (macOS/Linux, arm64/x64) from
   [nexdrew/homebrew-tap](https://github.com/nexdrew/homebrew-tap). The formula is
   generated — `scripts/homebrew-formula.mjs` renders it from each release's asset
   digests and the `update-homebrew-tap` release job pushes it to the tap; never edit
   it by hand. Because brew fetches with curl, the download never receives the macOS
   quarantine attribute, so none of the Gatekeeper handling above applies, and the
   formula's sha256 pins correspond to the same attested release assets. Verify the
   installed binary at any time:

   ```sh
   gh attestation verify "$(command -v blitzy)" --repo nexdrew/blitzy-cli
   ```

   (`command -v` resolves the brew symlink and, unlike `$(brew --prefix)/bin/blitzy`,
   works on machines with more than one Homebrew prefix.)

4. **Scoop bucket (Windows).**

   ```powershell
   scoop bucket add nexdrew https://github.com/nexdrew/scoop-bucket
   scoop install nexdrew/blitzy-cli
   ```

   Delivers the standalone Windows binary (x64 or arm64) from
   [nexdrew/scoop-bucket](https://github.com/nexdrew/scoop-bucket). The manifest is
   generated — `scripts/scoop-manifest.mjs` renders it from each release's asset
   digests and the `update-scoop-bucket` release job pushes it to the bucket; never
   edit it by hand. Scoop installs per-user (no admin rights), keeps the exe
   byte-identical to the attested release asset (only the `blitzy` shim is added),
   and the manifest's hashes pin the same attested assets as the Homebrew formula.
   Verify the installed exe at any time (on arm64, verify `blitzy-windows-arm64.exe`):

   ```powershell
   gh attestation verify "$(scoop prefix blitzy-cli)\blitzy-windows-x64.exe" --repo nexdrew/blitzy-cli
   ```

## Development

```sh
bun install
bun test             # unit tests, no network or credentials required
bun test --coverage  # with coverage (CI gates at >= 95% line coverage)
bun run lint         # standard
bun run build        # bundle to dist/cli.js (Node-compatible; impit stays external)
bun run compile      # standalone binary for the current platform -> dist/blitzy
```

## Releasing

Releases are automated with
[release-please](https://github.com/googleapis/release-please-action) (`.github/workflows/release.yml`).
Commits to `main` must follow [Conventional Commits](https://www.conventionalcommits.org)
(`feat:` → minor, `fix:` → patch; while pre-1.0, breaking changes bump the minor). Each
push to `main` updates a "Release PR" that accumulates the version bump and changelog;
**merging that Release PR** cuts the release:

1. tags the version and creates the GitHub Release,
2. publishes to npm with provenance via **OIDC Trusted Publishing** (no `NPM_TOKEN`), and
3. compiles standalone binaries on a per-OS/arch runner matrix (Linux x64/arm64 glibc,
   Linux x64 musl, macOS x64/arm64, Windows x64/arm64) — each natively so `impit`'s
   platform binary is embedded — attests build provenance for each
   (`actions/attest-build-provenance`, verifiable with
   `gh attestation verify <file> --repo nexdrew/blitzy-cli`), and attaches them to the
   GitHub Release,
4. regenerates `Formula/blitzy-cli.rb` in [nexdrew/homebrew-tap](https://github.com/nexdrew/homebrew-tap)
   from the release's asset digests (`scripts/homebrew-formula.mjs` is the formula's
   single source of truth — the file in the tap is always generated, never hand-edited),
   and
5. regenerates `bucket/blitzy-cli.json` in [nexdrew/scoop-bucket](https://github.com/nexdrew/scoop-bucket)
   the same way (`scripts/scoop-manifest.mjs` is the manifest's single source of truth).

One-time setup:

- On npmjs.com, configure this repo as a **Trusted Publisher** for the `blitzy-cli`
  package: repository `nexdrew/blitzy-cli`, workflow `release.yml`, environment `npm`.
- In GitHub, create an **Environment named `npm`** (optionally with a protection/approval
  rule on releases).
- Create a fine-grained PAT with **contents: write** on `nexdrew/homebrew-tap` and add
  it to this repo as the **`TAP_GITHUB_TOKEN`** secret (used by the tap-update job).
- Create a fine-grained PAT with **contents: write** on `nexdrew/scoop-bucket` and add
  it to this repo as the **`SCOOP_GITHUB_TOKEN`** secret (used by the bucket-update job).

## License

MIT © [Andrew Goode](https://github.com/nexdrew)
