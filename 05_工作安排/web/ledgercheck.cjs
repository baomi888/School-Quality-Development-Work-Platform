// 台账持久化专项验证 —— 用户要求「检查每周台账是否能够真正存住」
//
// 完整链路：
//   ① 分配第 99 周（测试周次，不碰真实数据）+ 手动给一格加搭档
//   ② commit 后**直接读磁盘** engine/data/ledger.json，确认写盘
//   ③ 杀掉引擎进程 → 重启 → bootstrap 再查，确认**重启不丢**
//   ④ clear-week 撤销测试周，确认磁盘同步删除，且原有各周数据原样不动
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const PY = 'C:/Users/HUAWEI/AppData/Local/Programs/Python/Python313/python.exe';
const ENGINE = path.resolve(__dirname, '../engine/main.py');
const LEDGER = path.resolve(__dirname, '../engine/data/ledger.json');
const BASE = 'http://127.0.0.1:8766';
const WK = 99; // 测试专用周次
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
const post = async (p, b) => (await fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
})).json();
const boot = async () => (await fetch(BASE + '/api/bootstrap')).json();
const diskWeeks = () => JSON.parse(fs.readFileSync(LEDGER, 'utf8')).weeks || {};

(async () => {
  const { killEngine, portBusy } = require('./portutil.cjs');

  // ---- 清端口、起引擎
  killEngine(8766);
  for (let i = 0; i < 20 && await portBusy(8766); i++) await sleep(300);
  if (await portBusy(8766)) throw new Error('端口 8766 仍被占用');
  let proc = spawn(PY, [ENGINE], { stdio: 'ignore' });
  if (!await waitUp()) throw new Error('引擎未就绪');
  console.log('■ 引擎就绪（第一段）\n');

  const before = await boot();
  const beforeWeeks = before.ledger?.weeks || {};
  const beforeDisk = diskWeeks();
  console.log(`  现有台账周次：${Object.keys(beforeWeeks).join(', ') || '(空)'}\n`);

  // ---- ① 分配 + 手动加搭档
  const r = await post('/api/assign', { week: WK, seed: 7, locked: {} });
  const t0 = r.tasks[0];
  const col = Object.keys(r.assign[t0.id])[0]; // 第一件活的第一个校区格
  const cur = r.assign[t0.id][col];
  const mate = r.people.find((p) =>
    p.role === 'assist' && !cur.includes(p.id) &&
    (p.can_do || []).includes(col)).id;
  const pairedAssign = JSON.parse(JSON.stringify(r.assign));
  pairedAssign[t0.id][col] = [...cur, mate];
  console.log(`  搭档测试：${t0.name} ${col}格 = ${cur.length + 1} 人`);

  await post('/api/commit', { week: WK, assign: pairedAssign });

  // ---- ② 直接读磁盘
  const d1 = diskWeeks();
  check('commit 后磁盘 ledger.json 有第99周', !!d1[String(WK)]);
  const live1 = (await boot()).ledger?.weeks?.[String(WK)];
  check('磁盘与接口返回一致', JSON.stringify(d1[String(WK)]) === JSON.stringify(live1));
  const t0Name = t0.name;
  const bothIn = [cur[0], mate].every((pid) =>
    ((d1[String(WK)] || {})[pid] || []).includes(t0Name));
  check('搭档两人都记入台账（同一件活）', bothIn,
    `${t0Name}: ${[cur[0], mate].map((p) => (before.people.find((x) => x.id === p) || {}).name).join(' + ')}`);
  const inv = d1[String(WK)] || {};
  check('台账是「人 → 任务名」翻转结构',
    Object.values(inv).every((v) => Array.isArray(v) && v.every((x) => typeof x === 'string')));
  check('台账覆盖本周全部被派人',
    Object.keys(inv).length === new Set(Object.values(pairedAssign).flatMap((row) => Object.values(row).flat())).size,
    `${Object.keys(inv).length} 人有台账记录`);
  check('原有各周数据未被动过',
    Object.keys(beforeDisk).every((k) => JSON.stringify(beforeDisk[k]) === JSON.stringify(d1[k])),
    `${Object.keys(beforeDisk).length} 周`);
  console.log('');

  // ---- ③ 杀进程重启，再查
  try { proc.kill(); } catch {}
  killEngine(8766);
  for (let i = 0; i < 20 && await portBusy(8766); i++) await sleep(300);
  if (await portBusy(8766)) throw new Error('旧引擎杀不掉');
  console.log('■ 引擎已杀掉并重启\n');
  proc = spawn(PY, [ENGINE], { stdio: 'ignore' });
  if (!await waitUp()) throw new Error('重启后引擎未就绪');

  const b2 = await boot();
  const after = b2.ledger?.weeks || {};
  check('重启后台账仍在（不丢数据）', !!after[String(WK)]);
  check('重启后内容与写盘一致', JSON.stringify(after[String(WK)]) === JSON.stringify(d1[String(WK)]));
  check('重启后搭档记录完整', [cur[0], mate].every((pid) => ((after[String(WK)] || {})[pid] || []).includes(t0Name)));
  console.log('');

  // ---- ④ 撤销测试周，确认磁盘同步删 + 原数据原样
  await post('/api/clear-week', { week: WK, assign: {} });
  const d3 = diskWeeks();
  check('撤销后磁盘同步删除第99周', !d3[String(WK)]);
  const b3 = await boot();
  check('原有各周台账原样保留',
    JSON.stringify(Object.keys(b3.ledger?.weeks || {}).sort()) === JSON.stringify(Object.keys(beforeWeeks).sort()),
    `${Object.keys(b3.ledger?.weeks || {}).length} 周`);
  check('原有各周内容逐字节一致',
    JSON.stringify(b3.ledger?.weeks) === JSON.stringify(beforeWeeks));

  console.log(`\n${fails === 0 ? '台账持久化验证：全部通过' : fails + ' 项失败'}`);
  process.exitCode = fails === 0 ? 0 : 1;
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => { /* 引擎留给后续测试清；不留进程 */ })
  .then(() => {
    const { killEngine } = require('./portutil.cjs');
    killEngine(8766);
    console.log('（测试引擎已关闭）');
  });
