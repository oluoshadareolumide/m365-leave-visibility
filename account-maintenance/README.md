# Account-wide repository maintenance

A single scheduled GitHub Action that performs **real, low-risk maintenance**
across every repository you own and commits the changes **under your name**, so
they attribute to you on GitHub.

> This is a self-contained kit. It does **nothing** until you (1) add a token
> and (2) copy the workflow into `.github/workflows/`. Until then it's inert.

## How it works

```
┌─ host repo (any one of your repos) ─────────────┐
│  .github/workflows/account-maintenance.yml      │  ← runs on a cron
│     └─ runs account-maintenance/maintain.py     │
│            using secret GH_MAINTENANCE_TOKEN     │
└───────────────────────────┬─────────────────────┘
                             │  lists your repos, clones each,
                             ▼  runs tasks, commits as you, pushes
        all your other repos (maintained in place)
```

One workflow reaches **all** your repos at runtime via the token, so you only
deploy it once. The commit author/committer are set to you
(`maintenance.config.json`), not a bot.

## Honest expectations (read this)

- **Commits only happen when there's real work.** Formatters only change
  files when there's drift; dependency bumps only when a new version exists.
  Quiet weeks produce **no commits** — and that's correct. This kit will not
  manufacture filler commits to keep your graph green.
- **For commits to count on your contribution graph**, all of these must hold
  (they do, by design, here): the commit's author email is a **verified email
  on your GitHub account**, the commit lands on the repo's **default branch**,
  and the repo is **not a fork**. That's why forks are skipped by default and
  why a PAT (not the default `GITHUB_TOKEN`) is required — bot-token commits
  don't attribute to you.
- **Want genuinely frequent, honest commits?** Point this at *real* recurring
  work. Your security repos (`xgta-soc`, `SOC-Threat-Intelligence-`,
  `PhishingGuard`) are ideal: a scheduled task that pulls fresh threat-intel /
  IOC feeds and commits the data is valuable *and* naturally daily. Ask me to
  add a feed-pull task and I'll wire it in.

## Activate

There is exactly **one** thing only you can do — mint the token (it's a
credential tied to your GitHub login; no script or assistant can create it for
you). Everything after that is a single command.

### Step 1 — create the token (only you)

- Recommended: a **fine-grained PAT** → Settings → Developer settings →
  Fine-grained tokens. Resource owner: you. Repository access: *All
  repositories*. Permissions: **Contents: Read and write** (add **Workflows:
  Read and write** only if you want it to touch workflow files). Set an expiry
  and calendar a rotation.
- Or a classic PAT with the `repo` scope.

> Never paste this token into a chat. Keep it in your shell/secret store only.

### Step 2 — one command (does everything else)

With the GitHub CLI (`gh`) logged in, from a checkout of this kit:

```bash
export GH_MAINTENANCE_TOKEN=github_pat_xxx   # the token from step 1
./bootstrap.sh                               # default host repo: it-support-scripts
# or target a different host:  ./bootstrap.sh some-repo
```

`bootstrap.sh` installs the scheduler on the host repo's default branch, stores
the token as the `GH_MAINTENANCE_TOKEN` secret, and kicks off a **dry run** so
you can review before anything is ever committed. Watch it:
`gh run watch --repo <you>/it-support-scripts`. When happy, run it without
dry-run or just let the weekly cron take over — it maintains **all** your repos
from that one place.

### Manual alternative (no script)

1. Add the token as an Actions secret named `GH_MAINTENANCE_TOKEN` on the host repo
   (Settings → Secrets and variables → Actions → New repository secret).
2. Copy `account-maintenance.yml` → `.github/workflows/account-maintenance.yml`
   on the host repo's **default branch**, with `account-maintenance/` at its root.
3. Actions tab → run `account-maintenance` with *Dry run* checked.

> Scheduled workflows run **only from a repo's default branch**. Pick a host
> whose default is sensible — `it-support-scripts` (default `main`) is a natural
> home. `m365-leave-visibility` currently defaults to a `claude/*` branch, so it
> is *not* a good host as-is.

You can also dry-run locally before deploying anywhere:

```bash
export GH_MAINTENANCE_TOKEN=github_pat_xxx
python account-maintenance/maintain.py --dry-run
python account-maintenance/maintain.py --dry-run --only CleanCSV,xgta-soc
```

## Configuration — `maintenance.config.json`

| Key | Meaning |
|-----|---------|
| `author.name` / `author.email` | Identity stamped on every commit. Email **must be verified on your account** to attribute. |
| `include` | If non-empty, only these repo names are touched. |
| `exclude` | Repo names to skip. |
| `skip_forks` | Skip forks (default `true`; auto-committing to forks is bad practice and doesn't count anyway). |
| `skip_archived` | Skip archived repos (default `true`). |
| `skip_private` | Skip private repos (default `false`). |
| `tasks.license_year` | Refresh copyright year in `LICENSE`. Safe, occasional. |
| `tasks.format` | Run a formatter **only if the repo already configures one** (prettier via config/devDeps, black via `pyproject`/`setup.cfg`). Never imposes a new style. |
| `tasks.deps` | **Opt-in.** Bump dependencies. |
| `deps.npm_target` | `patch` \| `minor` \| `latest` (default `minor` — avoids breaking majors). |
| `deps.require_passing_tests` | If the repo has an npm `test` script, run it after bumping and revert if it fails (default `true`). |
| `commit.message` | Commit subject line. |

## Tasks, by risk

| Task | Risk | Commits when… |
|------|------|---------------|
| `license_year` | very low | the year changed |
| `format` | low | the repo's own formatter finds drift |
| `deps` | medium (opt-in) | a dependency has a newer (minor/patch) version *and* tests still pass |

## Security notes

- Treat `GH_MAINTENANCE_TOKEN` like a password. Prefer a **fine-grained** PAT,
  least privilege (Contents only), with an **expiry**, and rotate it.
- The token is only ever read from the Actions secret / your env; the script
  never logs it.
- Review the first few real runs before leaving it on a schedule.

## Alternatives

- `templates/dependabot.yml` — if you only care about dependency updates and
  don't need sole authorship, Dependabot is the most reliable option (commits
  are authored by `dependabot[bot]`, which you then merge).
