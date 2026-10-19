# -*- coding: utf-8 -*-
"""冷启动验收：模拟用户第一次用的完整路径，确认「本地能用」不是一句空话。

检查：
  1. 服务能起、健康检查通过
  2. 三个入口页面都能打开（工作台 / 汇总工具页 / 智能体演示页）
  3. 用演示数据跑通汇总工具页所依赖的接口（/api/merge）
  4. 跑通智能体演示页依赖的接口（/api/agent）
  5. 下载一份产物，确认是合法 xlsx
"""
import io
import json
import re
import sys
import urllib.request
import uuid
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
B = 'http://127.0.0.1:8830'
ROOT = Path(r'C:\Users\HUAWEI\Desktop\质检部工作自动化')
INBOX = ROOT / '_inbox_comp' / 'demo' / '收件箱'
DOC = ROOT / '_inbox_comp' / 'demo' / '申报书_待预审.docx'

fails, passes = [], [0]


def check(cond, label, detail=''):
    if cond:
        passes[0] += 1
        print(f'  ✓ {label}')
    else:
        fails.append(label + (f'  → {detail}' if detail else ''))
        print(f'  ✗ {label}  {detail}')


def get(path):
    with urllib.request.urlopen(B + path, timeout=30) as r:
        return r.status, r.read()


def post_json(path, obj):
    req = urllib.request.Request(B + path, data=json.dumps(obj).encode(), method='POST')
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.status, json.loads(r.read())


def post_files(path, files):
    b = '----dsh' + uuid.uuid4().hex
    buf = io.BytesIO()
    for p in files:
        p = Path(p)
        buf.write(f'--{b}\r\n'.encode())
        buf.write(f'Content-Disposition: form-data; name="files"; filename="{p.name}"\r\n'.encode())
        buf.write(b'Content-Type: application/octet-stream\r\n\r\n')
        buf.write(p.read_bytes())
        buf.write(b'\r\n')
    buf.write(f'--{b}--\r\n'.encode())
    req = urllib.request.Request(B + path, data=buf.getvalue(), method='POST')
    req.add_header('Content-Type', f'multipart/form-data; boundary={b}')
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.status, json.loads(r.read())


print('=== 0. 主系统导航（智能体是否已接进系统）===')
st, html = get('/')
page = html.decode('utf-8', errors='replace')
m = re.search(r'assets/index-[\w-]+\.js', page)
check(bool(m), '主系统首页引用了主包 JS')
if m:
    _, jsraw = get('/' + m.group(0))
    code = jsraw.decode('utf-8', errors='replace')
    for kw, label in (('活动汇总', '「活动汇总」导航项'),
                      ('智能体', '「智能体」导航项'),
                      ('/merge', '嵌入汇总页'),
                      ('/agent', '嵌入智能体页')):
        check(kw in code, f'主系统含{label}')

print('\n=== 1. 健康检查 ===')
st, raw = get('/api/health')
h = json.loads(raw)
check(st == 200 and h.get('ok') is True, '服务在线', str(st))
print(f'     学期: {h.get("term")}｜学院 {len(h.get("colleges") or [])} 个'
      f'｜校区 {h.get("campuses")}')

print('\n=== 2. 三个入口页面 ===')
for path, kw, label in [
    ('/', 'html', '工作台首页'),
    ('/merge', '活动登记表汇总', '汇总工具页'),
    ('/agent', '智能体演示', '智能体演示页'),
]:
    try:
        st, body = get(path)
        txt = body.decode('utf-8', errors='replace')
        ok = st == 200 and (kw in txt or len(txt) > 500)
        check(ok, f'{label} ({path}) 可打开', f'HTTP {st}, {len(txt)} 字节')
    except Exception as exc:  # noqa: BLE001
        check(False, f'{label} ({path})', str(exc))

print('\n=== 3. 汇总工具页的接口（拖多份单表） ===')
files = sorted(INBOX.glob('*.xlsx'))
check(len(files) >= 5, f'演示数据就绪（{len(files)} 份单表）')
st, d = post_files('/api/merge', files)
c = d.get('counts', {})
check(st == 200, '/api/merge 返回 200', str(st))
check(c.get('unique') == 4, '去重后 4 个活动', str(c.get('unique')))
check(c.get('exact_merged') == 1, '自动合并重复 1 条', str(c.get('exact_merged')))
check(c.get('publicity_rows') == 3, '表一剔掉协会会员后 3 行', str(c.get('publicity_rows')))
check(bool(d.get('notes') or d.get('extra_weeks')),
      '跨周保护生效（有提示或另出一套）')
outs = d.get('outputs') or {}
check(len(outs) == 4, '四个产物都已生成', str(list(outs)))
for k, o in outs.items():
    st2, blob = get(o['url'])
    check(st2 == 200 and blob[:2] == b'PK', f'产物 {k} 可下载且是 xlsx')

print('\n=== 4. 智能体演示页的接口 ===')
for goal, ctx, label in [
    ('学分办法里比赛类怎么算分', {}, '学分检索'),
    ('哪些学院还没交表', {'inbox': str(INBOX)}, '催报'),
    ('预审这份申报书', {'doc': str(DOC)}, '预审'),
]:
    st, r = post_json('/api/agent', {'goal': goal, **ctx})
    phases = {s['phase'] for s in r.get('steps', [])}
    check(st == 200 and r.get('ok') is True, f'智能体「{label}」跑通', str(r.get('needs_human'))[:80])
    check({'perceive', 'plan', 'act', 'reflect'} <= phases,
          f'「{label}」轨迹含四段', str(phases))

print('\n=== 5. 汇总 ===')
print(f'  通过 {passes[0]} 项，失败 {len(fails)} 项')
if fails:
    for f in fails:
        print('   ✗', f)
    raise SystemExit(1)
print('  ✓ 本地可用性验收全部通过')
