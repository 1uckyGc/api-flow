import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Upload, X, Sparkles, RotateCcw, Loader2 } from 'lucide-react';
import api from '../../api/client';
import useTaskStore from '../../stores/useTaskStore';
import { useProvider } from '../../hooks/useProvider';
import {
  VIDEO_MODELS, getDefaultModel, mapModelForFlow2API, aspectToOrientation, providerOf,
} from '../../constants/models';

// 模型 value 是否已带方向后缀（避免再次追加 -portrait / -landscape）
const ORIENT_SUFFIX_RE = /-(portrait|landscape|square|four-three|three-four)(-2k|-4k)?$/;

export default function ToolPanel() {
  const location = useLocation();
  const path = location.pathname;
  const provider = useProvider();
  const isHolo = provider === 'holo';

  const [prompts, setPrompts] = useState('');
  const [model, setModel] = useState(getDefaultModel(provider, 'toolbox_t2v_portrait'));
  const [resolution, setResolution] = useState('standard');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [grokEditSize, setGrokEditSize] = useState('1024x1024');
  const [imagesPerPrompt, setImagesPerPrompt] = useState(4);
  const [i2vMode, setI2vMode] = useState('i2v');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(6);
  const [quality, setQuality] = useState('high');
  const fetchTaskGroups = useTaskStore((s) => s.fetchTaskGroups);
  const draftData = useTaskStore((s) => s.draftData);
  const setDraftData = useTaskStore((s) => s.setDraftData);

  useEffect(() => {
    if (draftData) {
      if (draftData.prompts) setPrompts(draftData.prompts);
      if (draftData.aspectRatio) setAspectRatio(draftData.aspectRatio);
      if (draftData.files) setFiles(draftData.files);

      const m = draftData.model;
      if (m?.startsWith('grok-')) {
        setModel(m);
      } else if (isHolo && m?.includes('veo')) {
        setModel(m);
        if (m?.includes('r2v')) setI2vMode('r2v');
      } else if (m?.includes('t2v_lite')) {
        setModel('veo_t2v_lite');
      } else if (m?.includes('interpolation_lite')) {
        setModel('veo_interpolation_lite');
      } else if (m?.includes('i2v_lite')) {
        setModel('veo_i2v_lite');
      } else if (m?.includes('veo') && m?.includes('t2v')) {
        setModel(m?.includes('relaxed') ? 'veo_t2v_ultra_relaxed' : 'veo_t2v_ultra');
      } else if (m?.includes('veo') && (m?.includes('i2v') || m?.includes('r2v'))) {
        setModel(m?.includes('relaxed') ? 'veo_i2v_ultra_relaxed' : 'veo_i2v_ultra');
        setI2vMode(m?.includes('r2v') ? 'r2v' : 'i2v');
      } else if (m?.includes('gemini')) {
        setModel(m.replace(/-(landscape|portrait|square|four-three|three-four)(-2k|-4k)?$/, ''));
      }
      setDraftData(null);
    } else {
      const orient = aspectToOrientation(aspectRatio);
      if (path.includes('t2i') || path.includes('i2i')) setModel('gemini-3.0-pro-image');
      else if (path.includes('i2v')) setModel(getDefaultModel(provider, `toolbox_i2v_${orient}`));
      else setModel(getDefaultModel(provider, `toolbox_t2v_${orient}`));

      if (!path.includes('i2v')) setI2vMode('i2v');
    }
  }, [path, draftData, setDraftData, provider]);

  // HOLO 模式 aspectRatio 改变 → 同档位换 orientation
  useEffect(() => {
    if (!isHolo) return;
    if (model.startsWith('grok-')) return;
    if (path.includes('t2i') || path.includes('i2i')) return;
    const newOrient = aspectToOrientation(aspectRatio);
    if (model.includes(newOrient)) return;
    const kind = path.includes('i2v') ? 'i2v' : 't2v';
    const newList = VIDEO_MODELS.holo[kind][newOrient];
    if (!newList || newList.length === 0) return;
    const tier = model.includes('_lite_') ? 'lite' : model.includes('_fast_') ? 'fast' : 's';
    const same = newList.find(o => o.value.includes(`_${tier}_`));
    setModel((same || newList[0]).value);
  }, [aspectRatio, isHolo, path]);

  const isGrokModel = model.startsWith('grok-');
  const isGrokVideo = isGrokModel && (model === 'grok-imagine-video-t2v' || model === 'grok-imagine-video-i2v');
  const isGrokEditModel = model === 'grok-imagine-image-edit';

  const isImageMode = path.includes('i2i') || path.includes('i2v');

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const uploadedFiles = Array.from(e.target.files);
      const maxSize = 5 * 1024 * 1024;
      const validFiles = uploadedFiles.filter(f => {
        if (f.size > maxSize) {
          alert(`图片 ${f.name} 大小超过 5MB 限制！`);
          return false;
        }
        return true;
      });
      if (validFiles.length > 0) {
        const limit = path.includes('i2v') ? (i2vMode === 'i2v' ? 2 : 3) : isGrokEditModel ? 1 : 10;
        setFiles(prev => {
          const total = [...prev, ...validFiles];
          return total.length > limit ? total.slice(0, limit) : total;
        });
      }
    }
    e.target.value = null;
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const singlePrompt = prompts.trim();
  const promptLines = singlePrompt ? [singlePrompt] : [];

  const taskType = path.includes('t2i') ? 'text_to_image'
    : path.includes('i2i') ? 'image_to_image'
    : path.includes('i2v') ? 'image_to_video' : 'text_to_video';

  const handleSubmit = async () => {
    if (promptLines.length === 0) return;
    setLoading(true);

    let uploadedImagePath = [];

    const newFiles = files.filter(f => typeof f !== 'string');
    const existingUrls = files.filter(f => typeof f === 'string').map(url => url.replace(/^\//, ''));

    if (isImageMode && newFiles.length > 0) {
      const formData = new FormData();
      newFiles.forEach(file => formData.append('files', file));
      try {
        const res = await api.post('/upload/', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        uploadedImagePath = res.data.paths || [];
      } catch (e) {
        console.error("Image Upload failed", e);
        setLoading(false);
        return;
      }
    }

    const finalInputFiles = [...existingUrls, ...uploadedImagePath];

    const ratioSuffix = aspectRatio === '16:9' ? 'landscape' : 'portrait';
    let finalModel = model;

    // 按"模型自身的 provider"分发（不再依赖全局 isHolo），三 provider 并存安全
    const modelProvider = providerOf(model);

    if (model.startsWith('grok-')) {
      // Grok：t2v/i2v 别名 → 真名 grok-imagine-video
      finalModel = (model === 'grok-imagine-video-t2v' || model === 'grok-imagine-video-i2v')
        ? 'grok-imagine-video' : model;
    } else if (model.startsWith('flow2api/')) {
      // 显式 flow2api/ 前缀的模型 value 已是 API 实名（含方向后缀），后端 dispatcher 会 strip 前缀
      finalModel = model;
    } else if (modelProvider === 'flow2api') {
      // Flow2API 老短别名（_ultra / _ultra_relaxed / _ultra_fl 等）— 不论全局 provider 都要走映射
      if ((path.includes('i2v') && i2vMode === 'r2v') &&
          (model === 'veo_i2v_ultra' || model === 'veo_i2v_ultra_relaxed')) {
        const isLandscape = aspectRatio === '16:9';
        finalModel = model === 'veo_i2v_ultra'
          ? (isLandscape ? 'veo_3_1_r2v_fast_ultra'         : 'veo_3_1_r2v_fast_portrait_ultra')
          : (isLandscape ? 'veo_3_1_r2v_fast_ultra_relaxed' : 'veo_3_1_r2v_fast_portrait_ultra_relaxed');
      } else {
        finalModel = mapModelForFlow2API(model, aspectRatio);
      }
    } else if (model === 'veo_t2v_lite') {
      finalModel = `veo_3_1_t2v_lite_${ratioSuffix}`;
    } else if (model === 'veo_i2v_lite') {
      finalModel = `veo_3_1_i2v_lite_${ratioSuffix}`;
    } else if (model === 'veo_interpolation_lite') {
      finalModel = `veo_3_1_interpolation_lite_${ratioSuffix}`;
    } else if (model.includes('gemini') && !ORIENT_SUFFIX_RE.test(model)) {
      // Gemini 短别名（gemini-3.1-flash-image / gemini-3.0-pro-image）拼方向后缀
      // 已含 -portrait/-landscape/-square 等的 value 跳过（防止 -portrait-portrait）
      let ratioSuffix2 = '-portrait';
      if (aspectRatio === '16:9') ratioSuffix2 = '-landscape';
      if (aspectRatio === '1:1') ratioSuffix2 = '-square';
      finalModel = model + ratioSuffix2;
      if (resolution === '2k') finalModel += '-2k';
      if (resolution === '4k') finalModel += '-4k';
    } else {
      // HOLO 视频：dropdown value 已是实名；r2v 模式换前缀
      if (path.includes('i2v') && i2vMode === 'r2v') {
        finalModel = model
          .replace('_i2v_s_', '_r2v_fast_')
          .replace('_i2v_fast_', '_r2v_fast_')
          .replace('_i2v_lite_', '_r2v_lite_');
      }
    }

    const expandedTasks = [];
    promptLines.forEach(prompt => {
      for (let i = 0; i < imagesPerPrompt; i++) {
        expandedTasks.push({
          prompt,
          input_files: finalInputFiles.length > 0 ? finalInputFiles : []
        });
      }
    });

    const taskGroupData = {
      title: promptLines[0].substring(0, 20) || "新生成任务",
      task_type: taskType,
      source: 'TOOLBOX',
      global_prompt: prompts,
      config_json: {
        model: finalModel,
        aspect_ratio: aspectRatio,
        images_per_prompt: imagesPerPrompt,
        // Grok 视频额外字段
        ...(model === 'grok-imagine-video-t2v' && { grok_mode: 't2v', seconds: duration, quality }),
        ...(model === 'grok-imagine-video-i2v' && { grok_mode: 'i2v', seconds: duration, quality }),
        // Grok 生图额外字段
        ...((model === 'grok-imagine-image' || model === 'grok-imagine-image-pro') && { grok_mode: 'image' }),
        // Grok 图像编辑（含尺寸）
        ...(model === 'grok-imagine-image-edit' && { grok_mode: 'image_edit', grok_size: grokEditSize }),
      },
      tasks: expandedTasks
    };

    try {
      await api.post('tasks/', taskGroupData);
      setPrompts('');
      setFiles([]);
      fetchTaskGroups();
    } catch (e) {
      console.error('Task submission failed', e);
      alert(`提交任务失败: ${e.response?.data?.detail || e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const selectClass = "w-full rounded-lg px-2.5 py-2 text-xs cursor-pointer transition-all duration-200 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/30";
  const selectStyle = {
    background: 'var(--surface-0)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-primary)',
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Scrollable form area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 custom-scrollbar relative z-10">

        {/* I2V mode toggle */}
        {path.includes('i2v') && (
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-0)' }}>
            <button
              onClick={() => { setI2vMode('i2v'); setFiles([]); }}
              className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 ${
                i2vMode === 'i2v' ? 'text-white' : ''
              }`}
              style={i2vMode === 'i2v'
                ? { background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }
                : { color: 'var(--text-tertiary)' }
              }
            >
              首尾帧
            </button>
            <button
              onClick={() => { setI2vMode('r2v'); setFiles([]); }}
              className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 ${
                i2vMode === 'r2v' ? 'text-white' : ''
              }`}
              style={i2vMode === 'r2v'
                ? { background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }
                : { color: 'var(--text-tertiary)' }
              }
            >
              特征参考
            </button>
          </div>
        )}

        {/* Image upload area */}
        {isImageMode && (
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              上传参考图
              <span className="font-normal ml-1" style={{ color: 'var(--text-tertiary)' }}>
                {path.includes('i2v')
                  ? (i2vMode === 'i2v' ? '(至多 2 张, 首/尾帧)' : '(至多 3 张, 特征参考)')
                  : '(基础参考底图)'}
              </span>
            </label>
            <div className="w-full border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all duration-300 group relative overflow-hidden"
              style={{
                borderColor: 'var(--border-default)',
                background: 'var(--surface-0)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--accent-muted)';
                e.currentTarget.style.background = 'var(--accent-subtle)';
                e.currentTarget.style.boxShadow = '0 0 20px rgba(99, 102, 241, 0.08) inset';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border-default)';
                e.currentTarget.style.background = 'var(--surface-0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <input
                type="file" multiple accept="image/png, image/jpeg, image/webp"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                onChange={handleFileChange}
              />
              <Upload size={20} className="mx-auto mb-1 group-hover:scale-110 transition-transform" style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>点击或拖拽上传</p>
            </div>

            {/* Thumbnails */}
            {files.length > 0 && (
              <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                {files.map((file, idx) => (
                  <div key={idx} className="relative w-16 h-16 flex-shrink-0">
                    <img
                      src={typeof file === 'string' ? file : URL.createObjectURL(file)}
                      alt="preview"
                      className="w-full h-full object-cover rounded-lg"
                      style={{ border: '1px solid var(--border-default)' }}
                    />
                    <button
                      onClick={() => removeFile(idx)}
                      className="absolute -top-1.5 -right-1.5 rounded-full w-5 h-5 flex items-center justify-center text-white transition-all z-20"
                      style={{ background: 'rgba(0,0,0,0.7)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--error)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.7)'}
                    >
                      <X size={10} />
                    </button>
                    <div className="absolute bottom-0.5 left-0.5 text-white text-[8px] px-1 py-0.5 rounded"
                      style={{ background: 'rgba(0,0,0,0.6)' }}>
                      {path.includes('i2v') && i2vMode === 'i2v'
                        ? (idx === 0 ? '首帧' : '尾帧')
                        : `图${idx + 1}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Prompt */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-tertiary)' }}>提示词</label>
          <textarea
            value={prompts}
            onChange={(e) => setPrompts(e.target.value)}
            className="w-full rounded-xl p-3 text-sm resize-none transition-all duration-300 focus:outline-none"
            style={{
              background: 'var(--surface-0)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'var(--accent)';
              e.target.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.1), 0 0 20px rgba(99, 102, 241, 0.05)';
            }}
            onBlur={e => {
              e.target.style.borderColor = 'var(--border-default)';
              e.target.style.boxShadow = 'none';
            }}
            rows={isImageMode ? 4 : 6}
            placeholder="输入提示词描述你想要的画面..."
          />
        </div>

        {/* Parameters */}
        <div className="rounded-xl p-3 space-y-3 relative overflow-hidden"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          }}>
          {/* Accent left edge */}
          <div className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r-full" style={{ background: 'var(--accent)' }} />
          <h3 className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 pl-2" style={{ color: 'var(--text-tertiary)' }}>
            <Settings2Icon /> 参数
          </h3>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--text-tertiary)' }}>模型</label>
            <select
              value={model} onChange={(e) => setModel(e.target.value)}
              className={selectClass} style={selectStyle}
            >
              {(() => {
                if (path.includes('t2i') || path.includes('i2i')) {
                  return (
                    <>
                      <option disabled>──── HOLO ────</option>
                      <option value="gemini-3.1-flash-image">Gemini 3.1 Flash — 迅速生图</option>
                      <option value="gemini-3.0-pro-image">Gemini 3.0 Pro — 高质量生图</option>
                      <option disabled>──── HOLO · GPT-images2 ────</option>
                      <option value="GPT-images2">GPT-images2 — 默认</option>
                      <option value="GPT-images2 1:1">GPT-images2 — 方形 1:1</option>
                      <option value="GPT-images2 1:1-2K">GPT-images2 — 方形 1:1 · 2K</option>
                      <option value="GPT-images2 16:9-2K">GPT-images2 — 横屏 16:9 · 2K</option>
                      <option value="GPT-images2 16:9-4K">GPT-images2 — 横屏 16:9 · 4K</option>
                      <option value="GPT-images2 9:16-4K">GPT-images2 — 竖屏 9:16 · 4K</option>
                      <option value="GPT-images2 2:3-2K">GPT-images2 — 2:3 · 2K</option>
                      <option value="GPT-images2 3:2-2K">GPT-images2 — 3:2 · 2K</option>
                      <option disabled>──── Flow2API ────</option>
                      <option value="flow2api/gemini-3.1-flash-image-portrait">
                        Flow2API · Gemini 3.1 Flash 竖屏{path.includes('i2i') ? ' (R2I)' : ''}
                      </option>
                      <option disabled>──── Dreamina（即梦）────</option>
                      {path.includes('t2i') ? (
                        <>
                          <option value="dreamina/t2i-5.0">即梦 · text2image 5.0（最新）</option>
                          <option value="dreamina/t2i-4.6">即梦 · text2image 4.6</option>
                        </>
                      ) : (
                        <option value="dreamina/i2i-default">即梦 · image2image（默认）</option>
                      )}
                      <option disabled>──── Grok ────</option>
                      {path.includes('i2i') ? (
                        <option value="grok-imagine-image-edit">Grok Imagine Edit — 图像编辑 (Super+)</option>
                      ) : (
                        <>
                          <option value="grok-imagine-image">Grok Imagine — 标准生图 (Super+)</option>
                          <option value="grok-imagine-image-pro">Grok Imagine Pro — 高质量生图 (Super+)</option>
                        </>
                      )}
                    </>
                  );
                }
                const kind = path.includes('i2v') ? 'i2v' : 't2v';
                const orient = aspectToOrientation(aspectRatio);
                return (
                  <>
                    <option disabled>──── HOLO ────</option>
                    {VIDEO_MODELS.holo[kind][orient].map(o => (
                      <option key={`holo-${o.value}`} value={o.value}>{o.label}</option>
                    ))}
                    {kind === 'i2v' && (
                      <>
                        <option disabled>──── HOLO · Sora 2 ────</option>
                        <option value="Sora-2-12">HOLO · Sora-2 (12s)</option>
                        <option value="Sora-2-16">HOLO · Sora-2 (16s)</option>
                      </>
                    )}
                    <option disabled>──── Flow2API ────</option>
                    {kind === 'i2v' && (
                      <>
                        <option value="flow2api/veo_3_1_i2v_s_fast_portrait_ultra_fl">Flow2API · I2V Fast 竖屏</option>
                        <option value="flow2api/veo_3_1_r2v_fast_portrait">Flow2API · R2V 竖屏 (多图参考)</option>
                      </>
                    )}
                    {VIDEO_MODELS.flow2api[kind].portrait.map(o => (
                      <option key={`flow-${o.value}`} value={o.value}>{o.label}</option>
                    ))}
                    {kind === 't2v' && <option value="veo_t2v_lite">VEO 3.1 T2V Lite</option>}
                    {kind === 'i2v' && <option value="veo_i2v_lite">VEO 3.1 I2V Lite — 首帧</option>}
                    {kind === 'i2v' && <option value="veo_interpolation_lite">VEO 3.1 Interpolation Lite — 首尾帧</option>}
                    <option disabled>──── Dreamina（即梦）────</option>
                    {kind === 't2v' ? (
                      <option value="dreamina/t2v-default">即梦 · text2video</option>
                    ) : (
                      <>
                        <option value="dreamina/seedance2.0fast">即梦 · seedance 2.0 fast (720p · 推荐)</option>
                        <option value="dreamina/seedance2.0">即梦 · seedance 2.0 标准 (720p)</option>
                        <option value="dreamina/seedance2.0fast_vip">即梦 · seedance 2.0 fast · VIP (1080p)</option>
                        <option value="dreamina/seedance2.0_vip">即梦 · seedance 2.0 · VIP (1080p)</option>
                      </>
                    )}
                    <option disabled>──── 第三方 · cc123.ai (Seedance / Sora) ────</option>
                    <option value="cc123/sd-2">cc123 · sd-2 (Seedance 2.0 · 15s)</option>
                    <option value="cc123/sd-2-vip">cc123 · sd-2-vip (Seedance 2.0 · 15s · 队列优先)</option>
                    <option value="cc123/sora-2">cc123 · sora-2 (OpenAI Sora 2)</option>
                    <option disabled>──── Grok ────</option>
                    <option value={kind === 'i2v' ? 'grok-imagine-video-i2v' : 'grok-imagine-video-t2v'}>
                      Grok Imagine Video (Super+)
                    </option>
                  </>
                );
              })()}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] mb-1" style={{ color: 'var(--text-tertiary)' }}>画面比例</label>
              {isGrokEditModel ? (
                <div
                  className="w-full rounded-lg px-2.5 py-2 text-xs"
                  style={{
                    background: 'var(--surface-0)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  跟随原图比例
                  <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }}>
                    单图编辑，输出比例跟随原图
                  </span>
                </div>
              ) : (
                <select
                  value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}
                  className={selectClass} style={selectStyle}
                >
                  <option value="9:16">9:16 竖屏</option>
                  <option value="16:9">16:9 横屏</option>
                  <option value="1:1">1:1 方形</option>
                </select>
              )}
            </div>
            <div>
              <label className="block text-[11px] mb-1" style={{ color: 'var(--text-tertiary)' }}>每条数量</label>
              <input
                type="number"
                min="1"
                max="100"
                value={imagesPerPrompt}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setImagesPerPrompt(isNaN(val) || val < 1 ? 1 : val);
                }}
                className={selectClass + " font-medium"}
                style={selectStyle}
              />
            </div>
          </div>

          {model.includes('gemini') && (
            <div className="grid grid-cols-1 gap-2">
              <div>
                <label className="block text-[11px] mb-1" style={{ color: 'var(--accent)' }}>画质精度</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className={selectClass + " font-semibold"}
                  style={{ ...selectStyle, color: 'var(--accent)' }}
                >
                  <option value="standard">标清 (默认)</option>
                  <option value="2k">2K 超清</option>
                  <option value="4k">4K 原画</option>
                </select>
              </div>
            </div>
          )}

          {/* Grok 视频额外参数 */}
          {isGrokVideo && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] mb-1" style={{ color: 'var(--text-tertiary)' }}>时长</label>
                <select
                  value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                  className={selectClass} style={selectStyle}
                >
                  <option value={6}>6s</option>
                  <option value={10}>10s</option>
                  <option value={12}>12s</option>
                  <option value={16}>16s</option>
                  <option value={20}>20s</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] mb-1" style={{ color: 'var(--text-tertiary)' }}>画质</label>
                <select
                  value={quality} onChange={(e) => setQuality(e.target.value)}
                  className={selectClass} style={selectStyle}
                >
                  <option value="high">720p 高清</option>
                  <option value="standard">480p 标准</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="flex-shrink-0 p-4 relative"
        style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
        {/* Gradient glow behind button */}
        <div className="absolute inset-x-4 top-6 h-12 rounded-xl opacity-30 blur-xl pointer-events-none"
          style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)' }} />
        <button
          onClick={handleSubmit}
          disabled={loading || promptLines.length === 0}
          className="w-full text-white font-bold py-3.5 rounded-xl transition-all duration-300 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 relative z-10 active:scale-[0.97]"
          style={{
            background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
            boxShadow: '0 4px 20px rgba(99, 102, 241, 0.3)',
          }}
          onMouseEnter={e => {
            if (!loading) {
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(99, 102, 241, 0.5)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(99, 102, 241, 0.3)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          {loading ? (
            <><Loader2 size={16} className="animate-spin" /> 提交中...</>
          ) : (
            <><Sparkles size={16} /> 提交生成</>
          )}
        </button>
        <button
          onClick={() => { setPrompts(''); setFiles([]); }}
          className="w-full mt-2 py-2 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1"
          style={{ color: 'var(--text-tertiary)' }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.background = 'var(--surface-3)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--text-tertiary)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <RotateCcw size={12} /> 清空表单
        </button>
      </div>
    </div>
  );
}

function Settings2Icon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>
    </svg>
  );
}
