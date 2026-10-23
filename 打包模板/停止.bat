@echo off
chcp 65001 >nul
title 停止服务

echo 正在停止 8765 / 8766 上的服务…
for %%P in (8765 8766) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
    taskkill /F /PID %%A >nul 2>&1
    echo   已停止端口 %%P 的进程 %%A
  )
)
echo 完成。
timeout /t 2 >nul
