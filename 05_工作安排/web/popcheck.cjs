// 「加人」弹层可见性回归验证 —— 真实浏览器点击
// 背景：.pcol 曾有 overflow:hidden 把 .pop 弹层整块裁掉，表现为「点加人没反应」。
// 验证：点「一键随机分配」→ 点第一个「加人」→ 断言 .pop 可见 → 点候选 chip → 断言格子变 2 人。
const { spawn } = require('child_process');
const path = require('path');
const PY = 'C:/Users/HUAWEI/AppData/Local/Programs/Python/Python313/python.exe';
const ENGINE = path.resolve(__dirname, '../engine/main.py');
const BASE = 'http://127.0.0.1:8766';
const SHOT = path.resolve(__dirname, '../_shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${extra ? ' | ' + extra : ''}`);
  if (!ok) fails++;
};
async function waitUp(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return true; } catch {}
    await sleep(400);
  }
  return false;
}

(async () => {
  const { killEngine, portBusy } = require('./portutil.cjs');
  killEngine(8766);
  for (let i = 0; i < 20 && await portBusy(8766); i++) await sleep(300);
  const proc = spawn(PY, [ENGINE], { stdio: 'ignore' });
  if (!await waitUp()) throw new Error('引擎未就绪');
  console.log('■ 引擎就绪\n');

  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.arow', { timeout: 15000 });

  // ① 一键随机分配
  const btns = await page.$$('.bar .btn');
  for (const b of btns) {
    const t = await b.evaluate((el) => el.textContent);
    if (t.includes('一键随机分配')) { await b.click(); break; }
  }
  await sleep(1200);

  // ② 点第一个「加人」按钮
  const moreBtn = await page.$('.pcol .more');
  check('「加人」按钮存在', !!moreBtn);
  await moreBtn.click();
  await sleep(300);

  // ③ 弹层必须真实可见（此前被 overflow:hidden 裁剪 = 不可见）
  const popVisible = await page.evaluate(() => {
    const el = document.querySelector('.pcol .pop');
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return {
      exists: true, w: Math.round(r.width), h: Math.round(r.height),
      display: st.display, visibility: st.visibility,
      visible: r.width > 50 && r.height > 30 && st.display !== 'none' && st.visibility !== 'hidden',
      chips: el.querySelectorAll('.chip').length,
    };
  });
  check('弹层渲染出来', popVisible.exists, JSON.stringify(popVisible.exists ? popVisible : {}));
  check('弹层真实可见（未被裁剪）', popVisible.visible,
    popVisible.exists ? `${popVisible.w}x${popVisible.h} chips=${popVisible.chips}` : '');
  check('弹层里有候选名单', popVisible.chips >= 5, `${popVisible.chips} 人`);

  // ④ 点候选 chip → 行内选中人数 +1（搭档制；行含西城+官渡两格）
  const rowOn = () => page.evaluate(() => {
    const first = document.querySelector('.arow:not(.head)');
    return first ? first.querySelectorAll('.pick .chip.on').length : -1;
  });
  const beforeCnt = await rowOn();
  await page.click('.pcol .pop .chip');
  await sleep(400);
  const afterCnt = await rowOn();
  check('点候选后行内选中 +1（搭档制加人成功）', afterCnt === beforeCnt + 1,
    `${beforeCnt} → ${afterCnt}（西城1+官渡1=2，点候选后 3）`);

  // ⑤ 弹层在点完后仍可用（open 保持，可继续加第 3 人）
  const stillOpen = await page.evaluate(() => !!document.querySelector('.pcol .pop'));
  check('弹层保持打开（可继续加人）', stillOpen);

  // 截图留档
  const fs = require('fs');
  fs.mkdirSync(SHOT, { recursive: true });
  await page.screenshot({ path: path.join(SHOT, 'pop-open.png') });

  await browser.close();
  console.log(`\n${fails === 0 ? '弹层验证：全部通过' : fails + ' 项失败'}`);
  process.exitCode = fails === 0 ? 0 : 1;
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => { require('./portutil.cjs').killEngine(8766); console.log('（测试引擎已关闭）'); });
