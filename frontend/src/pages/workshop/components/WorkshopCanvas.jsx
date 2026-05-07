import React, { useState } from 'react';
import useWorkshopStore from '../../../stores/useWorkshopStore';
import NodeCard from './NodeCard';
import { Plus, ArrowDown } from 'lucide-react';

const ADDABLE_NODES = [
  { type: 'llm_expand', label: '大模型裂变扩展' },
  { type: 'llm_transform', label: '提示词润色' },
  { type: 't2i', label: '生图节点 (文生图)' },
  { type: 'i2i', label: '生图节点 (图生图)' },
  { type: 't2v', label: '视频节点 (文生视频)' },
  { type: 'i2v', label: '视频节点 (图生视频)' },
  { type: 'extend', label: '视频延长节点' },
  { type: 'review', label: '人工提审网关' },
];

function AddNodeButton({ onAdd }) {
  const [open, setOpen] = useState(false);
  
  return (
    <div className="relative z-10 flex flex-col items-center my-2 group">
      {/* 连线背景带渐变流光 */}
      <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px] -z-10"
           style={{ background: 'linear-gradient(to bottom, transparent, var(--border-default) 20%, var(--border-default) 80%, transparent)' }} />
           
      <button 
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 scale-90 group-hover:scale-100"
        style={{ 
          background: 'var(--surface-3)', 
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}
      >
        <Plus size={16} strokeWidth={2.5} className={open ? 'rotate-45 text-[#8b5cf6] transition-transform' : 'transition-transform'} />
      </button>

      {/* 弹出层：支持添加各类节点 */}
      {open && (
        <div className="absolute top-full mt-2 w-48 rounded-xl border p-2 shadow-xl animate-in zoom-in-95 duration-200"
             style={{ background: 'var(--surface-[2])', borderColor: 'var(--border-subtle)', backdropFilter: 'blur(12px)' }}>
          {ADDABLE_NODES.map(item => (
            <button
              key={item.type}
              onClick={() => { onAdd(item.type, item.label); setOpen(false); }}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors hover:bg-[#8b5cf6]/10 hover:text-[#8b5cf6]"
              style={{ color: 'var(--text-secondary)' }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WorkshopCanvas() {
  const nodes = useWorkshopStore(s => s.nodes);
  const insertNodeAt = useWorkshopStore(s => s.insertNodeAt);
  
  const [dragIdx, setDragIdx] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-12 flex flex-col items-center bg-[var(--surface-0)] relative scroll-smooth">
      
      {/* 顶部起启点指示 */}
      <div className="w-48 text-center py-2.5 mb-2 rounded-full border shadow-sm font-bold tracking-widest text-[10px] uppercase transition-all hover:scale-105"
           style={{ background: 'var(--surface-[2])', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
        Workshop Start
      </div>

      <div className="w-[2px] h-6 flex items-end justify-center text-[10px] opacity-20" style={{ background: 'linear-gradient(to bottom, transparent, var(--border-default))' }}>
        <ArrowDown size={10} className="absolute mb-[-8px]" />
      </div>

      {nodes.length === 0 ? (
        <div className="mt-8">
           <AddNodeButton onAdd={(t, l) => insertNodeAt(0, t, l)} />
        </div>
      ) : (
        nodes.map((node, i) => (
          <React.Fragment key={node.id}>
            {/* 顶部的 Add Button */}
            <AddNodeButton onAdd={(t, l) => insertNodeAt(i, t, l)} />
            
            {/* 节点实体 */}
            <NodeCard 
              node={node} 
              index={i}
              dragIdx={dragIdx}
              setDragIdx={setDragIdx}
              hoverIdx={hoverIdx}
              setHoverIdx={setHoverIdx}
            />
          </React.Fragment>
        ))
      )}

      {/* 末尾附加结点 */}
      {nodes.length > 0 && (
         <AddNodeButton onAdd={(t, l) => insertNodeAt(nodes.length, t, l)} />
      )}
      
      <div className="w-[2px] h-12 flex justify-center text-[10px] opacity-20 mb-24" style={{ background: 'linear-gradient(to bottom, var(--border-default), transparent)' }}>
        <ArrowDown size={10} className="absolute mt-2" />
      </div>
    </div>
  );
}
