@echo off
setlocal
title HERMES - Windows fejlesztoi teszttelepito
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-workstation.ps1" -Demo %*
if errorlevel 1 (
  echo.
  echo A telepites nem fejezodott be. A hiba reszletei fent olvashatok.
  pause
  exit /b 1
)
echo.
echo A fejlesztoi tesztkornyezet elkeszult.
pause
