// 视觉验证：截屏 + 溢出检测（独立于 e2e，失败不影响功能验收）
const { spawn } = require('child_process');
const { killEngine, portBusy } = require('./portutil.cjs');
const path = require('path');
const PY = 'C:/Users/HUAWEI/AppData/Local/Programs/Python/Python313/python.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ENGINE = path.resolve(__dirname, '../engine/main.py');
const SHOT = path.resolve(__dirname, '../_shots');
const BASE = 'http://127.0.0.1:8766';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(n = 40) {
  for (let i = 0; i < n; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return true; } catch {}
    await sleep(400);
  }
  return false;
}

(async () => {
  const fs = require('fs');
  fs.mkdirSync(SHOT, { recursive: true });
  try {
    const killed = killEngine(8766);
    for (let i = 0; i < 20 && await portBusy(8766); i++) await sleep(300);
    if (killed.length) console.log(`已清理残留引擎：${killed.join(',')}`);
  } catch {}
  const proc = spawn(PY, [ENGINE], { stdio: 'ignore' });
  let browser = null;
  try {
    if (!await waitUp()) throw new Error('引擎未就绪');
    console.log('引擎就绪');
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: 60000,
    });
    for (const [w, h, tag] of [[1440, 900, 'desktop'], [820, 1180, 'tablet'], [390, 844, 'mobile']]) {
      const page = await browser.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push(String(e)));
      await page.setViewport({ width: w, height: h });
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(1500);
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('随机分配'));
        if (b) b.click();
      });
      await sleep(1800);
      const over = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('*').forEach((el) => {
          const cs = getComputedStyle(el);
          if (cs.overflowX !== 'visible') return;
          let p = el.parentElement, scrollable = false;
          while (p) { const s = getComputedStyle(p); if (s.overflowX === 'auto' || s.overflowX === 'scroll') { scrollable = true; break; } p = p.parentElement; }
          if (scrollable) return;
          if (el.scrollWidth > el.clientWidth + 2) bad.push(el.tagName + '.' + String(el.className).slice(0, 26));
        });
        return [...new Set(bad)].slice(0, 6);
      });
      const p = path.join(SHOT, `ui-${tag}.png`);
      await page.screenshot({ path: p, fullPage: true });
      console.log(`${tag.padEnd(8)} ${w}x${h} | console错误 ${errs.length} | 溢出 ${over.length}` +
        (errs.length ? '\n   ' + errs.slice(0, 2).join('\n   ') : '') +
        (over.length ? '\n   溢出: ' + over.join(', ') : ''));
      await page.close();
    }
    console.log('截图目录:', SHOT);
  } catch (e) {
    console.error('视觉验证失败:', e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { proc.kill(); } catch {}
  }
})();
