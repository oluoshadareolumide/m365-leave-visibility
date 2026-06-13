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

## Activate (3 steps)

1. **Create a token** with write access to your repos:
   - Recommended: a **fine-grained PAT** → Settings → Developer settings →
     Fine-grained tokens. Resource owner: you. Repository access: *All
     repositories*. Permissions: **Contents: Read and write** (add
     **Workflows: Read and write** only if you want it to touch workflow
     files). Set an expiry and calendar a rotation.
   - Or a classic PAT with the `repo` scope.
2. **Add it as a secret** named `GH_MAINTENANCE_TOKEN` on your host repo
   (Settings → Secrets and variables → Actions → New repository secret).
3. **Install the workflow**: copy `account-maintenance/account-maintenance.yml`
   to `.github/workflows/account-maintenance.yml` on the host repo's
   **default branch**, and make sure the `account-maintenance/` folder lives
   at that repo's root.
   > Note: `m365-leave-visibility`'s current default branch is a `claude/*`
   > branch. Scheduled workflows run **only from the default branch**, so set a
   > sensible default (e.g. `main`) or host this kit elsewhere — `it-support-scripts`
   > is a natural home.

**Test before trusting it:** run it manually first — Actions tab → run
`account-maintenance` with *Dry run* checked. It prints what it *would* commit
without changing anything. When happy, run it un-checked or wait for the cron.

You can also dry-run locally:

```bash
export GH_MAINTENANCE_TOKEN=ghp_xxx
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
