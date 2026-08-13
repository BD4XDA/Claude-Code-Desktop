# Claude Code White - admin launcher
# Usage:  powershell -NoExit -ExecutionPolicy Bypass -File scripts\start-admin.ps1
# - Spawns UAC elevation if not already admin (use -NoElevate to skip)
# - Runs `npm run dev` as administrator so the vite dev server, the local
#   bridge (bridge/server.mjs) and every spawned Claude Code CLI child
#   inherit admin rights.

[CmdletBinding()]
param([switch]$NoElevate)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin -and -not $NoElevate) {
  # Re-launch elevated (UAC prompt), keep window open, avoid recursion.
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
    '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-NoElevate'
  )
  exit
}
if (-not $isAdmin) { throw 'Administrator rights required.' }

$Host.UI.RawUI.WindowTitle = 'Claude Code White（管理员）'
& (Join-Path $ProjectRoot 'Start-Claude-Code-White.ps1')
