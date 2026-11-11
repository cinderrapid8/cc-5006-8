# 短广告片段模板合成系统

声明式模板 → 强校验 → 编译为可执行媒体处理图（ffmpeg filter graph）→ 渲染 → 独立探测验收。
模板是受限的节点 DAG，不是任意命令文本；用户输入永远不进入 shell。

## 架构与安全边界

| 关注点 | 实现位置 | 做法 |
| --- | --- | --- |
| 节点/参数白名单 | `src/schema.js` | 仅允许 `background/logo/text/endcard/output` 五类节点，参数按注册表做类型、枚举、范围、引用校验 |
| 引用与循环 | `src/schema.js` | 引用不存在节点报 `REF_MISSING`；DFS 染色检测循环并输出完整环路路径 `REF_CYCLE` |
| 时间线联合检查 | `src/timeline.js` | 图层窗口、转场长度、结束卡、成片时长一起校验；越界报 `LAYER_OUT_OF_BOUNDS` |
| 素材槽需求 | `src/assets.js` | 独立 ffprobe 结果核对尺寸/时长/透明通道；缺必需素材报 `ASSET_MISSING` 并阻止正式渲染，无占位文件 |
| 文本实测溢出 | `src/text.js` | 用与渲染相同的字体文件和布局参数测量，给出实测宽高、行数与容器尺寸的 `TEXT_OVERFLOW` |
| 字体一致性 | `src/fonts.js` + `src/text-render.js` | canvas 测量与文本图层 PNG 渲染共用同一字体注册表；ffmpeg 只做合成，不自行排版 |
| 命令注入面 | `src/process.js` | 全项目唯一进程出口，`spawn(bin, argv, { shell:false })`；滤镜写入脚本文件经 `-filter_complex_script` 传入 |
| 路径越界 | `src/store.js` | id 白名单正则，所有产物限制在数据根目录内 |
| 独立验收 | `src/render.js` + `scripts/verify.js` | 渲染后用独立 ffprobe 进程核对时长/尺寸，并用逐帧 framemd5 与冻结模板比对 |

文本为什么不交给 ffmpeg `drawtext`：本环境的静态 ffmpeg 未编入该滤镜。改为由 `@napi-rs/canvas`
把每个文本节点渲染成透明 PNG（与测量共用字体/字号/行高/对齐/盒模型），ffmpeg 仅按时间窗
`overlay` 并做 alpha 淡变。预览与渲染走同一条编译路径，因此排版不可能漂移。

## 目录

```
src/        校验、编译、探测、渲染、存储、HTTP 服务
web/        单页编辑器（绑定素材、编辑变量、实测溢出提示、预览、正式渲染、任务与验收状态）
scripts/    素材生成、引导入库、冻结、独立验收、浏览器冒烟
test/       node:test 套件（45 个用例）
packs/      三个品牌数据包：素材、模板定义、冻结成片与逐帧哈希、负面用例清单
data/       运行期数据（模板、变量表、任务、素材登记），不入库
```

## 使用

```bash
npm run fixtures     # 生成三个品牌的视频/透明标志/结束卡素材
npm run bootstrap    # 注册素材并保存模板与变量表到 data/
npm start            # 启动网页编辑器 http://localhost:3000

npm run freeze       # 渲染三个冻结成片 + 跑全部负面用例（必须全部拦截）
npm run verify       # 全新目录重渲染，独立探测时长/尺寸并逐帧比对冻结哈希
npm test             # 45 个单元/集成/安全用例
npm run ui:smoke     # 真实浏览器端到端（需先 npm start）
```

## 三个品牌数据包

- **aurora**：长标题溢出（实测 414px > 容器 170px，5 行）、缺素材阻止渲染
- **boreal**：透明标志（无 alpha 通道即 `ASSET_ALPHA`）、引用缺失、循环引用定位
- **cobalt**：6s 短背景无法覆盖 10s 节目（`ASSET_DURATION_SHORT`）、图层越界、转场超长、非法节点类型

每个包的 `renders/frozen.mp4` 是基准成片，`frozen.json` 记录独立探测结果与 300 帧的聚合哈希；
`scripts/verify.js` 在独立工作目录重渲染并要求逐帧一致、时长尺寸达标，结果写入 `packs/verify-report.json`。
