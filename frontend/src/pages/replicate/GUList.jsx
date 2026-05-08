import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, CheckCheck, ImageIcon, Film, Loader2 } from 'lucide-react';
import { listGUs, generateImage, generateVideo } from '../../api/replicate';

const STATUS_LABEL = {
  queued: '排队中',
  running: '生成中',
  success: '已完成',
  failed: '失败',
  retry: '重试',
};

export default function GUList({ job, onChange }) {
  const [gus, setGUs] = useState([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  const fetchList = useCallback(async () => {
    if (!job?.id) return;
    setLoading(true);
    try {
      const list = await listGUs(job.id);
      setGUs(list);
    } catch (e) {
      console.error('listGUs failed', e);
    } finally {
      setLoading(false);
    }
  }, [job?.id]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // 轮询：只要还有任意一个 GU 的子任务在 queued/running 就 5s 拉一次
  useEffect(() => {
    const hasInflight = gus.some(g =>
      ['queued', 'running'].includes(g.image_task?.status) ||
      ['queued', 'running'].includes(g.video_task?.status)
    );
    if (!hasInflight) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(fetchList, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [gus, fetchList]);

  const triggerImage = async (guId) => {
    try {
      await generateImage(job.id, guId, { model: 'GPT-images2 1:1' });
      fetchList();
    } catch (e) {
      alert(`出图失败：${e.response?.data?.detail || e.message}`);
    }
  };

  const triggerVideo = async (guId) => {
    try {
      await generateVideo(job.id, guId, { model: 'veo_3_1_i2v_s_fast_portrait_ultra_fl' });
      fetchList();
    } catch (e) {
      alert(`出视频失败：${e.response?.data?.detail || e.message}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-8 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <h2 className="text-lg font-semibold">{job.title}</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            共 {gus.length} 个 GU · 每张 9宫格图代表 15 秒，每段视频对应一个 GU 节奏
          </p>
        </div>
        <button
          onClick={fetchList}
          disabled={loading}
          className="px-3 py-1.5 rounded-md text-xs"
          style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
        >
          {loading ? '刷新中…' : '刷新状态'}
        </button>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {gus.map(gu => (
            <GUCard
              key={gu.gu_id}
              gu={gu}
              onGenerateImage={() => triggerImage(gu.gu_id)}
              onGenerateVideo={() => triggerVideo(gu.gu_id)}
            />
          ))}
        </div>
        {gus.length === 0 && !loading && (
          <div className="text-center py-16" style={{ color: 'var(--text-tertiary)' }}>
            未解析到任何 GU
          </div>
        )}
      </div>
    </div>
  );
}

function GUCard({ gu, onGenerateImage, onGenerateVideo }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <span className="text-sm font-semibold">GU {gu.gu_id}</span>
      </div>

      <div className="grid grid-cols-2 divide-x" style={{ borderColor: 'var(--border-subtle)' }}>
        {/* 产线 A — HOLO GPT-images2 (1:1) */}
        <PipelineColumn
          icon={<ImageIcon size={14} />}
          label="产线 A · 9宫格图（HOLO GPT-images2 · 1:1）"
          prompt={gu.pipeline_a_image}
          taskState={gu.image_task}
          onGenerate={onGenerateImage}
          mediaType="image"
        />
        {/* 产线 B — 暂未开通，按钮 disabled，仍展示提示词 + 复制 */}
        <PipelineColumn
          icon={<Film size={14} />}
          label="产线 B · 15秒视频（暂未开通）"
          prompt={gu.pipeline_b_video}
          taskState={gu.video_task}
          onGenerate={onGenerateVideo}
          mediaType="video"
          disabled={true}
        />
      </div>
    </div>
  );
}

function PipelineColumn({ icon, label, prompt, taskState, onGenerate, mediaType, disabled = false }) {
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      alert('复制失败');
    }
  };

  const inflight = ['queued', 'running'].includes(taskState?.status);
  const succeeded = taskState?.status === 'success';
  const failed = taskState?.status === 'failed';

  return (
    <div className="flex flex-col" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <span className="text-xs font-medium flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          {icon}{label}
        </span>
        <button
          onClick={copyPrompt}
          disabled={!prompt}
          className="px-2 py-0.5 rounded text-[10px] flex items-center gap-1"
          style={{ background: copied ? 'var(--accent-subtle)' : 'var(--surface-2)', color: copied ? 'var(--accent)' : 'var(--text-secondary)' }}
        >
          {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      <pre className="flex-1 overflow-auto px-3 py-2 text-[11px] whitespace-pre-wrap font-mono leading-snug max-h-44"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {prompt || '（无提示词）'}
      </pre>

      <div className="px-3 py-2.5 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        {succeeded && taskState?.output_file && (
          <div className="mb-2">
            {mediaType === 'image' ? (
              <img src={`/${taskState.output_file}`} alt="" className="w-full rounded" />
            ) : (
              <video src={`/${taskState.output_file}`} controls className="w-full rounded" />
            )}
          </div>
        )}
        {failed && (
          <div className="text-[11px] mb-2 px-2 py-1 rounded" style={{ background: '#7f1d1d33', color: '#fca5a5' }}>
            ❌ {taskState.error_message || '生成失败'}
          </div>
        )}
        <button
          onClick={onGenerate}
          disabled={disabled || inflight || !prompt}
          className="w-full px-2 py-1.5 rounded text-xs flex items-center justify-center gap-1.5 transition"
          style={{
            background: disabled ? 'var(--surface-3)' : (inflight ? 'var(--surface-3)' : (succeeded ? 'var(--surface-2)' : 'var(--accent)')),
            color: disabled ? 'var(--text-tertiary)' : (inflight ? 'var(--text-tertiary)' : (succeeded ? 'var(--text-secondary)' : '#fff')),
            cursor: (disabled || inflight || !prompt) ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.55 : 1,
          }}
          title={disabled ? '产线 B 暂未开通，仅展示提示词供复制使用' : undefined}
        >
          {inflight && <Loader2 size={12} className="animate-spin" />}
          {disabled
            ? '暂未开通（可复制提示词）'
            : inflight
              ? STATUS_LABEL[taskState?.status] || '处理中'
              : succeeded
                ? '重新生成'
                : (mediaType === 'image' ? '一键出图' : '一键出视频')}
        </button>
      </div>
    </div>
  );
}
