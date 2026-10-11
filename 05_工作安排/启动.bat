@echo off
chcp 936 >nul
cd /d "%~dp0"
title 质检部工作安排台

set PY=C:\Users\HUAWEI\AppData\Local\Programs\Python\Python313\python.exe
set URL=http://127.0.0.1:8766
if not exist "%PY%" set PY=python

echo.
echo   质检部工作安排台
echo   ----------------------------------------
echo   启动中，请稍候...

start "" /b "%PY%" engine\main.py

REM 端口就绪探测只能用 PowerShell（curl 的 errorlevel 不可靠）
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
