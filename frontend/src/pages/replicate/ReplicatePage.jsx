import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import * as api from '../../api/replicate';
import InputForm from './InputForm';
import AwaitingLLMOutput from './AwaitingLLMOutput';
import GUList from './GUList';

const STATUS_LABEL = {
  awaiting_llm_input: '待粘贴 LLM 输出',
  completed: '已拆分 GU',
  failed: '失败',
  pending: '初始化中',
  processing: 'Gemini 分析中',
};

export default function ReplicatePage() {
  const [jobs, setJobs] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const list = await api.listJobs();
      setJobs(list);
      if (!activeJobId && list.length > 0) {
        setActiveJobId(list[0].id);
      }
    } catch (e) {
      console.error('listJobs failed', e);
    }
  }, [activeJobId]);

  const refreshActive = useCallback(async () => {
    if (!activeJobId) {
      setActiveJob(null);
      return;
    }
    setLoading(true);
    try {
      const job = await api.getJob(activeJobId);
      setActiveJob(job);
    } catch (e) {
      console.error('getJob failed', e);
      setActiveJob(null);
    } finally {
      setLoading(false);
    }
  }, [activeJobId]);

  useEffect(() => { refreshList(); }, [refreshList]);
  useEffect(() => { refreshActive(); }, [refreshActive]);

  // PROCESSING 状态自动轮询（每 5s）
  const pollRef = useRef(null);
  useEffect(() => {
    if (activeJob?.status !== 'processing') {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      refreshActive();
      refreshList();
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [activeJob?.status, refreshActive, refreshList]);

  const handleCreate = async (formData) => {
    setCreating(true);
    try {
      const job = await api.createJob(formData);
      await refreshList();
      setActiveJobId(job.id);
    } catch (e) {
      alert(`提交失败: ${e.response?.data?.detail || e.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确认删除该作业及其所有素材？')) return;
    try {
      await api.deleteJob(id);
      if (activeJobId === id) setActiveJobId(null);
      await refreshList();
    } catch (e) {
      alert(`删除失败: ${e.response?.data?.detail || e.message}`);
    }
  };

  const startNew = () => setActiveJobId('__new__');

  const view = useMemo(() => {
    if (activeJobId === '__new__') {
      return <InputForm onSubmit={handleCreate} submitting={creating} />;
    }
    if (!activeJob) {
      return (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
          {jobs.length === 0 ? '点击右上「新建复刻作业」开始' : '请选择一个作业'}
        </div>
      );
    }
    if (activeJob.status === 'awaiting_llm_input') {
      return <AwaitingLLMOutput job={activeJob} onSubmitted={refreshActive} />;
    }
    if (activeJob.status === 'completed') {
      return <GUList job={activeJob} onChange={refreshActive} />;
    }
    if (activeJob.status === 'processing') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
          <Loader2 size={42} className="animate-spin" style={{ color: 'var(--accent)' }} />
          <div className="text-base font-medium">Gemini 正在分析样片…</div>
          <div className="text-xs text-center max-w-md" style={{ color: 'var(--text-tertiary)' }}>
            {activeJob.progress_message || '正在调用模型，30-90 秒后自动出结果'}
            <br />模型：{activeJob.gemini_model || activeJob.gemini_model_used || '默认'}
          </div>
        </div>
      );
    }
    if (activeJob.status === 'failed') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8">
          <AlertCircle size={42} style={{ color: '#ef4444' }} />
          <div className="text-base font-medium">作业失败</div>
          <div className="text-xs text-center max-w-2xl px-4 py-3 rounded-lg whitespace-pre-wrap break-words"
               style={{ background: '#7f1d1d22', color: '#fca5a5', border: '1px solid #7f1d1d' }}>
            {activeJob.progress_message || '未知错误'}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            可删除作业后重新提交，或在 LLM 模型下拉里换一个再试
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
        作业状态：{STATUS_LABEL[activeJob.status] || activeJob.status}
      </div>
    );
  }, [activeJobId, activeJob, jobs, creating]);

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--surface-0)' }}>
      {/* 左边作业列表 */}
      <aside className="flex flex-col flex-shrink-0 border-r" style={{ width: 260, borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            <Copy size={18} />
            <span className="font-semibold">复刻视频</span>
          </div>
          <button
            onClick={startNew}
            className="p-1.5 rounded-lg transition"
            style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
            title="新建作业"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto py-2">
          {jobs.length === 0 && (
            <div className="px-4 py-6 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              暂无作业。点击右上 + 新建。
            </div>
          )}
          {jobs.map(j => (
            <div
              key={j.id}
              onClick={() => setActiveJobId(j.id)}
              className="group px-4 py-2.5 cursor-pointer flex items-start justify-between gap-2 transition"
              style={{
                background: activeJobId === j.id ? 'var(--accent-subtle)' : 'transparent',
              }}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {j.title}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {STATUS_LABEL[j.status] || j.status}
                  {j.gu_count ? ` · ${j.gu_count} GU` : ''}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(j.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded transition"
                style={{ color: 'var(--text-tertiary)' }}
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* 右边主区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
            加载中…
          </div>
        ) : view}
      </main>
    </div>
  );
}
