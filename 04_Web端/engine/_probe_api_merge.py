# -*- coding: utf-8 -*-
"""端到端验证 /api/merge 与 /merge 页面（不依赖 requests，纯标准库 multipart）"""
import io
import json
import os
import sys
import urllib.request
import uuid
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PORT = os.environ.get('ZJB_PORT', '8765')
BASE = f'http://127.0.0.1:{PORT}'
ENGINE = Path(__file__).resolve().parent
FIX = ENGINE / '_probe_fixtures'


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=20) as r:
        return r.status, r.read()


def post_files(path, files, field='files'):
    b = '----dsh' + uuid.uuid4().hex
    buf = io.BytesIO()
    for p in files:
        p = Path(p)
        buf.write(f'--{b}\r\n'.encode())
        buf.write(f'Content-Disposition: form-data; name="{field}"; filename="{p.name}"\r\n'.encode())
        buf.write(b'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n')
        buf.write(p.read_bytes())
        buf.write(b'\r\n')
    buf.write(f'--{b}--\r\n'.encode())
    body = buf.getvalue()
    req = urllib.request.Request(BASE + path, data=body, method='POST')
    req.add_header('Content-Type', f'multipart/form-data; boundary={b}')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8'))


fails, passes = [], [0]


def check(cond, label, detail=''):
    if cond:
        passes[0] += 1
    else:
        fails.append(f'{label}{("  → " + detail) if detail else ""}')


# 1) 健康检查
st, raw = get('/api/health')
check(st == 200, '1. /api/health 200')
check(json.loads(raw).get('ok') is True, '1. health.ok')

# 2) 工具页可访问且是自包含 HTML
st, raw = get('/merge')
html = raw.decode('utf-8')
check(st == 200, '2. /merge 200')
check('活动登记表汇总' in html, '2. 页面标题正确')
check('<script>' in html and 'cdn' not in html.lower(), '2. 自包含：无外部 JS 依赖')
check('/api/merge' in html, '2. 页面指向 /api/merge')

# 3) 汇总 4 份第4周单表（第5周文件混在一起，验证分周）
allx = sorted(FIX.glob('*.xlsx'))
check(len(allx) >= 5, '3. 素材文件齐全', f'{len(allx)} 份')
st, d = post_files('/api/merge', allx)
check(st == 200, '3. /api/merge 200', str(d)[:200])
check(d.get('week') == 4, '3. 主周次第4周', str(d.get('week')))
c = d.get('counts', {})
check(c.get('unique') == 5, '3. 去重后 5 个活动', str(c.get('unique')))
check(c.get('publicity_rows') == 4, '3. 表一剔除协会会员后 4 行', str(c.get('publicity_rows')))
check(c.get('exact_merged') == 1, '3. 自动合并重复 1 条')
check(len(d.get('extra_weeks') or []) == 1, '3. 另有 1 套第5周产物')

outs = d.get('outputs') or {}
for key in ('total', 'publicity', 'timetable', 'report'):
    o = outs.get(key)
    check(bool(o), f'3. 产物已登记：{key}')
    if o:
        check(o['name'].endswith('.xlsx'), f'3. {key} 是 xlsx')
        check(o['size'] > 2000, f'3. {key} 非空（{o["size"]} 字节）')
        check(o['url'].startswith('/api/files/'), f'3. {key} 有下载地址')

# 4) 产物真的能下载，且是合法 xlsx（ZIP 头 PK）
for key, o in outs.items():
    st, raw = get(o['url'])
    check(st == 200 and raw[:2] == b'PK', f'4. {key} 可下载且为 xlsx 包')

# 5) 额外周次产物也可下载
extra = (d.get('extra_weeks') or [{}])[0]
for key, o in (extra.get('outputs') or {}).items():
    st, raw = get(o['url'])
    check(st == 200 and raw[:2] == b'PK', f'5. 第5周 {key} 可下载')

# 6) 指定 week=5 时排除他周
st, d5 = post_files('/api/merge?week=5', allx)
check(st == 200, '6. week=5 请求成功')
check(d5.get('week') == 5, '6. 主周次为 5', str(d5.get('week')))
check(len(d5.get('dropped_files') or []) == 4, '6. 排除 4 个第4周文件',
      str(len(d5.get('dropped_files') or [])))

# 7) 非 Excel 应被拒
bad = ENGINE / '_probe_out' / 'not_excel.xlsx'
bad.parent.mkdir(parents=True, exist_ok=True)
bad.write_bytes(b'this is not a workbook')
st, dr = post_files('/api/merge', [bad])
check(st == 200 and (dr.get('sources') or [{}])[0].get('ok') is False,
      '7. 坏文件只报文件级错误、不 500', f'HTTP {st}')

# 8) 单个学院文件也能汇总（来源判定不靠文件名）
one = [p for p in allx if p.name == '建工学院.xlsx']
st, d1 = post_files('/api/merge', one)
check(st == 200 and d1.get('counts', {}).get('unique') == 1, '8. 单文件汇总正常')


# 9) 智能体接口（HTTP 层；函数层由 _probe_agent.py 覆盖）
def post_json(path, obj):
    body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(BASE + path, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8'))


st, raw = get('/api/agent/presets')
pre = json.loads(raw)
check(st == 200 and len(pre.get('presets') or []) >= 4, '9. 智能体预设接口')
check(bool(pre.get('colleges')), '9. 预设里带应交单位名单')

st, raw = get('/agent')
check(st == 200 and '/api/agent' in raw.decode('utf-8'), '9. /agent 演示页可访问')

st, ra = post_json('/api/agent', {'goal': '学分办法里比赛类怎么算分'})
check(st == 200 and ra.get('ok') is True, '9. 学分检索目标达成', str(ra.get('needs_human'))[:120])
qp = ra.get('results', {}).get('query_policy') or {}
check(len(qp.get('hits') or []) > 0, '9. 检索命中原文条款')

st, rb = post_json('/api/agent', {'goal': '哪些学院还没交表',
                                  'inbox': str(FIX)})
check(st == 200 and rb.get('ok') is True, '9. 催报目标达成')
lm = rb.get('results', {}).get('list_missing') or {}
check(lm.get('expected', 0) >= 20, '9. 应交单位数来自配置', str(lm.get('expected')))
nt = (rb.get('results', {}).get('draft_notice') or {}).get('text_labeled') or ''
check('本内容由AI辅助生成' in nt, '9. 生成文案带回传的显式标识')
check(bool(rb.get('ai_marker', {}).get('content_id')), '9. 返回隐式标识')

# 缺上下文时如实追问，而不是 500
st, rc = post_json('/api/agent', {'goal': '把本周登记表汇总一下'})
check(st == 200 and rc.get('ok') is False, '9. 缺上下文返回未达成而非 500')
check(bool(rc.get('needs_human')), '9. 缺上下文进了 needs_human')

# 轨迹结构完整
st, rd = post_json('/api/agent', {'goal': '把本周登记表汇总一下并生成简报',
                                  'inbox': str(FIX), 'week': 4})
phases = {s.get('phase') for s in (rd.get('steps') or [])}
for ph in ('perceive', 'plan', 'act', 'reflect'):
    check(ph in phases, f'9. 轨迹含 {ph} 阶段')
check(rd.get('planner') in ('rule', 'llm'), '9. 标明所用规划器', str(rd.get('planner')))


print(f'\nWeb API 端到端：通过 {passes[0]} 项，失败 {len(fails)} 项')
if fails:
    print('\n失败项：')
    for f in fails:
        print('  ✗', f)
    raise SystemExit(1)
print('  ✓ 全部通过')
