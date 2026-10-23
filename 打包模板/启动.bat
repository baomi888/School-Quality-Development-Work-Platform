@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 质检部·工作安排台（关闭此窗口即停止服务）

rem 强制 UTF-8，避免不同电脑控制台编码导致中文乱码或启动器报错
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set PYTHONLEGACYWINDOWSSTDIO=0

set "PY=%~dp0runtime\python\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" "%~dp0launcher.py"

echo.
echo 服务已停止，可以关闭此窗口。
pause
