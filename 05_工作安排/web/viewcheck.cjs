// 验证字号/密度调节真实生效：三档字号 × 两档密度，各截一张图并测量实际渲染尺寸
const { spawn, execSync } = require('child_process');
const path = require('path');
const PY = 'C:/Users/HUAWEI/AppData/Local/Programs/Python/Python313/python.exe';
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
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    [...new Set(out.split('\n').filter((l) => l.includes(':8766') && l.includes('LISTENING'))
      .map((l) => l.trim().split(/\s+/).pop()))]
      .forEach((pid) => { try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch {} });
  } catch {}
  const proc = spawn(PY, [ENGINE], { stdio: 'ignore' });
  let browser = null;
  try {
    if (!await waitUp()) throw new Error('引擎未就绪');
    console.log('引擎就绪');
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: 60000,
    });

    for (const [fs, tag] of [[14, 'fs14'], [16, 'fs16'], [20, 'fs20']]) {
      for (const dense of [false, true]) {
        const page = await browser.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e)));
        page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
        // 先注入 localStorage 再加载，保证首屏就是目标设置
        await page.evaluateOnNewDocument((v, d) => {
          localStorage.setItem('zjb_work_fs', String(v));
          localStorage.setItem('zjb_work_fd', d ? '1' : '0');
        }, fs, dense);
        await page.setViewport({ width: 1440, height: 900 });
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(1300);
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('随机分配'));
          if (b) b.click();
        });
        await sleep(1500);

        const m = await page.evaluate(() => {
          const ctl = document.querySelector('.viewctl');
          const h2 = document.querySelector('.sec-h h2');
          const chip = document.querySelector('.chip');
          const body = document.body;
          return {
            htmlFs: getComputedStyle(document.documentElement).fontSize,
            ctlExists: !!ctl,
            ctlFont: ctl ? getComputedStyle(ctl.querySelector('.vval')).fontSize : null,
            h2Font: h2 ? getComputedStyle(h2).fontSize : null,
            chipFont: chip ? getComputedStyle(chip).fontSize : null,
            bodyLH: getComputedStyle(body).lineHeight,
            fd: getComputedStyle(document.documentElement).getPropertyValue('--fd').trim(),
            hOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
          };
        });
        const p = path.join(SHOT, `view-${tag}-${dense ? 'dense' : 'normal'}.png`);
        await page.screenshot({ path: p, fullPage: false });
        console.log(`字号${fs}px ${dense ? '紧凑' : '宽松'} → html=${m.htmlFs} 标签=${m.h2Font} chip=${m.chipFont} 行高=${m.bodyLH} --fd=${m.fd} 横向溢出=${m.hOverflow} 错误=${errs.length}`);
        if (errs.length) console.log('   ', errs.slice(0, 2));
        await page.close();
      }
    }
    console.log('\n截图前缀:', path.join(SHOT, 'view-'));
  } catch (e) {
    console.error('失败:', e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { proc.kill(); } catch {}
  }
})();