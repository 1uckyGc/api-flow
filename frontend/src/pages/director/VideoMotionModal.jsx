import React, { useState } from 'react';
import { Video, X, Sparkles, Wand2 } from 'lucide-react';
import { useProvider } from '../../hooks/useProvider';
import { VIDEO_MODELS, getDefaultModel } from '../../constants/models';

function parseTaskAction(rawPrompt) {
  if (!rawPrompt) return '';
  const match = rawPrompt.match(/\[TITLE\].*?\[\/TITLE\]([\s\S]*)/);
  const core = match ? match[1] : rawPrompt;
  const actionMatch = core.match(/动作：(.*?)$/m);
  return actionMatch ? actionMatch[1].trim() : '';
}

export default function VideoMotionModal({ targetTasks, onClose, onConfirm, submitting, defaultModel }) {
  const provider = useProvider();
  const isHolo = provider === 'holo';
  const [prompts, setPrompts] = useState({});
  const [videoModel, setVideoModel] = useState(
    defaultModel || getDefaultModel(provider, 'director_video')
  );

  const handleChange = (taskId, val) => {
    setPrompts(p => ({ ...p, [taskId]: val }));
  };

  const handleSubmit = () => {
    onConfirm(prompts, videoModel);
  };

  const selectStyle = {
    background: 'var(--surface-0)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-primary)',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
      style={{ background: 'var(--modal-backdrop)', backdropFilter: 'blur(4px)' }}>
      
      <div className="flex flex-col rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        style={{
          width: '560px',
          maxHeight: '85vh',
          background: 'var(--surface-1)',
          border: '1px solid var(--border-strong)'
        }}>
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}>
          <div className="flex items-center gap-2">
            <Video size={18} className="text-[var(--accent)]" />
            <div>
              <h2 className="text-sm font-bold font-display text-[var(--text-primary)]">视频运镜设定 (I2V)</h2>
              <p className="text-[10px] mt-0.5 text-[var(--text-tertiary)]">在此复写模型渲染动画时的相机运动指令</p>
            </div>
          </div>
          <button onClick={onClose} 
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors text-[var(--text-tertiary)] hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Model select */}
        <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
            生成模型
          </label>
          <select
            value={videoModel}
            onChange={e => setVideoModel(e.target.value)}
            className="w-full rounded-lg px-2.5 py-2 text-xs cursor-pointer focus:outline-none transition-all"
            style={selectStyle}
          >
            {isHolo ? (
              <>
                {VIDEO_MODELS.holo.i2v.portrait.map(o => (
                  <option key={o.value} value={o.value}>{o.label}（竖）</option>
                ))}
                {VIDEO_MODELS.holo.i2v.landscape.map(o => (
                  <option key={o.value} value={o.value}>{o.label}（横）</option>
                ))}
              </>
            ) : (
              <>
                <option value="veo_3_1_i2v_s_fast_portrait_ultra_relaxed">Veo 3.1 Relax（竖屏）</option>
                <option value="veo_3_1_i2v_s_fast_ultra_relaxed">Veo 3.1 Relax（横屏）</option>
                <option value="veo_3_1_i2v_s_fast_portrait_ultra_fl">Veo 3.1 Fast（竖屏）</option>
                <option value="veo_3_1_i2v_s_fast_ultra_fl">Veo 3.1 Fast（横屏）</option>
                <option value="veo_3_1_i2v_lite_portrait">Veo 3.1 I2V Lite（竖屏）</option>
                <option value="veo_3_1_i2v_lite_landscape">Veo 3.1 I2V Lite（横屏）</option>
              </>
            )}
          </select>
        </div>

        {/* List of frames */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar bg-[var(--surface-0)]">
          {targetTasks.map((t, idx) => {
            const originalAction = parseTaskAction(t.prompt);
            const title = t.config_json?.index ? `分镜 ${t.config_json.index}` : `图 ${idx + 1}`;
            
            return (
              <div key={t.id} className="flex gap-4 p-3 bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl">
                <div className="w-16 h-28 flex-shrink-0 border border-[var(--border-default)] rounded-lg overflow-hidden relative">
                  <img src={`/${t.output_file}`} alt="ref" className="w-full h-full object-cover" />
                  <div className="absolute top-1 left-1 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded backdrop-blur-md">
                    {title}
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col min-w-0">
                  <div className="mb-2">
                    <span className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase block mb-1">原生预设动作</span>
                    <div className="text-xs text-[var(--text-secondary)] bg-[var(--surface-2)] px-2 py-1.5 rounded truncate">
                      {originalAction || '默认自然动态'}
                    </div>
                  </div>
                  
                  <div className="flex-1 flex flex-col">
                    <span className="text-[10px] font-bold text-[var(--accent)] uppercase block mb-1">追加/覆写指令 (如: Dolly In)</span>
                    <textarea 
                      value={prompts[t.id] || ''}
                      onChange={e => handleChange(t.id, e.target.value)}
                      placeholder="选填。如不填写，则默认采用上方原生动作生视频。"
                      className="flex-1 w-full bg-[var(--surface-2)] border border-[var(--border-default)] rounded-lg p-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none resize-none"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 p-4 border-t border-[var(--border-subtle)] bg-[var(--surface-1)] flex gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-6 py-2.5 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 text-white font-semibold flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)' }}
          >
            {submitting ? (
              <><span className="animate-spin">⟳</span> 提交列队中...</>
            ) : (
              <><Wand2 size={15} /> 确认并开始生成视频</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
