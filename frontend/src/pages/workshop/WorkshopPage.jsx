import React, { useState, useEffect, useRef } from 'react';
import { Blocks, Plus, Play, MoreVertical, Edit2, Trash2, Download, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import RunInputFormModal from './components/RunInputFormModal';

export default function WorkshopPage() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [runningWorkflow, setRunningWorkflow] = useState(null); // 正在启动的模版
  const fileInputRef = useRef(null);

  const fetchWorkflows = async () => {
    try {
      const res = await api.get('/workflows/');
      setWorkflows(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('确认删除此管线模板？')) return;
    try {
      await api.delete(`/workflows/${id}`);
      fetchWorkflows();
    } catch (e) {
      alert('Delete failed');
    }
  };

  // 跳转组装界面
  const handleCreate = () => {
    navigate('/workshop/build');
  };

  const handleRun = (wf) => {
    setRunningWorkflow({ id: wf.id, title: wf.title });
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        await api.post('/workflows/import', json);
        fetchWorkflows();
      } catch(err) {
        alert('导入失败: 文件格式不合法或后端拒绝');
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const handleExport = async (id, title) => {
    try {
      const res = await api.get(`/workflows/${id}/export`);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'workflow'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('导出失败');
    }
  };

  return (
    <div className="w-full h-full flex flex-col p-8 bg-[var(--surface-0)] overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center border shadow-lg"
               style={{ background: 'var(--surface-2)', borderColor: 'var(--border-default)', color: 'var(--accent)' }}>
            <Blocks size={24} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter text-[var(--text-primary)]">创意工坊大厅</h1>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-tertiary)] uppercase mt-1">
              Creative Workshop / Pipelines
            </p>
          </div>
        </div>
        
          <div className="flex gap-2">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[var(--surface-3)] transition-colors border shadow-sm"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}
            >
              <Upload size={16} /> 从本地导入
            </button>
            <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleImport} />

            <button 
              onClick={handleCreate}
              className="px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 hover:scale-[1.02] active:scale-95 shadow-[0_4px_14px_rgba(139,92,246,0.3)] transition-all"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              <Plus size={16} /> 创建新管线
            </button>
          </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex-1 flex justify-center items-center text-[var(--text-tertiary)] opacity-50">加载中...</div>
      ) : workflows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center border border-dashed rounded-3xl" style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-1)' }}>
          <Blocks size={48} className="mb-4 opacity-20" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-lg font-bold mb-2 text-[var(--text-primary)]">尚无流水线模板</p>
          <p className="text-sm text-[var(--text-secondary)] mb-6">点击右上角新建属于您的自动化生产管线</p>
          <button 
            onClick={handleCreate}
            className="px-4 py-2 rounded-lg text-xs font-bold border hover:bg-[var(--surface-2)] transition-colors"
            style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}
          >
            开始组装
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {workflows.map(wf => (
            <div key={wf.id} className="group relative rounded-2xl p-5 border shadow-sm hover:shadow-xl transition-all hover:-translate-y-1 overflow-hidden"
                 style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}>
              
              {/* Top Accent */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#8b5cf6] to-[#ec4899] opacity-70 group-hover:opacity-100 transition-opacity" />
              
              <div className="flex justify-between items-start mb-4 mt-1">
                <h3 className="font-bold text-[var(--text-primary)] text-lg truncate flex-1 pr-4">{wf.title}</h3>
                <div className="relative group/menu flex items-center justify-center w-6 h-6 rounded-md hover:bg-[var(--surface-3)] cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>
                  <MoreVertical size={14} />
                  {/* Hover dropdown */}
                  <div className="absolute top-full right-0 mt-1 w-28 rounded-lg border shadow-xl opacity-0 invisible group-hover/menu:opacity-100 group-hover/menu:visible transition-all z-10"
                       style={{ background: 'var(--surface-2)', borderColor: 'var(--border-subtle)', backdropFilter: 'blur(10px)' }}>
                     <div className="p-1 flex flex-col gap-0.5">
                       <button onClick={() => navigate(`/workshop/build/${wf.id}`)} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[var(--surface-3)] text-[var(--text-secondary)] w-full text-left">
                         <Edit2 size={12} /> 编辑模板
                       </button>
                       <button onClick={() => handleExport(wf.id, wf.title)} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[var(--surface-3)] text-[var(--text-secondary)] w-full text-left">
                         <Download size={12} /> 导出为 JSON
                       </button>
                       <button onClick={() => handleDelete(wf.id)} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-rose-500/10 text-rose-400 w-full text-left">
                         <Trash2 size={12} /> 删除
                       </button>
                     </div>
                  </div>
                </div>
              </div>
              
              <p className="text-[11px] h-8 line-clamp-2 leading-relaxed mb-6" style={{ color: 'var(--text-secondary)' }}>
                {wf.description || '没有描述信息'}
              </p>
              
              <div className="flex items-center justify-between border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="text-[10px] font-mono font-bold tracking-widest px-2 py-1 rounded bg-[var(--surface-3)]" style={{ color: 'var(--text-tertiary)' }}>
                  {wf.steps_json?.length || 0} STEPS
                </div>
                
                <button 
                  onClick={() => handleRun(wf)} 
                  className="p-1 px-4 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all text-white hover:scale-105 active:scale-95 shadow-sm"
                  style={{ background: 'var(--accent)' }}
                >
                  <Play size={12} fill="currentColor" /> 启动
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {runningWorkflow && (
        <RunInputFormModal 
          workflowId={runningWorkflow.id}
          workflowTitle={runningWorkflow.title}
          onClose={() => setRunningWorkflow(null)}
        />
      )}
    </div>
  );
}
