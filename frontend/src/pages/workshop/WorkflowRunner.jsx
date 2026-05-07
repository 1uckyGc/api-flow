import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Play, PauseCircle, ArrowLeft, Image as ImageIcon, Film, FileText, Blocks } from 'lucide-react';
import api from '../../api/client';

const TYPE_ICONS = {
  'input': <Blocks size={16} />,
  't2i': <ImageIcon size={16} />,
  'i2i': <ImageIcon size={16} />,
  't2v': <Film size={16} />,
  'i2v': <Film size={16} />,
  'extend': <Film size={16} />,
  'llm_expand': <FileText size={16} />,
  'llm_transform': <FileText size={16} />,
  'review': <PauseCircle size={16} />,
};

const TYPE_LABELS = {
  'input': '入口解析',
  't2i': '文本生图',
  'i2i': '图生图',
  't2v': '文生视频',
  'i2v': '图生视频',
  'extend': '视频延展',
  'llm_expand': '创意裂变',
  'llm_transform': '提示词润色',
  'review': '人工审核',
};

export default function WorkflowRunner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchRun = async () => {
    try {
      const res = await api.get(`/workflows/runs/${id}`);
      setRun(res.data);
    } catch (e) {
      console.error(e);
      // maybe 404
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id === 'undefined' || !id) {
      navigate('/workshop', { replace: true });
      return;
    }
    fetchRun();
    // 轮询逻辑 (如果处于未结束状态)
    const interval = setInterval(() => {
      if (run && (run.status === 'RUNNING' || run.status === 'PENDING')) {
        fetchRun();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [id, run?.status]);

  if (loading && !run) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--surface-0)]">
        <Loader2 className="animate-spin text-[var(--accent)]" size={32} />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--surface-0)]">
        <AlertTriangle size={48} className="text-rose-500 mb-4" />
        <h2 className="text-xl font-bold mb-2">找不到执行纪要</h2>
        <button onClick={() => navigate('/workshop')} className="text-sm underline text-[var(--text-secondary)]">返回大厅</button>
      </div>
    );
  }

  const { steps_state, status, current_step } = run;

  // 渲染单个步骤的状态图标
  const renderStepStatus = (stepState) => {
    if (stepState.status === 'completed') return <CheckCircle2 size={16} className="text-emerald-500" />;
    if (stepState.status === 'failed') return <XCircle size={16} className="text-rose-500" />;
    if (stepState.status === 'running') return <Loader2 size={16} className="text-[var(--accent)] animate-spin" />;
    return <div className="w-2 h-2 rounded-full bg-[var(--text-tertiary)] opacity-30" />;
  };

  return (
    <div className="w-full h-full flex flex-col bg-[var(--surface-0)] overflow-y-auto custom-scrollbar">
      {/* 顶栏控制 */}
      <div className="flex-shrink-0 h-16 border-b flex items-center px-6 sticky top-0 z-20 backdrop-blur-md bg-[var(--surface-0)]/80" style={{ borderColor: 'var(--border-subtle)' }}>
        <button 
          onClick={() => navigate('/workshop')} 
          className="mr-4 p-2 rounded-xl hover:bg-[var(--surface-2)] transition-colors text-[var(--text-secondary)]"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
            执行监控大盘 
            <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded tracking-wider ${
              status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
              status === 'FAILED' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' :
              status === 'PAUSED' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' :
              'bg-[var(--accent-subtle)] text-[var(--accent-hover)] border border-[var(--accent)]/20 shadow-[0_0_10px_var(--accent-subtle)]'
            }`}>
              {status}
            </span>
          </h1>
          <p className="text-[11px] text-[var(--text-tertiary)] font-mono mt-0.5 opacity-80">
            ID: {run.id} | TITLE: {run.title}
          </p>
        </div>
      </div>

      {/* 进度轨道区 */}
      <div className="flex-1 p-8 max-w-4xl mx-auto w-full">
        <div className="space-y-6 relative before:absolute before:inset-0 before:ml-[23px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-[var(--border-strong)] before:to-transparent">
          
          {steps_state.map((step, idx) => {
            const isActive = run.status !== 'COMPLETED' && run.status !== 'FAILED' && idx === current_step;
            const isFinished = step.status === 'completed';
            const isFailed = step.status === 'failed';
            
            return (
              <div key={idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                
                {/* 轴心点 */}
                <div className={`flex items-center justify-center w-12 h-12 rounded-full border-4 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm transition-all duration-300 z-10 ${
                  isActive ? 'bg-[var(--surface-0)] border-[var(--accent)] shadow-[0_0_20px_var(--accent-subtle)] scale-110' :
                  isFinished ? 'bg-[var(--surface-0)] border-emerald-500' :
                  isFailed ? 'bg-[var(--surface-0)] border-rose-500' :
                  'bg-[var(--surface-1)] border-[var(--border-subtle)] opacity-50'
                }`}>
                  <div className={isActive ? 'text-[var(--accent)]' : isFinished ? 'text-emerald-500' : isFailed ? 'text-rose-500' : 'text-[var(--text-tertiary)]'}>
                     {renderStepStatus(step)}
                  </div>
                </div>
                
                {/* 任务卡片 */}
                <div className={`w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] p-5 rounded-2xl border shadow-sm transition-all duration-300 ${
                  isActive ? 'bg-[var(--surface-1)] border-[var(--accent)]/50 scale-[1.02]' :
                  'bg-[var(--surface-0)] border-[var(--border-subtle)] hover:bg-[var(--surface-1)]'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                       <span className="p-1.5 rounded-lg bg-[var(--surface-2)] text-[var(--text-secondary)]">
                         {TYPE_ICONS[step.type] || <Blocks size={16} />}
                       </span>
                       <h3 className="font-bold text-[13px] text-[var(--text-primary)]">
                         Step {idx}: {TYPE_LABELS[step.type] || step.type}
                       </h3>
                    </div>
                    {isActive && <div className="text-[10px] font-bold text-[var(--accent)] tracking-widest animate-pulse">处理中</div>}
                  </div>
                  
                  {/* 产出物占位 */}
                  <div className="min-h-[60px] rounded-xl bg-[var(--surface-2)] border border-[var(--border-subtle)] flex items-center justify-center p-4">
                     {step.output_files && step.output_files.length > 0 ? (
                       <div className="flex gap-2 w-full overflow-x-auto text-[10px] text-[var(--text-tertiary)] font-mono">
                          {/* 这里 7.4 会渲染真正的预览组件 */}
                          已产出 {step.output_files.length} 个文件
                       </div>
                     ) : step.error ? (
                       <div className="text-xs text-rose-500">{step.error}</div>
                     ) : (
                       <div className="text-[10px] text-[var(--text-tertiary)]">暂无产出</div>
                     )}
                  </div>
                </div>
              </div>
            );
          })}

        </div>
      </div>
    </div>
  );
}
