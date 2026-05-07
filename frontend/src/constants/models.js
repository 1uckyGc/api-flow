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
};

// =====================================================
// 图像模型（两个 provider 都用同一套 gemini 命名）
// =====================================================
export const IMAGE_MODELS = {
  t2i: [
    { value: 'gemini-3.1-flash-image-portrait', label: 'Gemini 3.1 Flash 竖屏' },
    { value: 'gemini-3.1-flash-image-landscape', label: 'Gemini 3.1 Flash 横屏' },
    { value: 'gemini-3.1-flash-image-square', label: 'Gemini 3.1 Flash 方形' },
    { value: 'gemini-3.0-pro-image-portrait', label: 'Gemini 3.0 Pro 竖屏' },
    { value: 'gemini-3.0-pro-image-landscape', label: 'Gemini 3.0 Pro 横屏' },
  ],
  i2i: [
    { value: 'gemini-3.1-flash-image-portrait', label: 'Gemini 3.1 Flash 竖屏 (R2I)' },
    { value: 'gemini-3.1-flash-image-landscape', label: 'Gemini 3.1 Flash 横屏 (R2I)' },
    { value: 'gemini-3.0-pro-image-portrait', label: 'Gemini 3.0 Pro 竖屏 (R2I)' },
    { value: 'gemini-3.0-pro-image-landscape', label: 'Gemini 3.0 Pro 横屏 (R2I)' },
  ],
};

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
