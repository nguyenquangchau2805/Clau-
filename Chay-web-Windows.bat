@echo off
cd /d "%~dp0"
title SAT Practice
echo %~dp0 | find /i "\Temp\" >nul
if not errorlevel 1 (
  echo Ban dang chay file ngay trong file ZIP. Hay bam chuot phai vao file ZIP, chon "Extract All" ^(Giai nen^),
  echo roi mo thu muc vua giai nen va bam dup file nay.
  pause
  exit /b
)
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Dang mo trang tai Node.js - hay cai ban LTS roi bam lai file nay.
  start "" https://nodejs.org
  pause
  exit /b
)
if not exist node_modules (
  echo Lan dau chay: dang cai thu vien, doi khoang 1 phut...
  call npm install
  if errorlevel 1 (
    echo Cai thu vien bi loi. Kiem tra mang Internet roi thu lai.
    pause
    exit /b
  )
)
set OPEN_BROWSER=1
node server.js
pause
