@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PY="C:\Users\HUAWEI\AppData\Local\Programs\Python\Python313\python.exe"
if not exist %PY% set PY=python

%PY% "%~dp0launch_all.py"
if errorlevel 1 pause
