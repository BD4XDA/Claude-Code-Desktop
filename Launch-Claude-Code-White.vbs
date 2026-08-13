Option Explicit

Dim shell, fileSystem, projectRoot, powerShell, launcher, arguments, adminMode, validateMode
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

projectRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShell = shell.ExpandEnvironmentStrings("%WINDIR%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
launcher = projectRoot & "\Start-Claude-Code-White.ps1"
arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & launcher & """"
adminMode = False
validateMode = False
If WScript.Arguments.Count > 0 Then
  adminMode = LCase(WScript.Arguments(0)) = "/admin"
  validateMode = LCase(WScript.Arguments(0)) = "/validate"
End If

If validateMode Then WScript.Quit 0

If adminMode Then
  Dim application
  Set application = CreateObject("Shell.Application")
  application.ShellExecute powerShell, arguments, projectRoot, "runas", 0
Else
  shell.Run """" & powerShell & """ " & arguments, 0, False
End If
