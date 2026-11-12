'use strict';

// Regenerates every derived contract example from 01-canonical.json.
// The canonical file is hand-reviewed and must stay deep-equal to the
// compiler's baseTemplate (checked by check-contract.js); every other
// example is a declared mutation of it, so the examples can never silently
// drift away from the current template contract.

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const canonical = JSON.parse(fs.readFileSync(path.join(DIR, '01-canonical.json'), 'utf8'));

function derive(id, title, kind, desc, mutate, extra = {}) {
  const base = JSON.parse(JSON.stringify(canonical));
  const out = {
    id,
    title,
    pack: base.pack,
    kind,
    desc,
    bindings: base.bindings,
    unbind: [],
    variables: base.variables,
    expect: base.expect,
    ...extra,
  };
  out.template = base.template;
  mutate(out);
  return out;
}

const examples = [];

// 02 — required slot left empty: must block formal render with ASSET_MISSING.
examples.push(derive(
  'ex_empty_slot',
  '反例：素材空槽（无占位替换）',
  'negative',
  'logo 槽位保持未绑定。系统不允许任何占位素材替代，正式渲染前以 ASSET_MISSING 拦截，并带 slotId 定位。',
  (out) => {
    out.unbind = ['logo'];
    out.expect = {
      ok: false,
      render: false,
      errors: ['ASSET_MISSING'],
      locatable: true,
    };
  },
));

// 03 — circular node reference: DFS coloring must emit the full cycle path.
examples.push(derive(
  'ex_ref_cycle',
  '反例：循环引用节点',
  'negative',
  '把 logoLayer 的输入改为 titleLayer，形成 logoLayer ↔ titleLayer 环。validateReferences 用 DFS 染色输出完整环路路径并报 REF_CYCLE，编译永远不会开始。',
  (out) => {
    const logo = out.template.nodes.find((n) => n.id === 'logoLayer');
    logo.inputs = ['titleLayer'];
    out.mutation = { node: 'logoLayer', inputs: ['titleLayer'] };
    out.expect = {
      ok: false,
      render: false,
      errors: ['REF_CYCLE'],
      locatable: true,
      messagePattern: 'logoLayer -> titleLayer -> logoLayer',
    };
  },
));

// 04 — long title measured against the real font: TEXT_OVERFLOW with evidence.
examples.push(derive(
  'ex_long_title_overflow',
  '反例：长标题实测溢出',
  'negative',
  '标题远超 1120x170 容器。text.js 用与渲染相同的 DejaVu Sans Bold 72px 实测换行，给出实测宽高/行数并报 TEXT_OVERFLOW；实测证据固定为 414px 高、5 行。',
  (out) => {
    out.variables = {
      title: 'AURORA LIGHT PRESENTS THE BIGGEST MIDNIGHT SUN CELEBRATION EVENT OF THE ENTIRE DECADE WITH LIVE PERFORMANCES',
      tagline: 'Feel the glow of a new day',
    };
    out.expect = {
      ok: false,
      render: false,
      errors: ['TEXT_OVERFLOW'],
      locatable: true,
      overflow: { nodeId: 'titleLayer', measuredHeight: 414, lines: 5, boxHeight: 170 },
    };
  },
));

// 05 — a 6s background cannot cover the 10s program even with -stream_loop.
examples.push(derive(
  'ex_short_background',
  '反例：背景素材时长不足',
  'negative',
  'background 槽位改绑 cobalt 包的 6s 素材 bg6.mp4；槽位 minDuration=10s，独立 ffprobe 实测 6.000s 后报 ASSET_DURATION_SHORT（容差 0.05s）。',
  (out) => {
    out.packAssets = { background: { pack: 'cobalt', file: 'bg6.mp4' } };
    out.bindings = { background: 'bg6.mp4', logo: 'logo.png', endcard: 'endcard.png' };
    out.expect = {
      ok: false,
      render: false,
      errors: ['ASSET_DURATION_SHORT'],
      locatable: true,
      messagePattern: '6.000s',
    };
  },
));

// 06 — legacy/renamed fields: migrate first, then the template validates and renders.
examples.push(derive(
  'ex_legacy_migration',
  '迁移例：过期字段经迁移后按新契约渲染',
  'migration',
  '旧模板仍使用 lengthSec/timebase/from/to/fadeInMs/fadeOutMs/alpha/fontColor/maxChars/minLenSec 等已下线字段。schema 不接受这些字段；先用 src/legacy.js 迁移为当前契约，迁移结果必须通过校验并正常渲染。',
  (out) => {
    const t = out.template;
    t.lengthSec = t.duration;
    delete t.duration;
    t.timebase = t.fps;
    delete t.fps;

    const bg = t.nodes.find((n) => n.id === 'bg');
    bg.params.alpha = bg.params.opacity;
    delete bg.params.opacity;

    const logo = t.nodes.find((n) => n.id === 'logoLayer');
    logo.params.from = logo.params.start;
    logo.params.to = logo.params.end;
    delete logo.params.start;
    delete logo.params.end;
    logo.params.fadeInMs = 500;
    logo.params.fadeOutMs = 500;
    delete logo.params.fadeIn;
    delete logo.params.fadeOut;

    const title = t.nodes.find((n) => n.id === 'titleLayer');
    title.params.fontColor = title.params.color;
    delete title.params.color;
    title.params.from = title.params.start;
    title.params.to = title.params.end;
    delete title.params.start;
    delete title.params.end;
    title.params.fadeInMs = 400;
    title.params.fadeOutMs = 400;
    delete title.params.fadeIn;
    delete title.params.fadeOut;

    t.variables[0].maxChars = t.variables[0].maxLength;
    delete t.variables[0].maxLength;
    t.slots[0].minLenSec = t.slots[0].minDuration;
    delete t.slots[0].minDuration;

    out.expectLegacy = {
      rejectedBySchema: true,
      legacyFields: [
        'template.lengthSec', 'template.timebase',
        'node.bg.alpha',
        'node.logoLayer.from', 'node.logoLayer.to', 'node.logoLayer.fadeInMs', 'node.logoLayer.fadeOutMs',
        'node.titleLayer.fontColor', 'node.titleLayer.from', 'node.titleLayer.to',
        'node.titleLayer.fadeInMs', 'node.titleLayer.fadeOutMs',
        'variable.title.maxChars',
        'slot.background.minLenSec',
      ],
    };
    out.expect = {
      ok: true,
      render: true,
      renderSize: { width: 1280, height: 720 },
      renderDuration: 10,
      errors: [],
    };
  },
));

for (const [i, example] of examples.entries()) {
  const file = path.join(DIR, `${String(i + 2).padStart(2, '0')}-${example.id.replace(/^ex_/, '')}.json`);
  fs.writeFileSync(file, JSON.stringify(example, null, 2) + '\n');
  if (require.main === module) {
    console.log('wrote', path.relative(path.join(DIR, '..', '..'), file));
  }
}
