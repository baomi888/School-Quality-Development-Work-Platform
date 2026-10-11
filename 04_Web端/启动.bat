@echo off
cd /d "%~dp0"
chcp 936 >nul
title 质检部周工作平台

set "PY=C:\Users\HUAWEI\AppData\Local\Programs\Python\Python313\python.exe"
if not exist "%PY%" set "PY=python"

set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%"

echo.
echo   ============================================
echo     质检部周工作平台  正在启动...
echo   ============================================
echo.
echo   平台首页  %URL%/    （一学期一条线 + 四个工作台）
echo.

start "" /b "%PY%" engine\main.py

setlocal enabledelayedexpansion
echo   正在等待服务就绪...
set "READY=0"
for /l %%n in (1,1,40) do (
  if "!READY!"=="0" (
    powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%/api/health')|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
    if not errorlevel 1 (
      set "READY=1"
    ) else (
      ping -n 2 127.0.0.1 >nul
    )
  )
)
endlocal & if "%READY%"=="1" (echo         服务已就绪) else (echo         等待超时，仍尝试打开浏览器)
start "" "%URL%/"
echo.
echo   服务在后台运行，关掉这个窗口即停止。
pause >nul

echo.
echo   服务已停止。