import React, { useState } from 'react';
import { Settings, CheckCircle, Loader, XCircle, Edit3, RefreshCw, Trash2 } from 'lucide-react';
import useTaskStore from '../../stores/useTaskStore';
import api from '../../api/client';
import { copyToClipboard } from '../../utils/clipboard';

export default function InspectorPanel({ groupDetail }) {
  const setActiveGroup = useTaskStore((s) => s.setActiveGroup);
  const fetchTaskGroups = useTaskStore((s) => s.fetchTaskGroups);
  const setDraftData = useTaskStore((s) => s.setDraftData);
  const [isRemixing, setIsRemixing] = useState(false);

  if (!groupDetail) return null;

  const handleDelete = async () => {
    if (!window.confirm("确定要彻底删除该批次任务以及生成的所有视频文件吗？本操作不可逆！")) return;
    try {
      await api.delete(`/tasks/${groupDetail.id}`);
      setActiveGroup(null);
      fetchTaskGroups();
    } catch (e) {
      console.error('Delete failed:', e);
      alert('删除失败，请检查网络日志。');
    }
  };

  const handleRemix = async () => {
    setIsRemixing(true);
    try {
      const joinedPrompts = groupDetail.tasks?.map(t => t.prompt).join('\n') || '';
      const rawImagePaths = groupDetail.tasks?.[0]?.input_files || [];
      
      const fetchedFiles = await Promise.all(
        rawImagePaths.map(async (path) => {
          try {
            const res = await fetch('/' + path);
            const blob = await res.blob();
            const filename = path.split('/').pop() || 'image.png';
            return new File([blob], filename, { type: blob.type });
          } catch (e) {
            console.error("Fetch image error", e);
            return null;
          }
        })
      );

      setDraftData({
        prompts: joinedPrompts,
        model: groupDetail.config_json?.model,
        aspectRatio: groupDetail.config_json?.aspectRatio,
        files: fetchedFiles.filter(f => f)
      });
      setActiveGroup(null);
    } finally {
      setIsRemixing(false);
    }
  };

  const handleRecreate = async () => {
    if (!window.confirm("确认使用与本批次【完全一致】的参数进行“无痕一键复刻”并重新下发至后台生成队列吗？")) return;
    try {
      // 从老任务组中抽取参数并发起新的一单
      const taskGroupData = {
        title: groupDetail.title + " (重制版)",
        task_type: groupDetail.task_type,
        source: groupDetail.source,
        global_prompt: groupDetail.global_prompt,
        config_json: groupDetail.config_json,
        tasks: groupDetail.tasks.map(t => ({
          prompt: t.prompt,
          input_files: t.input_files
        }))
      };
      await api.post('/tasks/', taskGroupData);
      fetchTaskGroups();
      alert("复刻成功！该批次已重新压入生成管线。");
    } catch (e) {
      console.error('Recreate failed', e);
      alert("复刻请求提交失败");
    }
  };

  // 计算任务跨度总耗时
  const getDuration = () => {
    if (!groupDetail.created_at || !groupDetail.updated_at) return '';
    const start = new Date(groupDetail.created_at);
    const end = new Date(groupDetail.updated_at);
    let diff = Math.floor((end - start) / 1000);
    // 扣补误差预防负数
    if (diff < 0) return '计算中...'; 
    if (diff < 60) return `${diff} 秒`;
    return `${Math.floor(diff / 60)} 分 ${diff % 60} 秒`;
  };

  // 取第一条任务参考作为范例图
  const sampleTask = groupDetail.tasks?.[0] || {};
  const inputFiles = sampleTask.input_files || [];
  const activeModel = groupDetail.config_json?.model || "VEO 默认极速超清";
  const aspectRatio = groupDetail.config_json?.aspectRatio || "9:16";

  const renderStatusBadge = () => {
    const s = groupDetail.status;
    if (s === 'completed') return <span className="text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1" style={{ background: 'rgba(52, 211, 153, 0.12)', color: 'var(--success)', border: '1px solid rgba(52, 211, 153, 0.2)' }}><CheckCircle size={10} /> 批次已完成</span>;
    if (s === 'processing') return <span className="text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1" style={{ background: 'rgba(251, 191, 36, 0.12)', color: 'var(--warning)', border: '1px solid rgba(251, 191, 36, 0.2)' }}><Loader size={10} className="animate-spin" /> 下发推流中</span>;
    if (s === 'failed') return <span className="text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1" style={{ background: 'rgba(248, 113, 113, 0.12)', color: 'var(--error)', border: '1px solid rgba(248, 113, 113, 0.2)' }}><XCircle size={10} /> 全链路终止</span>;
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>排队中</span>;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '--:--';
    const d = new Date(dateStr);
    return d.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <aside className="w-[300px] flex flex-col z-20 flex-shrink-0 text-sm relative h-full" style={{ background: 'var(--surface-1)', borderLeft: '1px solid var(--border-subtle)', boxShadow: 'none' }}>
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h3 className="font-bold text-[15px] flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
          <Settings size={15} style={{ color: 'var(--accent)' }} /> 参数洞察器
        </h3>
        {renderStatusBadge()}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 custom-scrollbar pb-32">
        {/* Model Meta */}
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-tertiary)' }}>生成内核</p>
          <div className="rounded-lg p-3 shadow-sm" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[13px] font-medium" style={{ color: 'var(--text-tertiary)' }}>路由链路：</span>
              <span style={{ color: 'var(--accent-hover)' }}>{activeModel}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[13px] font-medium" style={{ color: 'var(--text-tertiary)' }}>出图画幅：</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{aspectRatio}</span>
            </div>
          </div>
        </div>

        {/* Global Prompts */}
        <div className="space-y-2">
           <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-tertiary)' }}>原始提示内容</p>
           {groupDetail.tasks?.map((t, idx) => (
             <div key={idx} className="rounded-lg p-3 shadow-sm relative group mb-2 text-[13px] leading-relaxed font-medium" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                {t.prompt || '暂无文字提示，可能是全参考图硬解码。'}
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button 
                     onClick={() => copyToClipboard(t.prompt || '')}
                     className="rounded shadow-sm px-1.5 py-0.5 text-[10px]"
                     style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)', color: 'var(--text-tertiary)' }}
                   >复制</button>
                </div>
             </div>
           ))}
        </div>

        {/* Reference Images */}
        {inputFiles.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-tertiary)' }}>输入底图参考</p>
            <div className="grid grid-cols-3 gap-2">
              {inputFiles.map((file, idx) => (
                 <div key={idx} className="relative aspect-square rounded overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
                    <img src={`/${file}`} className="w-full h-full object-cover" />
                 </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline Log */}
        <div className="space-y-2 pt-2 border-t border-dashed" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-tertiary)' }}>生命周期记录</p>
          <div className="flex justify-between items-center text-[12px] mb-1" style={{ color: 'var(--text-secondary)' }}>
            <span>开始执行</span>
            <span className="font-mono">{formatDate(groupDetail.created_at)}</span>
          </div>
          <div className="flex justify-between items-center text-[12px] mb-1" style={{ color: 'var(--text-secondary)' }}>
            <span>末片下发完毕</span>
            <span className="font-mono">{groupDetail.status === 'completed' ? formatDate(groupDetail.updated_at) : '--:--'}</span>
          </div>
          <div className="flex justify-between items-center text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            <span>总计运行时长</span>
            <span className="font-mono" style={{ color: 'var(--success)' }}>{groupDetail.status === 'completed' ? getDuration() : '未截流'}</span>
          </div>
        </div>
      </div>

      {/* Advanced Action Bar */}
      <div className="absolute bottom-0 w-full p-4 space-y-2.5" style={{ background: 'var(--surface-1)', borderTop: '1px solid var(--border-subtle)', boxShadow: 'none' }}>
        <button 
          onClick={handleRemix}
          disabled={isRemixing}
          className="w-full py-2.5 rounded-xl font-semibold text-[13px] flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-50 active:scale-[0.97] hover:shadow-md"
          style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(99,102,241,0.2)', color: 'var(--accent-hover)' }}
        >
          <Edit3 size={14} /> {isRemixing ? '提取与装载参数打包中...' : '二次编辑再发车'}
        </button>
        
        <button 
          onClick={handleRecreate}
          className="w-full py-2.5 rounded-xl text-white font-semibold text-[13px] flex items-center justify-center gap-2 transition-all duration-300 active:scale-[0.97]"
          style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)', boxShadow: '0 4px 16px rgba(99, 102, 241, 0.25)' }}
          onMouseEnter={e => e.currentTarget.style.boxShadow = '0 6px 24px rgba(99, 102, 241, 0.4)'}
          onMouseLeave={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(99, 102, 241, 0.25)'}
        >
          <RefreshCw size={14} /> 原参无痕一键再生成
        </button>

        <button 
          onClick={handleDelete}
          className="w-full py-2 rounded-xl font-semibold text-[13px] transition-all duration-300 mt-2 flex items-center justify-center gap-1.5 active:scale-[0.97]"
          style={{ border: '1px solid rgba(248,113,113,0.2)', color: 'var(--error)' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <Trash2 size={13} /> 删除全盘任务关联
        </button>
      </div>
    </aside>
  );
}
