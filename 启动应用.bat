@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\electron\package.json" (
  echo Installing npm dependencies first-run may take minutes...
  call npm install --no-fund --no-audit --loglevel=error
  if errorlevel 1 exit /b 1
)
call npm start
if errorlevel 1 pause
