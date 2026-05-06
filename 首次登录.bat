@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 云邮教学空间 - 首次登录
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\tee-login.ps1"
set ERR=%ERRORLEVEL%
echo.
echo ============================================================
if %ERR% neq 0 (
  echo [Exit code %ERR%] See messages above or login_last_run.log
) else (
  echo [Done] Login state saved under browser_profile next to config.
)
echo.
echo Full log: %~dp0login_last_run.log
echo Press any key to close...
pause >nul
endlocal
exit /b %ERR%
