Option Explicit

Dim resultPath, dialogTitle, shell, folder, fileSystem, output
resultPath = WScript.Arguments(0)
dialogTitle = WScript.Arguments(1)

Set shell = CreateObject("Shell.Application")
Set folder = shell.BrowseForFolder(0, dialogTitle, 65, 17)

Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set output = fileSystem.CreateTextFile(resultPath, True, True)
If Not folder Is Nothing Then
  output.Write folder.Self.Path
End If
output.Close
