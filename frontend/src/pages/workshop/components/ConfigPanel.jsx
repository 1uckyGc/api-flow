import React from 'react';
import useWorkshopStore from '../../../stores/useWorkshopStore';
import { Settings2, Type, Box, SlidersHorizontal, Image as ImageIcon } from 'lucide-react';
import { useProvider } from '../../../hooks/useProvider';
import { VIDEO_MODELS } from '../../../constants/models';

const NODE_TYPES_I18N = {
  't2i': '文本生图 (T2I)',
  'i2i': '图生图 (I2I)',
  't2v': '文生视频 (T2V)',
  'i2v': '图生视频 (I2V)',
  'extend': '视频延展 (Extend)',
  'llm_expand': '创意裂变 (Expand)',
  'llm_transform': '提示词润色 (Transform)',
  'review': '人工审核 (Review Gate)'
};

export default function ConfigPanel() {
  const provider = useProvider();
  const isHolo = provider === 'holo';
  const selectedNode = useWorkshopStore(s => s.getSelectedNode());
  const updateNodeConfig = useWorkshopStore(s => s.updateNodeConfig);
  const updateNodeLabel = useWorkshopStore(s => s.updateNodeLabel);

  if (!selectedNode) {
    return (
      <div className="w-[var(--panel-width)] shrink-0 h-full border-l flex flex-col items-center justify-center p-6 animate-in fade-in"
           style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}>
        <div className="w-16 h-16 rounded-2xl mb-4 flex items-center justify-center opacity-40 delay-150 animate-in zoom-in-90"
             style={{ background: 'var(--surface-2)' }}>
          <Settings2 size={28} style={{ color: 'var(--text-tertiary)' }} />
        </div>
        <p className="text-sm font-medium tracking-wide" style={{ color: 'var(--text-tertiary)' }}>未选中任何节点</p>
        <p className="text-[11px] text-center mt-2 opacity-60" style={{ color: 'var(--text-tertiary)' }}>
          在左侧画布中点击卡片<br/>即可配置参数
        </p>
      </div>
    );
  }

  const { id, type, label, config } = selectedNode;

  const handleChange = (key, value) => {
    updateNodeConfig(id, { [key]: value });
  };

  // 基础样式
  const inputClass = "w-full bg-[var(--surface-2)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2.5 border border-transparent focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-all duration-200 outline-none";
  const labelClass = "text-[11px] font-bold uppercase tracking-wider mb-1.5 ml-1 flex items-center gap-1.5";

  return (
    <div className="w-[var(--panel-width)] shrink-0 h-full border-l flex flex-col overflow-y-auto custom-scrollbar"
         style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}>
      {/* Panel Header */}
      <div className="p-5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Settings2 size={16} style={{ color: 'var(--accent)' }} />
          <h2 className="font-bold text-[var(--text-primary)]">节点配置</h2>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{NODE_TYPES_I18N[type] || type} 算子详情</p>
      </div>

      <div className="p-5 flex flex-col gap-6">
        {/* 全局属性：节点名称 */}
        <div>
          <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
            <Type size={14} />
            显示名称
          </label>
          <input
            type="text"
            className={inputClass}
            value={label || ''}
            onChange={(e) => updateNodeLabel(id, e.target.value)}
            placeholder="为节点起个名字"
          />
        </div>

        {/* --- 差异化表单渲染 --- */}
        
        {/* 1. 生图/生视频模型面板 (t2i, i2i, i2v, t2v, extend) */}
        {['t2i', 'i2i', 'i2v', 't2v', 'extend'].includes(type) && (
          <>
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                <Box size={14} /> AI 模型 (Model)
              </label>
              <select 
                className={inputClass}
                value={config.model || ''}
                onChange={(e) => handleChange('model', e.target.value)}
              >
                {!config.model && <option value="">请选择模型...</option>}
                {(type === 't2i' || type === 'i2i') && (
                  <>
                    <optgroup label="Gemini">
                      <option value="gemini-3.1-flash-image">Gemini 3.1 Flash</option>
                      <option value="gemini-3.0-pro-image">Gemini 3.0 Pro</option>
                    </optgroup>
                    <optgroup label="Grok">
                      <option value="grok-imagine-image">Grok Imagine (标准)</option>
                      <option value="grok-imagine-image-pro">Grok Imagine Pro (高质量)</option>
                      {type === 'i2i' && <option value="grok-imagine-image-edit">Grok Edit (自动识别比例修图)</option>}
                    </optgroup>
                  </>
                )}
                {(type === 't2v' || type === 'i2v') && isHolo && (
                  <>
                    <optgroup label="HOLO 竖屏">
                      {VIDEO_MODELS.holo[type].portrait.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="HOLO 横屏">
                      {VIDEO_MODELS.holo[type].landscape.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Grok">
                      <option value={type === 't2v' ? 'grok-imagine-video-t2v' : 'grok-imagine-video-i2v'}>
                        Grok Imagine Video
                      </option>
                    </optgroup>
                  </>
                )}
                {type === 't2v' && !isHolo && (
                  <>
                    <optgroup label="VEO 3.1">
                      <option value="veo_t2v_ultra">Veo T2V Ultra (极速模式)</option>
                      <option value="veo_t2v_ultra_relaxed">Veo T2V Ultra Relax (休闲模式)</option>
                      <option value="veo_t2v_lite">Veo T2V Lite</option>
                    </optgroup>
                    <optgroup label="Grok">
                      <option value="grok-imagine-video-t2v">Grok Imagine Video (文生视频)</option>
                    </optgroup>
                  </>
                )}
                {type === 'i2v' && !isHolo && (
                  <>
                    <optgroup label="VEO 3.1">
                      <option value="veo_i2v_ultra">Veo I2V Ultra (首尾帧 - 极速)</option>
                      <option value="veo_i2v_ultra_relaxed">Veo I2V Ultra (首尾帧 - 休闲)</option>
                      <option value="veo_i2v_lite">Veo I2V Lite (首帧)</option>
                      <option value="veo_interpolation_lite">Veo 首尾帧补帧 (Interpolation)</option>
                    </optgroup>
                    <optgroup label="Grok">
                      <option value="grok-imagine-video-i2v">Grok Imagine Video (图生视频)</option>
                    </optgroup>
                  </>
                )}
                {type === 'extend' && (
                  <>
                    <optgroup label="引擎选择">
                      <option value="veo_extend">VEO 自动延展 (基础算法)</option>
                      <option value="grok-imagine-video-i2v">Grok Video 延长计算</option>
                    </optgroup>
                  </>
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 delay-75">
              {config.model !== 'grok-imagine-image-edit' && (
                <div>
                  <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                     <ImageIcon size={14} /> 画幅比例
                  </label>
                  <select 
                     className={inputClass}
                     value={config.aspect_ratio || '9:16'}
                     onChange={(e) => handleChange('aspect_ratio', e.target.value)}
                  >
                    <option value="9:16">9:16 竖屏</option>
                    <option value="16:9">16:9 横屏</option>
                    <option value="1:1">1:1 方型</option>
                  </select>
                </div>
              )}
              
              <div>
                <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                   <SlidersHorizontal size={14} /> 生成数量
                </label>
                <input
                  type="number" min={1} max={16}
                  className={inputClass}
                  value={config.images_per_prompt || 1}
                  onChange={(e) => handleChange('images_per_prompt', parseInt(e.target.value) || 1)}
                />
              </div>
            </div>

            {config.model?.includes('gemini') && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 delay-100">
                <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>画质精度</label>
                <select 
                   className={inputClass}
                   value={config.resolution || 'standard'}
                   onChange={(e) => handleChange('resolution', e.target.value)}
                >
                  <option value="standard">标清 (Standard)</option>
                  <option value="2k">2K 超清</option>
                  <option value="4k">4K 原画</option>
                </select>
              </div>
            )}

            {config.model === 'grok-imagine-video-t2v' || config.model === 'grok-imagine-video-i2v' ? (
              <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 delay-100">
                <div>
                  <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>视频时长</label>
                  <select 
                     className={inputClass}
                     value={config.seconds || 6}
                     onChange={(e) => handleChange('seconds', parseInt(e.target.value) || 6)}
                  >
                    <option value={6}>6 秒</option>
                    <option value={10}>10 秒</option>
                    <option value={12}>12 秒</option>
                    <option value={16}>16 秒</option>
                    <option value={20}>20 秒</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>渲染质量</label>
                  <select 
                     className={inputClass}
                     value={config.quality || 'high'}
                     onChange={(e) => handleChange('quality', e.target.value)}
                  >
                    <option value="high">720p (High)</option>
                    <option value="standard">480p (Standard)</option>
                  </select>
                </div>
              </div>
            ) : null}

            {/* 上游图像依赖提示 */}
            {['i2i', 'i2v', 'extend'].includes(type) && (
               <div className="p-3 rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/5 mt-2 flex items-start gap-2">
                 <ImageIcon size={14} className="mt-0.5" style={{ color: 'var(--accent)' }}/>
                 <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                   <strong style={{ color: 'var(--text-primary)' }}>该节点消费流素材</strong><br/>
                   运行时，该节点无需配置参考图。它将自动接收上游算子（或首节点表单上传）产出的图像或视频参与生成流转。
                 </p>
               </div>
            )}
          </>
        )}

        {/* 2. LLM 裂变扩展 / 解析 (llm_expand, llm_transform) */}
        {['llm_expand', 'llm_transform'].includes(type) && (
          <>
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                裂变数量 (Target Count)
              </label>
              <input
                type="number"
                min={1} max={50}
                className={inputClass}
                value={config.count || 4}
                onChange={(e) => handleChange('count', parseInt(e.target.value) || 4)}
              />
            </div>

            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 delay-75">
              <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                System Prompt
              </label>
              <textarea
                rows={4}
                className={`${inputClass} resize-none font-mono text-[11px] leading-relaxed`}
                value={config.system_prompt || ''}
                onChange={(e) => handleChange('system_prompt', e.target.value)}
                placeholder="例如: 你是一个创意摄影师..."
              />
            </div>
            
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 delay-100">
              <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                User Template
              </label>
              <textarea
                rows={3}
                className={`${inputClass} resize-none font-mono text-[11px] leading-relaxed`}
                value={config.user_template || '{input_prompt}'}
                onChange={(e) => handleChange('user_template', e.target.value)}
                placeholder="使用 {input_prompt} 引用前级提示词"
              />
            </div>
          </>
        )}

        {/* 3. 人工审核网关 (review) */}
        {type === 'review' && (
          <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 animate-in fade-in scale-95 duration-500">
            <h3 className="font-bold text-rose-400 text-sm mb-2">拦截提示</h3>
            <p className="text-xs text-rose-400/80 leading-relaxed">
              工作流执行到此节点时将**自动暂停**。在前端审批人员进行图像或文本圈选之前，下方的所有节点均等待触发。不需要配置参数。
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
