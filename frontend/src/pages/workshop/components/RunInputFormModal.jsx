import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Upload, Play, Loader2, ImagePlus } from 'lucide-react';
import api from '../../../api/client';

export default function RunInputFormModal({ workflowId, workflowTitle, onClose }) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);

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
      // 限制最多 4 张参考图
      if (validFiles.length > 0) {
        setFiles(prev => {
          const total = [...prev, ...validFiles];
          return total.length > 4 ? total.slice(0, 4) : total;
        });
      }
    }
    e.target.value = null;
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleRun = async () => {
    setLoading(true);
    let uploadedImagePaths = [];

    // 1. 先上传文件获取服务器相对路径
    if (files.length > 0) {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));
      try {
        const res = await api.post('/upload/', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        uploadedImagePaths = res.data.paths || [];
      } catch (e) {
        console.error("Image Upload failed", e);
        alert('上传底图失败');
        setLoading(false);
        return;
      }
    }

    // 2. 带着路径和Prompt启动管线
    const payload = {
      title: `${workflowTitle} - 执行`,
      input_files: uploadedImagePaths,
      input_prompts: prompt ? [prompt] : []
    };

    try {
      const res = await api.post(`/workflows/${workflowId}/run`, payload);
      console.log("[DEBUG] Run raw response:", res);
      
      const runId = res?.data?.id || res?.id || res?.data?.run_id;
      if (!runId) {
         alert(`无法解析返回的执行纪要ID，可能受到了浏览器/代理拦截：\n` + JSON.stringify(res?.data || res || "[]"));
         setLoading(false);
         return;
      }

      // 转跳到 Runner 监控页面
      navigate(`/workshop/run/${runId}`);
    } catch (e) {
      console.error("Run workflow failed", e);
      alert('启动工作流失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-subtle)' }}>
              <Play size={20} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>启动参数</h2>
              <p className="text-[11px] font-medium opacity-70" style={{ color: 'var(--text-tertiary)' }}>{workflowTitle}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--surface-3)] transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          
          {/* Prompt 提示词 */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-secondary)' }}>
              基础提示词 (Prompt)
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
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
              rows={4}
              placeholder="输入剧本创意灵感或是画面的描述..."
            />
          </div>

          {/* 图片上传 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
                物料投喂 (Files)
              </label>
              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>选填 (最高 4 张)</span>
            </div>
            
            <div className="w-full border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all duration-300 group relative overflow-hidden"
              style={{
                borderColor: 'var(--border-default)',
                background: 'var(--surface-0)',
              }}
            >
              <input
                type="file" multiple accept="image/png, image/jpeg, image/webp"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                onChange={handleFileChange}
              />
              <ImagePlus size={24} className="mx-auto mb-2 opacity-60 group-hover:scale-110 transition-transform" style={{ color: 'var(--accent)' }} />
              <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>点击或拖拽上传起始参考图</p>
            </div>

            {/* Thumbnails */}
            {files.length > 0 && (
              <div className="flex gap-2 mt-4 overflow-x-auto pb-1 custom-scrollbar">
                {files.map((file, idx) => (
                  <div key={idx} className="relative w-20 h-20 flex-shrink-0 group">
                    <img
                      src={URL.createObjectURL(file)}
                      alt="preview"
                      className="w-full h-full object-cover rounded-xl"
                      style={{ border: '1px solid var(--border-default)' }}
                    />
                    <button
                      onClick={() => removeFile(idx)}
                      className="absolute -top-2 -right-2 rounded-full w-6 h-6 flex items-center justify-center text-white scale-0 group-hover:scale-100 transition-transform z-20 shadow-md"
                      style={{ background: 'var(--error)' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="p-3 rounded-lg border bg-[var(--surface-2)] mt-4 flex items-start gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
               <div className="text-[11px] leading-relaxed opacity-70" style={{ color: 'var(--text-tertiary)' }}>
                 <strong>提示：</strong> 您在此处注入的文本和图像，将被流中的第一个处理节点（如大模型 或 图生图）所消费。
               </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}>
          <button 
            onClick={onClose}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl text-sm font-bold transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50"
            style={{ color: 'var(--text-secondary)' }}
          >
            取消
          </button>
          <button 
            onClick={handleRun}
            disabled={loading}
            className="px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-95 shadow-[0_4px_14px_rgba(99,102,241,0.3)] disabled:opacity-50 flex items-center gap-2 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)' }}
          >
            {loading ? (
              <><Loader2 size={16} className="animate-spin" /> 启动中...</>
            ) : (
              <><Play size={16} fill="currentColor" className="scale-90" /> 立即运行</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
