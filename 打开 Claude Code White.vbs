Option Explicit

Dim shell, fileSystem, projectRoot, launcher
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
projectRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
launcher = projectRoot & "\Launch-Claude-Code-White.vbs"
shell.Run "wscript.exe """ & launcher & """", 0, False
