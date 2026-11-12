# 模板契约（Template Contract）

本文件是模板系统的**唯一书面契约**，与编译器同源并由自动检查保持同步：

- 节点与参数注册表的唯一事实来源是 `src/schema.js` 的 `NODE_TYPES`；
- `docs/contract/registry-snapshot.json` 是该注册表的快照，由
  `node scripts/check-contract.js --update-registry` 从 `NODE_TYPES` 重新生成；
- `node scripts/check-contract.js`（`npm run contract:check`）会核对快照、本文档、
  `docs/contract/examples/` 下的可执行样例与真实编译/渲染结果，任何一项漂移都会失败。

契约版本：**2026-03**（旧字段迁移见第 7 节；默认模板不允许保留任何过期字段）。

---

## 1. 顶层结构与全局约束

模板顶层必须包含以下字段，缺一即 `TEMPLATE_SHAPE`：

`id`、`name`、`width`、`height`、`fps`、`duration`、`font`、`slots`、`variables`、`nodes`。

| 字段 | 类型/范围 | 说明 |
| --- | --- | --- |
| `id` | 字符串，匹配 `^[A-Za-z][A-Za-z0-9_]{0,63}$` | 模板标识，不合法报 `TEMPLATE_SHAPE` |
| `name` | 非空字符串 | 展示名 |
| `width` | 整数，2..7680 | 画布宽（像素） |
| `height` | 整数，2..4320 | 画布高（像素） |
| `fps` | 数字，1..240 | 帧率 |
| `duration` | 数字，0.1..600 秒 | 成片节目总时长，所有时间窗以此为界 |
| `font.family` | 非空字符串 | 必须在 `src/fonts.js` 字体注册表中，否则测量阶段报 `FONT_NOT_FOUND` |
| `font.weight` | `normal` 或 `bold`（可省略，默认 `normal`） | 其它值报 `TEMPLATE_SHAPE` |

`slots`、`variables` 必须是数组，`nodes` 必须是非空数组。

### 时长约束（`src/timeline.js`，单位均为秒）

- `logo` / `text` 图层必须满足 `start < end`，否则 `TIME_WINDOW`；
- 图层窗口必须落在 `[0, duration]` 内，越界报 `TIME_OUT_OF_RANGE`；
- 同一图层 `fadeIn + fadeOut` 不得超过窗口长度 `end - start`，否则 `TRANSITION_OVERLAP`；
- `endcard` 的 `start` 必须在 `[0, duration)` 内，越界报 `TIME_OUT_OF_RANGE`；
  `fadeIn` 必须大于 0（`TRANSITION_LENGTH`），且 `start + fadeIn <= duration`，否则 `TRANSITION_OVERLAP`；
- `background` 覆盖整个节目；其素材最短时长 `minDuration` 在素材绑定阶段核对。

### 图层边界（`src/timeline.js`）

`text` 图层的盒子必须完整落在画布内：`x + width <= canvas.width` 且
`y + height <= canvas.height`，否则报 `LAYER_OUT_OF_BOUNDS`（带节点定位与盒子尺寸）。

---

## 2. 节点目录（白名单，五类）

节点类型不在表内即 `NODE_TYPE_UNKNOWN`（任意“命令执行”类节点永远无法通过校验）。
节点 `id` 必须匹配 `^[A-Za-z][A-Za-z0-9_]{0,63}$`，重复报 `NODE_DUPLICATE`，
形状错误报 `NODE_SHAPE`，输入数量不符报 `NODE_INPUTS`。

### 2.1 `background`（kind=source，inputs=0）

| 参数 | 类型 | 必填 | 约束/默认 |
| --- | --- | --- | --- |
| `slot` | `slotRef`（of=video） | 是 | 必须引用已声明的 video 槽 |
| `opacity` | `number` | 否 | 0..1，默认 1；小于 1 时编译为 `colorchannelmixer=aa` |

### 2.2 `logo`（kind=transform，inputs=1）

| 参数 | 类型 | 必填 | 约束/默认 |
| --- | --- | --- | --- |
| `slot` | `slotRef`（of=image） | 是 | 必须引用已声明的 image 槽 |
| `x` / `y` | `number` | 是 | >= 0，画布左上角原点 |
| `start` / `end` | `number` | 是 | >= 0，且 `start < end`，窗口不超过 `duration` |
| `fadeIn` / `fadeOut` | `number` | 否 | >= 0，默认 0；两者之和不得超过窗口 |
| `opacity` | `number` | 否 | 0..1，默认 1 |

### 2.3 `text`（kind=transform，inputs=1）

| 参数 | 类型 | 必填 | 约束/默认 |
| --- | --- | --- | --- |
| `variable` | `variableRef` | 是 | 必须引用已声明变量 |
| `x` / `y` | `number` | 是 | >= 0 |
| `width` / `height` | `number` | 是 | >= 1；盒子不得越界（`LAYER_OUT_OF_BOUNDS`） |
| `fontSize` | `number` | 是 | 1..400 |
| `color` | `color` | 否 | `#RRGGBB`，默认 `#FFFFFF` |
| `start` / `end` | `number` | 是 | 同 logo 时间窗规则 |
| `fadeIn` / `fadeOut` | `number` | 否 | >= 0，默认 0 |
| `align` | `enum` | 否 | `left` / `center` / `right`，默认 `left` |
| `lineHeight` | `number` | 否 | 0.5..3，默认 1.2 |

文本不交给 ffmpeg 排版：`src/text.js` 用与渲染相同的字体文件实测换行与宽高，
超出盒子即 `TEXT_OVERFLOW`，诊断携带 `measuredWidth`、`measuredHeight`、`lines`、
`boxWidth`、`boxHeight` 作为实测证据。

### 2.4 `endcard`（kind=transform，inputs=1）

| 参数 | 类型 | 必填 | 约束/默认 |
| --- | --- | --- | --- |
| `slot` | `slotRef`（of=image） | 是 | 结束卡图片槽 |
| `start` | `number` | 是 | >= 0 且 < `duration` |
| `fadeIn` | `number` | 是 | > 0，且 `start + fadeIn <= duration` |

### 2.5 `output`（kind=output，inputs=1，无参数）

全图必须恰好有一个 `output` 节点，否则 `OUTPUT_COUNT`；任何节点不得把 output 节点作为输入，
否则 `REF_INVALID`。

---

## 3. 参数类型系统

注册表（`src/schema.js`）只认识以下六种参数类型；类型不符报 `PARAM_TYPE`，
缺少必填参数报 `PARAM_MISSING`，出现注册表外参数报 `PARAM_UNKNOWN`。

| 类型 | 规则 |
| --- | --- |
| `number` | 有限数字；支持 `min` / `max` 闭区间校验 |
| `string` | 非空字符串 |
| `enum` | 值必须出现在该参数声明的 `values` 中 |
| `color` | 严格匹配 `^#[0-9a-fA-F]{6}$`（如 `#ffd166`） |
| `slotRef` | 必须引用模板已声明的 `slots[].id`，且槽 `kind` 与参数声明的 `of`（video/image）一致 |
| `variableRef` | 必须引用模板已声明的 `variables[].id` |

---

## 4. 素材槽（slots）契约

每个槽位声明：`id`（`SLOT_SHAPE`/`SLOT_DUPLICATE`）、`kind`（`video`|`image`）、
整数像素 `width`/`height`、`match`（`exact` 默认，或 `max`）、布尔 `required`，
video 槽还需要 `minDuration`（秒），可选布尔 `requiresAlpha`。

绑定阶段（`src/assets.js`，独立 ffprobe 进程取证）的诊断：

| 诊断码 | 触发条件 |
| --- | --- |
| `ASSET_MISSING` | `required` 槽没有绑定素材；**不允许任何占位文件替代**，正式渲染被阻止 |
| `ASSET_NOT_FOUND` | 绑定的素材 id 在素材库中不存在 |
| `ASSET_FILE_GONE` | 登记在册的素材文件已从磁盘消失 |
| `ASSET_UNREADABLE` | ffprobe 无法解析该文件 |
| `ASSET_DIMENSIONS` | `exact` 模式尺寸必须像素级相等；`max` 模式不得超过声明尺寸 |
| `ASSET_DURATION` | video 素材时长无法探测 |
| `ASSET_DURATION_SHORT` | 实测时长（容差 0.05s）小于槽位 `minDuration` |
| `ASSET_ALPHA` | `requiresAlpha: true` 但素材像素格式无 alpha 通道 |
| `SLOT_UNKNOWN` | 绑定指向模板从未声明的槽位 |

变量值（`src/text.js`）：空/空白字符串报 `VARIABLE_EMPTY`；超过变量 `maxLength`
或 5000 字符硬上限报 `VARIABLE_TOO_LONG`。

---

## 5. 引用与 DAG 规则（`src/schema.js`）

- 节点输入引用不存在的节点 → `REF_MISSING`（消息同时包含引用方与缺失 id）；
- DFS 三色染色检测循环，命中时输出完整环路路径，例如
  `logoLayer -> titleLayer -> logoLayer`，诊断码 `REF_CYCLE`（带 `path` 字段）；
- 编译期 `topoSort` 是第二道防线，遇到环同样以 `REF_CYCLE` 中止；
- 预渲染文本层缺失是编译期错误 `TEXT_LAYER_MISSING`（正常流程不可达，属于防御性检查）。

---

## 6. 诊断码总表（校验器要求文档与实现逐一对应）

| 诊断码 | 产生阶段 |
| --- | --- |
| `TEMPLATE_SHAPE` / `SLOT_SHAPE` / `SLOT_DUPLICATE` | schema.js 结构校验 |
| `VARIABLE_SHAPE` / `VARIABLE_DUPLICATE` | schema.js 结构校验 |
| `NODE_SHAPE` / `NODE_DUPLICATE` / `NODE_TYPE_UNKNOWN` / `NODE_INPUTS` | schema.js 节点校验 |
| `PARAM_MISSING` / `PARAM_TYPE` / `PARAM_UNKNOWN` | schema.js 参数校验 |
| `REF_MISSING` / `REF_INVALID` / `REF_CYCLE` / `OUTPUT_COUNT` | schema.js 引用/DAG 校验 |
| `TIME_WINDOW` / `TIME_OUT_OF_RANGE` / `TRANSITION_OVERLAP` / `TRANSITION_LENGTH` | timeline.js 时间线 |
| `LAYER_OUT_OF_BOUNDS` | timeline.js 图层边界 |
| `ASSET_MISSING` / `ASSET_NOT_FOUND` / `ASSET_FILE_GONE` / `ASSET_UNREADABLE` | assets.js 素材 |
| `ASSET_DIMENSIONS` / `ASSET_DURATION` / `ASSET_DURATION_SHORT` / `ASSET_ALPHA` / `SLOT_UNKNOWN` | assets.js 素材 |
| `VARIABLE_EMPTY` / `VARIABLE_TOO_LONG` / `TEXT_OVERFLOW` / `FONT_NOT_FOUND` | text.js 文本/字体 |

每条诊断都带定位字段（`nodeId` / `slotId` / `variableId` / `path`）；样例检查会强制要求
负面用例的所有诊断均可定位。

---

## 7. 过期字段兼容与迁移（默认模板零保留）

过期字段**不进入** `src/schema.js`，也不允许出现在 `data/templates/` 的默认模板里；
旧材料统一由 `src/legacy.js` 的 `migrateTemplate()` 先迁移、再走当前契约校验。
可执行迁移样例：`docs/contract/examples/06-legacy_migration.json`。

| 作用域 | 过期字段 | 当前字段 | 迁移规则 |
| --- | --- | --- | --- |
| template | `lengthSec` | `duration` | 直接改名（秒） |
| template | `timebase` | `fps` | 直接改名 |
| node | `from` | `start` | 直接改名（秒） |
| node | `to` | `end` | 直接改名（秒） |
| node | `fadeInMs` | `fadeIn` | 毫秒除以 1000 转秒 |
| node | `fadeOutMs` | `fadeOut` | 毫秒除以 1000 转秒 |
| node | `alpha` | `opacity` | 直接改名（0..1） |
| node | `fontColor` | `color` | 直接改名（`#RRGGBB`） |
| variable | `maxChars` | `maxLength` | 直接改名 |
| slot | `minLenSec` | `minDuration` | 直接改名（秒） |

迁移结果（含每处 `field → replacement`、原始值、应用值、是否与新字段冲突）由
`migrateTemplate()` 返回；若新字段已存在则保留新值并在结果中标记 `collided: true`。
旧模板在迁移前必须被 `validateTemplateShape` 拒绝（过期字段表现为 `PARAM_UNKNOWN` /
`TEMPLATE_SHAPE`），迁移后必须通过完整校验并可渲染。

---

## 8. 可执行样例清单（`docs/contract/examples/`）

样例由 `generate-examples.js` 从 `01-canonical.json` 派生；`01-canonical.json` 与
`scripts/pack-definitions.js` 的 `baseTemplate('aurora_ad')` 必须逐字节一致。

| 文件 | 种类 | 触发/结果 | 证据 |
| --- | --- | --- | --- |
| `01-canonical.json` | positive | 全槽绑定、DAG 合法 | 渲染并独立探测：1280x720、10s、300 帧、h264/yuv420p |
| `02-empty_slot.json` | negative | logo 空槽 | `ASSET_MISSING`（slotId=logo），不渲染、无占位 |
| `03-ref_cycle.json` | negative | logoLayer ↔ titleLayer 环 | `REF_CYCLE`，消息含 `logoLayer -> titleLayer -> logoLayer` |
| `04-long_title_overflow.json` | negative | 长标题实测溢出 | `TEXT_OVERFLOW`：实测高 414px > 容器 170px、5 行 |
| `05-short_background.json` | negative | 6s 背景覆盖 10s 节目 | `ASSET_DURATION_SHORT`，消息含实测 `6.000s` |
| `06-legacy_migration.json` | migration | 14 处过期字段 | 迁移前被 schema 拒绝；迁移后通过校验并渲染 1280x720/10s |

校验器不会把“没有报错”伪装成成功：positive/migration 样例必须真实渲染，并用与渲染路径
独立的 ffprobe 核对成片尺寸与时长；negative 样例必须出现文档声明的诊断码且全部可定位。

### 维护命令

```bash
npm run contract:maintain           # 重新生成派生样例后跑全量检查（日常维护入口）
npm run contract:check              # 全量检查（含真实渲染与独立探测），写 evidence/check-report.json
npm run contract:check -- --static  # 无 ffmpeg 的静态检查（注册表/文档/样例/迁移逻辑）
npm run contract:check -- --json    # 机器可读报告输出到 stdout
npm run contract:registry           # 注册表变更后重新生成 registry-snapshot.json
npm run contract:examples           # 从正例重新生成派生样例
```

---

## 9. 成片尺寸与执行证据

- 标准节目画布 1280x720、30fps、10s，即 300 帧；输出编码器 h264、像素格式 yuv420p。
- `scripts/freeze.js` 渲染三个品牌包的冻结成片并记录独立探测结果与 300 帧 framemd5 聚合 sha256；
- `scripts/verify.js` 在全新临时目录重渲染，独立 ffprobe 核对 1280x720/10s，并逐帧比对冻结哈希，
  报告写入 `packs/verify-report.json`；
- 本契约检查的逐次执行证据写入 `docs/contract/evidence/check-report.json`，
  每个样例都记录诊断码（负面）或独立探测的 `width`/`height`/`duration`/`pixFmt`/`codec`（正面）。
