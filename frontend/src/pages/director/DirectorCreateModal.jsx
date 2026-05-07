import React from 'react';
import { X } from 'lucide-react';
import DirectorInputPanel from './DirectorInputPanel';

export default function DirectorCreateModal({ onClose, onSubmit, submitting, initialData }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
      style={{ background: 'var(--modal-backdrop)', backdropFilter: 'blur(4px)' }}>
      
      <div className="flex flex-col rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        style={{
          width: '420px',
          maxHeight: '85vh',
          background: 'var(--surface-1)',
          border: '1px solid var(--border-strong)'
        }}>
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}>
          <div>
            <h2 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>新建导演模式任务</h2>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>后台智能解析，无感秒切工作流</p>
          </div>
          <button onClick={onClose} 
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body (Input Panel) */}
        <div className="flex-1 overflow-hidden flex flex-col relative w-full h-[600px]">
          <DirectorInputPanel onSubmit={onSubmit} submitting={submitting} initialData={initialData} />
        </div>
      </div>
    </div>
  );
}
