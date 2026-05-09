// AI 模型目录 — 按 provider × kind × orientation 组织
//
// HOLO 协议下的模型名直接是 API 实名（landscape/portrait 内嵌），无需映射。
// Flow2API 协议下保留旧的 _ultra / _ultra_relaxed 等老别名，
// 由前端 mapModelForFlow2API() 在提交时拼出最终模型字符串。
//
// 切换 provider 由 useProvider() hook 决定，从 GET /api/config/ai-provider 读取。

// =====================================================
// 视频模型（按 provider × kind × orientation 区分）
// =====================================================
export const VIDEO_MODELS = {
  flow2api: {
    t2v: {
      landscape: [
        { value: 'veo_t2v_ultra', label: 'VEO 3.1 Ultra (极速)' },
        { value: 'veo_t2v_ultra_relaxed', label: 'VEO 3.1 Ultra Relax (休闲)' },
      ],
      portrait: [
        { value: 'veo_t2v_ultra', label: 'VEO 3.1 Ultra (极速)' },
        { value: 'veo_t2v_ultra_relaxed', label: 'VEO 3.1 Ultra Relax (休闲)' },
      ],
    },
    i2v: {
      landscape: [
        { value: 'veo_i2v_ultra', label: 'VEO 3.1 Ultra (极速首尾帧)' },
        { value: 'veo_i2v_ultra_relaxed', label: 'VEO 3.1 Ultra Relax (休闲)' },
      ],
      portrait: [
        { value: 'veo_i2v_ultra', label: 'VEO 3.1 Ultra (极速首尾帧)' },
        { value: 'veo_i2v_ultra_relaxed', label: 'VEO 3.1 Ultra Relax (休闲)' },
        { value: 'flow2api/veo_3_1_i2v_s_fast_portrait_ultra_fl', label: 'Flow2API · I2V Fast 竖屏' },
        { value: 'flow2api/veo_3_1_r2v_fast_portrait', label: 'Flow2API · R2V 竖屏 (多图参考)' },
      ],
    },
  },
  holo: {
    t2v: {
      landscape: [
        { value: 'veo_3_1_t2v_lite_landscape', label: 'T2V Lite 横屏 720p (~43c)' },
        { value: 'veo_3_1_t2v_fast_landscape', label: 'T2V Fast 横屏 720p (~51c)' },
        { value: 'veo_3_1_t2v_landscape', label: 'T2V Quality 横屏 720p (~89c)' },
        { value: 'veo_3_1_t2v_fast_landscape_1080p', label: 'T2V Fast 横屏 1080p (~72c)' },
        { value: 'veo_3_1_t2v_landscape_1080p', label: 'T2V Quality 横屏 1080p (~126c)' },
      ],
      portrait: [
        { value: 'veo_3_1_t2v_lite_portrait', label: 'T2V Lite 竖屏 720p (~43c)' },
        { value: 'veo_3_1_t2v_fast_portrait', label: 'T2V Fast 竖屏 720p (~51c)' },
        { value: 'veo_3_1_t2v_portrait', label: 'T2V Quality 竖屏 720p (~89c)' },
        { value: 'veo_3_1_t2v_fast_portrait_4k', label: 'T2V Fast 竖屏 4K (~88c)' },
      ],
    },
    i2v: {
      landscape: [
        { value: 'veo_3_1_i2v_lite_landscape', label: 'I2V Lite 横屏 720p (~55c)' },
        { value: 'veo_3_1_i2v_fast_landscape', label: 'I2V Fast 横屏 720p (~65c)' },
        { value: 'veo_3_1_i2v_s_landscape', label: 'I2V Quality 横屏 720p (~114c)' },
        { value: 'veo_3_1_i2v_fast_landscape_1080p', label: 'I2V Fast 横屏 1080p (~89c)' },
      ],
      portrait: [
        { value: 'veo_3_1_i2v_lite_portrait', label: 'I2V Lite 竖屏 720p (~55c)' },
        { value: 'veo_3_1_i2v_fast_portrait', label: 'I2V Fast 竖屏 720p (~65c)' },
        { value: 'veo_3_1_i2v_s_portrait', label: 'I2V Quality 竖屏 720p (~114c)' },
        { value: 'veo_3_1_i2v_fast_portrait_4k', label: 'I2V Fast 竖屏 4K (~110c)' },
      ],
    },
  },
  grok: {
    t2v: {
      landscape: [
        { value: 'grok-imagine-video', label: 'Grok Imagine Video' },
      ],
      portrait: [
        { value: 'grok-imagine-video', label: 'Grok Imagine Video' },
      ],
    },
    i2v: {
      landscape: [
        { value: 'grok-imagine-video', label: 'Grok Imagine Video (I2V)' },
      ],
      portrait: [
        { value: 'grok-imagine-video', label: 'Grok Imagine Video (I2V)' },
      ],
    },
  },
};

// =====================================================
// 图像模型（两个 provider 都用同一套 gemini 命名）
// =====================================================
// 按 provider 分组的图像模型（让前端 dropdown 可以三组并存）
export const IMAGE_MODELS_BY_PROVIDER = {
  holo: {
    t2i: [
      { value: 'gemini-3.1-flash-image-portrait', label: 'Gemini 3.1 Flash 竖屏' },
      { value: 'gemini-3.1-flash-image-landscape', label: 'Gemini 3.1 Flash 横屏' },
      { value: 'gemini-3.1-flash-image-square', label: 'Gemini 3.1 Flash 方形' },
      { value: 'gemini-3.0-pro-image-portrait', label: 'Gemini 3.0 Pro 竖屏' },
      { value: 'gemini-3.0-pro-image-landscape', label: 'Gemini 3.0 Pro 横屏' },
      { value: 'GPT-images2', label: 'GPT-images2 默认' },
      { value: 'GPT-images2 1:1', label: 'GPT-images2 方形 1:1' },
      { value: 'GPT-images2 1:1-2K', label: 'GPT-images2 方形 1:1 2K' },
      { value: 'GPT-images2 16:9-2K', label: 'GPT-images2 横屏 16:9 2K' },
      { value: 'GPT-images2 16:9-4K', label: 'GPT-images2 横屏 16:9 4K' },
      { value: 'GPT-images2 9:16-4K', label: 'GPT-images2 竖屏 9:16 4K' },
      { value: 'GPT-images2 2:3-2K', label: 'GPT-images2 2:3 2K' },
      { value: 'GPT-images2 3:2-2K', label: 'GPT-images2 3:2 2K' },
    ],
    i2i: [
      { value: 'gemini-3.1-flash-image-portrait', label: 'Gemini 3.1 Flash 竖屏 (R2I)' },
      { value: 'gemini-3.1-flash-image-landscape', label: 'Gemini 3.1 Flash 横屏 (R2I)' },
      { value: 'gemini-3.0-pro-image-portrait', label: 'Gemini 3.0 Pro 竖屏 (R2I)' },
      { value: 'gemini-3.0-pro-image-landscape', label: 'Gemini 3.0 Pro 横屏 (R2I)' },
      { value: 'GPT-images2 1:1', label: 'GPT-images2 方形 1:1 (R2I)' },
      { value: 'GPT-images2 16:9-2K', label: 'GPT-images2 横屏 16:9 2K (R2I)' },
      { value: 'GPT-images2 9:16-4K', label: 'GPT-images2 竖屏 9:16 4K (R2I)' },
    ],
  },
  flow2api: {
    t2i: [
      { value: 'flow2api/gemini-3.1-flash-image-portrait', label: 'Flow2API · Gemini 3.1 Flash 竖屏' },
    ],
    i2i: [],
  },
  grok: {
    t2i: [
      { value: 'grok-imagine-image', label: 'Grok Imagine 标准' },
      { value: 'grok-imagine-image-lite', label: 'Grok Imagine Lite (快速)' },
      { value: 'grok-imagine-image-pro', label: 'Grok Imagine Pro (高质量)' },
    ],
    i2i: [
      { value: 'grok-imagine-image-edit', label: 'Grok Imagine Edit (图像编辑)' },
    ],
  },
};

// 静态访问器：把数据塞进函数体内部字面量，绕过 rollup 把外部对象 IMAGE_MODELS_BY_PROVIDER 整个 tree-shake 掉的 bug
export function getImageModelsByProvider(provider, kind) {
  const T2I = {
    holo: [
      { value: 'gemini-3.1-flash-image-portrait', label: 'Gemini 3.1 Flash 竖屏' },
      { value: 'gemini-3.1-flash-image-landscape', label: 'Gemini 3.1 Flash 横屏' },
      { value: 'gemini-3.1-flash-image-square', label: 'Gemini 3.1 Flash 方形' },
      { value: 'gemini-3.0-pro-image-portrait', label: 'Gemini 3.0 Pro 竖屏' },
      { value: 'gemini-3.0-pro-image-landscape', label: 'Gemini 3.0 Pro 横屏' },
      { value: 'GPT-images2', label: 'GPT-images2 默认' },
      { value: 'GPT-images2 1:1', label: 'GPT-images2 方形 1:1' },
      { value: 'GPT-images2 1:1-2K', label: 'GPT-images2 方形 1:1 2K' },
      { value: 'GPT-images2 16:9-2K', label: 'GPT-images2 横屏 16:9 2K' },
      { value: 'GPT-images2 16:9-4K', label: 'GPT-images2 横屏 16:9 4K' },
      { value: 'GPT-images2 9:16-4K', label: 'GPT-images2 竖屏 9:16 4K' },
      { value: 'GPT-images2 2:3-2K', label: 'GPT-images2 2:3 2K' },
      { value: 'GPT-images2 3:2-2K', label: 'GPT-images2 3:2 2K' },
    ],
    flow2api: [
      { value: 'flow2api/gemini-3.1-flash-image-portrait', label: 'Flow2API · Gemini 3.1 Flash 竖屏' },
    ],
    grok: [
      { value: 'grok-imagine-image', label: 'Grok Imagine 标准' },
      { value: 'grok-imagine-image-lite', label: 'Grok Imagine Lite (快速)' },
      { value: 'grok-imagine-image-pro', label: 'Grok Imagine Pro (高质量)' },
    ],
  };
  const I2I = {
    holo: [
      { value: 'gemini-3.1-flash-image-portrait', label: 'Gemini 3.1 Flash 竖屏 (R2I)' },
      { value: 'gemini-3.1-flash-image-landscape', label: 'Gemini 3.1 Flash 横屏 (R2I)' },
      { value: 'gemini-3.0-pro-image-portrait', label: 'Gemini 3.0 Pro 竖屏 (R2I)' },
      { value: 'gemini-3.0-pro-image-landscape', label: 'Gemini 3.0 Pro 横屏 (R2I)' },
      { value: 'GPT-images2 1:1', label: 'GPT-images2 方形 1:1 (R2I)' },
      { value: 'GPT-images2 16:9-2K', label: 'GPT-images2 横屏 16:9 2K (R2I)' },
      { value: 'GPT-images2 9:16-4K', label: 'GPT-images2 竖屏 9:16 4K (R2I)' },
    ],
    flow2api: [],
    grok: [
      { value: 'grok-imagine-image-edit', label: 'Grok Imagine Edit (图像编辑)' },
    ],
  };
  const map = kind === 'i2i' ? I2I : T2I;
  return map[provider] || [];
}

// 兼容旧调用：扁平合并
export const IMAGE_MODELS = {
  t2i: [
    ...IMAGE_MODELS_BY_PROVIDER.holo.t2i,
    ...IMAGE_MODELS_BY_PROVIDER.flow2api.t2i,
    ...IMAGE_MODELS_BY_PROVIDER.grok.t2i,
  ],
  i2i: [
    ...IMAGE_MODELS_BY_PROVIDER.holo.i2i,
    ...IMAGE_MODELS_BY_PROVIDER.flow2api.i2i,
    ...IMAGE_MODELS_BY_PROVIDER.grok.i2i,
  ],
};

// 扁平 model→provider 索引：跟后端 model_registry.py 同步
// 显式前缀（"flow2api/" 等）优先，其次走命名规则
export function providerOf(model) {
  if (!model) return 'holo';
  const m = String(model).trim();
  // 1. 显式前缀（最高优先，可消歧重名模型）
  if (m.startsWith('flow2api/')) return 'flow2api';
  if (m.startsWith('grok/')) return 'grok';
  if (m.startsWith('holo/')) return 'holo';
  if (m.startsWith('cc123/')) return 'cc123';
  // 2. 命名规则
  if (m.startsWith('grok-')) return 'grok';
  if (m.includes('_ultra')) return 'flow2api';
  // HOLO 模型名大小写不稳，前缀比较走 lowercase
  const ml = m.toLowerCase();
  if (ml.startsWith('gpt-images') || ml.startsWith('gemini-3.') || ml.startsWith('imagen-') || ml.startsWith('veo_3_') || ml.startsWith('sora-')) return 'holo';
  return 'holo';  // 兜底
}

// =====================================================
// 默认模型（按 provider 选择）
// =====================================================
export const DEFAULT_MODELS = {
  flow2api: {
    director_image: 'gemini-3.1-flash-image-portrait',
    director_video: 'veo_3_1_i2v_s_fast_portrait_ultra_relaxed',
    fission_video:  'veo_3_1_i2v_s_fast_portrait_ultra_relaxed',
    toolbox_t2v_portrait:  'veo_t2v_ultra_relaxed',
    toolbox_t2v_landscape: 'veo_t2v_ultra_relaxed',
    toolbox_i2v_portrait:  'veo_i2v_ultra_relaxed',
    toolbox_i2v_landscape: 'veo_i2v_ultra_relaxed',
  },
  holo: {
    director_image: 'gemini-3.1-flash-image-portrait',
    director_video: 'veo_3_1_i2v_lite_portrait',
    fission_video:  'veo_3_1_i2v_lite_portrait',
    toolbox_t2v_portrait:  'veo_3_1_t2v_lite_portrait',
    toolbox_t2v_landscape: 'veo_3_1_t2v_lite_landscape',
    toolbox_i2v_portrait:  'veo_3_1_i2v_lite_portrait',
    toolbox_i2v_landscape: 'veo_3_1_i2v_lite_landscape',
  },
};

// =====================================================
// 帮助函数
// =====================================================

// 取一个 provider 下某 kind/orientation 的视频模型 option 列表
export function getVideoOptions(provider, kind, orientation) {
  const p = (provider || 'flow2api').toLowerCase();
  return VIDEO_MODELS[p]?.[kind]?.[orientation] || [];
}

// 取一个默认模型
export function getDefaultModel(provider, key) {
  const p = (provider || 'flow2api').toLowerCase();
  return DEFAULT_MODELS[p]?.[key] || DEFAULT_MODELS.flow2api[key];
}

// flow2api 旧逻辑：dropdown 短别名 → API 实名
// 仅 flow2api 模式下使用；HOLO 模式下 dropdown value 已经是 API 实名，不走此函数
export function mapModelForFlow2API(shortAlias, aspectRatio) {
  const isLandscape = aspectRatio === '16:9';
  const map = {
    veo_t2v_ultra:         isLandscape ? 'veo_3_1_t2v_fast_ultra'              : 'veo_3_1_t2v_fast_portrait_ultra',
    veo_t2v_ultra_relaxed: isLandscape ? 'veo_3_1_t2v_fast_ultra_relaxed'      : 'veo_3_1_t2v_fast_portrait_ultra_relaxed',
    veo_i2v_ultra:         isLandscape ? 'veo_3_1_i2v_s_fast_ultra_fl'         : 'veo_3_1_i2v_s_fast_portrait_ultra_fl',
    veo_i2v_ultra_relaxed: isLandscape ? 'veo_3_1_i2v_s_fast_ultra_relaxed'    : 'veo_3_1_i2v_s_fast_portrait_ultra_relaxed',
  };
  return map[shortAlias] || shortAlias;
}

// 把比例字符串映射到 orientation
export function aspectToOrientation(aspectRatio) {
  if (aspectRatio === '16:9' || aspectRatio === '4:3') return 'landscape';
  return 'portrait';
}
