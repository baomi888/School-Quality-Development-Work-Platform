---
name: 质检部周工作平台 · 档案台
version: alpha-6
description: 高校行政办公工具的设计系统。暖纸冷墨、正红单点、零圆角零阴影，层级全部交给线；落地页与工作台共用同一套语言。

colors:
  # 表面（4 档：画布 → 容器 → 次级容器 → 浮层）
  canvas:        "#F6F6F4"
  surface:       "#FFFFFF"
  surface-2:     "#F1F1EF"
  elevated:      "#FFFFFF"

  # 文本（3 档 + 反色）
  text:          "#0A0A0A"
  text-2:        "#5E5E5E"
  text-3:        "#8A8A8A"
  text-on-brand: "#FFFFFF"

  # 边框（3 级：分隔线 / 结构硬边 / 有面积的控件）
  line:          "#E0E0DD"
  line-strong:   "#111111"
  line-control:  "#111111"

  # 中性填充（4 级，全部半透明，叠任何底色都成立）
  fill-1:        "rgba(10, 10, 10, 0.13)"
  fill-2:        "rgba(10, 10, 10, 0.075)"
  fill-3:        "rgba(10, 10, 10, 0.04)"
  fill-4:        "rgba(10, 10, 10, 0.02)"

  # 品牌 = 黑。瑞士体系里黑就是最强的强调，不需要第二个色。
  brand:         "#111111"
  brand-ink:     "#111111"
  brand-deep:    "#000000"
  brand-soft:    "#F0F0EE"
  brand-line:    "#111111"

  # 强调 = 正红，全站唯一彩色
  accent:        "#D92D20"
  accent-soft:   "#FCECEB"

  # 语义（本体给描边/图标/填充，-ink 给文字；-soft 给底）
  success:       "#111111"
  success-ink:   "#111111"
  success-soft:  "#F0F0EE"
  warning:       "#8A5A00"
  warning-ink:   "#7A4F00"
  warning-soft:  "#FAF3E6"
  danger:        "#D92D20"
  danger-ink:    "#B42318"
  danger-soft:   "#FCECEB"
  info:          "#111111"
  info-ink:      "#111111"
  info-soft:     "#F0F0EE"

typography:
  # alpha-5：字体改用「苞米 Agent」思路 —— 标题衬线、正文无衬线。
  # 骨架仍是瑞士（超大标题、硬线、零圆角），但字面从 Helvetica 换成中文优先的衬线 + 无衬线。
  font-family-serif: "Noto Serif SC, Songti SC, SimSun, serif"   # 标题 / 品牌名
  font-family: "Noto Sans SC, PingFang SC, Microsoft YaHei, Hiragino Sans GB, system-ui, -apple-system, sans-serif"   # 正文 / 按钮
  font-family-mono: "SFMono-Regular, Consolas, Menlo, monospace"
  # 衬线标题字距：--ls-serif 0.01em（中文衬线收紧会糊，给极轻正字距）

  # 八档字号。alpha-4 把原稿取值整体上调一档：原稿偏小，
  # 中文小字会发糊、正文读起来像脚注。音阶结构不变
  # （大号收紧字距、小号拉开字距），只是每一档都往上抬。
  # 全站文字只允许落进四级：分区标题 / 条目标题 / 正文说明 / 元信息。
  hero:                           # ① 页面大标题，每页至多一个
    fontSize: 56px
    fontWeight: 700
    letterSpacing: "-0.035em"
    lineHeight: 0.96
  display:                        # 读数（右侧数字块、统计值）
    fontSize: 32px
    fontWeight: 700
    letterSpacing: "-0.02em"
    lineHeight: 1.1
  title:                          # ① 分区标题（卡片名、工作流块名）
    fontSize: 21px
    fontWeight: 700
    letterSpacing: "-0.02em"
    lineHeight: 1.25
  lead:                           # ② 条目标题（工作流每一条、文件名）
    fontSize: 16px
    fontWeight: 700
    letterSpacing: "-0.01em"
    lineHeight: 1.25
  label:                          # 步骤条、小按钮
    fontSize: 13px
    fontWeight: 400
    letterSpacing: "0"
    lineHeight: 1.35
  body:                           # ③ 正文说明
    fontSize: 14px
    fontWeight: 400
    letterSpacing: "0"
    lineHeight: 1.5
  caption:                        # ④ 元信息（交付物、时间、引擎名）
    fontSize: 12px
    fontWeight: 400
    letterSpacing: "0.08em"
    lineHeight: 1.5
  micro:                          # ④ 表头 / 控件标签 / 星期
    fontSize: 11.5px
    fontWeight: 700
    letterSpacing: "0.12em"
    lineHeight: 1.5

measure:
  prose: 62ch                     # 说明性文字的最大行长，超了就换行

numeric:
  variant: tabular-nums           # 序号 / 读数 / 明细，等宽对齐

rounded:
  sm: 0px
  md: 0px
  lg: 0px
  xl: 0px
  pill: 0px

spacing:
  "0": 0px
  "1": 4px
  "2": 6px
  "3": 8px
  "4": 12px
  "5": 16px
  "6": 20px
  "7": 24px
  "8": 32px
  "9": 40px

# 控件高度：同一行并排必须同高。取值 = styles.css 里 .btn-sm / .chip / .btn 的实际高度。
control-height:
  sm: 26px
  md: 34px
  lg: 38px

icon-size:
  xs: 12px
  sm: 14px
  md: 16px
  lg: 20px
  xl: 24px

motion:
  instant: 70ms
  fast: 120ms
  base: 180ms
  slow: 300ms
  easing: "cubic-bezier(0.2, 0, 0.2, 1)"

components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.text-on-brand}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "{control-height.md}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.line-strong}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "{control-height.md}"
  card:
    backgroundColor: "{colors.surface}"
    borderTop: "2px {colors.line-strong}"
    rounded: "{rounded.lg}"
    padding: "{spacing.6}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.line-strong}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "{control-height.sm}"
  tag-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success-ink}"
    rounded: "{rounded.sm}"
  tag-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-ink}"
    rounded: "{rounded.sm}"
  tag-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-ink}"
    rounded: "{rounded.sm}"
---

## Overview

广东石油化工学院校素拓质检部的内部工具，使用者是部长、副部长和干事，
典型场景是周四坐在办公室用半小时把本周排班做完。

**调性是「瑞士理性」（国际主义平面设计）：纯白卡片压在极浅灰的画布上，
分隔全部靠 1px / 2px 的线，没有圆角，没有阴影，字体走 Helvetica。**
信息层级靠字号、线与留白拉开，不靠装饰。

它要处理的是一张密密麻麻的 Excel 表，所以选这个方向有实际理由：
**在表格密集的工具里，圆角和阴影是噪声**，而网格与直线天然贴合表格。

两条硬约束：

1. **红只有一处含义——「需要你注意」。** 当前步骤、错误、未安排、破坏性操作。
   其它任何地方都不许用红，否则这条信号就废了。
2. **瞬时反馈不用品牌色。** hover / focus / 按下统一走中性填充，
   这是从 LobeHub 的 DESIGN.md 借来的纪律。

## Colors

### 为什么主色是黑，而红只有一个

瑞士体系里**黑本身就是最强的强调**：主按钮是黑底白字，选中态是黑底白字，
完成态也是黑。这样整站只有一个彩色变量需要管理。

**红 `#D92D20` 是唯一彩色**，只出现在三处：

| 出现位置 | 含义 |
|---|---|
| 步骤条 / 工作流当前段的红线 | 现在该做这件事 |
| 错误提示、体检未通过、未安排 | 有问题 |
| 破坏性操作 | 不可逆 |

### 为什么没有绿色

「已通过 / 已完成 / 已安排」用**黑 + ✓** 表达，不用绿。
理由：绿色和红色在语义上是对立的，一旦出现绿，红的告警强度就被稀释；
而黑 + 记号已经足够表达「办好了」，还顺带把色板压到最简。

### 中性填充：hover 不许变黑底

参考 LobeHub 的明文规定：

> Do keep solid `colorPrimary` for the single most important action and for state.
> **Don't spread brand color as decoration.**

四级中性填充全部是**同一墨色的半透明**，叠在画布、卡片、表格任一层都成立：

| 令牌 | 透明度 | 用途 |
|---|---|---|
| `--fill-1` | .13 | 按下 / active |
| `--fill-2` | .075 | hover |
| `--fill-3` | .04 | 极淡 hover（表格行） |
| `--fill-4` | .02 | 选中底 |

**判定规则：瞬时反馈（hover / focus / 按下）用中性填充；
持久状态（`.on` / `.active`）与主操作才用黑。**

### 对比度实测

所有承载文字的 `-ink` 值均已验算，目标 ≥ 4.5:1（WCAG AA）：

| 令牌 | 值 | 白底 | 判定 |
|---|---|---|---|
| `--text` | `#0A0A0A` | 19.8:1 | ✓ |
| `--text-2` | `#5E5E5E` | 6.5:1 | ✓ |
| `--brand`（黑底白字） | `#111111` | 18.9:1 | ✓ |
| `--accent`（红底白字） | `#D92D20` | 4.83:1 | ✓ |
| `--danger-ink` | `#B42318` | 6.6:1 | ✓ |
| `--warning-ink` | `#7A4F00` | 6.9:1 | ✓ |

`--text-3` `#8A8A8A` 约 3.4:1，**只用于非关键元信息与占位符，不承载正文**。

## Typography

### 八档字号 + 字距（重建前有 9 种取值）

重建前 `font-size` 有 11 / 12 / 12.5 / 13 / 13.5 / 14 / 15 / 16 / 26px 共 9 种，
其中 7 种挤在 12–14px 的 2px 区间里——相邻差 0.5px，人眼分辨不出。

alpha-3 收成 8 档（`--fs-sm` 与 `--fs-md` 同值 13px，合并计一档），取值照搬
`_风格预览/03-瑞士理性.html`。核心规律：**大号收紧字距、小号拉开字距**——
字距不跟字号走同一方向，这是瑞士排版的骨架。

| 令牌 | 值 | 字距 | 用途 |
|---|---|---|---|
| `--fs-hero` | 52px | -.035em | ① 页面大标题（每页至多一个） |
| `--fs-display` | 26px | -.02em | 读数（右侧数字块、统计值） |
| `--fs-title` | 19px | -.02em | ① 分区标题（卡片名、工作流块名） |
| `--fs-lead` | 15px | -.01em | ② 条目标题（工作流每条、文件名） |
| `--fs-label` | 12.5px | 0 | 步骤条、小按钮 |
| `--fs-md` | 13px | 0 | ③ 正文说明（默认） |
| `--fs-caption` | 11px | .08em | ④ 元信息（交付物、时间、引擎名） |
| `--fs-micro` | 10.5px | .12em | ④ 表头 / 控件标签 / 星期 |

**规则：CSS 里不允许再出现 `font-size: NNpx`，一律取令牌。**
（构建产物 `grep 'font-size:[0-9.]*px'` 应为零命中，除 `:0` 这类合法值外。）

### 字重三档，但 700 是受控资源

400（正文）/ 500（比正文重一档：表格里的活动名、清单项名）/ 700（重音）。

700 **只**给这六处：页面大标题、分区标题、表头、序号、主按钮、读数。
其余一切默认 400，需要强调时先升到 500，而不是直接 700——
**瑞士的「重」靠字号与留白，不靠字重。** 中文字体在 700 下笔画变粗，
必须把它留给真正该压住场面的那级标题。

### 字体：从 Helvetica 换成「苞米 Agent」的中文优先方案（alpha-5）

alpha-2 ~ alpha-4 的瑞士骨架用的是 `Helvetica Neue → Arial`（Arial 是 Helvetica
在 Windows 上的度量兼容替代，是刻意的引用而非兜底），中文落到微软雅黑。
问题出在中文字面上：Helvetica/Arial 不含汉字，中文一律掉进系统雅黑，
标题与正文同字面，中文排版缺少「标题感」，这就是用户说的「字体配饰不好看」。

alpha-5 保留瑞士骨架（超大标题、硬线、零圆角、红是唯一彩色），只换字体思路，
照搬「苞米 Agent」的双字面方案：

- **标题 / 品牌名 → 衬线 `Noto Serif SC`**（Mac 落 Songti SC，Windows 落 SimSun），700；
- **正文 / 按钮 → 无衬线 `Noto Sans SC`**（Mac 落 PingFang SC，Windows 落微软雅黑），400/500；
- 衬线标题的字距单独走 `--ls-serif 0.01em`——中文衬线用 Helvetica 那套
  `-0.035em` 会挤到糊，必须回正。

Web 字体经 **Google 中国镜像 `fonts.googleapis.cn`** 直连加载（国内可访问），
加载失败时按上面的系统字体逐级兜底，不会掉进浏览器默认宋体。字号音阶沿用 alpha-4。

### 行高

大号极紧、小号常规——行高和字号反向走：`--lh-hero .96`（52px 大标题贴行）、
`--lh-tight 1.25`（标题）、`--lh-snug 1.35`（步骤条/按钮）、`--lh-body 1.5`（正文）。
说明文字行距不松，排版味来自紧凑行距，不是大留白。

### 四级文字层次（全站不许有第五级）

全站文字只允许落进四级，用字号 + 字距 + 颜色（而非更多字号）拉开：

| 级别 | 用途 | 字号 / 字重 / 字距 |
|---|---|---|
| ① 分区标题 | 一块内容的名字 | `--fs-title` 19 / 700 / `--ls-title` |
| ② 条目标题 | 清单里每一条的名字 | `--fs-lead` 15 / 700 / `--ls-lead` |
| ③ 正文说明 | 解释性文字 | `--fs-md` 13 / 400 / `--lh-body`，限宽 `--measure` |
| ④ 元信息 | 交付物、时间、文件大小 | `--fs-caption` 11 / 400 / `--text-3` |

拉丁文标签（表头、`XLSX / XLS` 一类）走大写 + 拉字距；**中文不加字距**，加了会散。

## Layout

### 间距阶梯（4px 基础 + 保留 2px 半档）

`0 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 40`。

LobeHub 用严格的 4px 阶梯，但中文小控件密排时 4px 步长偏粗——实测本项目里
`6px` 与 `12px` 是高频真实需求。**保留半档，不硬套。**

### 控件高度三级

`26 / 34 / 38`（`.btn-sm` / `.chip` / `.btn` 的实际像素高度，令牌不可撒谎）。
同一行里并排的按钮必须同高。

### 栏宽

主内容区最大 **1200px**，居中。再宽会让眼睛在长表格里丢失行位置。

## Elevation & Depth

**没有阴影。** 层级全部交给线：

| 手法 | 用途 |
|---|---|
| 画布 `#F6F6F4` vs 卡片 `#FFFFFF` | 明度差把卡片抬起来 |
| 卡片顶部 `2px` 纯黑线 | 章节分界 |
| 表格 / 列表 `1px` 浅灰线（`--line`） | 行分隔 |
| 控件 `1px` 纯黑线（`--line-strong`） | 按钮、chip、输入框的边界 |

这条是本项目和常见后台最不一样的地方：**如果觉得某个元素不够突出，
第一反应应该是加线或加留白，不是加阴影。**

## Shapes

**圆角全部为 0。** 瑞士体系里没有圆角这回事。

例外：状态徽标（✓）、状态点、加载圈仍用 `border-radius: 50%`——
那是**记号**，不是容器，圆形记号在方格里反而更好定位。

## Components

组件命名按**角色**而不是外观。`button-primary` 而不是 `blackButton`——
换主色时名字仍然成立。

### 卡片

白底 + 顶部 `2px` 黑线 + 内距 20px，无圆角无阴影。

### Chip（学院选择器）

本项目的核心交互控件，四种语义状态：

| 状态 | 视觉 | 含义 |
|---|---|---|
| 默认 | 白底 + 黑边 + `--text` 字 | 可选 |
| 选中 `.on` | **黑实底 + 白字** | 已选入本周学院池 |
| 禁用 `.host` | `--danger-soft` 底 + `--danger-ink` 字 | 本周主办学院，不可自检 |
| 提示 `.avoid` | `--warning-soft` 底 + `--warning-ink` 字 | 上周已排过，选中会被拦 |

**四种状态底色必须两两可辨**，不能只靠文字区分——使用者是在快速点选，不读字。

### 步骤条

四步：上传 → 拆分 → 安排学院 → 安排助理。
用**顶部 3px 线**表达状态：已完成黑线、当前红线、未完成浅灰线。
编号就是编号，**不做成圆圈徽章**。未完成步不要置灰到看不见，用 `--text-3` 保持可读。

### 本周工作流

页面顶部六段：周一 → 周日。灰色段落（与规划部交接、安排学院 + 助理）由**系统进度自动判定**；
其余线下动作手工勾选，状态按周存 `localStorage`。

当前该做的那一段用**左侧一道 3px 红线**标出（不铺整行红底）——
这是红色最正当的一次使用：告诉使用者「现在该做这个」。
整行红底会把「红 = 需要注意」这个信号一次用光，所以只留一道边线。

## Do's and Don'ts

**Do**

- 取令牌，不写字面量。新增样式前先查这张表，没有对应令牌就先补令牌再写组件。
- 瞬时反馈用 `--fill-*`，持久状态与主操作用 `--brand-*`（黑）。
- 语义色配 `-ink`：底色用 `-soft`，文字用 `-ink`，不要反过来。
- 同一行并排控件用同一高度档位。
- 键盘可达：所有交互元素必须有 `:focus-visible` 焦点环。
- 需要强调时先想「加线还是加留白」，最后才考虑颜色。

**Don't**

- 不要 `font-size: NNpx`。取令牌。
- 不要在 hover 上刷品牌色。用 `--fill-2`。
- 不要给红色扩容。红 = 要注意，多一处就少一分。
- 不要用绿色表示「已完成」。用黑 + ✓。
- 不要加圆角或阴影「让它好看一点」——这不在这个方向的语法里。
- 不要让 `--text-3` 承载正文——它只有 3.4:1。
- 不要引入组件库（shadcn / antd）。本项目 4 个页面，
  引入只会让令牌体系出现两套事实来源。

## Tooling

该规格可用 Google Labs 的 design.md CLI 校验：

```bash
npx @google/design.md lint DESIGN.md    # 断链令牌 / WCAG 对比度 / 章节顺序
npx @google/design.md diff DESIGN.md DESIGN-v2.md   # 令牌回归
```

规格来源：<https://github.com/google-labs-code/design.md>
对照基准：<https://github.com/lobehub/lobe-chat>（其 `DESIGN.md` / `DESIGN.dark.md`）

## 变更记录

| 版本 | 方向 | 说明 |
|---|---|---|
| alpha-1 | 小清新 | 薄荷白画布、青蓝品牌色、大圆角、极轻阴影 |
| alpha-2 | 瑞士理性 | 黑白为主、正红单点、零圆角零阴影、Helvetica；新增「本周工作流」六段 |
| alpha-3 | 瑞士理性 · 整页重排 | 逐项对齐 `_风格预览/03-瑞士理性.html` 的排版规格：八档字号 + 字距/行高/限宽令牌；三级文字层次（分区标题 19 / 条目标题 15 / 正文 13 + 元信息 11）；工作流改为目录式；深色模式图表配色反相 |
| lambda | （试做）周课表形态 | 物件化隐喻试做：活动=课表色块、主办学院哈希配色。**已废弃** —— 10 色学院色块违反「红是唯一彩色」铁律 |
| **alpha-4** | **瑞士理性 · 字号上调 + 课表入格** | ① 八档字号整体上调一档（hero 52→56、display 26→32、title 19→21、lead 15→16、body 13→14、caption 11→12、micro 10.5→11.5），中文小字不再发糊；② 新增「本周活动课表」区块，按星期分七列 + 「未排」列，**单色**（白底 + 1px 黑边 + 3px 黑顶条），学院身份交给卡上文字而不是颜色；③ 窄屏整表横向滚动，不把列压扁 |
| **alpha-5** | **瑞士骨架 · 苞米 Agent 字体** | 骨架不动（瑞士理性），只换字体思路：标题/品牌名改**衬线 Noto Serif SC**、正文/按钮改**无衬线 Noto Sans SC**（Mac/Win 各有系统兜底），衬线标题字距回正为 `--ls-serif 0.01em`；标签字距由 0.18em 收敛到苞米的 0.15em；Web 字体走 Google 中国镜像 `fonts.googleapis.cn`，加载失败自动降级系统字体。改的是「字面」，不是「版式」 |
| **alpha-6** | **档案台 · 落地页与工作台合并** | ① 画布由冷白 `#F6F6F4` 换成**暖纸 `#F7F5F0`**，主色由纯黑 `#111111` 换成**冷墨 `#14151A`**，正红由 `#D92D20` 压暗为 `#B72C24`（暖纸上对比度 6.2:1）——与落地页完全同一套取值，「暖纸冷墨」；② **首页改为落地页形态**：衬线大标题「一学期，十八格。」+ 事实带 + **学期线**（18 格，W5 红框标「本周」，数据来自台账）+ 两列墨线功能格，原来的 Bento 彩色图标块与背景光斑全部删除；③ **四个功能页全部统一**：卡片、表格、标签、按钮、课表、步骤条、侧栏逐段档案台化，清掉全部圆角/阴影/绿色残留；④ **只保留浅色** —— 删除 `Theme` 类型、`THEME_KEY`、`applyTheme`、顶栏主题切换按钮、`prefers-color-scheme` 与 `data-theme` 两套深色 token，图表只留一套 `CHART_LIGHT`；⑤ 顶栏导航在 ≤600px 折成两行（品牌一行、导航横向可滚）；⑥ `/landing` 由静态挂载改为 **302 跳转 `/`**，修掉「无尾斜杠 404 → 启动脚本打开空白页」的坑 |

alpha-1 的令牌值全部保留在 `git` 历史里（`2de1016`），
方向回退只需替换 `web/src/styles/tokens.css` 与 `styles.css` 的两处结构规则。

### alpha-3 到底改了什么

alpha-2 只做到了「配色换成瑞士」，版面骨相还是后台模板那一套：
字号随手写、字距没有、行长不限、层次全靠颜色分。
alpha-3 把**排版**这一层重做了一遍：

**① 建立令牌化的排版系统**（`web/src/styles/tokens.css`）

之前字号只有 5 档、且 `styles.css` 里散落着 20 多处 `font-size: NNpx` 字面量。
现在：

- 字号 8 档：`--fs-micro 10.5` / `--fs-caption 11` / `--fs-label 12.5` / `--fs-sm 13` /
  `--fs-md 13` / `--fs-lead 15` / `--fs-title 19` / `--fs-display 26` / `--fs-hero 52`
- 字重 3 档：`--fw-normal 400` / `--fw-medium 500` / `--fw-bold 700`
- 行高 4 档：`--lh-hero .96` / `--lh-tight 1.25` / `--lh-snug 1.35` / `--lh-body 1.5`
- 字距 8 档：`--ls-hero -.035em` → `--ls-kicker .18em`（大号收紧、小号拉开）
- 限宽：`--measure 62ch`
- 等宽数字：`--num: tabular-nums`

构建后 `grep 'font-size:[0-9]*px'` 产物 CSS **零命中**，字号只能从令牌来。

**② 定下四级文字层次，全站不许有第五级**

| 级别 | 用途 | 字号 / 字重 / 字距 |
|---|---|---|
| ① 分区标题 | 一块内容的名字 | `--fs-title` 19 / 700 / `--ls-title` |
| ② 条目标题 | 清单里每一条的名字 | `--fs-lead` 15 / 700 / `--ls-lead` |
| ③ 正文说明 | 解释性文字 | `--fs-md` 13 / 400 / `--lh-body` / 限宽 `--measure` |
| ④ 元信息 | 交付物、时间、文件大小 | `--fs-caption` 11 / 400 / `--text-3` |

拉丁文标签（表头、`XLSX / XLS` 一类）走大写 + 拉字距；**中文不加字距**，加了会散。

**③ 「本周工作流」从表单改成目录**

之前六段的标题和说明都是 13px，读起来像一张没重点的表单。
现在每一天 = 目录里的一条：条目标题 15/700 是第一落点，说明降一档并卡在 62ch，
交付物是最弱的 11px。星期那一列**右对齐**，让所有条目标题共用一条硬左边界。

当前行从「整行红底」改为「左侧一道 3px 红线」——
整行铺底会把「红 = 需要注意」这个信号一次用光。

**④ 深色模式下图表反相**（`web/src/pages/Dashboard.tsx`）

ECharts 在画布上读不到 CSS 变量，之前只有一套浅色常量，
深色模式下**黑柱子在黑底上直接隐形**。现在分 `CHART_LIGHT` / `CHART_DARK` 两套，
用 `matchMedia('(prefers-color-scheme: dark)')` 订阅切换，坐标轴标签、图例、
环形图分隔缝的颜色一并跟随。

**⑤ 新增 `_shots/` 视觉验收工具**

`_风格预览/03-瑞士理性.html` 是设计稿，但「代码改了」不等于「页面对了」。
`_shots/` 下是三个 Puppeteer 脚本，用本机已有的 Chromium 无头跑：

- `shot.js` —— 四个页签逐页整页截图
- `modes.js` —— 浅色 / 深色各截一遍（图表配色必须两种都看）
- `detail.js` + `guide-zoom.js` —— 局部 2x 放大，并把关键元素的计算样式打印出来
- `final.js` / `e2e2.js` —— 跑真实流程（上传总表 → 拆分 → 生成预览 → 体检）后截图

只调 `/api/upload`、`/api/split`、`/api/preview`、`/api/diagnose` 这几个
**不写台账**的接口，所以跑验收不会污染 `data/ledger.json`。

**验收标准是「和设计稿并排看不出差别」，不是「配色对了」。**
