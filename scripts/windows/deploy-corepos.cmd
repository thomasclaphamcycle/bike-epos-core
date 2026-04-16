@echo off
cd /d C:\CorePOS

git pull
if errorlevel 1 exit /b 1

call npm install --include=dev
if errorlevel 1 exit /b 1

cd /d C:\CorePOS\frontend
set VITE_API_PROXY_TARGET=http://localhost:3100
call npm install --include=dev
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1

cd /d C:\CorePOS
call npx prisma migrate deploy
if errorlevel 1 exit /b 1

call C:\Users\coreposadmin\AppData\Roaming\npm\pm2.cmd restart corepos-backend
if errorlevel 1 exit /b 1
call C:\Users\coreposadmin\AppData\Roaming\npm\pm2.cmd restart corepos-frontend
if errorlevel 1 exit /b 1

REM === Run production validator ===
powershell -ExecutionPolicy Bypass -File C:\CorePOS\scripts\validate_windows_production.ps1
if errorlevel 1 exit /b 1

exit /b 0
