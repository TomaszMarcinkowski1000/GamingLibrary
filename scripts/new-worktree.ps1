#requires -Version 5.1
<#
.SYNOPSIS
  Create a git worktree and copy the gitignored files a fresh checkout needs.

.DESCRIPTION
  `git worktree add` only checks out TRACKED files. Local secrets and the
  Claude permission allowlist are gitignored, so a new worktree starts without
  them: the dev server can't run and Claude re-prompts for every command.

  This wrapper runs `git worktree add` and then copies a fixed list of
  untracked files from the main repo into the new worktree.

.EXAMPLE
  ./scripts/new-worktree.ps1 -Name mark-play-status
  # -> ../GamingLibrary-mark-play-status on branch plan/mark-play-status (from main)

.EXAMPLE
  ./scripts/new-worktree.ps1 -Name photo-id -Branch research/photo-identification-spike

.EXAMPLE
  ./scripts/new-worktree.ps1 -Name hotfix -Branch fix/login -Base origin/main
#>
[CmdletBinding()]
param(
  # Short slug. Worktree dir becomes ../GamingLibrary-<Name>.
  [Parameter(Mandatory)] [string] $Name,

  # Branch to create or attach. Defaults to plan/<Name>.
  [string] $Branch,

  # Base ref for a newly created branch.
  [string] $Base = "main"
)

$ErrorActionPreference = "Stop"

# Files that are gitignored but every worktree needs a local copy of.
# Add to this list if a new local-only file shows up.
$PropagateFiles = @(
  ".dev.vars",
  ".env",
  ".claude/settings.local.json"
)

# Resolve the main repo root (this script lives in <root>/scripts).
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepoName = Split-Path $RepoRoot -Leaf
$ParentDir = Split-Path $RepoRoot -Parent

if (-not $Branch) { $Branch = "plan/$Name" }
$WorktreePath = Join-Path $ParentDir "$RepoName-$Name"

if (Test-Path $WorktreePath) {
  throw "Target already exists: $WorktreePath"
}

# Does the branch already exist?
& git -C $RepoRoot show-ref --verify --quiet "refs/heads/$Branch"
$branchExists = $?

Write-Host "Creating worktree: $WorktreePath" -ForegroundColor Cyan
if ($branchExists) {
  Write-Host "  attaching existing branch '$Branch'" -ForegroundColor Cyan
  & git -C $RepoRoot worktree add $WorktreePath $Branch
} else {
  Write-Host "  creating branch '$Branch' from '$Base'" -ForegroundColor Cyan
  & git -C $RepoRoot worktree add -b $Branch $WorktreePath $Base
}
if ($LASTEXITCODE -ne 0) { throw "git worktree add failed (exit $LASTEXITCODE)" }

# Copy the gitignored local files.
Write-Host "Copying local-only files:" -ForegroundColor Cyan
foreach ($rel in $PropagateFiles) {
  $src = Join-Path $RepoRoot $rel
  if (-not (Test-Path $src)) {
    Write-Host "  skip  $rel (not present in main repo)" -ForegroundColor DarkGray
    continue
  }
  $dst = Join-Path $WorktreePath $rel
  $dstDir = Split-Path $dst -Parent
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Write-Host "  copy  $rel" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. cd into it with:" -ForegroundColor Cyan
Write-Host "  cd `"$WorktreePath`"" -ForegroundColor White
