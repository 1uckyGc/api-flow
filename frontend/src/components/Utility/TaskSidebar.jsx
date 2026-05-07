import React, { useState } from 'react';
import { Clapperboard, Trash2, CheckCircle, XCircle, Loader, Clock, RefreshCw, AlertCircle } from 'lucide-react';

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '失败' }
];

function matchFilter(job, filterKey) {
  if (filterKey === 'all') return true;
  if (filterKey === 'running') return job.status === 'pending' || job.status === 'processing' || job.status === 'needs_review';
  if (filterKey === 'done') return job.status === 'completed';
  if (filterKey === 'failed') return job.status === 'failed';
  return true;
}

export default function TaskSidebar({ 
  title, 
  icon: Icon = Clapperboard,
  activeJobId, 
  setActiveJobId, 
  activeJobs = [], 
  onOpenCreate, 
  onDelete,
  onRetry
}) {
  const [filter, setFilter] = useState('all');

  return (
    <div className="w-[360px] border-r border-[var(--border-subtle)] bg-[var(--surface-1)] flex flex-col flex-shrink-0 z-10 h-full">
      <div className="p-4 border-b border-[var(--border-subtle)] flex flex-col gap-3" style={{ background: 'var(--surface-2)' }}>
        <h2 className="text-[var(--text-primary)] font-bold text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon size={16} style={{ color: 'var(--accent)' }} />
            <span>{title} 历史</span>
          </div>
          <span className="text-[10px] text-[var(--text-tertiary)] font-normal">共 {activeJobs.length} 批</span>
        </h2>
        
        <button 
          onClick={onOpenCreate}
          className="w-full font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
          style={{ 
            background: 'var(--accent-subtle)', 
            color: 'var(--accent)', 
            border: '1px solid var(--border-subtle)' 
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-subtle)'}
        >
          <span className="text-lg leading-none">+</span> 发起新任务
        </button>

        <div className="flex gap-2 border-t border-[var(--border-subtle)] pt-3 overflow-x-auto no-scrollbar">
          {FILTER_TABS.map(tab => {
            const count = tab.key === 'all' ? activeJobs.length : activeJobs.filter(j => matchFilter(j, tab.key)).length;
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                  filter === tab.key 
                  ? 'bg-[var(--accent)] text-white shadow-lg' 
                  : 'bg-[var(--surface-3)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {tab.label} <span className="opacity-60 ml-0.5">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        {activeJobs.filter(j => matchFilter(j, filter)).map(job => {
          const isNeedsReview = job.status === 'needs_review';
          const isProcessing = job.status === 'pending' || job.status === 'processing';
          const isFailed = job.status === 'failed';
          const isDone = job.status === 'completed';

          return (
            <div key={job.id} onClick={() => setActiveJobId(job.id)}
              className={`p-3 rounded-xl cursor-pointer transition-all border relative group ${
                activeJobId === job.id
                ? 'bg-[var(--accent-subtle)] border-[var(--accent)] shadow-[inset_3px_0_0_0_var(--accent)]'
                : 'bg-[var(--surface-3)] border-transparent hover:bg-[var(--surface-4)]'
              }`}
            >
              {isNeedsReview && (
                <div className="absolute -top-2 -right-2 flex items-center gap-1 bg-[#f59e0b] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-md animate-bounce">
                  <AlertCircle size={10} /> 待确认
                </div>
              )}
              <div className="flex justify-between items-start mb-1.5 pr-8">
                <h3 className={`font-bold text-xs truncate ${activeJobId === job.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`} title={job.title}>
                  {job.title}
                </h3>
                <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
                  {new Date(job.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
              </div>
              
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-md"
                  style={{
                    background: isNeedsReview ? 'rgba(245,158,11,0.1)' : isProcessing ? 'rgba(99,102,241,0.1)' : isFailed ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    color: isNeedsReview ? '#f59e0b' : isProcessing ? 'var(--accent)' : isFailed ? 'var(--error)' : 'var(--success)'
                  }}
                >
                  {isNeedsReview && <AlertCircle size={12} className="animate-pulse"/>}
                  {isProcessing && <Loader size={12} className="animate-spin" />}
                  {isFailed && <XCircle size={12} />}
                  {isDone && <CheckCircle size={12} />}
                  {!isNeedsReview && !isProcessing && !isFailed && !isDone && <Clock size={12} />}
                  
                  <span>
                    {isNeedsReview ? '请查看图板' : isProcessing ? '生成中...' : isFailed ? '遭遇失败' : isDone ? '已完成' : '等待调度'}
                  </span>
                  <span className="ml-1 opacity-60">({job.completed_count}/{job.total_count})</span>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onRetry && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); onRetry(job); }}
                      className="w-6 h-6 flex items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-all hover:bg-[var(--surface-3)] hover:text-[var(--accent)]"
                      title="以此任务参数重新发起"
                    ><RefreshCw size={12} /></button>
                  )}
                  {onDelete && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); onDelete(job.id); }}
                      className="w-6 h-6 flex items-center justify-center rounded-lg text-[var(--error)] transition-all hover:bg-[var(--error)] hover:text-white"
                      title="删除任务"
                    ><Trash2 size={12} /></button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {activeJobs.length === 0 && (
          <div className="text-xs text-[var(--text-tertiary)] text-center py-6">暂无任务</div>
        )}
      </div>
    </div>
  );
}
