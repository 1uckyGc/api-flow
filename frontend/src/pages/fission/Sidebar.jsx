import React, { useState } from 'react';
import { Image, Film, Sparkles, XCircle, AlertCircle, Circle, FileText, RefreshCw, Trash2 } from 'lucide-react';

function getFissionStatus(job) {
  const stage = job.fission_stage || 'images';
  const isProcessing = job.status === 'pending' || job.status === 'processing';
  const hasError = job.completed_count < job.total_count && !isProcessing;
  
  if (isProcessing) {
    if (stage === 'images') return { text: "图像生产中...", Icon: Image, color: "text-fuchsia-400 bg-fuchsia-500/10" };
    if (stage === 'videos') return { text: "视频生产中...", Icon: Film, color: "text-cyan-400 bg-cyan-500/10" };
    return { text: "延展生产中...", Icon: Sparkles, color: "text-emerald-400 bg-emerald-500/10" };
  }
  
  if (job.status === 'failed') {
    const msg = job.progress_message || "任务失败";
    return { text: msg, Icon: XCircle, color: "text-red-400 bg-red-500/10" };
  }
  
  if (job.status === 'needs_review' || job.status === 'completed') {
    const errorIcon = hasError ? AlertCircle : null;
    if (stage === 'images') return { text: "图像已就绪 | 待产视频", Icon: Image, ErrorIcon: errorIcon, color: "text-amber-400 bg-amber-500/10 border border-amber-500/20" };
    if (stage === 'videos') return { text: "视频已就绪 | 待产延展", Icon: Film, ErrorIcon: errorIcon, color: "text-cyan-400 bg-cyan-500/10 border border-cyan-500/20" };
    return { text: "全部完结", Icon: Sparkles, ErrorIcon: errorIcon, color: "text-emerald-400 bg-emerald-500/10" };
  }
  
  return { text: "未知状态", Icon: Circle, color: "text-gray-400 bg-gray-500/10" };
}

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'review', label: '待处理' },
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '失败' }
];

function matchFilter(job, filterKey) {
  if (filterKey === 'all') return true;
  if (filterKey === 'running') return job.status === 'pending' || job.status === 'processing';
  if (filterKey === 'review') return job.status === 'needs_review';
  if (filterKey === 'done') return job.status === 'completed';
  if (filterKey === 'failed') return job.status === 'failed';
  return true;
}

export default function Sidebar({ activeJobId, setActiveJobId, activeJobs, onOpenCreate, onDelete, onRetry, onShowDetails }) {
  const [filter, setFilter] = useState('all');

  return (
    <div className="w-[380px] border-r border-[var(--border-subtle)] bg-[var(--surface-2)] flex flex-col flex-shrink-0 z-10">
      <div className="p-4 border-b border-[var(--border-subtle)] flex flex-col gap-3">
        <h2 className="text-[var(--text-primary)] font-black text-sm flex items-center justify-between">
          <span>裂变历史</span>
          <span className="text-[10px] text-[var(--text-tertiary)] font-normal">共 {activeJobs.length} 批</span>
        </h2>
        <button 
          onClick={() => onOpenCreate()}
          className="w-full bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--border-subtle)] font-bold py-2.5 rounded-xl hover:bg-[var(--accent-subtle)] transition-all flex items-center justify-center gap-2 text-xs"
        >
          <span className="text-lg leading-none">+</span> 发起新裂变任务
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
                  ? 'bg-[var(--accent)] text-[var(--text-primary)] shadow-lg shadow-[var(--accent-subtle)]' 
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
        <div className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest pl-2 mb-1">
          {filter === 'all' ? '活跃批次' : `过滤: ${filter === 'running' ? '运行中' : filter === 'review' ? '待处理' : filter === 'done' ? '已完成' : '失败'}`}
        </div>
        {activeJobs.filter(j => matchFilter(j, filter)).map(job => {
          const statusInfo = getFissionStatus(job);
          const isProcessing = job.status === 'pending' || job.status === 'processing';
          
          return (
            <div key={job.id} onClick={() => setActiveJobId(job.id)}
              className={`p-3 rounded-xl cursor-pointer transition-all border relative group ${
                activeJobId === job.id
                ? 'bg-[var(--accent-subtle)] border-[var(--accent)] shadow-[inset_3px_0_0_0_var(--accent)]'
                : 'bg-[var(--surface-3)] border-transparent hover:bg-[var(--surface-4)]'
              }`}
            >
              <div className="flex justify-between items-start mb-1.5 pr-8">
                <h3 className={`font-bold text-xs truncate ${activeJobId === job.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`} title={job.title}>{job.title}</h3>
                <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0" title={new Date(job.created_at).toLocaleString()}>
                  {new Date(job.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-md ${statusInfo.color}`}>
                    {isProcessing ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
                    ) : (
                      <statusInfo.Icon size={12} />
                    )}
                    {statusInfo.text}
                    {statusInfo.ErrorIcon && <statusInfo.ErrorIcon size={12} className="text-red-500 animate-pulse" />}
                    <span className="ml-1 opacity-60">({job.completed_count}/{job.total_count})</span>
                  </span>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={(e) => { e.stopPropagation(); onShowDetails(job); }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--surface-4)] text-[var(--text-tertiary)] hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] transition-all"
                    title="查看工作流参数详情"
                  ><FileText size={14} /></button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onRetry(job); }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--accent-subtle)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-all shadow-sm shadow-[var(--accent-subtle)]"
                    title="以此为模板重试"
                  ><RefreshCw size={14} /></button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onDelete(job.id); }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all shadow-sm shadow-red-500/10"
                    title="删除任务"
                  ><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
        {activeJobs.length === 0 && (
          <div className="text-xs text-gray-600 text-center py-6">暂无裂变任务</div>
        )}
      </div>
    </div>
  );
}
