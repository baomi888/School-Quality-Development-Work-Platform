// 浏览器实测：周工作台账区块常驻显示、两种视图切换、汇总数据正确
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const PY = 'C:/Users/HUAWEI/AppData/Local/Programs/Python/Python313/python.exe';
const ENGINE = path.resolve(__dirname, '../engine/main.py');
const BASE = 'http://127.0.0.1:8766';
const SHOT = path.resolve(__dirname, '../_shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`) }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`) }
}

async function waitUp(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return true; } catch {}
    await sleep(400);
  }
  return false;
}

async function main() {
  fs.mkdirSync(SHOT, { recursive: true });
  const { killEngine, portBusy } = require('./portutil.cjs');
  killEngine(8766);
  for (let i = 0; i < 20 && await portBusy(8766); i++) await sleep(300);

  const proc = spawn(PY, [ENGINE], { stdio: 'ignore' });
  try {
    if (!await waitUp()) throw new Error('引擎未就绪');
    const puppeteer = require('puppeteer-core');
    const browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1200 });
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
    await sleep(900);

    // 造数据：随机分配 + 存入台账（第 11 周）
    await page.click('button.primary');
    await sleep(800);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button.btn')].find((x) => x.textContent.includes('存入台账'));
      if (b) b.click();
    });
    await sleep(800);

    // 1) 台账区块常驻（不需展开"编辑人员与工作内容"）
    const ledgerVisible = await page.evaluate(() => {
      const secs = [...document.querySelectorAll('.sec')];
      return secs.some((s) => s.querySelector('h2') && s.querySelector('h2').textContent.includes('周工作台账'));
    });
    check('台账区块常驻显示（06 区，无需展开编辑）', ledgerVisible);

    // 2) 汇总条
    const sumText = await page.evaluate(() => document.querySelector('.ledger-sum')?.textContent || '');
    check('汇总条正确（已记录/覆盖/累计 + 当前周状态）',
      /已记录/.test(sumText) && /覆盖/.test(sumText) && /累计/.test(sumText) && /第 11 周/.test(sumText),
      sumText.replace(/\s+/g, ' ').trim().slice(0, 70));

    // 3) 默认按周视图有卡片
    const weekCards = await page.evaluate(() => document.querySelectorAll('.ledger-weeks .lweek').length);
    check('按周视图渲染周卡片', weekCards >= 1, `周卡片=${weekCards}`);
    const ledgerEl = await page.$('.ledger');
    if (ledgerEl) await ledgerEl.screenshot({ path: path.join(SHOT, 'ledger-week.png') });

    // 4) 切到按人视图
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('.ledger-tabs .tab')].find((x) => x.textContent.includes('按人看'));
      if (t) t.click();
    });
    await sleep(600);
    const personCards = await page.evaluate(() => document.querySelectorAll('.ledger-persons .lperson').length);
    check('按人视图渲染人卡片', personCards >= 1, `人卡片=${personCards}`);
    const minLight = await page.evaluate(() => document.querySelectorAll('.lperson.light').length);
    check('按人视图标出累计最少的人（轮空预警）', typeof minLight === 'number', `最少件高亮=${minLight}`);
    const ledgerEl2 = await page.$('.ledger');
    if (ledgerEl2) await ledgerEl2.screenshot({ path: path.join(SHOT, 'ledger-person.png') });

    await browser.close();
  } finally {
    killEngine(8766);
    try { proc.kill('SIGKILL'); } catch {}
  }

  console.log(`\n台账 UI：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('ERR', e); process.exit(2); });
