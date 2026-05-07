import React, { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import useTaskStore from '../../stores/useTaskStore';
import TaskItem from './TaskItem';

export default function Inbox() {
  const location = useLocation();
  const path = location.pathname;
  const taskGroups = useTaskStore((s) => s.taskGroups);
  const filter = useTaskStore((s) => s.filter);
  const setFilter = useTaskStore((s) => s.setFilter);
  const searchQuery = useTaskStore((s) => s.searchQuery);
  const setSearchQuery = useTaskStore((s) => s.setSearchQuery);
  const fetchTaskGroups = useTaskStore((s) => s.fetchTaskGroups);
  const connectWebSocket = useTaskStore((s) => s.connectWebSocket);
  const disconnectWebSocket = useTaskStore((s) => s.disconnectWebSocket);
  const setActiveGroup = useTaskStore((s) => s.setActiveGroup);
  const activeGroupId = useTaskStore((s) => s.activeGroupId);

  useEffect(() => {
    fetchTaskGroups();
    connectWebSocket();
    return () => disconnectWebSocket();
  }, [fetchTaskGroups, connectWebSocket, disconnectWebSocket]);

  // 计算当前路由对应的 task_type
  const currentTaskType = useMemo(() => {
    if (path.includes('t2i')) return 'text_to_image';
    if (path.includes('i2i')) return 'image_to_image';
    if (path.includes('t2v')) return 'text_to_video';
    if (path.includes('i2v')) return 'image_to_video';
    if (path.includes('fission')) return 'pipeline';
    return null;
  }, [path]);

  // 先过滤出符合当前路由和顶部筛选状态的任务
  const filteredGroups = useMemo(() => {
    return taskGroups.filter(g => {
      const isFissionRoute = path.includes('fission') || path.includes('pipe');
      
      // 1. 路由拦截隔离：Source + 血缘拦截
      if (isFissionRoute) {
        // 裂变板块：只显示 FISSION/PIPELINE 来源，或具有裂变血缘的任务
        if (g.source !== 'FISSION' && g.source !== 'PIPELINE' && !g.fission_parent_id) return false;
      } else {
        // 基础模块：排除 FISSION/PIPELINE 来源，且排除具有任何裂变血缘的任务
        if (g.source === 'FISSION' || g.source === 'PIPELINE' || g.fission_parent_id) return false;
        if (currentTaskType && g.task_type !== currentTaskType) return false;
      }

      // 2. 文本搜索
      if (searchQuery && !g.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      
      // 3. 状态标签过滤
      if (filter === 'all') return true;
      if (filter === 'review' && g.status === 'needs_review') return true;
      if (filter === 'running' && g.status === 'processing') return true;
      if (filter === 'done' && g.status === 'completed') return true;
      if (filter === 'failed' && g.status === 'failed') return true;
      
      return false;
    });
  }, [taskGroups, currentTaskType, filter, searchQuery]);

  const lastPathRef = React.useRef(path);

  // 当切换大路由板块（例如从 t2v 切换到 t2i）时，由于 filteredGroups 会变更
  // 我们想要右侧能自动展出本模式的最新的结果，而不是默认展示空白表单。如果没有任务再显示表单。
  useEffect(() => {
    const pathChanged = lastPathRef.current !== path;
    lastPathRef.current = path;

    if (pathChanged) {
      // 画廊首选逻辑：只要切了大类菜单，强制优先看最新的生成结果！
      if (filteredGroups.length > 0) {
        setActiveGroup(filteredGroups[0].id);
      } else {
        setActiveGroup(null);
      }
      return;
    }

    // 以下是日常同板块内的状态变动（如点新建、删除、列表刷新等）
    // 如果用户主动处于“新建任务”(null) 状态，我们坚决不强行霸占视图
    if (activeGroupId === null) return;

    // 只有当当前的 activeGroupId 并不在当前的过滤列表里（比如被删除了）时进行接管替换
    const currentStillVisible = filteredGroups.some(g => g.id === activeGroupId);
    if (!currentStillVisible) {
      if (filteredGroups.length > 0) {
        setActiveGroup(filteredGroups[0].id);
      } else {
        // 真的一条记录都没有的时候再展现表单
        setActiveGroup(null);
      }
    }
  }, [filteredGroups, activeGroupId, setActiveGroup, path]);

    // 获取当前板块某状态的总数
  const getCount = (statusKey) => {
    const isFissionRoute = path.includes('fission') || path.includes('pipe');
    const baseGroups = taskGroups.filter(g => {
      if (isFissionRoute) {
        return g.source === 'FISSION' || g.source === 'PIPELINE' || g.fission_parent_id;
      } else {
        if (g.source === 'FISSION' || g.source === 'PIPELINE' || g.fission_parent_id) return false;
        if (currentTaskType && g.task_type !== currentTaskType) return false;
        return true;
      }
    });
    
    if (statusKey === 'all') return baseGroups.length;
    let mapped = '';
    if (statusKey === 'review') mapped = 'needs_review';
    else if (statusKey === 'running') mapped = 'processing';
    else if (statusKey === 'done') mapped = 'completed';
    else if (statusKey === 'failed') mapped = 'failed';
    return baseGroups.filter(g => g.status === mapped).length;
  };

  const tabs = [
    { key: 'all', label: '全部', style: { background: 'var(--surface-3)', color: 'var(--text-secondary)' } },
    { key: 'review', label: '待处理', style: { background: 'var(--accent-subtle)', color: 'var(--accent-hover)' } },
    { key: 'running', label: '进行中', style: { background: 'rgba(251, 191, 36, 0.12)', color: 'var(--warning)' } },
    { key: 'done', label: '已完成', style: { background: 'rgba(52, 211, 153, 0.12)', color: 'var(--success)' } },
    { key: 'failed', label: '失败', style: { background: 'rgba(248, 113, 113, 0.12)', color: 'var(--error)' } },
  ];

  return (
    <aside id="inbox-panel" className="w-[320px] flex flex-col z-20 flex-shrink-0" style={{ background: 'var(--surface-1)', borderRight: '1px solid var(--border-subtle)' }}>
      {/* 顶部标题 */}
      <div className="px-4 py-3 flex justify-between items-center flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="font-bold text-[15px]" id="inbox-title" style={{ color: 'var(--text-primary)' }}>智能裂变队列</h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" id="inbox-badge" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }}>
            {taskGroups.length} 任务
          </span>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-tertiary)' }}>🔍</span>
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all placeholder-gray-400" 
            style={{ background: 'var(--surface-0)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
            placeholder="搜索任务名称..." 
          />
        </div>
      </div>

      {/* 筛选标签页 */}
      <div className="px-3 py-0 flex gap-0 flex-shrink-0 overflow-x-auto no-scrollbar" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {tabs.map(tab => (
          <button 
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`filter-tab px-3 py-2.5 text-[12px] whitespace-nowrap transition-colors ${filter === tab.key ? 'active' : ''}`}
            style={{ color: filter === tab.key ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
          >
            {tab.label} <span className="filter-count" style={tab.style}>{getCount(tab.key)}</span>
          </button>
        ))}
      </div>

      {/* 新建按钮 */}
      <div className="px-3 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button 
          onClick={() => setActiveGroup(null)}
          className="w-full text-white font-semibold py-2.5 rounded-xl hover:shadow-lg hover:shadow-indigo-500/25 shadow-md transition-all flex items-center justify-center gap-2 text-sm"
          style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)', boxShadow: '0 4px 16px rgba(99, 102, 241, 0.25)' }}
        >
          <span>＋</span> <span>新建任务</span>
        </button>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-2 py-2" id="inbox-list">
        {filteredGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12" style={{ color: 'var(--text-tertiary)' }}>
            <span className="text-3xl mb-2">📭</span>
            <p className="text-sm">没有匹配的任务</p>
          </div>
        ) : (
          filteredGroups.map(group => <TaskItem key={group.id} group={group} />)
        )}
      </div>

      {/* 底部统计条 */}
      <div className="px-4 py-2.5 flex items-center justify-between text-[11px] flex-shrink-0" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}>
        <span>今日已完成 <strong style={{ color: 'var(--text-secondary)' }}>{getCount('done')}</strong> 个任务</span>
        <span>API 余额: <strong style={{ color: 'var(--success)' }}>正常</strong></span>
      </div>
    </aside>
  );
}
