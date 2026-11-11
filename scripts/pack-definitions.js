'use strict';

// Canonical definitions of the three brand data packages.
// Each pack pairs a renderable template with edge-case suites that must be
// rejected with locatable errors instead of being silently rendered.

const W = 1280;
const H = 720;
const D = 10;

function baseTemplate(id, name, color) {
  return {
    id,
    name,
    width: W,
    height: H,
    fps: 30,
    duration: D,
    font: { family: 'DejaVu Sans', weight: 'bold' },
    slots: [
      { id: 'background', kind: 'video', width: W, height: H, minDuration: D, match: 'exact', required: true },
      { id: 'logo', kind: 'image', width: 320, height: 180, match: 'exact', required: true, requiresAlpha: true },
      { id: 'endcard', kind: 'image', width: W, height: H, match: 'exact', required: true },
    ],
    variables: [
      { id: 'title', type: 'text', label: 'Headline', maxLength: 200 },
      { id: 'tagline', type: 'text', label: 'Tagline', maxLength: 120 },
    ],
    nodes: [
      { id: 'bg', type: 'background', inputs: [], params: { slot: 'background', opacity: 1 } },
      {
        id: 'logoLayer', type: 'logo', inputs: ['bg'],
        params: { slot: 'logo', x: 40, y: 36, start: 0.3, end: 7.5, fadeIn: 0.5, fadeOut: 0.5, opacity: 1 },
      },
      {
        id: 'titleLayer', type: 'text', inputs: ['logoLayer'],
        params: {
          variable: 'title', x: 80, y: 250, width: 1120, height: 170,
          fontSize: 72, color, start: 0.6, end: 7.8, fadeIn: 0.4, fadeOut: 0.4, align: 'center', lineHeight: 1.15,
        },
      },
      {
        id: 'taglineLayer', type: 'text', inputs: ['titleLayer'],
        params: {
          variable: 'tagline', x: 240, y: 450, width: 800, height: 90,
          fontSize: 40, color: '#FFFFFF', start: 0.9, end: 7.8, fadeIn: 0.4, fadeOut: 0.4, align: 'center', lineHeight: 1.2,
        },
      },
      { id: 'endcardLayer', type: 'endcard', inputs: ['taglineLayer'], params: { slot: 'endcard', start: 8, fadeIn: 0.6 } },
      { id: 'out', type: 'output', inputs: ['endcardLayer'], params: {} },
    ],
  };
}

const packs = {
  aurora: {
    label: 'Aurora — long headline suite',
    color: '#ffd166',
    assets: {
      background: 'bg12.mp4',
      logo: 'logo.png',
      endcard: 'endcard.png',
    },
    variables: {
      title: 'AURORA LIGHT',
      tagline: 'Feel the glow of a new day',
    },
    cases: [
      {
        id: 'long_title_overflow',
        desc: 'headline far wider and taller than its container',
        variables: {
          title: 'AURORA LIGHT PRESENTS THE BIGGEST MIDNIGHT SUN CELEBRATION EVENT OF THE ENTIRE DECADE WITH LIVE PERFORMANCES',
          tagline: 'Feel the glow of a new day',
        },
        expectErrors: ['TEXT_OVERFLOW'],
      },
      {
        id: 'missing_asset',
        desc: 'logo slot unbound must block formal render, no placeholder allowed',
        unbind: ['logo'],
        expectErrors: ['ASSET_MISSING'],
      },
    ],
  },

  boreal: {
    label: 'Boreal — transparent logo suite',
    color: '#8ce99a',
    assets: {
      background: 'bg12.mp4',
      logo: 'logo.png',
      endcard: 'endcard.png',
    },
    variables: {
      title: 'BOREAL NORTH',
      tagline: 'Where silence becomes scenery',
    },
    cases: [
      {
        id: 'opaque_logo_rejected',
        desc: 'a logo without an alpha channel fails the slot transparency requirement',
        flattenAlpha: 'logo',
        expectErrors: ['ASSET_ALPHA'],
      },
      {
        id: 'ref_missing_node',
        desc: 'node pointing at a node that does not exist',
        patch: { node: 'out', inputs: ['doesNotExist'] },
        expectErrors: ['REF_MISSING'],
      },
      {
        id: 'ref_cycle',
        desc: 'circular node reference must be reported with the cycle path',
        patch: { node: 'logoLayer', inputs: ['titleLayer'] },
        expectErrors: ['REF_CYCLE'],
      },
    ],
  },

  cobalt: {
    label: 'Cobalt — short background and layer bounds suite',
    color: '#9ad1ff',
    assets: {
      background: 'bg12.mp4',
      logo: 'logo.png',
      endcard: 'endcard.png',
    },
    variables: {
      title: 'COBALT FORGE',
      tagline: 'Precision built for real work',
    },
    cases: [
      {
        id: 'short_background',
        desc: '6s background cannot cover the 10s program even though it loops',
        assetsOverride: { background: 'bg6.mp4' },
        expectErrors: ['ASSET_DURATION_SHORT'],
      },
      {
        id: 'layer_out_of_bounds',
        desc: 'text box crossing the canvas edge',
        invalidTemplate: 'cobalt_bounds',
        expectErrors: ['LAYER_OUT_OF_BOUNDS'],
      },
      {
        id: 'transition_overflow',
        desc: 'fade in plus fade out longer than the layer window',
        invalidTemplate: 'cobalt_transition',
        expectErrors: ['TRANSITION_OVERLAP'],
      },
      {
        id: 'forbidden_node_type',
        desc: 'arbitrary command node type is not in the registry',
        patch: { node: 'bg', type: 'shell_exec' },
        expectErrors: ['NODE_TYPE_UNKNOWN'],
      },
    ],
  },
};

const invalidTemplates = {
  cobalt_bounds: () => {
    const t = baseTemplate('cobalt_bounds', 'Cobalt bounds violation', '#9ad1ff');
    t.id = 'cobalt_bounds';
    const title = t.nodes.find((n) => n.id === 'titleLayer');
    title.params.x = 900;
    title.params.width = 1120; // 900 + 1120 > 1280
    return t;
  },
  cobalt_transition: () => {
    const t = baseTemplate('cobalt_transition', 'Cobalt transition violation', '#9ad1ff');
    t.id = 'cobalt_transition';
    const logo = t.nodes.find((n) => n.id === 'logoLayer');
    logo.params.start = 1;
    logo.params.end = 2;
    logo.params.fadeIn = 0.8;
    logo.params.fadeOut = 0.8; // 1.6s of fades inside a 1s window
    return t;
  },
};

module.exports = { baseTemplate, packs, invalidTemplates, W, H, D };
