@echo off
cd /d "%~dp0"
chcp 936 >nul
title 质检部周工作平台 - 更新并启动

set "PY=C:\Users\HUAWEI\AppData\Local\Programs\Python\Python313\python.exe"
if not exist "%PY%" set "PY=python"
set "NODE=C:\Users\HUAWEI\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
if not exist "%NODE%" set "NODE=node"
set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%"

echo.
echo   ============================================
echo     质检部周工作平台  更新并启动
echo   ============================================
echo.

echo   [1/4] 关闭已运行的旧服务...
set "KILLED=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
  set "KILLED=1"
)
if "%KILLED%"=="1" (echo         已关闭旧服务) else (echo         没有正在运行的服务)
ping -n 2 127.0.0.1 >nul

echo.
echo   [2/4] 重新构建前端...
if not exist "web\node_modules" (
  echo         首次运行，正在安装依赖，可能要几分钟，请稍候...
  pushd web
  call npm install
  if errorlevel 1 (
    echo.
    echo   [x] 依赖安装失败，请检查网络后重试。
    popd
    echo.
    pause
    exit /b 1
  )
  popd
)
pushd web
set "NODEDIR=%NODE%"
for %%i in ("%NODE%") do set "NODEDIR=%%~dpi"
set "PATH=%NODEDIR%;%PATH%"
"%NODE%" node_modules\typescript\bin\tsc -b
if errorlevel 1 (
  echo.
  echo   [x] 构建失败：类型检查未通过，请把上面的报错发出来。
  popd
  echo.
  pause
  exit /b 1
)
"%NODE%" node_modules\vite\bin\vite.js build
if errorlevel 1 (
  echo.
  echo   [x] 构建失败，请把上面的报错发出来。
  popd
  echo.
  pause
  exit /b 1
)
popd
echo         构建完成

echo.
echo   [3/4] 更新界面缓存...
if exist "engine\preview" del /q "engine\preview\*.html" >nul 2>&1
echo         ok

echo.
echo   [4/4] 启动服务...
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