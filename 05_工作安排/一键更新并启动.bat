@echo off
chcp 936 >nul
cd /d "%~dp0"
title 质检部工作安排台 - 更新并启动

set NPM=C:\Users\HUAWEI\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
set NPM_DIR=%CD%\web\node_modules
set PY=C:\Users\HUAWEI\AppData\Local\Programs\Python\Python313\python.exe
set URL=http://127.0.0.1:8766
if not exist "%PY%" set PY=python

echo.
echo   [1/3] 关闭旧服务...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8766 ^| findstr LISTENING') do (
  taskkill /F /PID %%p >nul 2>&1
)

echo   [2/3] 构建前端...
cd web
if exist "%NPM%" (
  call "%NPM%" "%NPM_DIR%\typescript\bin\tsc" -b
  call "%NPM%" "%NPM_DIR%\vite\bin\vite.js" build
) else (
  echo   未找到 Node，跳过构建（将使用已有产物）
)
cd ..

echo   [3/3] 启动服务...
start "" /b "%PY%" engine\main.py

set /a TRIES=0
:WAIT
set /a TRIES+=1
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%/api/health').StatusCode|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto READY
if %TRIES% geq 25 goto FAIL
ping -n 2 127.0.0.1 >nul
goto WAIT

:READY
echo   已就绪，正在打开浏览器...
start "" "%URL%"
echo.
echo   关闭本窗口即停止服务。
echo.
pause
exit /b 0

:FAIL
echo.
echo   启动失败。请检查 Python 是否可用，或端口 8766 是否被占用。
echo.
pause
exit /b 1
