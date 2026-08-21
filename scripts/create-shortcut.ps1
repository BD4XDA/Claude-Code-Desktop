# Create one-click desktop shortcuts for Claude Code White.

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Desktop = [Environment]::GetFolderPath('Desktop')
$WScript = "$env:WINDIR\System32\wscript.exe"
$Launcher = Join-Path $ProjectRoot 'Launch-Claude-Code-White.vbs'
$Icon = Join-Path $ProjectRoot 'public\Claude-Code-White-Light.ico'
$ClaudeIcon = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\claude.exe'
$IconSource = if (Test-Path -LiteralPath $Icon) { $Icon } elseif (Test-Path -LiteralPath $ClaudeIcon) { $ClaudeIcon } else { $WScript }

$shell = New-Object -ComObject WScript.Shell

$shortcutPath = Join-Path $Desktop 'Claude Code White.lnk'
$link = $shell.CreateShortcut($shortcutPath)
$link.TargetPath = $WScript
$link.Arguments = "`"$Launcher`""
$link.WorkingDirectory = $ProjectRoot
$link.Description = '一键启动 Claude Code White'
$link.IconLocation = "$IconSource,0"
$link.WindowStyle = 7
$link.Save()

$adminPath = Join-Path $Desktop 'Claude Code White（管理员）.lnk'
$admin = $shell.CreateShortcut($adminPath)
$admin.TargetPath = $WScript
$admin.Arguments = "`"$Launcher`" /admin"
$admin.WorkingDirectory = $ProjectRoot
$admin.Description = '以管理员身份启动 Claude Code White'
$admin.IconLocation = "$IconSource,0"
$admin.WindowStyle = 7
$admin.Save()

Write-Host "已创建桌面快捷方式：$shortcutPath" -ForegroundColor Green
Write-Host "已更新管理员快捷方式：$adminPath" -ForegroundColor Green
