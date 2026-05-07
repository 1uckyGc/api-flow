import React, { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, Brain, Flame, Film, Clock, ChevronDown, Check, RefreshCw, Trash2 } from 'lucide-react';
import api from '../../api/client';
import useTaskStore from '../../stores/useTaskStore';
import { useProvider } from '../../hooks/useProvider';
import { getDefaultModel } from '../../constants/models';

const SECTION_PAGE_SIZE = 20;

export default function DetailPanel({ activeJobId }) {
  const provider = useProvider();
  const taskProgressMap = useTaskStore((s) => s.taskProgressMap);
  const [chainGroups, setChainGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [selectedVideos, setSelectedVideos] = useState(new Set());
  const [selectedExtends, setSelectedExtends] = useState(new Set());
  const [videoPrompt, setVideoPrompt] = useState("");
  const [extendPrompt, setExtendPrompt] = useState("");
  const [extendingVideo, setExtendingVideo] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [previewMedia, setPreviewMedia] = useState(null);

  const [videoEngine, setVideoEngine] = useState('veo');
  const [videoGrokDuration, setVideoGrokDuration] = useState(10);
  const [extendEngine, setExtendEngine] = useState('veo');
  const [extendGrokDuration, setExtendGrokDuration] = useState(10);

  // 层级折叠状态
  const [collapsedSections, setCollapsedSections] = useState({});
  // 每层分页可见数量
  const [sectionVisibleCounts, setSectionVisibleCounts] = useState({});

  const toggleSection = (key) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const showMore = (key) => {
    setSectionVisibleCounts((prev) => ({
      ...prev,
      [key]: (prev[key] || SECTION_PAGE_SIZE) + SECTION_PAGE_SIZE,
    }));
  };

  const fetchChain = async () => {
    if (!activeJobId) return;
    try {
      const res = await api.get(`/tasks/fission/${activeJobId}/chain`);
      setChainGroups(res.data);
    } catch (e) { console.error("加载裂变链失败", e); }
  };

  useEffect(() => {
    fetchChain();
  }, [activeJobId]);

  // 终态判断：所有 group 均为 completed / needs_review / failed 时停止高频轮询
  const allTerminal = useMemo(() => {
    if (chainGroups.length === 0) return false;
    const terminalStatuses = ['completed', 'needs_review', 'failed'];
    return chainGroups.every((g) => terminalStatuses.includes(g.status));
  }, [chainGroups]);

  useEffect(() => {
    if (allTerminal) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchChain();
    }, 3000);
    return () => clearInterval(timer);
  }, [activeJobId, allTerminal]);

  const rootGroup = chainGroups.find(g => g.id === activeJobId);
  if (!rootGroup) {
    return (
      <div className="flex-1 h-full bg-[var(--surface-0)] flex items-center justify-center">
        <div className="text-[var(--text-tertiary)] animate-pulse">努力加载中...</div>
      </div>
    );
  }

  const isFissionFailed = rootGroup.status === 'failed' && chainGroups.length <= 1;

  if (rootGroup.status === 'pending' || isFissionFailed) {
    return (
      <div className={`flex-1 h-full flex flex-col items-center justify-center relative overflow-hidden bg-[var(--surface-0)]`}>
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] blur-[120px] rounded-full animate-pulse ${isFissionFailed ? 'bg-red-600/10' : 'bg-indigo-600/10'}`}></div>
        <div className="relative w-48 h-48 mb-12">
          <div className={`absolute inset-0 border-4 rounded-full ${isFissionFailed ? 'border-red-500/20' : 'border-indigo-500/20'}`}></div>
          {!isFissionFailed && (
            <>
              <div className="absolute inset-0 border-t-4 border-indigo-500 rounded-full animate-spin [animation-duration:3s]"></div>
              <div className="absolute inset-4 border-b-4 border-fuchsia-500 rounded-full animate-spin [animation-duration:2s] [animation-direction:reverse]"></div>
              <div className="absolute inset-8 border-l-4 border-cyan-400 rounded-full animate-spin [animation-duration:1.5s]"></div>
            </>
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-4xl filter ${isFissionFailed ? 'drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'drop-shadow-[0_0_10px_rgba(99,102,241,0.8)]'}`}>
              {isFissionFailed ? <Flame size={32} /> : <Brain size={32} />}
            </span>
          </div>
        </div>
        <h3 className={`text-xl font-black mb-2 tracking-tight ${isFissionFailed ? 'text-[var(--error)]' : 'text-[var(--text-primary)]'}`}>
          {isFissionFailed ? '推理引擎发生异常' : '创意引擎正在深度推理'}
        </h3>
        <p className="text-[var(--text-tertiary)] text-sm mb-8 font-medium italic">「{rootGroup.title}」</p>
        <div className={`w-full max-w-lg bg-[var(--surface-1)] border rounded-2xl p-4 backdrop-blur-xl shadow-2xl space-y-2 ${isFissionFailed ? 'border-red-500/20' : 'border-[var(--border-subtle)]'}`}>
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2 mb-2">
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500/50"></div>
              <div className="w-2 h-2 rounded-full bg-yellow-500/50"></div>
              <div className="w-2 h-2 rounded-full bg-green-500/50"></div>
            </div>
            <span className="text-[10px] text-[var(--text-tertiary)] font-mono uppercase tracking-widest ml-1">DEEPSEEK REASONING LOGS</span>
          </div>
          <div className="h-24 overflow-y-auto font-mono text-[11px] space-y-1.5 custom-scrollbar">
            <div className="text-[var(--text-tertiary)] flex gap-2">
              <span className="text-indigo-400 opacity-50">[{new Date(rootGroup.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}]</span>
              <span className="text-[var(--text-secondary)]">系统初始化完成...</span>
            </div>
            <div className={`flex gap-2 ${isFissionFailed ? 'text-red-400/80' : 'text-[var(--text-tertiary)]'}`}>
              <span className={`${isFissionFailed ? 'text-red-500' : 'text-indigo-400'} opacity-50`}>[{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}]</span>
              <span className={`${isFissionFailed ? 'text-red-300' : 'text-indigo-300'} font-bold`}>{isFissionFailed ? '阻断报告:' : '思维碎片:'}</span>
              <span className={`${isFissionFailed ? 'text-red-100' : 'text-[var(--text-secondary)]'} animate-in fade-in slide-in-from-left-1 duration-500`}>
                {taskProgressMap[`group_${rootGroup.id}`] || rootGroup.progress_message || (isFissionFailed ? "由于网络或认证问题，推理链条已中断" : "正在等待 DeepSeek 推理回传...")}
              </span>
            </div>
            {(taskProgressMap[`group_${rootGroup.id}`] || rootGroup.progress_message) && (
              <div className="text-emerald-400/80 animate-pulse flex gap-2 pl-14 font-bold">
                <span>» 执行注入: 语义发散与光影解构...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const imageGroups = chainGroups.filter(g => !g.fission_parent_id || g.fission_stage === 'images');
  const videoGroups = chainGroups.filter(g => g.fission_stage === 'videos');
  const extendGroups = chainGroups.filter(g => g.fission_stage === 'extended' || g.config_json?.isExtension);

  const images = imageGroups.flatMap(g => g.tasks || []);
  const videos = videoGroups.flatMap(g => g.tasks || []);
  const extends_ = extendGroups.flatMap(g => g.tasks || []);

  const toggleSelection = (setFn, id, e) => {
    e.stopPropagation();
    setFn(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDownload = (tasks, idOrSet = null) => {
    let toDownload = [];
    if (idOrSet === null) toDownload = tasks.filter(t => t.status === 'success' && t.output_file);
    else if (idOrSet instanceof Set) toDownload = tasks.filter(t => idOrSet.has(t.id) && t.status === 'success' && t.output_file);
    else {
      const target = tasks.find(t => t.id === idOrSet);
      if (target && target.status === 'success' && target.output_file) toDownload = [target];
    }
    if (toDownload.length === 0) return alert("没有可下载的成品");
    toDownload.forEach((t, i) => {
      setTimeout(() => {
        const url = t.output_file;
        const link = document.createElement('a');
        link.href = url;
        link.download = `followmeeeaigc_${t.id.substring(0,8)}.${url.split('.').pop()}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, i * 300);
    });
  };

  const handleVideoHover = (e, play) => {
    const vid = e.currentTarget.querySelector('video');
    if (vid) {
      if (play) {
        if (!vid.src && vid.dataset.src) vid.src = vid.dataset.src;
        vid.play().catch(()=>{});
      } else {
        vid.pause();
        vid.currentTime = 0;
      }
    }
  };

  const handleGenerateVideo = async () => {
    if (selectedImages.size === 0) return alert('请勾选图像！');
    if (!videoPrompt.trim()) return alert('请输入视频生成提示词！');
    setGeneratingVideo(true);
    const targetImages = images.filter(img => selectedImages.has(img.id));
    
    let model = rootGroup.config_json?.videoModel || getDefaultModel(provider, 'fission_video');
    let grok_mode = undefined;
    let seconds = undefined;

    if (videoEngine === 'grok') {
      model = "grok-imagine-video";
      grok_mode = "i2v";
      seconds = videoGrokDuration;
    }

    const taskGroupData = {
      title: `图生视频(${targetImages.length}条)`,
      task_type: "image_to_video",
      source: "GALLERY",
      config_json: {
        model,
        grok_mode,
        seconds,
        fission_parent_id: rootGroup.id,
        fission_stage: "videos"
      },
      tasks: targetImages.map(img => ({ prompt: videoPrompt.trim(), input_files: [img.output_file] }))
    };
    try {
      await api.post('/tasks/', taskGroupData);
      setSelectedImages(new Set());
      setVideoPrompt("");
      fetchChain();
    } catch (e) { alert("视频任务发起失败"); } finally { setGeneratingVideo(false); }
  };

  const handleExtendVideo = async () => {
    if (selectedVideos.size === 0) return alert('请勾选视频！');
    if (!extendPrompt.trim()) return alert('请输入延展提示词！');
    setExtendingVideo(true);
    const targetVids = videos.filter(vid => selectedVideos.has(vid.id));

    let model = rootGroup.config_json?.videoModel || getDefaultModel(provider, 'fission_video');
    let grok_mode = undefined;
    let seconds = undefined;

    if (extendEngine === 'grok') {
      model = "grok-imagine-video";
      grok_mode = "i2v";
      seconds = extendGrokDuration;
    }

    const taskGroupData = {
      title: `视频延展(${targetVids.length}条)`,
      task_type: "image_to_video",
      source: "GALLERY_EXTEND",
      config_json: {
        isExtension: true,
        model,
        grok_mode,
        seconds,
        fission_parent_id: rootGroup.id,
        fission_stage: "extended"
      },
      tasks: targetVids.map(vid => ({ prompt: extendPrompt.trim(), input_files: [vid.output_file] }))
    };
    try {
      await api.post('/tasks/', taskGroupData);
      setSelectedVideos(new Set());
      setExtendPrompt("");
      fetchChain();
    } catch (e) { alert("延展发起失败"); } finally { setExtendingVideo(false); }
  };

  const handleRetryTask = async (taskId, e) => {
    e.stopPropagation();
    try {
      await api.post(`/tasks/item/${taskId}/retry`);
      fetchChain();
    } catch (e) { alert("重试发起失败"); }
  };

  const handleDeleteTask = async (taskId, e) => {
    e.stopPropagation();
    if (!window.confirm("确定要删除这张卡片及其物理文件吗？")) return;
    try {
      await api.delete(`/tasks/item/${taskId}`);
      fetchChain();
    } catch (e) { alert("删除失败"); }
  };

  const handleRetryAllFailed = async (tasks, e) => {
    e.stopPropagation();
    const failedTasks = tasks.filter(t => t.status === 'failed');
    if (failedTasks.length === 0) return;
    try {
      await Promise.all(failedTasks.map(t => api.post(`/tasks/item/${t.id}/retry`)));
      fetchChain();
    } catch (e) { alert("批量重试失败"); }
  };

  const selectAll = (tasks, setFn) => setFn(new Set(tasks.filter(t => t.status === 'success').map(t => t.id)));
  const invertSelection = (tasks, setFn, currentSet) => {
    const validIds = tasks.filter(t => t.status === 'success').map(t => t.id);
    const next = new Set();
    validIds.forEach(id => { if (!currentSet.has(id)) next.add(id); });
    setFn(next);
  };

  const renderMediaGrid = (items, selectedSet, setSelectedFn, colorTheme, label, sectionKey) => {
    const isCollapsed = collapsedSections[sectionKey];
    if (isCollapsed) return null;
    const limit = sectionVisibleCounts[sectionKey] || SECTION_PAGE_SIZE;
    const visibleItems = items.slice(0, limit);
    const hasMore = items.length > limit;

    return (
      <>
        <div className="grid grid-cols-5 gap-3">
          {visibleItems.map(task => (
            <div key={task.id}
              onMouseEnter={label !== 'image' ? e => handleVideoHover(e, true) : undefined}
              onMouseLeave={label !== 'image' ? e => handleVideoHover(e, false) : undefined}
              onClick={() => task.status === 'success' && setPreviewMedia({type: label === 'image' ? 'image' : 'video', url: task.output_file})}
              className={`aspect-[9/16] bg-[var(--surface-1)] rounded-xl border-2 relative group overflow-hidden cursor-pointer ${selectedSet.has(task.id) ? `border-${colorTheme}-500` : 'border-[var(--border-subtle)]'}`}
            >
              {task.status === 'success' ? (
                label === 'image'
                  ? <img src={task.output_file} className="w-full h-full object-cover" loading="lazy" />
                  : <video 
                        className="w-full h-full object-cover" 
                        muted loop 
                        preload="none" 
                        poster={task.output_thumbnail ? `/${task.output_thumbnail}` : `/${task.output_file}#t=0.001`} 
                        data-src={task.output_file} 
                      />
              ) : task.status === 'failed' ? (
                <div className="flex flex-col items-center justify-center w-full h-full bg-red-500/10 text-red-500/80 p-2 text-center text-[10px] leading-relaxed overflow-y-auto custom-scrollbar">
                  <AlertTriangle size={20} className="mb-1" />
                  <span className="font-bold mb-1">生成失败</span>
                  <span className="opacity-70">{task.error_message || '未知错误'}</span>
                </div>
              ) : (
                <div className={`flex flex-col items-center justify-center w-full h-full bg-${colorTheme}-500/5`}>
                  <div className={`w-6 h-6 border-2 border-${colorTheme}-500/30 border-t-${colorTheme}-500 rounded-full animate-spin mb-2`}></div>
                  {(() => {
                    const progMsg = taskProgressMap?.[task.id] || '';
                    let retryBadge = null;
                    let displayMsg = label === 'image' ? '正在生成图像...' : label === 'video' ? '正在生成视频...' : '正在视频延展...';
                    if (progMsg) {
                      const retryMatch = progMsg.match(/\[重试\s(\d+\/\d+)\]/);
                      if (retryMatch) {
                        retryBadge = retryMatch[1];
                      }
                    }
                    return (
                      <div className="flex flex-col items-center">
                        <span className={`text-[10px] text-${colorTheme}-400 font-bold animate-pulse`}>
                          {displayMsg}
                        </span>
                        {retryBadge && (
                          <span className={`text-[9px] text-orange-400 font-bold mt-1 tracking-wider bg-orange-500/10 px-1 py-0.5 rounded border border-orange-500/20`}>
                            重试 {retryBadge}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
              <div onClick={(e) => toggleSelection(setSelectedFn, task.id, e)} className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-all z-10 ${selectedSet.has(task.id) ? `bg-${colorTheme}-500 border-${colorTheme}-500` : 'border-white/50 bg-black/60 opacity-0 group-hover:opacity-100'}`}>
                {selectedSet.has(task.id) && <Check size={14} strokeWidth={3} className="text-white" />}
              </div>

              {/* 原子级操作浮层 */}
              <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                {task.status === 'failed' && (
                  <button 
                    onClick={(e) => handleRetryTask(task.id, e)}
                    className="p-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg shadow-lg backdrop-blur-md transition-all active:scale-90"
                    title="重试此项"
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
                <button 
                  onClick={(e) => handleDeleteTask(task.id, e)}
                  className="p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded-lg shadow-lg backdrop-blur-md transition-all active:scale-90"
                  title="删除此项"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
        {hasMore && (
          <button
            onClick={() => showMore(sectionKey)}
            className="mt-3 w-full py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--surface-1)] hover:bg-[var(--surface-2)] rounded-lg transition-colors"
          >
            加载更多 ({items.length - limit} 张剩余)
          </button>
        )}
      </>
    );
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[var(--surface-0)] text-[var(--text-secondary)] custom-scrollbar relative">
      <div className="max-w-[1400px] mx-auto p-8 space-y-8 pb-32">
        <div className="border-b border-[var(--border-subtle)] pb-4">
          <h1 className="text-2xl font-black text-[var(--text-primary)]">{rootGroup.title}</h1>
          <p className="text-[var(--text-tertiary)] text-xs mt-1">
            <span className="bg-[var(--accent-subtle)] text-[var(--accent)] px-2 py-0.5 rounded text-[10px] font-bold ring-1 ring-[var(--border-subtle)] mr-2">FSN-{rootGroup.id?.substring(0,8)}</span>
          </p>
        </div>

        {/* 图像层 */}
        <div className="bg-[var(--surface-2)] rounded-2xl p-5 border border-[var(--border-subtle)] shadow-xl relative">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-fuchsia-500 rounded-l-2xl"></div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2 cursor-pointer select-none group/title" onClick={() => toggleSection('images')}>
              <ChevronDown 
                size={16} 
                className={`text-[var(--text-tertiary)] transition-transform duration-300 ${collapsedSections['images'] ? '-rotate-90' : 'rotate-0'}`} 
              />
              <span className="bg-fuchsia-500/20 text-fuchsia-400 px-2 py-0.5 rounded text-[10px]">图像层</span>
              裂变图像 ({images.length})
            </h2>
            <div className="flex items-center gap-2">
              {images.some(t => t.status === 'failed') && (
                <button onClick={(e) => handleRetryAllFailed(images, e)} className="text-[10px] bg-red-500/10 text-red-500 hover:bg-red-500/20 px-2 py-0.5 rounded transition-colors flex items-center gap-1">
                  <RefreshCw size={10} /> 重试所有失败项
                </button>
              )}
              <button onClick={() => selectAll(images, setSelectedImages)} className="text-[10px] text-[var(--text-tertiary)] hover:text-fuchsia-400 bg-[var(--surface-1)] px-2 py-0.5 rounded transition-colors">全选</button>
              <button onClick={() => invertSelection(images, setSelectedImages, selectedImages)} className="text-[10px] text-[var(--text-tertiary)] hover:text-fuchsia-400 bg-[var(--surface-1)] px-2 py-0.5 rounded transition-colors">反选</button>
              <button onClick={() => handleDownload(images, selectedImages)} className="text-xs bg-fuchsia-500/10 text-fuchsia-400 px-3 py-1.5 rounded-lg font-semibold hover:bg-fuchsia-500/20 transition-all">下载选中 ({selectedImages.size})</button>
            </div>
          </div>
          {renderMediaGrid(images, selectedImages, setSelectedImages, 'fuchsia', 'image', 'images')}
          {selectedImages.size > 0 && (
            <div className="mt-4 p-4 bg-[var(--surface-1)] rounded-xl border border-[var(--border-subtle)] space-y-3">
              <div className="flex items-center gap-3 mb-2">
                <label className="text-[11px] font-bold text-gray-300">生成引擎:</label>
                <div className="flex gap-1.5 p-1 rounded-lg" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                  <button
                    onClick={() => setVideoEngine('veo')}
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${videoEngine === 'veo' ? 'bg-fuchsia-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    Veo 3.1 Relax
                  </button>
                  <button
                    onClick={() => setVideoEngine('grok')}
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${videoEngine === 'grok' ? 'bg-fuchsia-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    Grok Video
                  </button>
                </div>
                {videoEngine === 'grok' && (
                  <div className="flex gap-1.5 p-1 rounded-lg" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                    <button
                      onClick={() => setVideoGrokDuration(6)}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${videoGrokDuration === 6 ? 'bg-fuchsia-400 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                      6 秒
                    </button>
                    <button
                      onClick={() => setVideoGrokDuration(10)}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${videoGrokDuration === 10 ? 'bg-fuchsia-400 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                      10 秒
                    </button>
                  </div>
                )}
              </div>
              <textarea value={videoPrompt} onChange={e => setVideoPrompt(e.target.value)} placeholder="输入图生视频提示词..." className="w-full bg-[var(--surface-0)] border border-[var(--border-default)] rounded-lg p-3 text-xs text-[var(--text-primary)] custom-scrollbar focus:outline-none focus:border-[var(--accent)]" />
              <button onClick={handleGenerateVideo} disabled={generatingVideo} className="w-full bg-fuchsia-600 py-2 rounded-lg text-xs font-bold">{generatingVideo ? '发车中...' : <span className="flex items-center justify-center gap-1"><Film size={13} /> 开启批量视频生成</span>}</button>
            </div>
          )}
        </div>

        {/* 视频层 */}
        {videos.length > 0 && (
          <div className="bg-[var(--surface-2)] rounded-2xl p-5 border border-[var(--border-subtle)] shadow-xl relative">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500 rounded-l-2xl"></div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2 cursor-pointer select-none group/title" onClick={() => toggleSection('videos')}>
                <ChevronDown 
                  size={16} 
                  className={`text-[var(--text-tertiary)] transition-transform duration-300 ${collapsedSections['videos'] ? '-rotate-90' : 'rotate-0'}`} 
                />
                <span className="bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded text-[10px]">视频层</span>
                衍生视频 ({videos.length})
              </h2>
               <div className="flex items-center gap-2">
                {videos.some(t => t.status === 'failed') && (
                  <button onClick={(e) => handleRetryAllFailed(videos, e)} className="text-[10px] bg-red-500/10 text-red-500 hover:bg-red-500/20 px-2 py-0.5 rounded transition-colors flex items-center gap-1">
                    <RefreshCw size={10} /> 重试所有失败项
                  </button>
                )}
                <button onClick={() => selectAll(videos, setSelectedVideos)} className="text-[10px] text-[var(--text-tertiary)] hover:text-cyan-400 bg-[var(--surface-1)] px-2 py-0.5 rounded transition-colors">全选</button>
                <button onClick={() => invertSelection(videos, setSelectedVideos, selectedVideos)} className="text-[10px] text-[var(--text-tertiary)] hover:text-cyan-400 bg-[var(--surface-1)] px-2 py-0.5 rounded transition-colors">反选</button>
                <button onClick={() => handleDownload(videos, selectedVideos)} className="text-xs bg-cyan-500/10 text-cyan-400 px-3 py-1.5 rounded-lg font-semibold hover:bg-cyan-500/20 transition-all">下载选中 ({selectedVideos.size})</button>
              </div>
            </div>
            {renderMediaGrid(videos, selectedVideos, setSelectedVideos, 'cyan', 'video', 'videos')}
            {selectedVideos.size > 0 && (
              <div className="mt-4 p-4 bg-[var(--surface-1)] rounded-xl border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center gap-3 mb-2">
                  <label className="text-[11px] font-bold text-gray-300">延展引擎:</label>
                  <div className="flex gap-1.5 p-1 rounded-lg" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                    <button
                      onClick={() => setExtendEngine('veo')}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${extendEngine === 'veo' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                      Veo 3.1 Relax
                    </button>
                    <button
                      onClick={() => setExtendEngine('grok')}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${extendEngine === 'grok' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                      Grok Video
                    </button>
                  </div>
                  {extendEngine === 'grok' && (
                    <div className="flex gap-1.5 p-1 rounded-lg" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                      <button
                        onClick={() => setExtendGrokDuration(6)}
                        className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${extendGrokDuration === 6 ? 'bg-cyan-400 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                      >
                        6 秒
                      </button>
                      <button
                        onClick={() => setExtendGrokDuration(10)}
                        className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${extendGrokDuration === 10 ? 'bg-cyan-400 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                      >
                        10 秒
                      </button>
                    </div>
                  )}
                </div>
                <textarea value={extendPrompt} onChange={e => setExtendPrompt(e.target.value)} placeholder="输入延展提示词..." className="w-full bg-[var(--surface-0)] border border-[var(--border-default)] rounded-lg p-3 text-xs text-[var(--text-primary)] custom-scrollbar focus:outline-none focus:border-[var(--accent)]" />
                <button onClick={handleExtendVideo} disabled={extendingVideo} className="w-full bg-cyan-600 py-2 rounded-lg text-xs font-bold">{extendingVideo ? '延展中...' : <span className="flex items-center justify-center gap-1"><Clock size={13} /> 开启视频延展</span>}</button>
              </div>
            )}
          </div>
        )}

        {/* 成品层 */}
        {extends_.length > 0 && (
          <div className="bg-[var(--surface-2)] rounded-2xl p-5 border border-[var(--border-subtle)] shadow-xl relative">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 rounded-l-2xl"></div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2 cursor-pointer select-none group/title" onClick={() => toggleSection('extends')}>
                <ChevronDown 
                  size={16} 
                  className={`text-[var(--text-tertiary)] transition-transform duration-300 ${collapsedSections['extends'] ? '-rotate-90' : 'rotate-0'}`} 
                />
                <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-[10px]">成品层</span>
                延展视频 ({extends_.length})
              </h2>
              <div className="flex items-center gap-2">
                {extends_.some(t => t.status === 'failed') && (
                  <button onClick={(e) => handleRetryAllFailed(extends_, e)} className="text-[10px] bg-red-500/10 text-red-500 hover:bg-red-500/20 px-2 py-0.5 rounded transition-colors flex items-center gap-1">
                    <RefreshCw size={10} /> 重试所有失败项
                  </button>
                )}
                <button onClick={() => selectAll(extends_, setSelectedExtends)} className="text-[10px] text-[var(--text-tertiary)] hover:text-emerald-400 bg-[var(--surface-1)] px-2 py-0.5 rounded transition-colors">全选</button>
                <button onClick={() => invertSelection(extends_, setSelectedExtends, selectedExtends)} className="text-[10px] text-[var(--text-tertiary)] hover:text-emerald-400 bg-[var(--surface-1)] px-2 py-0.5 rounded transition-colors">反选</button>
                <button onClick={() => handleDownload(extends_, selectedExtends)} className="text-xs bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg font-semibold hover:bg-emerald-500/20 transition-all">下载选中 ({selectedExtends.size})</button>
              </div>
            </div>
            {renderMediaGrid(extends_, selectedExtends, setSelectedExtends, 'emerald', 'extend', 'extends')}
          </div>
        )}
      </div>

      {previewMedia && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4" onClick={() => setPreviewMedia(null)}>
          {previewMedia.type === 'image' ? <img src={previewMedia.url} className="max-w-full max-h-full object-contain" /> : <video src={previewMedia.url} className="max-w-full max-h-full object-contain" controls autoPlay loop />}
        </div>
      )}
    </div>
  );
}
