import React from 'react';
import { CheckCircle, Clock, Film, RotateCw, XCircle } from 'lucide-react';
import useTaskStore from '../../stores/useTaskStore';

export default function TaskItem({ group }) {
  const activeGroupId = useTaskStore((s) => s.activeGroupId);
  const setActiveGroup = useTaskStore((s) => s.setActiveGroup);
  const isActive = activeGroupId === group.id;

  let statusText = '';
  let StatusIcon = Clock;
  let dotClass = '';
  let badgeStyle = {};
  let gradientClass = 'from-gray-400 to-slate-600';
  let opacityClass = '';

  const pct = group.total_count > 0 ? Math.round((group.completed_count + group.failed_count) / group.total_count * 100) : 0;

  switch (group.status) {
    case 'needs_review':
      statusText = '待验收';
      StatusIcon = Film;
      dotClass = 'review';
      badgeStyle = { background: 'var(--accent-subtle)', color: 'var(--accent-hover)' };
      gradientClass = 'from-orange-400 to-rose-500';
      break;
    case 'processing':
      statusText = `进度 ${pct}%`;
      StatusIcon = RotateCw;
      dotClass = 'running';
      badgeStyle = { background: 'rgba(251, 191, 36, 0.12)', color: 'var(--warning)' };
      gradientClass = 'from-emerald-400 to-teal-600';
      break;
    case 'completed':
      statusText = '完成';
      StatusIcon = CheckCircle;
      dotClass = 'done';
      badgeStyle = { background: 'rgba(52, 211, 153, 0.12)', color: 'var(--success)' };
      gradientClass = 'from-pink-400 to-fuchsia-600';
      opacityClass = 'opacity-60';
      break;
    case 'failed':
      statusText = `${group.failed_count}个失败`;
      StatusIcon = XCircle;
      dotClass = 'failed';
      badgeStyle = { background: 'rgba(248, 113, 113, 0.12)', color: 'var(--error)' };
      gradientClass = 'from-sky-400 to-indigo-500';
      opacityClass = 'opacity-70';
      break;
    default:
      statusText = '队列中';
      StatusIcon = Clock;
      badgeStyle = { background: 'var(--surface-3)', color: 'var(--text-secondary)' };
  }

  const date = new Date(group.created_at);
  const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div 
      onClick={() => setActiveGroup(group.id)}
      className={`inbox-item ${isActive ? 'active' : ''} ${opacityClass} p-2.5 rounded-xl cursor-pointer border border-transparent flex gap-2.5 transition-all mb-1`}
    >
      <div className={`w-10 h-13 rounded-lg bg-gradient-to-br ${gradientClass} flex-shrink-0 shadow-sm`} style={{ minHeight: '3.25rem' }}></div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-[13px] truncate leading-tight" style={{ color: 'var(--text-primary)' }}>{group.title}</h3>
        <div className="mt-1">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1" style={badgeStyle}>
            <StatusIcon size={10} strokeWidth={2.5} />
            {statusText}
          </span>
        </div>
        
        {group.status === 'processing' && (
          <div className="w-full rounded-full h-1 mt-1.5" style={{ background: 'var(--surface-3)' }}>
            <div className="h-1 rounded-full progress-bar" style={{ width: `${pct}%`, background: 'var(--warning)' }}></div>
          </div>
        )}
        
        <div className="text-[10px] mt-1 flex items-center gap-1.5" style={{ color: 'var(--text-tertiary)' }}>
          <span>{group.total_count} 项任务</span>
          <span>·</span>
          <span>{timeStr}</span>
        </div>
      </div>
    </div>
  );
}
