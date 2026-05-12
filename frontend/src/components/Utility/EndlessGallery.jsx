import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CheckCheck, Shuffle, Trash2, Film, RefreshCw, Download,
  ArrowRight, Sparkles, Clock, AlertTriangle, X, CheckSquare, ImagePlus
} from 'lucide-react';
import useTaskStore from '../../stores/useTaskStore';
import api from '../../api/client';
import { useProvider } from '../../hooks/useProvider';
import { getDefaultModel } from '../../constants/models';
import FolderPickerBar from '../FolderPickerBar';
import { useAutoSaveFolder } from '../../hooks/useAutoSaveFolder';

/**
 * 无尽画廊 —— 按时间倒序平铺展示当前模式下所有历史生成结果。
 * 采用 Pinterest / 小红书风格瀑布流网格。
 */
export default function EndlessGallery() {
  const provider = useProvider();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const taskGroups = useTaskStore((s) => s.taskGroups);
  const taskProgressMap = useTaskStore((s) => s.taskProgressMap);
  const setDraftData = useTaskStore((s) => s.setDraftData);
  const fetchTaskGroups = useTaskStore((s) => s.fetchTaskGroups);

  const [selectedTasks, setSelectedTasks] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewCard, setPreviewCard] = useState(null);
  const [extendMode, setExtendMode] = useState(false);
  const [extendPrompt, setExtendPrompt] = useState('');
  const [extending, setExtending] = useState(false);
  const [batchPrompt, setBatchPrompt] = useState('');
  const [batching, setBatching] = useState(false);
  const [extendEngine, setExtendEngine] = useState('veo'); // 'veo' | 'grok'
  const [grokDuration, setGrokDuration] = useState(10); // 6 | 10
  const [batchEngine, setBatchEngine] = useState('veo');
  const [batchGrokDuration, setBatchGrokDuration] = useState(10);
  const [columnCount, setColumnCount] = useState(() => {
    const saved = localStorage.getItem('endless_gallery_cols');
    return saved ? parseInt(saved, 10) : 5;
  });
  const isCompact = columnCount >= 10;

  useEffect(() => {
    localStorage.setItem('endless_gallery_cols', columnCount.toString());
  }, [columnCount]);

  // Dreamina 并发状态指示器：5s 轮询 /api/dreamina/concurrency
  // 后端用 Redis semaphore 全局限制 5 并发，超出 in flight 数会排队
  const [dreaminaState, setDreaminaState] = useState({ max: 5, in_flight: 0, waiting: 0, available: true });
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.get('/dreamina/concurrency');
        if (alive && r.data) setDreaminaState(r.data);
      } catch (e) { /* 静默 */ }
    };
    tick();
    const t = setInterval(() => { if (document.visibilityState === 'visible') tick(); }, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // 批量操作 Tab
  const [batchTab, setBatchTab] = useState('i2i'); // 'i2i' | 'i2v' | 'extend' | 'download' | 'delete'
  // 图生图批量配置
  const [batchI2iModel, setBatchI2iModel] = useState('gemini-3.0-pro-image');
  const [batchI2iResolution, setBatchI2iResolution] = useState('standard');
  const [batchI2iAspectRatio, setBatchI2iAspectRatio] = useState('9:16');
  const [batchRefFile, setBatchRefFile] = useState(null);
  const [batchRefPreview, setBatchRefPreview] = useState(null);
  const batchRefInputRef = useRef(null);

  // 记录上一次点击的卡片索引，用于 Shift 范围连选
  const lastSelectedIndex = useRef(null);

  // 动态计算每次加载的数量，保证填满完整的行（至少 20 张）
  const getPageSize = useCallback((cols) => Math.max(20, Math.ceil(20 / cols) * cols), []);
  const [visibleCount, setVisibleCount] = useState(() => getPageSize(columnCount));
  const observerRef = useRef(null);

  // callback ref 模式：每次 sentinel DOM 节点真正出现/消失时都会执行
  const sentinelCallbackRef = useCallback((node) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => prev + getPageSize(columnCount));
        }
      },
      { rootMargin: '200px' }
    );
    observerRef.current.observe(node);
  }, [columnCount, getPageSize]);

  useEffect(() => {
    // 切换页面时重置加载数量到第一页
    setVisibleCount(getPageSize(columnCount));
  }, [pathname, columnCount, getPageSize]);

  const handleBatchAction = async (actionType) => {
    if (!batchPrompt.trim() || selectedTasks.size === 0) return;
    
    const selectedCards = allCards.filter(c => selectedTasks.has(c.id));
    if (selectedCards.length === 0) return;

    setBatching(true);
    
    const isExtension = actionType === 'EXTEND';
    const firstCard = selectedCards[0];
    const aspectRatio = firstCard.groupConfig?.aspect_ratio || '9:16';
    
    let model = '';
    let config_json = {
      isExtension: isExtension,
      aspect_ratio: aspectRatio,
      images_per_prompt: 1
    };

    if (batchEngine === 'grok') {
      model = 'grok-imagine-video';
      config_json.model = model;
      config_json.grok_mode = 'i2v';
      config_json.seconds = batchGrokDuration;
    } else {
      const orientKey = aspectRatio === '16:9' ? 'toolbox_i2v_landscape' : 'toolbox_i2v_portrait';
      model = getDefaultModel(provider, orientKey);
      config_json.model = model;
    }

    const taskGroupData = {
      title: `${isExtension ? '[批量延展]' : '[批量生视频]'} ${batchPrompt.substring(0, 15)}`,
      task_type: 'image_to_video',
      source: isExtension ? 'GALLERY_EXTEND' : 'TOOLBOX',
      global_prompt: batchPrompt.trim(),
      config_json: config_json,
      tasks: selectedCards.map(card => ({
        prompt: batchPrompt.trim(),
        input_files: [card.output_file]
      }))
    };

    try {
      await api.post('tasks/', taskGroupData);
      setBatchPrompt('');
      setSelectedTasks(new Set());
      setSelectionMode(false);
      fetchTaskGroups();
    } catch (e) {
      console.error('Batch task creation failed', e);
      alert('批量任务创建失败');
    } finally {
      setBatching(false);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm("确定要删除该生成结果吗？物理文件也将被移除。")) return;
    try {
      await api.delete(`/tasks/item/${taskId}`);
      fetchTaskGroups();
    } catch (e) {
      console.error("Delete task failed", e);
      alert("删除失败");
    }
  };

  const handleBatchDelete = async () => {
    if (selectedTasks.size === 0) return alert('请先勾选要删除的任务');
    const n = selectedTasks.size;
    if (!window.confirm(`确定要批量删除选中的 ${n} 个任务吗？该操作不可逆。`)) return;

    setBatching(true);
    try {
      const res = await api.post('/tasks/batch-delete', Array.from(selectedTasks));
      setSelectedTasks(new Set());
      setSelectionMode(false);
      await fetchTaskGroups();
      alert(res.data?.message ? `已删除 ${n} 个任务` : `已删除 ${n} 个任务（无后端消息）`);
    } catch (e) {
      console.error("Batch delete failed", e);
      const msg = e.response?.data?.detail || e.message || '未知错误';
      alert(`批量删除失败：${msg}`);
    } finally {
      setBatching(false);
    }
  };

  const handleBatchI2I = async () => {
    if (!batchPrompt.trim() || selectedTasks.size === 0) return;

    const selectedImageCards = allCards.filter(
      c => selectedTasks.has(c.id) && !c.isVideo && (c.status === 'SUCCESS' || c.status === 'success')
    );
    if (selectedImageCards.length === 0) {
      alert('没有选中已完成的图片');
      return;
    }

    setBatching(true);

    let refPath = null;
    if (batchRefFile) {
      const formData = new FormData();
      formData.append('files', batchRefFile);
      try {
        const res = await api.post('/upload/', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        refPath = res.data.paths?.[0] || null;
      } catch (e) {
        console.error('Ref image upload failed', e);
        alert('参考图上传失败');
        setBatching(false);
        return;
      }
    }

    const isGrokEdit = batchI2iModel === 'grok-imagine-image-edit';
    let finalModel = batchI2iModel;
    if (!isGrokEdit) {
      const suffix = batchI2iAspectRatio === '16:9' ? '-landscape' : batchI2iAspectRatio === '1:1' ? '-square' : '-portrait';
      finalModel = batchI2iModel + suffix;
      if (batchI2iModel.includes('gemini')) {
        if (batchI2iResolution === '2k') finalModel += '-2k';
        if (batchI2iResolution === '4k') finalModel += '-4k';
      }
    }

    const taskGroupData = {
      title: `[批量图生图] ${batchPrompt.substring(0, 15)}`,
      task_type: 'image_to_image',
      source: 'TOOLBOX',
      global_prompt: batchPrompt.trim(),
      config_json: {
        model: finalModel,
        aspect_ratio: isGrokEdit ? null : batchI2iAspectRatio,
        images_per_prompt: 1,
        ...(isGrokEdit && { grok_mode: 'image_edit', grok_size: '1024x1024' }),
      },
      tasks: selectedImageCards.map(card => ({
        prompt: batchPrompt.trim(),
        input_files: refPath ? [card.output_file, refPath] : [card.output_file]
      }))
    };

    try {
      await api.post('tasks/', taskGroupData);
      setBatchPrompt('');
      if (batchRefPreview) URL.revokeObjectURL(batchRefPreview);
      setBatchRefFile(null);
      setBatchRefPreview(null);
      setSelectedTasks(new Set());
      setSelectionMode(false);
      fetchTaskGroups();
    } catch (e) {
      console.error('Batch I2I failed', e);
      alert('批量图生图创建失败');
    } finally {
      setBatching(false);
    }
  };

  const handleRetryTask = async (taskId) => {
    try {
      await api.post(`/tasks/item/${taskId}/retry`);
      fetchTaskGroups(); // Refresh task list to show QUEUED status
    } catch (error) {
      console.error("Retry failed", error);
      alert("重试触发失败");
    }
  };

  const handleSubmitExtend = async () => {
    if (!extendPrompt.trim() || !previewCard) return;
    setExtending(true);
    
    const aspectRatio = previewCard.groupConfig?.aspect_ratio || '9:16';
    
    let model = '';
    let config_json = {
      isExtension: true,
      aspect_ratio: aspectRatio,
      images_per_prompt: 1
    };

    if (extendEngine === 'grok') {
      model = 'grok-imagine-video';
      config_json.model = model;
      config_json.grok_mode = 'i2v';
      config_json.seconds = grokDuration;
    } else {
      const orientKey = aspectRatio === '16:9' ? 'toolbox_i2v_landscape' : 'toolbox_i2v_portrait';
      model = getDefaultModel(provider, orientKey);
      config_json.model = model;
    }

    const taskGroupData = {
      title: `[延展] ${extendPrompt.substring(0, 15)}`,
      task_type: 'image_to_video',
      source: 'GALLERY_EXTEND',
      global_prompt: extendPrompt.trim(),
      config_json: config_json,
      tasks: [{ prompt: extendPrompt.trim(), input_files: [previewCard.output_file] }]
    };
    try {
      await api.post('tasks/', taskGroupData);
      setPreviewCard(null);
      setExtendMode(false);
      setExtendPrompt('');
      fetchTaskGroups();
    } catch (e) {
      console.error('Extension task creation failed', e);
      alert('延长任务创建失败');
    } finally {
      setExtending(false);
    }
  };

  const handleRerunTask = async (taskId, e) => {
    e.stopPropagation();
    if (!window.confirm("确定要在当前卡片上重新生成吗？这会覆盖掉目前的视觉主文件（对于延展视频，这是重新拼合的好机会）。")) {
      return;
    }
    try {
      await api.post(`/tasks/item/${taskId}/retry`);
      fetchTaskGroups(); 
    } catch (error) {
      console.error("Retry failed", error);
      alert("重新触发失败");
    }
  };

  const toggleSelectionMode = () => {
    setSelectionMode(prev => {
      if (prev) {
        // 退出选择模式时清空已选
        setSelectedTasks(new Set());
        lastSelectedIndex.current = null;
      }
      return !prev;
    });
  };

  const toggleSelect = (taskId, shiftKey = false) => {
    const currentIndex = allCards.findIndex(c => c.id === taskId);

    if (shiftKey && lastSelectedIndex.current !== null && currentIndex !== -1) {
      // Shift 范围连选：选中两次点击之间的所有卡片
      const start = Math.min(lastSelectedIndex.current, currentIndex);
      const end = Math.max(lastSelectedIndex.current, currentIndex);
      const newSet = new Set(selectedTasks);
      for (let i = start; i <= end; i++) {
        if (allCards[i]?.id && allCards[i].status !== 'empty') {
          newSet.add(allCards[i].id);
        }
      }
      setSelectedTasks(newSet);
    } else {
      const newSet = new Set(selectedTasks);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      setSelectedTasks(newSet);
      if (currentIndex !== -1) lastSelectedIndex.current = currentIndex;
    }
  };

  const handleSelectAll = () => {
    const allSelectableIds = allCards
      .filter(c => c.id && c.status !== 'empty')
      .map(c => c.id);
    lastSelectedIndex.current = null;
    setSelectedTasks(new Set(allSelectableIds));
  };

  const handleInvertSelection = () => {
    const allSelectableIds = allCards
      .filter(c => c.id && c.status !== 'empty')
      .map(c => c.id);
    
    const newSet = new Set();
    allSelectableIds.forEach(id => {
      if (!selectedTasks.has(id)) newSet.add(id);
    });
    lastSelectedIndex.current = null;
    setSelectedTasks(newSet);
  };

  const currentTaskType = useMemo(() => {
    if (pathname.includes('t2i')) return 'text_to_image';
    if (pathname.includes('i2i')) return 'image_to_image';
    if (pathname.includes('t2v')) return 'text_to_video';
    if (pathname.includes('i2v')) return 'image_to_video';
    return null;
  }, [pathname]);

  const allCards = useMemo(() => {
    const cards = [];
    const filtered = taskGroups.filter(g => {
      if (currentTaskType && g.task_type !== currentTaskType) return false;
      if (g.source === 'FISSION' || g.source === 'PIPELINE' || g.source === 'DIRECTOR' || g.fission_parent_id) return false;
      return true;
    });
    
    for (const group of filtered) {
      const tasks = group.tasks || [];
      const cfgModel = group.config_json?.model || '';
      const grokMode = group.config_json?.grok_mode || '';
      const isVideo = cfgModel.includes('t2v') || 
                      cfgModel.includes('i2v') ||
                      cfgModel.includes('r2v') ||
                      cfgModel === 'grok-imagine-video' ||
                      grokMode === 't2v' || grokMode === 'i2v';
      
      for (const task of tasks) {
        cards.push({
          ...task,
          groupId: group.id,
          groupTitle: group.title,
          groupConfig: group.config_json,
          groupTaskType: group.task_type,
          isVideo,
          createdAt: group.created_at,
        });
      }
    }

    cards.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return cards;
  }, [taskGroups, currentTaskType]);

  // 本地文件夹 auto-save（gallery scope）—— 新出现的 success 视频自动写入用户绑定文件夹
  const { saveFromUrl: saveGalleryToFolder, handle: galleryFolderHandle } = useAutoSaveFolder('gallery');
  const gallerySavedRef = useRef(new Set());
  useEffect(() => {
    if (!galleryFolderHandle) return;
    const candidates = allCards.filter(c =>
      c.isVideo &&
      (c.status === 'SUCCESS' || c.status === 'success') &&
      c.output_file &&
      c.id &&
      !gallerySavedRef.current.has(c.id)
    );
    if (candidates.length === 0) return;
    candidates.forEach(async (c) => {
      const url = c.output_file.startsWith('/') ? c.output_file : `/${c.output_file}`;
      const filename = c.output_file.split('/').pop() || `gallery-${c.id.slice(0, 8)}.mp4`;
      const r = await saveGalleryToFolder(url, filename);
      if (r.ok) gallerySavedRef.current.add(c.id);
    });
  }, [allCards, galleryFolderHandle, saveGalleryToFolder]);

  const handleBridgeToVideo = (card) => {
    setDraftData({
      files: [`/${card.output_file}`],
      prompts: '',
      model: null,
    });
    navigate('/i2v');
  };

  const handleRemix = (card) => {
    let _files = [];
    try {
       if (card.input_files && Array.isArray(card.input_files)) {
         _files = card.input_files.map(f => `/${f}`);
       } else if (card.input_files && typeof card.input_files === 'string') {
         const parsed = JSON.parse(card.input_files);
         if (Array.isArray(parsed)) _files = parsed.map(f => `/${f}`);
       }
    } catch (e) {}
    
    setDraftData({
      prompts: card.prompt || '',
      model: card.groupConfig?.model || null,
      aspectRatio: card.groupConfig?.aspectRatio || '9:16',
      files: _files
    });
  };

  const handleDownload = async (url) => {
    if (!url) return;
    try {
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
    } catch (e) {
      console.error('Download failed:', e);
      alert('下载出错，请检查网络或跨域设置。');
    }
  };

  const handleBulkDownload = async () => {
    const validUrls = allCards.filter(t => selectedTasks.has(t.id) && (t.status === 'SUCCESS' || t.status === 'success')).map(t => t.output_file).filter(Boolean);
    if (validUrls.length === 0) {
      alert("没有选中任何已生成的项");
      return;
    }
    
    setDownloading(true);
    try {
      for (const url of validUrls) {
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
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('Download failed:', e);
      alert('批量下载出错：' + e.message);
    } finally {
      setDownloading(false);
      setSelectedTasks(new Set());
      setSelectionMode(false);
    }
  };

  const clearFailedTasks = async () => {
    if (!window.confirm("确定要一键清除所有失败的任务记录吗？该操作不可逆。")) return;
    try {
      const res = await api.delete('/tasks/failed/clear/all');
      const { failed = 0, zombies = 0 } = res.data || {};
      await fetchTaskGroups();
      if (failed === 0 && zombies === 0) {
        alert('当前用户没有失败/僵尸任务可清。\n如果界面仍显示红色卡片，可能是其它用户的任务（admin 视图）或本地缓存，刷新页面再看。');
      } else {
        alert(`已清除 ${failed} 条失败 + ${zombies} 条僵尸任务。`);
      }
    } catch (error) {
      console.error("清理错误任务失败", error);
      const msg = error.response?.data?.detail || error.message || '未知错误';
      alert(`清除失败：${msg}`);
    }
  };

  const isImageRoute = pathname.includes('t2i') || pathname.includes('i2i');
  const modeLabel = isImageRoute ? '图片' : '视频';

  if (allCards.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center relative">
        <div className="absolute w-[200px] h-[200px] rounded-full opacity-[0.04] blur-[80px]" style={{ background: 'var(--accent)' }} />
        <div className="text-center relative z-10">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-3)', border: '1px solid var(--border-default)' }}>
            <Sparkles size={28} className="opacity-40" style={{ color: 'var(--accent)' }} />
          </div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>还没有生成过{modeLabel}</p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>在左侧输入提示词并点击生成</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header stats bar */}
      <header 
        className="px-5 py-3 flex items-center justify-between flex-shrink-0 relative"
        style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        {/* Accent bottom line */}
        <div className="absolute bottom-0 left-5 right-5 h-[1px]" style={{ background: 'linear-gradient(90deg, var(--accent), transparent 60%)' }} />
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>历史结果</h2>
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }}>
            {allCards.length} 条
          </span>
          {/* 列数控制器 */}
          <div className="flex items-center gap-1 ml-3 p-0.5 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
            {[4, 6, 8, 10, 12, 14].map(n => (
              <button
                key={n}
                onClick={() => setColumnCount(n)}
                title={`每行 ${n} 列`}
                className="text-[9px] font-bold w-5 h-5 rounded transition-all leading-none"
                style={{
                  background: columnCount === n ? 'var(--accent)' : 'transparent',
                  color: columnCount === n ? '#fff' : 'var(--text-tertiary)',
                }}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Dreamina 并发指示器：Redis semaphore in_flight 作权威，account_querying 仅 tooltip 辅助 */}
          {(() => {
            const inFlight = dreaminaState.in_flight ?? 0;          // 本系统语义 (Redis semaphore)
            const accountQ = dreaminaState.account_querying ?? 0;    // dreamina list_task 本地缓存，仅参考
            const max = dreaminaState.max ?? 2;
            const waiting = dreaminaState.waiting ?? 0;
            const isFull = inFlight >= max;
            const isIdle = inFlight === 0 && waiting === 0;
            const bg = isFull ? 'rgba(248,113,113,0.15)' : isIdle ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)';
            const fg = isFull ? '#f87171' : isIdle ? '#34d399' : '#fbbf24';
            const dot = isFull ? '#f87171' : isIdle ? '#34d399' : '#fbbf24';
            const txt = isFull
              ? `Dreamina 满载 ${inFlight}/${max}${waiting > 0 ? ` · 排队 ${waiting}` : ''}`
              : isIdle
                ? `Dreamina 空闲 0/${max}`
                : `Dreamina ${inFlight}/${max}${waiting > 0 ? ` · 等 ${waiting}` : ''}`;
            const tip = `本系统正在跑 ${inFlight}/${max}（Redis semaphore 权威）\n等待槽 ${waiting} 个\n上游 dreamina 本地缓存 querying ${accountQ}（仅参考，可能 stale）`;
            return (
              <div className="flex items-center gap-1.5 ml-3 px-2.5 py-1 rounded-md"
                   title={tip}
                   style={{ background: bg, border: `1px solid ${fg}33` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot, boxShadow: `0 0 6px ${dot}` }} />
                <span className="text-[10px] font-bold leading-none" style={{ color: fg }}>{txt}</span>
              </div>
            );
          })()}
        </div>
        
        <div className="flex items-center gap-3">
          <FolderPickerBar scopeKey="gallery" label="新视频自动保存" />
          {allCards.length > 0 && (
            <div className="flex items-center gap-2">
              {/* 选择模式：全选/反选 仅在选择模式激活后显示 */}
              {selectionMode && (
                <div className="flex items-center pr-3 mr-1 gap-2" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                  <button 
                    onClick={handleSelectAll}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-md transition-all active:scale-95 flex items-center gap-1"
                    style={{ background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }}
                  >
                    <CheckCheck size={12} /> 全选
                  </button>
                  <button 
                    onClick={handleInvertSelection}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-md transition-all active:scale-95 flex items-center gap-1"
                    style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}
                  >
                    <Shuffle size={12} /> 反选
                  </button>
                </div>
              )}

              {/* 选择模式 Toggle 按钮 */}
              <button
                onClick={toggleSelectionMode}
                title={selectionMode ? '退出选择模式（清空已选）' : '进入选择模式（可 Shift 范围连选）'}
                className="text-[11px] font-bold px-3 py-1.5 rounded-md transition-all active:scale-95 flex items-center gap-1"
                style={{
                  background: selectionMode ? 'var(--accent)' : 'var(--surface-3)',
                  color: selectionMode ? '#fff' : 'var(--text-secondary)',
                  boxShadow: selectionMode ? '0 0 12px var(--accent-subtle)' : 'none',
                }}
              >
                <CheckSquare size={12} /> {selectionMode ? '退出选择' : '多选模式'}
              </button>
            </div>
          )}

          {allCards.some(c => c.status === 'FAILED' || c.status === 'failed') && (
            <button 
              onClick={clearFailedTasks}
              className="text-[11px] transition-colors flex items-center gap-1 px-3 py-1.5 rounded-md font-medium"
              style={{ background: 'rgba(248,113,113,0.12)', color: 'var(--error)' }}
            >
              <Trash2 size={12} /> 清除失败任务
            </button>
          )}
        </div>
      </header>

      {/* Waterfall gallery */}
      <div className={`flex-1 overflow-y-auto custom-scrollbar ${columnCount >= 10 ? 'p-2' : columnCount >= 8 ? 'p-3' : 'p-4'}`}>
        <div className={`grid pb-12 ${columnCount >= 10 ? 'gap-1.5' : columnCount >= 8 ? 'gap-2.5' : 'gap-4'}`} style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
          {allCards.slice(0, visibleCount).map((card) => {
            const isDone = card.status === 'SUCCESS' || card.status === 'success';
            const isFailed = card.status === 'FAILED' || card.status === 'failed';
            const isPending = !isDone && !isFailed;

            return (
              <div 
                key={card.id} 
                onClick={(e) => {
                  if (selectionMode && card.id) {
                    // 选择模式：整张卡片可点击，支持 Shift 范围连选
                    toggleSelect(card.id, e.shiftKey);
                  } else if (!selectionMode && isDone) {
                    setPreviewCard(card);
                  }
                }}
                onMouseEnter={(e) => {
                  const v = e.currentTarget.querySelector('video');
                  if (v) {
                    if (!v.src && v.dataset.src) v.src = v.dataset.src;
                    v.play().catch(()=>{});
                  }
                }}
                onMouseLeave={(e) => {
                  const v = e.currentTarget.querySelector('video');
                  if (v) v.pause();
                }}
                className={`group relative ${isCompact ? 'rounded-md shadow-sm' : 'rounded-xl shadow-md'} overflow-hidden flex flex-col w-full transition-[box-shadow,border-color] duration-300 ${selectionMode ? 'cursor-pointer' : (isDone ? 'cursor-pointer' : '')} ${selectedTasks.has(card.id) ? 'border-2 border-emerald-500 ring-2 ring-emerald-500/30 scale-[0.98]' : (isFailed ? 'ring-2 ring-red-500/50' : `border-2 border-transparent hover:border-[var(--border-strong)] ${isCompact ? 'hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]' : 'hover:shadow-[0_12px_40px_rgba(0,0,0,0.3)]'}`)}`}
                style={{
                  aspectRatio: (() => {
                    const ar = card.groupConfig?.aspectRatio;
                    if (ar === '16:9') return isCompact ? '16/11' : '16/9';
                    if (ar === '1:1') return '1/1';
                    return isCompact ? '9/14' : '9/16';
                  })(),
                  background: 'var(--surface-2)',
                }}
              >
                <div className="absolute inset-0">
                  {isDone && card.output_file ? (
                    card.isVideo ? (
                      <video 
                        className="w-full h-full object-cover transition-opacity duration-300" 
                        loop muted playsInline 
                        preload="none"
                        poster={card.output_thumbnail ? `/${card.output_thumbnail}` : `/${card.output_file}#t=0.001`}
                        data-src={`/${card.output_file}#t=0.001`}
                      />
                    ) : (
                      <img 
                        src={`/${card.output_file}`} 
                        className="w-full h-full object-cover" 
                        alt={card.prompt}
                        onError={e => { e.currentTarget.style.opacity = '0'; }}
                      />
                    )
                  ) : (
                    <div 
                      className={`w-full h-full flex flex-col items-center justify-center p-3 ${isFailed ? 'bg-gradient-to-br from-red-900/30 to-gray-900' : 'bg-gradient-to-br from-indigo-900/40 to-gray-800'}`}
                    >
                        {isPending && (
                          <div className={isCompact ? 'mb-1' : 'mb-2'}>
                            {taskProgressMap?.[card.id] ? (
                              <Sparkles size={isCompact ? 16 : 24} className="animate-pulse drop-shadow-lg" style={{ color: 'var(--accent-hover)' }} />
                            ) : (
                              <Clock size={isCompact ? 16 : 24} className="animate-[spin_3s_linear_infinite] drop-shadow-md opacity-80" style={{ color: 'var(--text-tertiary)' }} />
                            )}
                          </div>
                        )}
                        {isFailed && <AlertTriangle size={isCompact ? 18 : 28} className={`text-red-400 ${isCompact ? 'mb-1' : 'mb-2'}`} />}
                        
                        <div className="text-center w-full px-1 flex flex-col items-center">
                          {isFailed ? (
                            <>
                              <p className="text-[11px] text-red-200 font-medium leading-tight mb-2 overflow-y-auto custom-scrollbar max-h-24" title={card.error_message}>
                                {card.error_message || '生成被阻断'}
                              </p>
                              <div className="flex gap-2">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleRetryTask(card.id); }}
                                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-[10px] text-white font-bold rounded-md transition-colors flex items-center justify-center gap-1 shadow-md"
                                  title="在后端直接重新排队执行该任务"
                                >
                                  <RefreshCw size={10} /> 重试执行
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleRemix(card); }}
                                  className="px-3 py-1.5 bg-red-800/80 hover:bg-red-700 text-[10px] text-white rounded-md transition-colors flex items-center justify-center gap-1 shadow-sm"
                                  title="提取指令和原图，以新任务形式处理"
                                >
                                  提取重填
                                </button>
                              </div>
                            </>
                          ) : isPending ? (
                            (() => {
                              const progMsg = taskProgressMap?.[card.id];
                              const isRunning = progMsg || card.status === 'running' || card.status === 'RUNNING';
                              if (!isRunning) {
                                return (
                                  <p className="text-[11px] text-white/70 font-medium tracking-widest mt-1">
                                    排队中...
                                  </p>
                                );
                              }
                              
                              let retryBadge = null;
                              let displayMsg = progMsg || '准备就绪...';
                              if (progMsg) {
                                const retryMatch = progMsg.match(/\[重试\s(\d+\/\d+)\]/);
                                if (retryMatch) {
                                  retryBadge = retryMatch[1];
                                  displayMsg = progMsg.replace(retryMatch[0], '').trim();
                                }
                              }
                              
                              return (
                                <div className="flex flex-col items-center">
                                  <div className="flex items-center gap-1 mb-0.5">
                                    <span className="text-[10px] text-indigo-300 font-bold tracking-wider">生成中</span>
                                    {retryBadge && (
                                      <span className="text-[9px] text-orange-300 px-1 py-0.5 rounded bg-orange-500/20 border border-orange-500/30 font-bold tracking-wider">
                                        重试 {retryBadge}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-white/90 font-medium leading-tight break-words line-clamp-2 text-center">
                                    {displayMsg}
                                  </p>
                                </div>
                              );
                            })()
                          ) : null}
                        </div>
                    </div>
                  )}
                </div>

                {/* Bottom info bar */}
                <div className={`absolute bottom-0 w-full bg-gradient-to-t from-black/80 via-black/40 to-transparent ${isCompact ? 'p-1.5' : 'p-2.5'}`}>
                  <div className={`flex items-center truncate ${isCompact ? 'gap-1' : 'gap-2'}`}>
                    {card.groupConfig?.isExtension && (
                      <span className={`bg-amber-500 text-white font-bold rounded flex-shrink-0 ${isCompact ? 'text-[8px] px-1 py-0' : 'text-[9px] px-1.5 py-0.5'}`}>延展</span>
                    )}
                    <p className={`text-white font-medium truncate ${isCompact ? 'text-[10px]' : 'text-[11px]'}`} title={card.prompt || card.groupPrompt}>
                      {card.prompt || card.groupPrompt || '生成任务'}
                    </p>
                  </div>
                  {!isCompact && (
                    <p className="text-[9px] text-white/50 mt-0.5 truncate">
                      {card.groupConfig?.model?.split('_').slice(0, 3).join(' ') || '模型'}
                    </p>
                  )}
                </div>

                {/* Checkbox：选择模式下常驻；非选择模式下鼠标悬停 or 已选中时显示 */}
                {card.id && (
                  <div 
                    className={`absolute top-2 left-2 z-10 cursor-pointer p-1 transition-opacity duration-150 ${selectionMode || selectedTasks.has(card.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      // 非选择模式下点 checkbox 自动进入选择模式
                      if (!selectionMode) setSelectionMode(true);
                      toggleSelect(card.id, e.shiftKey);
                    }}
                    title={selectedTasks.has(card.id) ? "取消选择" : (selectionMode ? "选择（Shift+点击可范围连选）" : "点击进入选择模式")}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all shadow-sm ${selectedTasks.has(card.id) ? 'bg-emerald-500 border-emerald-500' : 'bg-black/50 border-white/70 hover:border-white'}`}>
                      {selectedTasks.has(card.id) && <span className="text-[10px] text-white font-bold leading-none">✓</span>}
                    </div>
                  </div>
                )}

                {/* Hover action menu */}
                {isDone && (
                  <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1 z-20">
                    {!card.isVideo && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleBridgeToVideo(card); }}
                        className="bg-black/70 hover:bg-indigo-600 text-white text-[10px] font-semibold px-2 py-1.5 rounded-lg backdrop-blur-sm transition-colors whitespace-nowrap flex items-center gap-1 shadow"
                        title="送去生视频"
                      >
                        <Film size={11} /> 生视频
                      </button>
                    )}
                    <button
                      onClick={(e) => handleRerunTask(card.id, e)}
                      className="bg-black/70 hover:bg-sky-600 text-white text-[10px] font-semibold px-2 py-1.5 rounded-lg backdrop-blur-sm transition-colors whitespace-nowrap flex items-center gap-1 shadow"
                      title="废弃当前结果并在原地重新生成（常用于延展视频重拼或生歪覆盖）"
                    >
                      <RefreshCw size={11} /> 重新生成
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemix(card); }}
                      className="bg-black/70 hover:bg-violet-600 text-white text-[10px] font-semibold px-2 py-1.5 rounded-lg backdrop-blur-sm transition-colors whitespace-nowrap flex items-center gap-1 shadow"
                      title="提取参数到工作台修改"
                    >
                      <RefreshCw size={11} /> Remix
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownload(card.output_file); }}
                      className="bg-black/70 hover:bg-emerald-600 text-white text-[10px] font-semibold px-2 py-1.5 rounded-lg backdrop-blur-sm transition-colors whitespace-nowrap flex items-center gap-1 shadow"
                      title="保存到本地"
                    >
                      <Download size={11} /> 下载
                    </button>
                    {card.isVideo && (
                      <button
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setPreviewCard(card);
                          setExtendMode(true);
                          setExtendPrompt(card.prompt || '');
                        }}
                        className="bg-black/70 hover:bg-amber-600 text-white text-[10px] font-semibold px-2 py-1.5 rounded-lg backdrop-blur-sm transition-colors whitespace-nowrap flex items-center gap-1 shadow"
                        title="选择该视频的最后片段延长"
                      >
                        <ArrowRight size={11} /> 延长
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteTask(card.id); }}
                      className="bg-black/70 hover:bg-red-600 text-white text-[10px] font-semibold px-2 py-1.5 rounded-lg backdrop-blur-sm transition-colors whitespace-nowrap flex items-center gap-1 shadow"
                      title="永久删除"
                    >
                      <Trash2 size={11} /> 删除
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {/* Scroll sentinel */}
          {visibleCount < allCards.length && (
            <div ref={sentinelCallbackRef} className="col-span-full flex justify-center py-8">
              <div className="text-xs animate-pulse" style={{ color: 'var(--text-tertiary)' }}>加载更多...</div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom floating action bar - Redesigned Floating + Tabs */}
      {(() => {
        const hasImages = allCards.some(c => selectedTasks.has(c.id) && !c.isVideo);
        const hasVideos = allCards.some(c => selectedTasks.has(c.id) && c.isVideo);
        
        const generativeTabs = [];
        if (hasImages) {
          generativeTabs.push({ id: 'i2i', label: '图生图', icon: ImagePlus });
          generativeTabs.push({ id: 'i2v', label: '批量生视频', icon: Film });
        }
        if (hasVideos) {
          generativeTabs.push({ id: 'extend', label: '延长视频', icon: ArrowRight });
        }

        const activeGenTab = generativeTabs.some(t => t.id === batchTab) ? batchTab : (generativeTabs[0]?.id || null);

        return (
          <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 min-w-[550px] max-w-[90vw] rounded-2xl p-4 flex flex-col gap-3 z-[100] transition-all duration-300 ${selectedTasks.size === 0 ? 'translate-y-20 opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'}`}
            style={{
              background: 'var(--glass-bg)',
              border: '1px solid var(--border-default)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              boxShadow: '0 8px 40px var(--shadow-modal, rgba(0,0,0,0.3))',
            }}>
            
            {/* Top row: Generative Tabs */}
            {generativeTabs.length > 0 && (
              <div className="flex gap-2">
                {generativeTabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setBatchTab(t.id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                      activeGenTab === t.id 
                        ? 'bg-white/20 text-white shadow-sm' 
                        : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }`}
                  >
                    <t.icon size={13} /> {t.label}
                  </button>
                ))}
              </div>
            )}

            {/* Batch prompt input */}
            <div className="flex gap-2 w-full">
                <input 
                  type="text"
                  value={batchPrompt}
                  onChange={(e) => setBatchPrompt(e.target.value)}
                  placeholder="输入批量操作的统一提示词..."
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm focus:outline-none placeholder-gray-500"
                  style={{
                    background: 'var(--surface-0)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
                />
                <div className="font-bold px-4 py-2.5 rounded-xl text-sm flex items-center whitespace-nowrap" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }}>
                  已选中 {selectedTasks.size} 项
                </div>
            </div>

            {/* Config Area - I2I */}
            {activeGenTab === 'i2i' && (
              <div className="flex items-center gap-2 px-1 flex-wrap mt-1">
                <label className="text-[11px] font-bold text-gray-300 whitespace-nowrap">模型:</label>
                <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                  {[
                    { val: 'gemini-3.0-pro-image', label: 'Gemini 3.0 Pro' },
                    { val: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash' },
                    { val: 'grok-imagine-image-edit', label: 'Grok Edit' },
                  ].map(({ val, label }) => (
                    <button
                      key={val}
                      onClick={() => setBatchI2iModel(val)}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-colors ${batchI2iModel === val ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {batchI2iModel !== 'grok-imagine-image-edit' && (
                  <>
                    <label className="text-[11px] font-bold text-gray-300 whitespace-nowrap ml-2">比例:</label>
                    <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                      {['9:16', '16:9', '1:1'].map(ar => (
                        <button
                          key={ar}
                          onClick={() => setBatchI2iAspectRatio(ar)}
                          className={`px-2 py-1 text-[10px] font-bold rounded-md transition-colors ${batchI2iAspectRatio === ar ? 'bg-violet-500 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                          {ar}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {batchI2iModel.includes('gemini') && (
                  <>
                    <label className="text-[11px] font-bold text-gray-300 whitespace-nowrap ml-2">精度:</label>
                    <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                      {[
                        { val: 'standard', label: '标清' },
                        { val: '2k', label: '2K超清' },
                        { val: '4k', label: '4K原画' }
                      ].map(res => (
                        <button
                          key={res.val}
                          onClick={() => setBatchI2iResolution(res.val)}
                          className={`px-2 py-1 text-[10px] font-bold rounded-md transition-colors ${batchI2iResolution === res.val ? 'bg-violet-500 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                          {res.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {/* 可选参考图区域 */}
                <input
                  ref={batchRefInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      if (batchRefPreview) URL.revokeObjectURL(batchRefPreview);
                      setBatchRefFile(file);
                      setBatchRefPreview(URL.createObjectURL(file));
                    }
                    e.target.value = null;
                  }}
                />
                {batchRefFile ? (
                  <div className="relative w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 border border-violet-500 ml-2" title="参考图已选">
                    <img src={batchRefPreview} alt="ref" className="w-full h-full object-cover" />
                    <button
                      onClick={() => {
                        if (batchRefPreview) URL.revokeObjectURL(batchRefPreview);
                        setBatchRefFile(null);
                        setBatchRefPreview(null);
                      }}
                      className="absolute inset-0 w-full h-full bg-black/60 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity text-white"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => batchRefInputRef.current?.click()}
                    className="ml-2 text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors whitespace-nowrap"
                    style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)', color: 'var(--text-tertiary)' }}
                    title="可选：添加参考图（图+参考图+提示词 模式）"
                  >
                    + 参考图
                  </button>
                )}
              </div>
            )}

            {/* Config Area - I2V / Extend */}
            {(activeGenTab === 'i2v' || activeGenTab === 'extend') && (
              <div className="flex items-center gap-3 px-1 mt-1">
                <label className="text-[11px] font-bold text-gray-300">生成引擎:</label>
                <div className="flex gap-1.5 p-1 rounded-lg" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                  <button
                    onClick={() => setBatchEngine('veo')}
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${batchEngine === 'veo' ? 'bg-amber-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    Veo 3.1 Relax
                  </button>
                  <button
                    onClick={() => setBatchEngine('grok')}
                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${batchEngine === 'grok' ? 'bg-amber-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    Grok Image-to-Video
                  </button>
                </div>
                {batchEngine === 'grok' && (
                  <div className="flex gap-1.5 p-1 rounded-lg ml-2" style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)' }}>
                    <button
                      onClick={() => setBatchGrokDuration(6)}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${batchGrokDuration === 6 ? 'bg-[#5eead4] text-gray-900 border border-[#5eead4]' : 'text-gray-400 hover:text-gray-200'}`}
                      style={{ boxShadow: batchGrokDuration === 6 ? '0 0 10px rgba(94,234,212,0.3)' : 'none' }}
                    >
                      6 秒
                    </button>
                    <button
                      onClick={() => setBatchGrokDuration(10)}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${batchGrokDuration === 10 ? 'bg-[#5eead4] text-gray-900 border border-[#5eead4]' : 'text-gray-400 hover:text-gray-200'}`}
                      style={{ boxShadow: batchGrokDuration === 10 ? '0 0 10px rgba(94,234,212,0.3)' : 'none' }}
                    >
                      10 秒
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Bottom Row: Actions */}
            <div className="flex items-center justify-between gap-3 mt-2">
              <div className="flex gap-2">
                {activeGenTab === 'i2i' && (
                  <button 
                    onClick={handleBatchI2I}
                    disabled={batching || !batchPrompt.trim()}
                    className="font-bold py-2.5 px-5 rounded-xl shadow-sm transition-all text-sm disabled:opacity-50 flex items-center gap-2 text-white"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 4px 12px rgba(99,102,241,0.3)' }}
                  >
                    {batching ? <RefreshCw size={15} className="animate-spin" /> : <ImagePlus size={15} />}
                    执行批量图生图 {batchRefFile ? '（含参考）' : ''}
                  </button>
                )}
                {activeGenTab === 'i2v' && (
                  <button 
                    onClick={() => handleBatchAction('I2V')}
                    disabled={batching || !batchPrompt.trim()}
                    className="font-bold py-2.5 px-5 rounded-xl shadow-sm transition-all text-sm disabled:opacity-50 flex items-center gap-2 text-white"
                    style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}
                  >
                    {batching ? <RefreshCw size={15} className="animate-spin" /> : <Film size={15} />}
                    执行批量生视频
                  </button>
                )}
                {activeGenTab === 'extend' && (
                  <button 
                    onClick={() => handleBatchAction('EXTEND')}
                    disabled={batching || !batchPrompt.trim()}
                    className="font-bold py-2.5 px-5 rounded-xl shadow-sm transition-all text-sm disabled:opacity-50 flex items-center gap-2 text-white"
                    style={{ background: 'linear-gradient(135deg, #f59e0b, #ea580c)', boxShadow: '0 4px 12px rgba(245,158,11,0.3)' }}
                  >
                    {batching ? <RefreshCw size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                    执行批量延长视频
                  </button>
                )}
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={handleBulkDownload}
                  disabled={downloading}
                  className="font-semibold py-2.5 px-4 rounded-xl shadow-sm transition-all text-xs disabled:opacity-50 flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 hover:text-emerald-300"
                >
                  <Download size={14} /> {downloading ? '打包中...' : '下载'}
                </button>
                <button 
                  onClick={handleBatchDelete}
                  disabled={batching || selectedTasks.size === 0}
                  className="font-bold py-2.5 px-4 rounded-xl shadow-sm transition-all text-xs disabled:opacity-50 flex items-center gap-1.5 text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 hover:text-rose-300"
                >
                  <Trash2 size={14} /> 删除
                </button>
                <button 
                  onClick={() => setSelectedTasks(new Set())}
                  className="font-semibold py-2.5 px-4 rounded-xl transition-all text-xs text-gray-400 bg-white/5 hover:bg-white/10 hover:text-gray-200"
                >
                  取消
                </button>
              </div>
            </div>

          </div>
        );
      })()}

      {/* Preview modal / extend overlay */}
      {previewCard && (
        <div 
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-4 sm:p-8"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
          onClick={() => {
            setPreviewCard(null);
            setExtendMode(false);
          }}
        >
          <div 
            className="relative max-w-full max-h-[80vh] flex flex-col shadow-2xl rounded-xl overflow-hidden pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {previewCard.isVideo ? (
              <video 
                src={`/${previewCard.output_file}`} 
                className="max-w-[90vw] max-h-[80vh] object-contain bg-black/50" 
                controls
                autoPlay
              />
            ) : (
              <img 
                src={`/${previewCard.output_file}`} 
                className="max-w-[90vw] max-h-[80vh] object-contain" 
                alt={previewCard.prompt}
              />
            )}
            
            <button 
              onClick={() => {
                setPreviewCard(null);
                setExtendMode(false);
              }}
              className="absolute top-4 right-4 w-10 h-10 text-white rounded-full flex items-center justify-center transition-colors z-10 backdrop-blur-sm shadow-md"
              style={{ background: 'rgba(0,0,0,0.4)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.7)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.4)'}
            >
              <X size={20} />
            </button>
          </div>
          
          {extendMode && previewCard.isVideo && (
             <div 
               className="mt-6 w-full max-w-3xl flex gap-3 pointer-events-auto"
               onClick={(e) => e.stopPropagation()}
             >
               <input 
                 type="text" 
                 value={extendPrompt}
                 onChange={(e) => setExtendPrompt(e.target.value)}
                 placeholder="输入延长画面的提示词描述（与上一段首尾相连）..."
                 className="flex-1 backdrop-blur-md text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-lg text-sm"
                 style={{
                   background: 'rgba(255,255,255,0.1)',
                   border: '1px solid rgba(255,255,255,0.2)',
                 }}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') handleSubmitExtend();
                 }}
               />
               
               <div className="flex flex-col gap-1.5 shrink-0 justify-center">
                 <div className="flex gap-1 p-0.5 rounded-lg shrink-0 w-max" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
                   <button
                     onClick={() => setExtendEngine('veo')}
                     className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors ${extendEngine === 'veo' ? 'bg-amber-600 text-white' : 'text-gray-300 hover:bg-white/10'}`}
                   >
                     Veo 3.1
                   </button>
                   <button
                     onClick={() => setExtendEngine('grok')}
                     className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors ${extendEngine === 'grok' ? 'bg-amber-600 text-white' : 'text-gray-300 hover:bg-white/10'}`}
                   >
                     Grok
                   </button>
                 </div>
                 {extendEngine === 'grok' && (
                   <div className="flex gap-1 p-0.5 rounded-lg shrink-0 w-max" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
                     <button
                       onClick={() => setGrokDuration(6)}
                       className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors ${grokDuration === 6 ? 'bg-[#5eead4] text-gray-900 border border-[#5eead4]' : 'text-gray-300 hover:bg-white/10'}`}
                       style={{ boxShadow: grokDuration === 6 ? '0 0 10px rgba(94,234,212,0.3)' : 'none' }}
                     >
                       6 秒
                     </button>
                     <button
                       onClick={() => setGrokDuration(10)}
                       className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors ${grokDuration === 10 ? 'bg-[#5eead4] text-gray-900 border border-[#5eead4]' : 'text-gray-300 hover:bg-white/10'}`}
                       style={{ boxShadow: grokDuration === 10 ? '0 0 10px rgba(94,234,212,0.3)' : 'none' }}
                     >
                       10 秒
                     </button>
                   </div>
                 )}
               </div>

               <button 
                 onClick={handleSubmitExtend}
                 disabled={extending || !extendPrompt.trim()}
                 className="text-white font-bold px-6 py-3 rounded-xl shadow-lg transition-all disabled:opacity-50 whitespace-nowrap flex items-center gap-2 text-sm"
                 style={{
                   background: 'linear-gradient(135deg, #f59e0b, #ea580c)',
                   border: '1px solid rgba(245,158,11,0.5)',
                 }}
               >
                 {extending ? '提交中...' : <><ArrowRight size={16} /> 生成延展视频</>}
               </button>
             </div>
          )}
        </div>
      )}
    </div>
  );
}
