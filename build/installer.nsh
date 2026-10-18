!macro customUnInstall
  ; Remove only the startup entry owned by this application.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Mori GPT Pet"
!macroend
