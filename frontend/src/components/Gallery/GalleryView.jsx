import React, { useState, useEffect } from 'react';
import { Film, Palette, AlertTriangle, Play, Camera, Loader, Download, CheckCircle, XCircle, Zap, Check } from 'lucide-react';
import useTaskStore from '../../stores/useTaskStore';
import api from '../../api/client';
import InspectorPanel from './InspectorPanel';

export default function GalleryView() {
  const activeGroupId = useTaskStore((s) => s.activeGroupId);
  const taskGroups = useTaskStore((s) => s.taskGroups);
  const taskProgressMap = useTaskStore((s) => s.taskProgressMap);
  const [selectedTasks, setSelectedTasks] = useState(new Set());
  const [groupDetail, setGroupDetail] = useState(null);
  const [downloading, setDownloading] = useState(false);
  
  const group = taskGroups.find(g => g.id === activeGroupId);

  // 清除选中状态并拉取明细
  useEffect(() => {
    setSelectedTasks(new Set());
    setGroupDetail(null);
    if (activeGroupId) {
      api.get(`/tasks/${activeGroupId}`).then((res) => {
        setGroupDetail(res.data);
      }).catch(err => {
        console.error('Failed to fetch group details', err);
      });
    }
  }, [activeGroupId, taskGroups]);

  if (!group && !groupDetail) return null;

  const currentGroup = groupDetail || group;

  const toggleSelect = (taskId) => {
    const newSet = new Set(selectedTasks);
    if (newSet.has(taskId)) {
      newSet.delete(taskId);
    } else {
      newSet.add(taskId);
    }
    setSelectedTasks(newSet);
  };

  const handleDownload = async (urls) => {
    setDownloading(true);
    try {
      for (const url of urls) {
        if (!url) continue;
        const response = await fetch(`/${url}`);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = url.split('/').pop() || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
        // 延迟 500 毫秒，防止浏览器触发“并发下载恶意拦截”
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('Download failed:', e);
      alert('下载出错，请检查控制台网络。');
    } finally {
      setDownloading(false);
      setSelectedTasks(new Set()); // 下载后清空选择，营造动作已完成的心流
    }
  };

  const handleDownloadAll = () => {
    const validUrls = tasks.filter(t => t.status === 'SUCCESS' || t.status === 'success').map(t => t.output_file).filter(Boolean);
    if (validUrls.length > 0) {
      handleDownload(validUrls);
    } else {
      alert("没有可下载的完成项");
    }
  };

  const handleDownloadSelected = () => {
    const validUrls = tasks.filter(t => selectedTasks.has(t.id) && (t.status === 'SUCCESS' || t.status === 'success')).map(t => t.output_file).filter(Boolean);
    if (validUrls.length > 0) {
      handleDownload(validUrls);
    } else {
      alert("没有选中已完成的项");
    }
  };

  const cfgModel = currentGroup.config_json?.model || '';
  const grokMode = currentGroup.config_json?.grok_mode || '';
  const isVideo = cfgModel.includes('t2v') || cfgModel.includes('i2v') || cfgModel === 'grok-imagine-video' || grokMode === 't2v' || grokMode === 'i2v';
  const TypeIcon = isVideo ? Film : Palette;

  const tasks = currentGroup.tasks || [];

  return (
    <div className="flex-1 flex h-full fade-in">
      {/* 左侧画廊主域 */}
      <div className="flex-1 flex flex-col relative h-full overflow-hidden" style={{ background: 'var(--surface-0)' }}>
        <header className="px-6 py-5 flex justify-between items-start flex-shrink-0" style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{currentGroup.title}</h1>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1" style={isVideo ? { color: 'var(--warning)', background: 'rgba(251,191,36,0.12)' } : { background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }}>
              <TypeIcon size={13} /> {currentGroup.status === 'completed' ? '已完成' : (currentGroup.status === 'needs_review' ? '待验收' : '处理中')}
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {currentGroup.global_prompt ? `需求：${currentGroup.global_prompt}` : `共 ${currentGroup.total_count} 个任务项`}
          </p>
        </div>
        <div className="flex gap-2">
          {isVideo && (
            <button 
              onClick={handleDownloadAll}
              disabled={downloading}
              className="font-medium py-2 px-4 rounded-lg text-[13px] transition-all duration-300 flex items-center gap-1.5 disabled:opacity-50 active:scale-95"
              style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Download size={14} /> {downloading ? '批量下发中...' : '全部下载'}
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 p-6 overflow-y-auto pb-32">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {tasks.map((task, idx) => {
            const isSelected = selectedTasks.has(task.id);
            const isDone = task.status === 'SUCCESS' || task.status === 'success';
            const isFailed = task.status === 'FAILED' || task.status === 'failed';
            
            return (
              <div 
                key={task.id} 
                className={`stagger-item aspect-916 relative bg-gray-900 rounded-xl overflow-hidden ${isDone ? 'cursor-pointer group' : ''} transition-[box-shadow,border-color] duration-300 ${isSelected ? 'border-2 border-indigo-500 ring-2 ring-[var(--accent)]/40 scale-[0.97] shadow-[0_0_20px_rgba(99,102,241,0.15)]' : (isFailed ? 'border-2 border-red-500/30' : 'border-2 border-transparent hover:border-[var(--border-strong)] hover:shadow-xl')}`}
                style={{ animationDelay: `${idx * 60}ms` }}
                onClick={() => isDone && toggleSelect(task.id)}
                onMouseEnter={(e) => { const v = e.currentTarget.querySelector('video'); if(v) v.play().catch(()=>{}); }}
                onMouseLeave={(e) => { const v = e.currentTarget.querySelector('video'); if(v) v.pause(); }}
              >
                {/* 背景渐变图 / 或者真实的预览图 */}
                {isDone && task.output_file ? (
                   isVideo ? (
                     <video src={`/${task.output_file}#t=0.001`} className="absolute w-full h-full object-cover opacity-80" loop muted playsInline preload="metadata" />
                   ) : (
                     <img src={`/${task.output_file}`} className="absolute w-full h-full object-cover opacity-80" loading="lazy" />
                   )
                ) : (
                   <div className={`absolute inset-0 bg-gradient-to-br ${isFailed ? 'from-red-500/20 to-gray-800/50' : 'from-indigo-500/20 to-purple-600/30'} opacity-40`}></div>
                )}
                
                {/* Overlay Icons */}
                <div className="absolute inset-0 flex items-center justify-center opacity-40 group-hover:opacity-60 transition-opacity duration-300" style={{ color: isFailed ? 'var(--error)' : 'white' }}>
                  {isFailed ? <AlertTriangle size={32} /> : (isDone ? (isVideo ? <Play size={32} /> : <Camera size={32} />) : <Loader size={28} className="animate-spin" />)}
                </div>

                {isSelected && <div className="absolute inset-0 bg-indigo-500/10"></div>}

                {/* status badges */}
                <div className="absolute top-3 left-3">
                  {isDone && <span className="text-[10px] font-bold bg-emerald-500 text-white px-2 py-0.5 rounded-lg flex items-center gap-0.5"><CheckCircle size={10} /> 已生成</span>}
                  {isFailed && <span className="text-[10px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-lg flex items-center gap-0.5"><XCircle size={10} /> 失败</span>}
                </div>

                {isDone && (
                  <div className={`absolute top-3 right-3 w-7 h-7 rounded-full border-2 flex items-center justify-center shadow-lg transition-all duration-300 ${isSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-black/30 border-white/50 text-transparent group-hover:bg-black/40'}`}>
                    <Check size={14} strokeWidth={3} />
                  </div>
                )}
                
                {isFailed && (
                   <div className="absolute inset-0 flex flex-col items-center justify-center mt-12 gap-2">
                     <span className="text-xs text-red-300 font-medium truncate max-w-[80%] px-2 text-center">{task.error_message || '生成失败'}</span>
                   </div>
                )}

                <div className="absolute bottom-0 w-full p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none">
                  <p className="text-xs text-white font-medium truncate" title={task.prompt}>{task.prompt || '默认提示词'}</p>
                  <div className="flex justify-between items-center mt-0.5">
                    <p className="text-[10px] text-white/60 truncate max-w-[40%]">{currentGroup.config_json?.model || '未知模型'}</p>
                    <p className={`text-[10px] font-medium truncate text-right ml-2 ${isDone ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-indigo-300 animate-pulse'}`} title={taskProgressMap?.[task.id]}>
                      {isDone ? '解析完成' : isFailed ? '终止' : (taskProgressMap?.[task.id] || '云端握手中...')}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部动作栏 */}
      <div className={`action-bar absolute bottom-6 left-1/2 -translate-x-1/2 w-[85%] max-w-4xl rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] p-3.5 flex items-center gap-3 z-50 transition-all ${selectedTasks.size === 0 ? 'translate-y-20 opacity-0 pointer-events-none' : ''}`} style={{ background: 'rgba(14,16,21,0.9)', border: '1px solid var(--border-default)', backdropFilter: 'blur(12px)' }}>
        <div className="font-bold px-4 py-2.5 rounded-xl whitespace-nowrap text-sm" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }}>
          已选 <span className="text-base">{selectedTasks.size}</span> 项
        </div>
        {!isVideo ? (
          <>
            <div className="flex-1">
              <input type="text" className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400 transition-all" placeholder="输入下一步视频镜头提示词..." style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
            </div>
            <button className="hover:shadow-lg hover:shadow-indigo-500/25 text-white font-semibold py-2.5 px-6 rounded-xl shadow-md transition-all duration-300 whitespace-nowrap flex items-center gap-1.5 text-sm active:scale-95" style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)' }}>
              <Zap size={14} /> 批量生视频
            </button>
          </>
        ) : (
          <>
            <div className="flex-1"></div>
            <button 
              onClick={handleDownloadSelected}
              disabled={downloading}
              className="hover:shadow-lg hover:shadow-indigo-500/25 text-white font-semibold py-2.5 px-6 rounded-xl shadow-md transition-all duration-300 whitespace-nowrap flex items-center gap-1.5 text-sm disabled:opacity-50 active:scale-95"
              style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)' }}
            >
              <Download size={14} /> {downloading ? '分发拉取中...' : '下载选中'}
            </button>
          </>
        )}
      </div>
      
      </div>

      {/* 右侧参数与实体洞察器 */}
      <InspectorPanel groupDetail={currentGroup} />
    </div>
  );
}
