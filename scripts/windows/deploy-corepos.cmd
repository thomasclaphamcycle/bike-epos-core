@echo off
cd /d C:\CorePOS

git pull
if errorlevel 1 exit /b 1

call npm install --include=dev
if errorlevel 1 exit /b 1

cd /d C:\CorePOS\frontend
set VITE_API_PROXY_TARGET=http://localhost:3000
call npm install --include=dev
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1

cd /d C:\CorePOS
call npx prisma migrate deploy
if errorlevel 1 exit /b 1

call C:\Users\coreposadmin\AppData\Roaming\npm\pm2.cmd restart corepos-backend
if errorlevel 1 exit /b 1

exit /b 0