@echo off
rem Double-click to remove Agentviewer (keeps settings in %USERPROFILE%\.agentviewer).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Agentviewer\uninstall.ps1" %*
echo.
pause
