import React, { useState, useRef } from 'react';
import { Upload, X, Sparkles, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../api/client';

const inputStyle = {
  background: 'var(--surface-0)',
  border: '1px solid var(--border-default)',
  color: 'var(--text-primary)',
};
const labelStyle = { color: 'var(--text-secondary)' };
const hintStyle = { color: 'var(--text-tertiary)' };

export default function DirectorInputPanel({ onSubmit, submitting, initialData }) {
  const initModelFull = initialData?.config_json?.model || 'gemini-3.1-flash-image-portrait';
  const initModelBase = initModelFull.replace(/-2k$/, '').replace(/-4k$/, '');
  const initRes = initModelFull.endsWith('-4k') ? '4k' : (initModelFull.endsWith('-2k') ? '2k' : 'standard');

  const [productFiles, setProductFiles] = useState(initialData?.config_json?.product_files || []);
  const [script, setScript] = useState(initialData?.config_json?.script || '');
  const [count, setCount] = useState(initialData?.config_json?.count || 6);
  const [style, setStyle] = useState(initialData?.config_json?.style || '');
  const [characterDesc, setCharacterDesc] = useState(initialData?.config_json?.character_desc || '');
  const [model, setModel] = useState(initModelBase);
  const [resolution, setResolution] = useState(initRes);
  const [videoModel, setVideoModel] = useState(initialData?.config_json?.videoModel || 'veo_3_1_i2v_s_fast_portrait_ultra_relaxed');
  const [showAdvanced, setShowAdvanced] = useState(!!(initialData?.config_json?.style || initialData?.config_json?.character_desc));
  const [uploading, setUploading] = useState(false);
  const productInputRef = useRef(null);

  const handleProductUpload = async (e) => {
    const maxSize = 5 * 1024 * 1024;
    const selected = Array.from(e.target.files || []).filter(f => {
      if (f.size > maxSize) {
        alert(`图片 ${f.name} 大小超过 5MB 限制！`);
        return false;
      }
      return true;
    });
    if (!selected.length) return;
    e.target.value = null;
    setUploading(true);
    try {
      const formData = new FormData();
      selected.forEach(f => formData.append('files', f));
      const res = await api.post('/upload/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const paths = res.data.paths || [];
      setProductFiles(prev => [...prev, ...paths].slice(0, 5));
    } catch (e) {
      alert(`图片上传失败: ${e.response?.data?.detail || e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const removeProduct = (idx) => setProductFiles(prev => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!script.trim()) { alert('请输入剧本内容'); return; }
    if (productFiles.length === 0) { alert('请上传至少一张产品白底图'); return; }
    
    let finalModel = model;
    if (resolution === '2k') finalModel += '-2k';
    if (resolution === '4k') finalModel += '-4k';

    await onSubmit({
      title: script.slice(0, 30) || '导演模式会话',
      product_files: productFiles,
      script: script.trim(),
      count,
      style: style.trim(),
      character_desc: characterDesc.trim(),
      model: finalModel,
      video_model: videoModel,
    });
  };

  const handleReset = () => {
    setProductFiles([]); setScript(''); setCount(6);
    setStyle(''); setCharacterDesc('');
  };

  const fieldClass = 'w-full rounded-xl px-3 py-2.5 text-sm transition-all duration-150 focus:outline-none';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar">

        {/* 产品白底图上传 */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={labelStyle}>
            产品白底图
            <span className="font-normal ml-1" style={hintStyle}>(至多 5 张)</span>
          </label>
          <div
            className="w-full border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all duration-150 relative"
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
              ref={productInputRef}
              type="file" multiple accept="image/png, image/jpeg, image/webp"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              onChange={handleProductUpload}
              disabled={uploading || productFiles.length >= 5}
            />
            <Upload size={18} className="mx-auto mb-1" style={hintStyle} />
            <p className="text-xs" style={hintStyle}>
              {uploading ? '上传中...' : '点击上传产品图'}
            </p>
          </div>

          {productFiles.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
              {productFiles.map((path, idx) => (
                <div key={idx} className="relative w-16 h-16 flex-shrink-0">
                  <img
                    src={`/${path}`}
                    alt="product"
                    className="w-full h-full object-cover rounded-lg"
                    style={{ border: '1px solid var(--border-default)' }}
                  />
                  <button
                    onClick={() => removeProduct(idx)}
                    className="absolute -top-1.5 -right-1.5 rounded-full w-5 h-5 flex items-center justify-center text-white z-20"
                    style={{ background: 'rgba(0,0,0,0.7)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--error, #ef4444)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.7)'}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 剧本 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold" style={labelStyle}>剧本 / 大纲</label>
            <span className="text-[10px]" style={hintStyle}>{script.length} 字</span>
          </div>
          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            className={fieldClass + ' resize-none'}
            style={inputStyle}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
            rows={6}
            placeholder="输入剧本内容，例如：第一幕：主角晨跑时拿着产品；第二幕：饮用后精神大振..."
          />
        </div>

        {/* 参数卡片 */}
        <div
          className="rounded-xl p-3 space-y-3"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
        >
          {/* 分镜数量 */}
          <div>
            <label className="block text-[11px] mb-1 font-semibold" style={labelStyle}>
              分镜数量
              <span className="font-normal ml-1" style={hintStyle}>(1 – 20)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range" min="1" max="20" value={count}
                onChange={e => setCount(Number(e.target.value))}
                className="flex-1 cursor-pointer"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span
                className="text-xs font-bold w-6 text-center"
                style={{ color: 'var(--accent)' }}
              >
                {count}
              </span>
            </div>
          </div>

          {/* 生图模型 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] mb-1 font-semibold" style={labelStyle}>生图模型</label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full rounded-lg px-2.5 py-2 text-xs cursor-pointer focus:outline-none transition-all"
                style={inputStyle}
              >
                <option value="gemini-3.1-flash-image-portrait">Gemini 3.1 Flash</option>
                <option value="gemini-3.0-pro-image-portrait">Gemini 3.0 Pro</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] mb-1 font-semibold" style={{color: 'var(--accent)'}}>画质精度</label>
              <select
                value={resolution}
                onChange={e => setResolution(e.target.value)}
                className="w-full rounded-lg px-2.5 py-2 text-xs cursor-pointer focus:outline-none transition-all font-semibold"
                style={{...inputStyle, color: 'var(--accent)'}}
              >
                <option value="standard">标清</option>
                <option value="2k">2K 超清</option>
                <option value="4k">4K 原画</option>
              </select>
            </div>
          </div>

          {/* 视频模型 */}
          <div>
            <label className="block text-[11px] mb-1 font-semibold" style={labelStyle}>视频模型</label>
            <select
              value={videoModel}
              onChange={e => setVideoModel(e.target.value)}
              className="w-full rounded-lg px-2.5 py-2 text-xs cursor-pointer focus:outline-none transition-all"
              style={inputStyle}
            >
              <option value="veo_3_1_i2v_s_fast_portrait_ultra_relaxed">Veo 3.1 Relax（竖屏）</option>
              <option value="veo_3_1_i2v_s_fast_ultra_relaxed">Veo 3.1 Relax（横屏）</option>
              <option value="veo_3_1_i2v_s_fast_portrait_ultra_fl">Veo 3.1 Fast（竖屏）</option>
              <option value="veo_3_1_i2v_s_fast_ultra_fl">Veo 3.1 Fast（横屏）</option>
              <option value="veo_3_1_i2v_lite_portrait">Veo 3.1 I2V Lite（竖屏）</option>
              <option value="veo_3_1_i2v_lite_landscape">Veo 3.1 I2V Lite（横屏）</option>
            </select>
          </div>

          {/* 高级选项折叠 */}
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className="w-full flex items-center justify-between text-[11px] font-semibold py-1 transition-colors"
            style={hintStyle}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
          >
            高级选项
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {showAdvanced && (
            <div className="space-y-2.5 pt-1">
              <div>
                <label className="block text-[11px] mb-1" style={hintStyle}>全局风格设定</label>
                <input
                  type="text"
                  value={style}
                  onChange={e => setStyle(e.target.value)}
                  className={fieldClass}
                  style={{ ...inputStyle, fontSize: '12px', padding: '8px 10px' }}
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
                  placeholder="如：北美现代街头、居家温馨..."
                />
              </div>
              <div>
                <label className="block text-[11px] mb-1" style={hintStyle}>人物外形描述</label>
                <input
                  type="text"
                  value={characterDesc}
                  onChange={e => setCharacterDesc(e.target.value)}
                  className={fieldClass}
                  style={{ ...inputStyle, fontSize: '12px', padding: '8px 10px' }}
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
                  placeholder="如：25岁亚裔女性，长直发，运动风..."
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div
        className="flex-shrink-0 p-4 space-y-2"
        style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
      >
        <button
          onClick={handleSubmit}
          disabled={submitting || !script.trim() || productFiles.length === 0}
          className="w-full text-white font-semibold py-3 rounded-xl transition-all duration-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{
            background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
            boxShadow: '0 4px 16px rgba(99, 102, 241, 0.25)',
          }}
          onMouseEnter={e => { if (!submitting) e.currentTarget.style.boxShadow = '0 6px 24px rgba(99, 102, 241, 0.4)'; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(99, 102, 241, 0.25)'; }}
        >
          {submitting
            ? <><span className="animate-pulse">⟳</span> 导演引擎运行中...</>
            : <><Sparkles size={15} /> 开始拍摄</>
          }
        </button>
        <button
          onClick={handleReset}
          className="w-full py-2 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1"
          style={hintStyle}
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
