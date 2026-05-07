import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Upload, Settings, FileSpreadsheet, Sparkles } from 'lucide-react';
import api from '../../api/client';
import useTaskStore from '../../stores/useTaskStore';
import { useProvider } from '../../hooks/useProvider';
import {
  VIDEO_MODELS, IMAGE_MODELS, getDefaultModel, mapModelForFlow2API, aspectToOrientation,
} from '../../constants/models';

export default function Toolbox() {
  const location = useLocation();
  const path = location.pathname;
  const provider = useProvider(); // "holo" | "flow2api"
  const isHolo = provider === 'holo';

  const [prompts, setPrompts] = useState('');
  const [model, setModel] = useState(getDefaultModel(provider, 'toolbox_t2v_portrait'));
  const [resolution, setResolution] = useState('standard');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [imagesPerPrompt, setImagesPerPrompt] = useState(4);
  const [i2vMode, setI2vMode] = useState('i2v'); // i2v 或 r2v
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const fetchTaskGroups = useTaskStore((s) => s.fetchTaskGroups);
  const draftData = useTaskStore((s) => s.draftData);
  const setDraftData = useTaskStore((s) => s.setDraftData);

  // 挂载时如果有 Draft 数据则回填，否则按路由+provider 设默认模型
  useEffect(() => {
    if (draftData) {
      if (draftData.prompts) setPrompts(draftData.prompts);
      if (draftData.aspectRatio) setAspectRatio(draftData.aspectRatio);
      if (draftData.files) setFiles(draftData.files);

      // 把底层模型还原为前台 select 能认的值
      const m = draftData.model;
      if (m?.includes('veo') && m?.includes('t2v')) {
        if (isHolo) {
          setModel(m); // HOLO 直接用实名
        } else {
          setModel(m?.includes('relaxed') ? 'veo_t2v_ultra_relaxed' : 'veo_t2v_ultra');
        }
      } else if (m?.includes('veo') && (m?.includes('i2v') || m?.includes('r2v'))) {
        if (isHolo) {
          setModel(m);
        } else {
          setModel(m?.includes('relaxed') ? 'veo_i2v_ultra_relaxed' : 'veo_i2v_ultra');
        }
        setI2vMode(m?.includes('r2v') ? 'r2v' : 'i2v');
      } else if (m?.includes('gemini')) {
        // 图像模型保留短别名（不带 -portrait 后缀）让选择器能命中
        setModel(m.replace(/-(landscape|portrait|square|four-three|three-four)(-2k|-4k)?$/, ''));
      }
      setDraftData(null);
    } else {
      // 没 draft，按 provider × 路由 选默认值
      const orient = aspectToOrientation(aspectRatio);
      if (path.includes('t2i') || path.includes('i2i')) {
        setModel('gemini-3.0-pro-image');
      } else if (path.includes('i2v')) {
        setModel(getDefaultModel(provider, `toolbox_i2v_${orient}`));
      } else {
        setModel(getDefaultModel(provider, `toolbox_t2v_${orient}`));
      }
      if (!path.includes('i2v')) setI2vMode('i2v');
    }
  }, [path, draftData, setDraftData, provider]);

  // HOLO 模式下，aspectRatio 改变需重选同档 orientation 模型
  useEffect(() => {
    if (!isHolo) return;
    if (path.includes('t2i') || path.includes('i2i')) return; // 图像模型由后缀拼接
    const newOrient = aspectToOrientation(aspectRatio);
    // 已经匹配的话不动
    if (model.includes(newOrient)) return;
    const kind = path.includes('i2v') ? 'i2v' : 't2v';
    // 在新 orientation 列表里挑一个保留同档（lite/fast/quality）的，挑不到就第一个
    const newList = VIDEO_MODELS.holo[kind][newOrient];
    if (!newList || newList.length === 0) return;
    const tier = model.includes('_lite_') ? 'lite' : model.includes('_fast_') ? 'fast' : 's';
    const same = newList.find(o => o.value.includes(`_${tier}_`));
    setModel((same || newList[0]).value);
  }, [aspectRatio, isHolo, path]);

  const handleClear = () => {
    setPrompts('');
    setFiles([]);
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const uploadedFiles = Array.from(e.target.files);
      const limit = path.includes('i2v') ? (i2vMode === 'i2v' ? 2 : 3) : 10;
      
      setFiles(prev => {
        const total = [...prev, ...uploadedFiles];
        return total.length > limit ? total.slice(0, limit) : total;
      });
    }
    // 制空 value 以支持重复传同一张
    e.target.value = null;
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const isImageMode = path.includes('i2i') || path.includes('i2v');

  const singlePrompt = prompts.trim();
  const promptLines = singlePrompt ? [singlePrompt] : [];

  const handleSubmit = async () => {
    if (promptLines.length === 0) return;
    setLoading(true);

    let uploadedImagePath = [];
      const freshFiles = files.filter(f => f instanceof File);
      const alreadyUploaded = files.filter(f => typeof f === 'string');
      
      const formData = new FormData();
      freshFiles.forEach(file => formData.append('files', file));
      
      try {
        const res = freshFiles.length > 0 
          ? await api.post('/upload/', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
          : { data: { paths: [] } };
        // 接口返回 { "paths": ["uploads/xxx.jpg", ...] }
        const newPaths = res.data.paths || [];
        uploadedImagePath = [...alreadyUploaded, ...newPaths];
      } catch (e) {
        console.error("Image Upload failed", e);
        setLoading(false);
        // 此处可以抛出错误气泡提示
        return;
      }

    // 拼最终提交模型名
    let finalModel = model;

    if (model.includes('gemini')) {
      // 图像：短别名 + ratio 后缀（HOLO 与 flow2api 都吃这种命名）
      let ratioSuffix = '-portrait';
      if (aspectRatio === '16:9') ratioSuffix = '-landscape';
      if (aspectRatio === '1:1') ratioSuffix = '-square';
      finalModel = model + ratioSuffix;
      if (resolution === '2k') finalModel += '-2k';
      if (resolution === '4k') finalModel += '-4k';
    } else if (isHolo) {
      // HOLO 视频：dropdown value 已经是 API 实名，r2v 模式需要换前缀
      if (path.includes('i2v') && i2vMode === 'r2v') {
        // 把 i2v_lite_/i2v_fast_/i2v_s_ 替换为 r2v_lite_/r2v_fast_（HOLO r2v 没 quality）
        finalModel = model
          .replace('_i2v_s_', '_r2v_fast_')
          .replace('_i2v_fast_', '_r2v_fast_')
          .replace('_i2v_lite_', '_r2v_lite_');
      }
    } else {
      // flow2api 老短别名 → API 实名
      if ((path.includes('i2v') && i2vMode === 'r2v') &&
          (model === 'veo_i2v_ultra' || model === 'veo_i2v_ultra_relaxed')) {
        const isLandscape = aspectRatio === '16:9';
        finalModel = model === 'veo_i2v_ultra'
          ? (isLandscape ? 'veo_3_1_r2v_fast_ultra'         : 'veo_3_1_r2v_fast_portrait_ultra')
          : (isLandscape ? 'veo_3_1_r2v_fast_ultra_relaxed' : 'veo_3_1_r2v_fast_portrait_ultra_relaxed');
      } else {
        finalModel = mapModelForFlow2API(model, aspectRatio);
      }
    }

    const taskGroupData = {
      title: promptLines[0].substring(0, 15) + (promptLines.length > 1 ? ` 等 ${promptLines.length} 个任务` : ''),
      task_type: taskType,
      source: 'toolbox',
      config_json: {
        model: finalModel,
        aspectRatio,
        imagesPerPrompt,
      },
      tasks: promptLines.map(prompt => ({ prompt, input_files: uploadedImagePath }))
    };

    try {
      await api.post('/tasks/', taskGroupData);
      setPrompts('');
      setFiles([]);
      fetchTaskGroups(); // 刷新队列
      // 注意：真实场景这里可以有 Toast 提示
    } catch (e) {
      console.error('Task submission failed', e);
    } finally {
      setLoading(false);
    }
  };

  const taskType = path.includes('t2i') ? 'text_to_image' 
                 : path.includes('i2i') ? 'image_to_image' 
                 : path.includes('i2v') ? 'image_to_video'
                 : path.includes('fission') ? 'pipeline' : 'text_to_video';

  const title = path.includes('t2i') ? '文生图工具' 
              : path.includes('i2i') ? '图生图工具' 
              : path.includes('i2v') ? '图生视频工具'
              : path.includes('fission') ? '矩阵裂变模式' : '文生视频工具';

  const desc = path.includes('t2i') ? '输入提示词，AI 为你生成图片'
             : path.includes('i2i') ? '上传参考图并输入提示，生成新图片'
             : path.includes('i2v') ? '上传参考图（可多张）并输入提示，生成动态视频'
             : path.includes('fission') ? '自动化多维流水线工作流' : '输入提示词，AI 为你生成视频';

  const selectClass = "w-full rounded-xl px-3 py-2.5 text-sm cursor-pointer transition-all duration-300 focus:outline-none";
  const selectStyle = {
    background: 'var(--surface-0)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-primary)',
  };

  return (
    <div className="flex-1 flex flex-col fade-in relative h-full overflow-hidden">
      <header className="px-6 py-5 border-b flex-shrink-0"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}>
        <h1 className="text-xl font-black tracking-tighter" style={{ color: 'var(--text-primary)' }}>{title}</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
      </header>

      <div className="flex-1 p-6 overflow-y-auto w-full pb-32 custom-scrollbar">
        <div className={`mx-auto w-full transition-all ${isImageMode ? 'max-w-[1040px]' : 'max-w-4xl'}`}>
          <div className={`grid grid-cols-1 ${isImageMode ? 'lg:grid-cols-[420px_1fr]' : ''} gap-6 w-full items-start`}>
            
            {/* === 左侧交互区 === */}
            {isImageMode && (
              <div className="flex flex-col space-y-5 w-full">

          {/* I2V / R2V 专属二级模式切换 */}
          {path.includes('i2v') && (
            <div className="flex gap-1.5 p-1 rounded-xl w-fit" style={{ background: 'var(--surface-0)' }}>
              <button 
                onClick={() => { setI2vMode('i2v'); setFiles([]); }}
                className={`tab-btn py-2 px-6 rounded-lg text-[13px] font-semibold transition-all duration-300 ${i2vMode === 'i2v' ? 'active shadow-md' : ''}`}
                style={i2vMode === 'i2v' 
                  ? { background: 'var(--surface-3)', color: 'var(--text-primary)' } 
                  : { color: 'var(--text-tertiary)' }
                }
              >
                首尾帧过场
              </button>
              <button 
                onClick={() => { setI2vMode('r2v'); setFiles([]); }}
                className={`tab-btn py-2 px-6 rounded-lg text-[13px] font-semibold transition-all duration-300 ${i2vMode === 'r2v' ? 'active shadow-md' : ''}`}
                style={i2vMode === 'r2v' 
                  ? { background: 'var(--surface-3)', color: 'var(--text-primary)' } 
                  : { color: 'var(--text-tertiary)' }
                }
              >
                主体特征参考
              </button>
            </div>
          )}

                {/* 图片上传区 */}
            <div className="animate-in slide-in-from-bottom-2 fade-in duration-300">
              <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-secondary)' }}>
                上传参考图 <span className="font-normal normal-case tracking-normal" style={{ color: 'var(--text-tertiary)' }}>
                  ({path.includes('i2v') 
                      ? (i2vMode === 'i2v' ? '至多上传 2 张，将分别被指派为视频的首帧与尾帧' : '至多上传 3 张，作为主体视频生成特征参考') 
                      : '作为图生图的基础参考底图'})
                </span>
              </label>
              
              <div className="w-full border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-300 group relative overflow-hidden"
                style={{ borderColor: 'var(--border-default)', background: 'var(--surface-0)' }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--accent-muted)';
                  e.currentTarget.style.background = 'var(--accent-subtle)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border-default)';
                  e.currentTarget.style.background = 'var(--surface-0)';
                }}
              >
                <input 
                  type="file" 
                  multiple 
                  accept="image/png, image/jpeg, image/webp" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                  onChange={handleFileChange} 
                />
                <Upload size={24} className="mx-auto mb-2 group-hover:scale-110 transition-transform duration-300" style={{ color: 'var(--text-tertiary)' }} />
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>点击或将图片拖拽到此处上传</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>支持 PNG, JPG, WEBP，可传多张</p>
              </div>

              {/* 预览队列 */}
              {files.length > 0 && (
                <div className="flex gap-3 mt-4 overflow-x-auto pb-2 custom-scrollbar">
                  {files.map((file, idx) => (
                    <div key={idx} className="relative w-24 h-24 flex-shrink-0 animate-in zoom-in-95 fade-in duration-200">
                      <img 
                        src={file instanceof File ? URL.createObjectURL(file) : (file.startsWith('http') ? file : `${api.defaults.baseURL.replace(/\/api$/, '')}/${file.replace(/^\//, '')}`)} 
                        alt="preview" 
                        className="w-full h-full object-cover rounded-xl shadow-md"
                        style={{ border: '1px solid var(--border-default)' }}
                      />
                      <button 
                        onClick={() => removeFile(idx)}
                        className="absolute -top-2 -right-2 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:scale-110 shadow-md transition-all duration-300 active:scale-90"
                        style={{ background: 'rgba(0,0,0,0.7)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--error)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.7)'}
                      >
                        ✕
                      </button>
                      <div className="absolute top-1 left-1 text-white text-[9px] px-1.5 py-0.5 rounded shadow-sm backdrop-blur-sm"
                        style={{ background: 'rgba(0,0,0,0.6)' }}>
                        {path.includes('i2v') && i2vMode === 'i2v' 
                           ? (idx === 0 ? '首帧' : (idx === 1 ? '尾帧' : `图 ${idx + 1}`)) 
                           : (path.includes('i2v') && i2vMode === 'r2v'
                               ? `主参考 ${idx + 1}`
                               : `底图 ${idx + 1}`)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </div>
            )}

            {/* === 右侧主控区 === */}
            <div className="flex flex-col space-y-5 flex-1 min-w-0">

              {/* Textarea */}
          <div className="animate-in slide-in-from-bottom-2 fade-in duration-500 delay-100 fill-mode-both">
            <div className="flex justify-between items-end mb-2">
              <label className="block text-xs font-semibold uppercase tracking-widest"
                style={{ color: 'var(--text-secondary)' }}>
                提示词
              </label>
              <button 
                onClick={() => alert("CSV 批量生成功能即将上线，敬请期待！")}
                className="text-[12px] font-medium flex items-center gap-1 transition-all duration-300 px-2 py-1 rounded-lg cursor-pointer active:scale-95"
                style={{ color: 'var(--accent)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-subtle)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <FileSpreadsheet size={13} /> 导入 CSV 批量生成
              </button>
            </div>
            <textarea 
              value={prompts}
              onChange={(e) => setPrompts(e.target.value)}
              className="w-full rounded-2xl p-4 text-sm resize-none transition-all duration-300 focus:outline-none"
              style={{
                background: 'var(--surface-0)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
              rows={isImageMode ? 11 : 5}
              placeholder="输入长篇提示词，支持自由换行...&#10;&#10;例如：&#10;巨大的赛博朋克深空探测器在光晕中缓缓旋转...&#10;镜头慢慢拉远，星海璀璨入画..."
            />
          </div>

          {/* Config Parameters */}
          <div className="rounded-2xl p-5 shadow-lg"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="text-xs font-bold uppercase tracking-widest mb-4 flex items-center gap-2"
              style={{ color: 'var(--text-secondary)' }}>
              <Settings size={14} style={{ color: 'var(--accent)' }} /> 生成参数
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[11px] mb-1.5" style={{ color: 'var(--text-tertiary)' }}>模型</label>
                <select 
                  value={model} 
                  onChange={(e) => setModel(e.target.value)}
                  className={selectClass}
                  style={selectStyle}
                >
                  {(() => {
                    if (path.includes('t2i') || path.includes('i2i')) {
                      return (
                        <>
                          <option value="gemini-3.1-flash-image">Gemini 3.1 Flash</option>
                          <option value="gemini-3.0-pro-image">Gemini 3.0 Pro</option>
                        </>
                      );
                    }
                    const kind = path.includes('i2v') ? 'i2v' : 't2v';
                    if (isHolo) {
                      const orient = aspectToOrientation(aspectRatio);
                      return VIDEO_MODELS.holo[kind][orient].map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ));
                    }
                    return VIDEO_MODELS.flow2api[kind].portrait.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ));
                  })()}
                </select>
              </div>
              <div>
                <label className="block text-[11px] mb-1.5" style={{ color: 'var(--text-tertiary)' }}>画面比例</label>
                <select 
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="9:16">9:16 (竖屏)</option>
                  <option value="16:9">16:9 (横屏)</option>
                  <option value="1:1">1:1 (方形)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] mb-1.5" style={{ color: 'var(--text-tertiary)' }}>每条生成数量</label>
                <select 
                  value={imagesPerPrompt}
                  onChange={(e) => setImagesPerPrompt(Number(e.target.value))}
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                </select>
              </div>
              {model.includes('gemini') && (
                <div>
                  <label className="block text-[11px] mb-1.5" style={{ color: 'var(--accent)' }}>画质分辨率</label>
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
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button 
              onClick={handleClear}
              className="px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-300 active:scale-95"
              style={{ color: 'var(--text-tertiary)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              清空
            </button>
            <button 
              onClick={handleSubmit}
              disabled={loading || promptLines.length === 0}
              className="text-white font-semibold py-3 px-8 rounded-xl shadow-lg transition-all duration-300 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]"
              style={{
                background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
                boxShadow: '0 4px 16px rgba(99, 102, 241, 0.25)',
              }}
              onMouseEnter={e => {
                if (!loading) e.currentTarget.style.boxShadow = '0 6px 24px rgba(99, 102, 241, 0.4)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(99, 102, 241, 0.25)';
              }}
            >
              {loading ? '提交中...' : <><Sparkles size={14} /> 提交到队列</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
  );
}
