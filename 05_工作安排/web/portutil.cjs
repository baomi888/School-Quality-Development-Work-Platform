// 端口清理小工具 —— 不用 cmd、不依赖 wmic（本机 wmic 已被移除，会静默失败）。
//
// 为什么不用 `taskkill /F /PID x`：
//   ① Git Bash 会把 `/F` 当成路径转换成 `F:/` → 命令直接报错
//   ② 走 cmd.exe 的 execSync 在本机并发时会偶发 EBUSY
//
// 为什么不用 wmic：
//   本机（Win11）wmic 已被移除，命令不存在 → 静默失败 → 旧引擎占着端口，
//   测的其实是旧代码且不报错（表现为「改了代码测试结果却没变」）。
//
// 方案：PowerShell Get-CimInstance 查 PID（无 cmd、无 wmic）+ Stop-Process 杀。
const { execFileSync } = require('child_process');
const http = require('http');

const PORT = 8766;

/** 列出占用引擎进程（main.py）的 PID，通过 PowerShell CIM 查询 */
function pidsOnPort(port = PORT) {
  try {
    const ps = [
      '-NoProfile', '-Command',
      // 注意转义层数：这里最终要传给 PS 的正则是 main\.py（JS 里 \\ = 一个反斜杠）
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | " +
      "Where-Object { $_.CommandLine -match 'main\\.py' } | " +
      "ForEach-Object { $_.ProcessId }",
    ];
    const out = execFileSync('powershell', ps, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids = [];
    for (const line of out.split(/\r?\n/)) {
      const pid = line.trim();
      if (/^\d+$/.test(pid)) pids.push(pid);
    }
    return [...new Set(pids)];
  } catch { return []; }
}

/** 杀掉占端口的引擎进程 */
function killEngine(port = PORT) {
  const pids = pidsOnPort(port);
  pids.forEach((pid) => {
    try {
      execFileSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -Confirm:$false`],
        { stdio: 'ignore' });
    } catch { /* 已退出 */ }
  });
  return pids;
}

/** 端口是否已被占用（直接握手，不起 cmd） */
function portBusy(port = PORT) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1500 }, (res) => {
      res.resume(); resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

module.exports = { PORT, pidsOnPort, killEngine, portBusy };
