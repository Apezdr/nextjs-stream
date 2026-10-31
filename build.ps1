# build.ps1
# Build the nextjs-stream image and push it to Docker Hub.
#
# The tag is the version: today's date, plus -2, -3, ... when that date is
# already on Docker Hub (2026.10.31, 2026.10.31-2). The image carries it, and
# the commit it was built from, as APP_VERSION and GIT_COMMIT; the app reports
# them to OpenTelemetry as service.version and vcs.ref.head.revision.
#
# The image is built from a clean checkout of one commit (a temporary git
# worktree), so uncommitted or untracked files never reach it. By default that
# commit is origin/main, and a push is refused when:
#   - the commit is not on origin/main, or
#   - local main has commits origin/main lacks. An image built then would
#     miss them, the way 2026.10.29 missed the deployed but unpushed
#     watch-threshold commits.
#   - :latest is already that commit. A new version should mean a change:
#     2026.10.31-3 and -4 were two images of one commit, each a Docker Hub tag
#     and a SigNoz deployment marker for nothing. -Force rebuilds it anyway,
#     for a patched base image, say.
#
# Usage:
#   .\build.ps1                  # build origin/main, push :<tag> and :latest
#   .\build.ps1 -DryRun          # print the tag, commit and commands, do nothing
#   .\build.ps1 -NoPush          # build and tag :<tag> locally only (:latest stays put)
#   .\build.ps1 -Ref my-branch -NoPush   # try another commit (it can't be pushed)
#   .\build.ps1 -Tag 2026.11.01-4        # use this tag instead of picking one
#   .\build.ps1 -Force           # rebuild and push the commit :latest already is

param(
    [string]$Ref = 'origin/main',
    [string]$Tag,
    [switch]$NoPush,
    [switch]$DryRun,
    [switch]$Force
)

$repo = 'membersolo/nextjs-stream'
$hubTagsUrl = 'https://hub.docker.com/v2/namespaces/membersolo/repositories/nextjs-stream/tags'

function Fail([string]$message) {
    Write-Host $message -ForegroundColor Red
    exit 1
}

# git runs against this script's repo wherever it is called from. Native
# commands report failure through the exit code, so check that, not the output.
function Invoke-Git {
    $output = & git -C $PSScriptRoot @args
    if ($LASTEXITCODE -ne 0) { Fail "git $($args -join ' ') failed (exit $LASTEXITCODE)" }
    return $output
}

# The commit and version a published tag was built from: its OCI labels, read
# from the registry without pulling the image. $null when the tag doesn't exist
# yet or predates the labels.
function Get-PublishedBuild([string]$ref) {
    $answer = docker buildx imagetools inspect $ref --format '{{json .Image}}' 2>&1
    if ($LASTEXITCODE -ne 0) {
        if ("$answer" -match 'not found') { return $null }
        Fail "Could not read $ref from the registry ($answer). -Force skips this check."
    }
    $image = ($answer | Out-String) | ConvertFrom-Json
    # A multi-platform tag answers with one image per platform
    if (-not $image.config) { $image = @($image.PSObject.Properties.Value)[0] }
    $labels = $image.config.Labels
    if (-not $labels -or -not $labels.'org.opencontainers.image.revision') { return $null }
    return @{ commit = $labels.'org.opencontainers.image.revision'; version = $labels.'org.opencontainers.image.version' }
}

# --- Which commit -------------------------------------------------------------
Write-Host "Fetching origin..." -ForegroundColor Cyan
Invoke-Git fetch origin --quiet | Out-Null
$commit = ([string](Invoke-Git rev-parse --verify "$Ref^{commit}")).Trim()
$short = $commit.Substring(0, 7)

& git -C $PSScriptRoot merge-base --is-ancestor $commit origin/main
$onMain = ($LASTEXITCODE -eq 0)
$unpushed = 0
$hasMain = & git -C $PSScriptRoot rev-parse --verify --quiet main
if ($LASTEXITCODE -eq 0 -and $hasMain) { $unpushed = [int](Invoke-Git rev-list --count origin/main..main) }

if (-not $NoPush) {
    if (-not $onMain) { Fail "$Ref ($short) is not on origin/main. Only main ships; use -NoPush to try it." }
    if ($unpushed -gt 0) { Fail "Local main has $unpushed commit(s) origin/main lacks. Push them first, or the image will miss them." }
    if (-not $Force) {
        $published = Get-PublishedBuild "${repo}:latest"
        if ($published -and $published.commit -eq $commit) {
            Fail "${repo}:latest ($($published.version)) is already $short, so there is nothing new to ship. -Force rebuilds it anyway (for a patched base image, say)."
        }
    }
}

# --- Which tag ----------------------------------------------------------------
if (-not $Tag) {
    $date = Get-Date -Format 'yyyy.MM.dd'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try {
        $page = Invoke-RestMethod -Uri "${hubTagsUrl}?name=$date&page_size=100" -TimeoutSec 20 -ErrorAction Stop
    } catch {
        Fail "Could not read the existing tags from Docker Hub ($($_.Exception.Message)). Pass -Tag to choose one."
    }
    $taken = @($page.results | ForEach-Object { $_.name } | Where-Object { $_ -eq $date -or $_ -match "^$([regex]::Escape($date))-\d+$" })
    if ($taken.Count -eq 0) {
        $Tag = $date
    } else {
        $highest = ($taken | ForEach-Object { if ($_ -eq $date) { 1 } else { [int]($_ -replace '^.*-', '') } } | Measure-Object -Maximum).Maximum
        $Tag = "$date-$($highest + 1)"
    }
}

$image = "${repo}:$Tag"
$latest = "${repo}:latest"
# Only a build that ships moves :latest, so a -NoPush test can't be pushed by
# a later `docker push ...:latest`
$tagArgs = @('-t', $image)
if (-not $NoPush) { $tagArgs += @('-t', $latest) }
Write-Host ""
Write-Host "  commit  $commit ($Ref)" -ForegroundColor Cyan
Write-Host "  tags    $image$(if (-not $NoPush) { ", $latest" })" -ForegroundColor Cyan
Write-Host "  push    $(if ($NoPush) { 'no' } else { 'yes' })" -ForegroundColor Cyan
if (-not $onMain) { Write-Host "  note    not on origin/main" -ForegroundColor Yellow }
if ($unpushed -gt 0) { Write-Host "  note    local main has $unpushed unpushed commit(s)" -ForegroundColor Yellow }
Write-Host ""

if ($DryRun) {
    Write-Host "Dry run: would build $commit in a temporary worktree with" -ForegroundColor Yellow
    Write-Host "  docker build --build-arg APP_VERSION=$Tag --build-arg GIT_COMMIT=$commit $($tagArgs -join ' ') <worktree>"
    if (-not $NoPush) { Write-Host "  docker push $image; docker push $latest" }
    exit 0
}

# --- Build from a clean checkout ----------------------------------------------
$worktree = Join-Path ([IO.Path]::GetTempPath()) "nextjs-stream-build-$short"
if (Test-Path $worktree) { Remove-Item -Recurse -Force $worktree -ErrorAction SilentlyContinue }
& git -C $PSScriptRoot worktree prune
Invoke-Git worktree add --detach --quiet $worktree $commit | Out-Null
try {
    docker build --progress=plain `
        --build-arg "APP_VERSION=$Tag" `
        --build-arg "GIT_COMMIT=$commit" `
        @tagArgs $worktree
    # A failed build must not fall through to a push: docker push would send
    # whatever image already carries the tag
    if ($LASTEXITCODE -ne 0) { Fail "docker build failed (exit $LASTEXITCODE); nothing was pushed" }
} finally {
    & git -C $PSScriptRoot worktree remove --force $worktree
}

# Read the labels as JSON: Windows PowerShell 5.1 strips the double quotes a
# Go template's `index` needs before docker sees them
$labels = docker image inspect $image --format '{{json .Config.Labels}}' | ConvertFrom-Json
$labelled = $labels.'org.opencontainers.image.version'
if ($labelled -ne $Tag) { Fail "$image is labelled '$labelled', expected '$Tag'; nothing was pushed" }

if ($NoPush) {
    Write-Host "Built $image ($short). Not pushed." -ForegroundColor Green
    exit 0
}

# --- Push ---------------------------------------------------------------------
foreach ($name in @($image, $latest)) {
    Write-Host "Pushing $name..." -ForegroundColor Cyan
    docker push $name
    if ($LASTEXITCODE -ne 0) { Fail "docker push $name failed (exit $LASTEXITCODE)" }
}

$digest = @(docker image inspect $image --format '{{json .RepoDigests}}' | ConvertFrom-Json) | Select-Object -First 1
Write-Host ""
Write-Host "Pushed $image and $latest ($short)" -ForegroundColor Green
Write-Host "  digest  $digest" -ForegroundColor Green
Write-Host "  deploy  docker compose pull nextjs-stream; docker compose up -d --no-deps nextjs-stream" -ForegroundColor Green
