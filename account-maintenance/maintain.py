#!/usr/bin/env python3
"""Account-wide repository maintenance orchestrator.

Runs from ONE host repo (via a scheduled GitHub Action) and performs real,
low-risk maintenance across every repository you own, committing changes
under YOUR identity so they attribute to you on GitHub.

Design goals:
  * Honest: only commits when a task actually changes files. No filler.
  * Safe:   per-repo isolation; one repo failing never aborts the run.
  * Yours:  author + committer are set to you, not a bot.

It is stdlib-only (no pip install needed to list/clone/commit). Optional
formatters / dependency tools are used only if present on PATH.

Usage:
    python maintain.py [--dry-run] [--config PATH] [--only REPO[,REPO...]]

Auth:
    Set GH_MAINTENANCE_TOKEN to a token with Contents: read & write on your
    repos. Without it, the script forces --dry-run.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

API = "https://api.github.com"
HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE / "maintenance.config.json"


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def log(msg: str) -> None:
    print(msg, flush=True)


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None,
        check: bool = True) -> subprocess.CompletedProcess:
    """Run a command, capturing output. Raises on non-zero unless check=False."""
    return subprocess.run(
        cmd, cwd=str(cwd) if cwd else None, env=env,
        text=True, capture_output=True, check=check,
    )


def have(tool: str) -> bool:
    return shutil.which(tool) is not None


# --------------------------------------------------------------------------- #
# GitHub API
# --------------------------------------------------------------------------- #
def gh_get(path: str, token: str) -> list | dict:
    req = urllib.request.Request(
        f"{API}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "account-maintenance-script",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def list_owned_repos(token: str) -> list[dict]:
    """Every repo the authenticated user owns (public + private)."""
    repos: list[dict] = []
    page = 1
    while True:
        batch = gh_get(
            f"/user/repos?affiliation=owner&per_page=100&page={page}", token
        )
        if not batch:
            break
        repos.extend(batch)
        page += 1
    return repos


# --------------------------------------------------------------------------- #
# Maintenance tasks. Each returns True if it changed files in `repo_dir`.
# --------------------------------------------------------------------------- #
def task_license_year(repo_dir: Path) -> bool:
    """Refresh the copyright year in a LICENSE file (safe, occasional)."""
    changed = False
    year = date.today().year
    for name in ("LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"):
        path = repo_dir / name
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")

        def bump(m: re.Match) -> str:
            start = m.group("start")
            return f"{start}-{year}" if int(start) < year else start

        # Matches "2020" or "2020-2024" right after a copyright marker.
        new = re.sub(
            r"(?i)(copyright\D{0,12})(?P<start>\d{4})(?:\s*-\s*\d{4})?",
            lambda m: m.group(1) + bump(m),
            text,
        )
        if new != text:
            path.write_text(new, encoding="utf-8")
            changed = True
    return changed


def _node_uses_prettier(repo_dir: Path) -> bool:
    if any((repo_dir / c).exists() for c in (
        ".prettierrc", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml",
        ".prettierrc.js", "prettier.config.js", ".prettierrc.cjs",
    )):
        return True
    pkg = repo_dir / "package.json"
    if pkg.is_file():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return False
        if "prettier" in data:
            return True
        deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
        return "prettier" in deps
    return False


def _python_uses_black(repo_dir: Path) -> bool:
    pyproject = repo_dir / "pyproject.toml"
    if pyproject.is_file() and "[tool.black]" in pyproject.read_text(
        encoding="utf-8", errors="ignore"
    ):
        return True
    setup_cfg = repo_dir / "setup.cfg"
    return setup_cfg.is_file() and "[black]" in setup_cfg.read_text(
        encoding="utf-8", errors="ignore"
    )


def task_format(repo_dir: Path) -> bool:
    """Run a formatter ONLY if the repo already opts into it. Never imposes a
    style the project didn't choose, so this is a safe no-op for most repos."""
    ran = False
    if _node_uses_prettier(repo_dir) and have("npx"):
        run(["npx", "--yes", "prettier", "--write", "."],
            cwd=repo_dir, check=False)
        ran = True
    if _python_uses_black(repo_dir) and have("black"):
        run(["black", "."], cwd=repo_dir, check=False)
        ran = True
    return ran and _has_unstaged_changes(repo_dir)


def task_deps(repo_dir: Path, cfg: dict) -> bool:
    """Bump dependencies. Opt-in & conservative (minor/patch by default).
    Optionally gated on the project's own tests passing."""
    changed = False
    target = cfg.get("npm_target", "minor")  # 'latest' | 'minor' | 'patch'
    require_tests = cfg.get("require_passing_tests", True)

    pkg = repo_dir / "package.json"
    if pkg.is_file() and have("npx"):
        run(["npx", "--yes", "npm-check-updates", "-u", "--target", target],
            cwd=repo_dir, check=False)
        run(["npm", "install", "--package-lock-only", "--no-audit", "--no-fund"],
            cwd=repo_dir, check=False)
        if _has_unstaged_changes(repo_dir):
            if require_tests and _npm_has_test_script(pkg):
                run(["npm", "install", "--no-audit", "--no-fund"],
                    cwd=repo_dir, check=False)
                res = run(["npm", "test"], cwd=repo_dir, check=False)
                if res.returncode != 0:
                    log("      tests failed after bump -> reverting deps")
                    run(["git", "checkout", "--", "."], cwd=repo_dir, check=False)
                    return False
            changed = True

    req = repo_dir / "requirements.txt"
    if req.is_file() and have("pur"):
        run(["pur", "-r", "requirements.txt"], cwd=repo_dir, check=False)
        changed = changed or _has_unstaged_changes(repo_dir)

    return changed


def _npm_has_test_script(pkg: Path) -> bool:
    try:
        data = json.loads(pkg.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    test = data.get("scripts", {}).get("test", "")
    return bool(test) and "no test specified" not in test


def _has_unstaged_changes(repo_dir: Path) -> bool:
    res = run(["git", "status", "--porcelain"], cwd=repo_dir, check=False)
    return bool(res.stdout.strip())


# --------------------------------------------------------------------------- #
# Per-repo processing
# --------------------------------------------------------------------------- #
def select_repos(repos: list[dict], cfg: dict, only: set[str]) -> list[dict]:
    include = set(cfg.get("include", []))
    exclude = set(cfg.get("exclude", []))
    out = []
    for r in repos:
        name = r["name"]
        if only and name not in only:
            continue
        if include and name not in include:
            continue
        if name in exclude:
            continue
        if cfg.get("skip_forks", True) and r.get("fork"):
            continue
        if cfg.get("skip_archived", True) and r.get("archived"):
            continue
        if cfg.get("skip_private", False) and r.get("private"):
            continue
        out.append(r)
    return out


def process_repo(repo: dict, cfg: dict, token: str, dry_run: bool) -> str:
    name = repo["name"]
    branch = repo["default_branch"]
    author = cfg["author"]
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": author["name"],
        "GIT_AUTHOR_EMAIL": author["email"],
        "GIT_COMMITTER_NAME": author["name"],
        "GIT_COMMITTER_EMAIL": author["email"],
    }
    tmp = Path(tempfile.mkdtemp(prefix=f"maint-{name}-"))
    repo_dir = tmp / name
    try:
        clone_url = f"https://x-access-token:{token}@github.com/{repo['full_name']}.git"
        run(["git", "clone", "--depth", "1", "--branch", branch,
             clone_url, str(repo_dir)], env=env)

        tasks = cfg.get("tasks", {})
        applied: list[str] = []
        if tasks.get("license_year", True) and task_license_year(repo_dir):
            applied.append("license-year")
        if tasks.get("format", True) and task_format(repo_dir):
            applied.append("format")
        if tasks.get("deps", False) and task_deps(repo_dir, cfg.get("deps", {})):
            applied.append("deps")

        if not _has_unstaged_changes(repo_dir):
            return f"  - {name}: no changes"

        summary = ", ".join(applied) or "maintenance"
        if dry_run:
            diff = run(["git", "diff", "--stat"], cwd=repo_dir, check=False)
            log(f"  ~ {name}: WOULD commit ({summary})\n"
                + "\n".join("      " + l for l in diff.stdout.splitlines()))
            return f"  ~ {name}: would commit ({summary})"

        message = cfg.get("commit", {}).get(
            "message", "chore: automated maintenance")
        run(["git", "add", "-A"], cwd=repo_dir, env=env)
        run(["git", "commit", "-m", f"{message}\n\n[{summary}]"],
            cwd=repo_dir, env=env)
        _push_with_retry(repo_dir, branch, env)
        return f"  + {name}: committed ({summary})"
    except subprocess.CalledProcessError as exc:
        return f"  ! {name}: ERROR {(exc.stderr or exc.stdout or '').strip()[:200]}"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _push_with_retry(repo_dir: Path, branch: str, env: dict) -> None:
    import time
    delay = 2
    for attempt in range(4):
        res = run(["git", "push", "origin", f"HEAD:{branch}"],
                  cwd=repo_dir, env=env, check=False)
        if res.returncode == 0:
            return
        if attempt == 3:
            raise subprocess.CalledProcessError(
                res.returncode, "git push", res.stdout, res.stderr)
        time.sleep(delay)
        delay *= 2


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would change without committing.")
    parser.add_argument("--only", default="",
                        help="Comma-separated repo names to limit the run to.")
    args = parser.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    only = {s.strip() for s in args.only.split(",") if s.strip()}

    token = os.environ.get("GH_MAINTENANCE_TOKEN", "")
    dry_run = args.dry_run or not token
    if not token:
        log("No GH_MAINTENANCE_TOKEN set -> forcing --dry-run "
            "(cannot list/clone/push without it).")
        return 0

    log("Listing owned repositories...")
    repos = list_owned_repos(token)
    targets = select_repos(repos, cfg, only)
    log(f"{len(targets)} repo(s) in scope "
        f"(of {len(repos)} owned). dry_run={dry_run}\n")

    results = [process_repo(r, cfg, token, dry_run) for r in targets]

    log("\n=== Summary ===")
    for line in results:
        log(line)
    errors = [r for r in results if r.lstrip().startswith("!")]
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
