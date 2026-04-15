' Helbling Rapporte – Hintergrund-Starter (kein CMD-Fenster)
' Wird vom Windows Task Scheduler beim Anmelden aufgerufen.

Dim fso, scriptDir, shell

Set fso    = CreateObject("Scripting.FileSystemObject")
Set shell  = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = scriptDir

' Logs-Ordner erstellen falls nicht vorhanden
If Not fso.FolderExists(scriptDir & "\logs") Then
    fso.CreateFolder(scriptDir & "\logs")
End If

' Node.js starten (Port 3000, Ausgabe in logs\node.log)
shell.Run "cmd /c node server.js > """ & scriptDir & "\logs\node.log"" 2>&1", 0, False

' 5 Sekunden warten damit Node hochfaehrt
WScript.Sleep 5000

' Caddy starten (HTTPS + automatisches Let's Encrypt Zertifikat)
shell.Run "cmd /c caddy run > """ & scriptDir & "\logs\caddy.log"" 2>&1", 0, False
