import React, { useState } from 'react';
import { Blocks, Save, Play, Download, Upload, AlertCircle } from 'lucide-react';
import useWorkshopStore from '../../stores/useWorkshopStore';
import useAuthStore from '../../stores/useAuthStore';
import WorkshopCanvas from './components/WorkshopCanvas';
import ConfigPanel from './components/ConfigPanel';
import api from '../../api/client';

export default function WorkflowBuilder() {
  const token = useAuthStore(s => s.token);
  const nodes = useWorkshopStore(s => s.nodes);
  const workflowMeta = useWorkshopStore(s => s.workflowMeta);
  const setWorkflowMeta = useWorkshopStore(s => s.setWorkflowMeta);
  
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSave = async () => {
    if (nodes.length === 0) {
      setErrorMsg('画布为空，无法保存');
      setTimeout(() => setErrorMsg(''), 3000);
      return;
    }
    
    setIsSaving(true);
    try {
      const payload = {
        title: workflowMeta.title,
        description: workflowMeta.description,
        input_schema: {},
        steps_json: nodes.map(n => ({
          type: n.type,
          label: n.label,
          config: n.config
        }))
      };

      const res = await api.post('/workflows/', payload);
      
      // Flash success
      setErrorMsg('保存成功');
      setTimeout(() => setErrorMsg(''), 2000);
    } catch (err) {
      setErrorMsg(err.message || '网络异常');
      setTimeout(() => setErrorMsg(''), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[var(--surface-0)] animate-in fade-in slide-in-from-bottom-4 duration-500 ease-in-out">
      
      {/* 顶部控制栏 (TopBar) */}
      <div className="h-16 border-b flex items-center justify-between px-6 z-20 shadow-sm"
           style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center border"
               style={{ background: 'var(--surface-3)', borderColor: 'var(--border-default)', color: 'var(--accent)' }}>
            <Blocks size={18} strokeWidth={2.2} />
          </div>
          
          <div className="flex flex-col">
            <input 
              type="text" 
              value={workflowMeta.title}
              onChange={(e) => setWorkflowMeta({ title: e.target.value })}
              className="font-black tracking-tighter text-base bg-transparent border-none outline-none focus:ring-0 p-0 hover:bg-white/5 rounded px-1 transition-colors" 
              style={{ color: 'var(--text-primary)' }}
            />
            <input
              type="text"
              value={workflowMeta.description}
              onChange={(e) => setWorkflowMeta({ description: e.target.value })}
              className="text-[10px] uppercase tracking-widest font-semibold bg-transparent border-none outline-none focus:ring-0 p-0 opacity-70 hover:opacity-100 hover:bg-white/5 rounded px-1 transition-colors mt-0.5"
              style={{ color: 'var(--text-tertiary)' }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 flex-1 items-center">
           {errorMsg && (
            <div className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 mr-2 ${errorMsg.includes('成功') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              <AlertCircle size={14} />
              {errorMsg}
            </div>
           )}

           <button 
             className="px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 hover:bg-[var(--surface-3)]"
             style={{ color: 'var(--text-secondary)' }}
           >
             <Upload size={14} /> 导入
           </button>
           <button 
             onClick={handleSave}
             disabled={isSaving}
             className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 
                        ${isSaving ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-95 shadow-[0_4px_14px_rgba(139,92,246,0.3)]'}
             `}
             style={{ background: 'var(--accent)', color: 'white' }}
           >
             <Save size={14} /> {isSaving ? '保存中...' : '保存管线'}
           </button>
        </div>
      </div>
      
      {/* 核心工作区 */}
      <div className="flex-1 flex overflow-hidden">
        <WorkshopCanvas />
        <ConfigPanel />
      </div>

    </div>
  );
}
