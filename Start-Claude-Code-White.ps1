# Claude Code White — one-click local launcher
# Reuses a healthy instance, otherwise starts one on a free port, waits until
# the page and bridge are ready, then opens it in a Chrome app window.

[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$Foreground,
  [int]$PreferredPort = 3000
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$StateDir = Join-Path $env:LOCALAPPDATA 'ClaudeCodeWhite'
$StateFile = Join-Path $StateDir 'launcher.json'
$LogFile = Join-Path $StateDir 'server.log'
$ErrFile = Join-Path $StateDir 'server-error.log'

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Test-ClaudeCodeWhite([int]$Port, [int]$TimeoutMs = 1200) {
  try {
    $request = [Net.HttpWebRequest]::Create("http://localhost:$Port/api/status")
    $request.Timeout = $TimeoutMs
    $request.ReadWriteTimeout = $TimeoutMs
    $request.Proxy = $null
    $response = $request.GetResponse()
    try {
      if ([int]$response.StatusCode -ne 200) { return $false }
      $reader = New-Object IO.StreamReader($response.GetResponseStream())
      $payload = $reader.ReadToEnd() | ConvertFrom-Json
      # 实时插话由协议 6 引入。旧进程不能继续复用。
      return [bool]$payload.bridge -and [int]$payload.bridgeProtocol -ge 9
    } finally { $response.Close() }
  } catch { return $false }
}

function Get-RememberedPort {
  try {
    if (Test-Path -LiteralPath $StateFile) {
      $state = Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($state.port -as [int]) { return [int]$state.port }
    }
  } catch { }
  return 0
}

function Find-HealthyPort {
  $candidates = @((Get-RememberedPort), $PreferredPort) + (3000..3019) | Select-Object -Unique
  foreach ($candidate in $candidates) {
    if ($candidate -gt 0 -and (Test-ClaudeCodeWhite $candidate 350)) { return [int]$candidate }
  }
  return 0
}

function Find-FreePort([int]$Start) {
  foreach ($candidate in $Start..($Start + 19)) {
    $listener = $null
    try {
      $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $candidate)
      $listener.Start()
      return $candidate
    } catch { }
    finally { if ($listener) { $listener.Stop() } }
  }
  throw '3000–3019 端口均被占用，无法启动 Claude Code White。'
}

function Find-Chrome {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe' }),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  return $candidates | Select-Object -First 1
}

function Open-ClaudeCodeWhite([int]$Port) {
  $url = "http://localhost:$Port/"
  $chrome = Find-Chrome
  if ($chrome) {
    Start-Process -FilePath $chrome -ArgumentList @("--app=$url", '--start-maximized')
  } else {
    Start-Process $url
  }
}

$healthyPort = Find-HealthyPort
if ($healthyPort -gt 0) {
  if (-not $NoBrowser) { Open-ClaudeCodeWhite $healthyPort }
  Write-Host "Claude Code White 已就绪：http://localhost:$healthyPort/" -ForegroundColor Green
  exit 0
}

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $npm -or -not $node) {
  Add-Type -AssemblyName PresentationFramework
  [Windows.MessageBox]::Show('未检测到 Node.js/npm，请先安装 Node.js 22 或更高版本。', 'Claude Code White') | Out-Null
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules\vinext\dist\cli.js'))) {
  Write-Host '首次运行：正在准备所需组件…' -ForegroundColor Cyan
  Push-Location $ProjectRoot
  try { & $npm install --no-audit --no-fund }
  finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw '所需组件准备失败，请检查网络后重试。' }
}

$port = Find-FreePort $PreferredPort
Remove-Item -LiteralPath $LogFile,$ErrFile -Force -ErrorAction SilentlyContinue
$runner = Join-Path $ProjectRoot 'scripts\run-vinext.mjs'
$arguments = @("`"$runner`"", 'dev', '--host', 'localhost', '--port', [string]$port, '--strictPort')

if ($Foreground) {
  Set-Location -LiteralPath $ProjectRoot
  Write-Host "Claude Code White 正在启动：http://localhost:$port/" -ForegroundColor Cyan
  & $node $runner 'dev' '--host' 'localhost' '--port' ([string]$port) '--strictPort'
  exit $LASTEXITCODE
}

$process = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile -PassThru
@{ port = $port; pid = $process.Id; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8

$ready = $false
for ($attempt = 0; $attempt -lt 80; $attempt++) {
  if (Test-ClaudeCodeWhite $port 700) { $ready = $true; break }
  if ($process.HasExited) { break }
  Start-Sleep -Milliseconds 250
}

if (-not $ready) {
  $details = if (Test-Path -LiteralPath $ErrFile) { (Get-Content -LiteralPath $ErrFile -Tail 12 -ErrorAction SilentlyContinue) -join "`n" } else { '' }
  Add-Type -AssemblyName PresentationFramework
  [Windows.MessageBox]::Show("启动失败。请把下面的内容发给我：`n`n$details", 'Claude Code White') | Out-Null
  exit 1
}

if (-not $NoBrowser) { Open-ClaudeCodeWhite $port }
Write-Host "Claude Code White 已就绪：http://localhost:$port/" -ForegroundColor Green
