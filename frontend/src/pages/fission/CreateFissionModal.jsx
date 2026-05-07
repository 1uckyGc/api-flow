import React, { useState, useEffect } from 'react';
import { X, Upload, Zap, Rocket, Loader2 } from 'lucide-react';
import api from '../../api/client';

export default function CreateFissionModal({ onClose, onSuccess, initialData = null }) {
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [videoModel, setVideoModel] = useState('veo_3_1_i2v_s_fast_portrait_ultra_relaxed');
  const [globalPrompt, setGlobalPrompt] = useState('');
  const [fissionCount, setFissionCount] = useState(4);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [resolution, setResolution] = useState('standard');

  useEffect(() => {
    if (initialData) {
      setTaskTitle(initialData.title || '');
      setGlobalPrompt(initialData.global_prompt || '');
      if (initialData.config_json) {
        setVideoModel(initialData.config_json.videoModel || 'veo_3_1_i2v_s_fast_portrait_ultra_relaxed');
        setFissionCount(initialData.config_json.count || 4);
        setAspectRatio(initialData.config_json.aspectRatio || '9:16');
      }
      if (initialData.input_file) {
        setFile({ name: "已沿用原任务底图", virtualPath: initialData.input_file });
      }
    }
  }, [initialData]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        alert(`图片 ${file.name} 大小超过 5MB 限制！`);
      } else {
        setFile(file);
      }
    }
    e.target.value = null;
  };

  const handleSubmit = async () => {
    if (!file) return alert("请先上传产品底图！");
    if (!globalPrompt.trim()) return alert("请填写全局模糊指令！");
    setSubmitting(true);
    try {
      let uploadedImagePath = file.virtualPath || null;
      
      if (!uploadedImagePath && file instanceof File) {
        const formData = new FormData();
        formData.append('files', file);
        const resUpload = await api.post('/upload/', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        uploadedImagePath = resUpload.data.paths[0];
      }

      if (!uploadedImagePath) return alert("请上传或选择参考图");

      let finalImageModel = "gemini-3.0-pro-image-portrait";
      if (aspectRatio === '16:9') finalImageModel = "gemini-3.0-pro-image-landscape";
      if (aspectRatio === '1:1') finalImageModel = "gemini-3.0-pro-image-square";

      if (resolution === '2k') finalImageModel += '-2k';
      if (resolution === '4k') finalImageModel += '-4k';

      // 解析 Lite 模型 alias 为完整名
      const ratioSuffix = aspectRatio === '16:9' ? 'landscape' : 'portrait';
      let finalVideoModel = videoModel;
      if (videoModel === 'veo_i2v_lite') {
        finalVideoModel = `veo_3_1_i2v_lite_${ratioSuffix}`;
      }

      const taskGroupData = {
        title: taskTitle.trim() || (globalPrompt.substring(0, 15) + `... (${fissionCount}变体)`),
        task_type: "text_to_image",
        source: "FISSION",
        global_prompt: globalPrompt.trim(),
        config_json: { model: finalImageModel, videoModel: finalVideoModel, aspectRatio, count: fissionCount },
        tasks: [{ prompt: "", input_files: [uploadedImagePath] }] 
      };
      
      const resTask = await api.post('/tasks/', taskGroupData);
      onSuccess(resTask.data.id);
    } catch (e) {
      alert("任务发起失败: " + (e.response?.data?.detail || e.message));
      setSubmitting(false);
    }
  };

  const inputClass = "w-full rounded-lg px-3 py-2 text-xs transition-all focus:outline-none";
  const inputStyle = {
    background: 'var(--surface-1)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-primary)',
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'var(--modal-backdrop, rgba(0,0,0,0.6))', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col p-6 space-y-4 slide-up"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 16px 48px var(--shadow-modal, rgba(0,0,0,0.4))',
        }}>

        {/* Header */}
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-display font-bold text-lg flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}>
            <Zap size={18} style={{ color: 'var(--accent)' }} />
            发起新裂变批次
          </h2>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-4)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            <X size={16} />
          </button>
        </div>
        
        {/* Upload */}
        <label className="h-24 w-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all group relative overflow-hidden"
          style={{
            borderColor: 'var(--border-default)',
            background: 'var(--surface-1)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--accent-muted)';
            e.currentTarget.style.background = 'var(--accent-subtle)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border-default)';
            e.currentTarget.style.background = 'var(--surface-1)';
          }}
        >
          {file ? (
            <div className="text-xs font-semibold px-2 text-center" style={{ color: 'var(--accent-hover)' }}>{file.name}</div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <Upload size={18} style={{ color: 'var(--text-tertiary)' }} />
              <span className="text-xs font-semibold text-center px-4" style={{ color: 'var(--text-tertiary)' }}>
                点击或拖拽上传产品底图 (主参考位)
              </span>
            </div>
          )}
          <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
        </label>

        {/* Task name */}
        <input type="text"
          className={inputClass}
          style={inputStyle}
          placeholder="任务命名 (选填)"
          value={taskTitle}
          onChange={e => setTaskTitle(e.target.value)}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
        />

        {/* Global prompt */}
        <textarea
          className={inputClass + " h-20 resize-none custom-scrollbar"}
          style={inputStyle}
          placeholder="全局模糊指令: 例如 '产品放在室内阳光充足的窗台旁...'"
          value={globalPrompt}
          onChange={e => setGlobalPrompt(e.target.value)}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
        />
        
        {/* Params grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>画面比例</span>
            <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}
              className={inputClass + " cursor-pointer"} style={inputStyle}>
              <option value="9:16">9:16 (竖屏)</option>
              <option value="16:9">16:9 (横屏)</option>
              <option value="1:1">1:1 (正方)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>精度</span>
            <select value={resolution} onChange={e => setResolution(e.target.value)}
              className={inputClass + " cursor-pointer"} style={{...inputStyle, color: 'var(--accent)'}}>
              <option value="standard">标清</option>
              <option value="2k">2K 超清</option>
              <option value="4k">4K 原画</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>生产变体数</span>
            <input type="text" inputMode="numeric"
              value={fissionCount}
              onChange={e => setFissionCount(e.target.value.replace(/\D/g, '') ? parseInt(e.target.value.replace(/\D/g, '')) : '')}
              onBlur={() => { if(!fissionCount || fissionCount<1) setFissionCount(1); if(fissionCount>50) setFissionCount(50); }}
              className={inputClass + " text-center font-bold"} style={inputStyle}
            />
          </div>
        </div>

        {/* Video engine */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>预选视频引擎</span>
          <select value={videoModel} onChange={e => setVideoModel(e.target.value)}
            className={inputClass + " cursor-pointer"} style={inputStyle}>
            <option value="veo_3_1_i2v_s_fast_portrait_ultra_relaxed">Veo Relax (高品质追求)</option>
            <option value="veo_3_1_i2v_s_fast_portrait_ultra_fl">Veo Fast (效率优先)</option>
            <option value="veo_i2v_lite">Veo I2V Lite (首帧，轻量化)</option>
          </select>
        </div>

        {/* Submit */}
        <button onClick={handleSubmit} disabled={submitting}
          className="w-full py-3 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: submitting ? 'var(--surface-4)' : 'linear-gradient(135deg, var(--accent), #8b5cf6)',
            boxShadow: submitting ? 'none' : '0 4px 16px rgba(99, 102, 241, 0.25)',
          }}
          onMouseEnter={e => { if (!submitting) e.currentTarget.style.boxShadow = '0 6px 24px rgba(99, 102, 241, 0.4)'; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = submitting ? 'none' : '0 4px 16px rgba(99, 102, 241, 0.25)'; }}
        >
          {submitting ? (
            <><Loader2 size={16} className="animate-spin" /> 正在全力发车...</>
          ) : (
            <><Rocket size={16} /> 确认开启裂变</>
          )}
        </button>
      </div>
    </div>
  );
}
