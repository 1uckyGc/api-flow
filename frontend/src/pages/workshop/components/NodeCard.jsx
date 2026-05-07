import React from 'react';
import useWorkshopStore from '../../../stores/useWorkshopStore';
import { GripVertical, X, Sparkles, Image as ImageIcon, Clapperboard, TextSelect, ShieldCheck, AlertCircle, MessageSquare, MonitorPlay, Layers } from 'lucide-react';

const NODE_THEMES = {
  'llm_expand': { icon: Sparkles, color: '#d946ef', bg: 'rgba(217, 70, 239, 0.1)', border: 'rgba(217, 70, 239, 0.3)', typeLabel: '创意裂变' },
  'llm_transform': { icon: TextSelect, color: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)', border: 'rgba(236, 72, 153, 0.3)', typeLabel: '分镜解析' },
  't2i': { icon: ImageIcon, color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.1)', border: 'rgba(14, 165, 233, 0.3)', typeLabel: '文本生图' },
  'i2i': { icon: ImageIcon, color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)', border: 'rgba(6, 182, 212, 0.3)', typeLabel: '图生图' },
  't2v': { icon: Clapperboard, color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)', typeLabel: '文生视频' },
  'i2v': { icon: MonitorPlay, color: '#059669', bg: 'rgba(5, 150, 105, 0.1)', border: 'rgba(5, 150, 105, 0.3)', typeLabel: '图生视频' },
  'extend': { icon: Layers, color: '#14b8a6', bg: 'rgba(20, 184, 166, 0.1)', border: 'rgba(20, 184, 166, 0.3)', typeLabel: '视频延长' },
  'review': { icon: ShieldCheck, color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)', typeLabel: '人工提审' },
};

function NodeDetailPreview({ node }) {
  const t = node.type;
  const cfg = node.config || {};
  
  if (t === 'llm_expand' || t === 'llm_transform') {
     return (
       <div className="mt-3 pt-3 border-t flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
             <span className="flex items-center gap-1.5"><MessageSquare size={13}/> 输出 {cfg.count || 4} 组分支</span>
          </div>
          {cfg.system_prompt ? (
            <div className="relative group">
              <div className="bg-[var(--surface-3)] px-2.5 py-2 rounded flex-1 truncate font-mono text-[10px] leading-relaxed transition-all opacity-80 group-hover:opacity-100 border border-[var(--border-subtle)]" style={{ color: 'var(--text-secondary)' }}>
                {cfg.system_prompt}
              </div>
            </div>
          ) : (
            <div className="text-rose-400/80 text-[10px] flex items-center gap-1.5 bg-rose-500/10 px-2 py-1.5 rounded font-mono">
              <AlertCircle size={12}/> 未填写 System Prompt
            </div>
          )}
       </div>
     );
  }
  
  if (['t2i', 'i2i', 't2v', 'i2v', 'extend'].includes(t)) {
     return (
       <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2 text-[10px] uppercase tracking-widest font-bold" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="bg-[var(--surface-3)] px-2.5 py-2 rounded border border-[var(--border-subtle)] flex flex-col gap-1 truncate transition-colors hover:border-[#8b5cf6]/50">
             <span className="opacity-50" style={{ color: 'var(--text-tertiary)' }}>运行模型</span>
             <span className="truncate" style={{ color: 'var(--text-primary)' }}>{cfg.model ? cfg.model.replace('veo_3_1_t2v_portrait', 'Veo 3.1').split('-').pop() : '未选择模型'}</span>
          </div>
          <div className="bg-[var(--surface-3)] px-2.5 py-2 rounded border border-[var(--border-subtle)] flex flex-col gap-1 transition-colors hover:border-[#8b5cf6]/50">
             <span className="opacity-50" style={{ color: 'var(--text-tertiary)' }}>画幅 & 单卡产出</span>
             <span style={{ color: 'var(--text-primary)' }}>{cfg.aspect_ratio || '16:9'} · {cfg.images_per_prompt || 1} 组</span>
          </div>
       </div>
     );
  }
  
  if (t === 'review') {
     return (
       <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
         <div className="text-[11px] text-amber-500/80 bg-amber-500/5 px-2.5 py-2 rounded font-medium border border-amber-500/20 leading-relaxed flex items-start gap-2">
           <ShieldCheck size={14} className="mt-0.5 shrink-0" />
           执行到此时将挂起，等待您筛选上级输出的素材后再向后流转。
         </div>
       </div>
     );
  }
  return null;
}

export default function NodeCard({ node, index, dragIdx, setDragIdx, hoverIdx, setHoverIdx }) {
  const selectedNodeId = useWorkshopStore(s => s.selectedNodeId);
  const selectNode = useWorkshopStore(s => s.selectNode);
  const removeNode = useWorkshopStore(s => s.removeNode);
  const moveNode = useWorkshopStore(s => s.moveNode);
  
  const isSelected = selectedNodeId === node.id;
  const isDragging = dragIdx === index;
  const isHovered = hoverIdx === index && dragIdx !== index;

  const theme = NODE_THEMES[node.type] || NODE_THEMES['t2i'];
  const Icon = theme.icon;

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragIdx(index);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== index) {
      setHoverIdx(index);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (dragIdx !== null && hoverIdx !== null && dragIdx !== hoverIdx) {
      moveNode(dragIdx, hoverIdx);
    }
    setDragIdx(null);
    setHoverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setHoverIdx(null);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      onClick={() => selectNode(node.id)}
      className={`
        w-80 shrink-0 min-h-[120px] relative rounded-2xl p-4 cursor-pointer transition-all duration-300 ease-out overflow-hidden border
        ${isSelected 
          ? 'shadow-[0_8px_30px_rgba(139,92,246,0.15)] scale-[1.02] bg-[var(--surface-1)]' 
          : 'shadow-md hover:shadow-[0_8px_20px_rgba(0,0,0,0.15)] hover:-translate-y-0.5 bg-[var(--surface-0)]'}
        ${isDragging ? 'opacity-30 scale-95' : 'opacity-100'}
        ${isHovered ? 'translate-y-2 border-dashed' : ''}
      `}
      style={{
        borderColor: isHovered ? theme.color : (isSelected ? 'var(--accent)' : 'var(--border-subtle)'),
      }}
    >
      {/* 侧边主题色点缀防卫条 */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-1.5 transition-all" 
        style={{ background: isSelected ? 'var(--accent)' : theme.color, opacity: isSelected ? 1 : 0.6 }} 
      />
      
      {/* 顶部标题区 */}
      <div className="flex items-start gap-3 pl-2">
        {/* 图标与类型 */}
        <div 
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
          style={{ background: theme.bg, color: theme.color, borderColor: theme.border }}
        >
          <Icon size={20} strokeWidth={2.2} />
        </div>
        
        {/* Name Block */}
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="text-[10px] font-black uppercase tracking-widest mb-0.5 flex items-center gap-2" style={{ color: theme.color }}>
            {theme.typeLabel}
            {node.type === 'extend' && <span className="opacity-70 font-mono tracking-normal"> (Loop)</span>}
          </div>
          <h3 className="font-bold text-sm truncate flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
            {node.label}
          </h3>
        </div>

        {/* 右上角操作区 */}
        <div className="flex flex-col items-center gap-1">
          <button 
            onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all bg-[var(--surface-2)] text-[var(--text-tertiary)] hover:bg-rose-500/10 hover:text-rose-400"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
          
          <div className="w-7 flex items-center justify-center py-2 cursor-grab active:cursor-grabbing text-[var(--text-tertiary)] opacity-30 hover:opacity-100 transition-opacity">
            <GripVertical size={16} />
          </div>
        </div>
      </div>

      {/* 内部状态预览 */}
      <div className="pl-1">
        <NodeDetailPreview node={node} />
      </div>
    </div>
  );
}
