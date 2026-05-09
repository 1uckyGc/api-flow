import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, CheckCheck, ImageIcon, Film, Loader2, Settings } from 'lucide-react';
import { listGUs, generateImage, generateVideo } from '../../api/replicate';
import { copyToClipboard } from '../../utils/clipboard';

const STATUS_LABEL = {
  queued: '排队中',
  running: '生成中',
  success: '已完成',
  failed: '失败',
  retry: '重试',
};

// 视频模型分组：官方（即梦 Dreamina CLI）+ 第三方（cc123.ai relay）
const VIDEO_MODEL_GROUPS = [
  {
    label: '官方 · 即梦 Dreamina CLI',
    options: [
      { value: 'seedance2.0fast', label: 'seedance 2.0 fast · 默认 (720p)', vip: false },
      { value: 'seedance2.0fast_vip', label: 'seedance 2.0 fast · VIP (720p / 1080p)', vip: true },
      { value: 'seedance2.0', label: 'seedance 2.0 标准 (720p)', vip: false },
      { value: 'seedance2.0_vip', label: 'seedance 2.0 · VIP (720p / 1080p)', vip: true },
    ],
  },
  {
    label: '第三方 · cc123.ai relay',
    options: [
      { value: 'cc123/sd-2', label: 'cc123 · sd-2 标准 (Seedance 2.0)', vip: false },
      { value: 'cc123/sd-2-vip', label: 'cc123 · sd-2 VIP (1080p · 队列优先)', vip: true },
    ],
  },
];

// 平铺所有 model（用于 vip 检测等通用判断）
const ALL_VIDEO_MODELS = VIDEO_MODEL_GROUPS.flatMap(g => g.options);

const VIDEO_RESOLUTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p（仅 VIP）' },
];

export default function GUList({ job, onChange }) {
  const [gus, setGUs] = useState([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);
  const [videoModel, setVideoModel] = useState('seedance2.0fast');
  const [videoResolution, setVideoResolution] = useState('720p');

  const isVip = useMemo(() => videoModel.includes('vip'), [videoModel]);
  const isCC123 = useMemo(() => videoModel.startsWith('cc123/'), [videoModel]);

  // 模型切到非 VIP 时自动把分辨率打回 720p（避免提交 1080p 被后端 guard 强制改）
  useEffect(() => {
    if (!isVip && videoResolution !== '720p') setVideoResolution('720p');
  }, [isVip, videoResolution]);

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

  const triggerVideo = async (guId, gu) => {
    // 用户在顶部选了模型和分辨率 → 这两个总是覆盖 cli_payload；
    // duration 沿用 cli_payload (B-json 给的)；后端服务端 guard 会再校验
    // model 与 resolution 兼容（非 vip 强制 720p）。
    const payload = {
      model_version: videoModel,
      video_resolution: videoResolution,
    };
    try {
      await generateVideo(job.id, guId, payload);
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

      {/* 视频生成工具栏：全局选 model + resolution，影响所有「一键出视频」按钮 */}
      <div
        className="px-8 py-3 border-b flex items-center gap-3 flex-wrap"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
      >
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <Settings size={12} />
          产线 B 视频参数
        </div>

        <select
          value={videoModel}
          onChange={e => setVideoModel(e.target.value)}
          className="px-3 py-1.5 rounded-md text-xs outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
          title="选择视频生成 provider + 模型"
        >
          {VIDEO_MODEL_GROUPS.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <select
          value={videoResolution}
          onChange={e => setVideoResolution(e.target.value)}
          className="px-3 py-1.5 rounded-md text-xs outline-none"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
            opacity: isVip ? 1 : 0.6,
          }}
          title={isVip ? '分辨率（VIP 模型支持 1080p）' : '非 VIP 模型仅支持 720p'}
        >
          {VIDEO_RESOLUTIONS.map(r => (
            <option key={r.value} value={r.value} disabled={!isVip && r.value !== '720p'}>
              {r.label}
            </option>
          ))}
        </select>

        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {isCC123
            ? '🔌 第三方 cc123.ai relay · 纯 HTTP 不需要扫码登录 · 可能更快'
            : isVip
              ? '✓ VIP 通道：可选 1080p，队列更靠前，credits 消耗更高'
              : '官方即梦 · 提示：要 1080p / 队列优先级，选 VIP 模型'}
        </span>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {gus.map(gu => (
            <GUCard
              key={gu.gu_id}
              gu={gu}
              videoModel={videoModel}
              videoResolution={videoResolution}
              onGenerateImage={() => triggerImage(gu.gu_id)}
              onGenerateVideo={() => triggerVideo(gu.gu_id, gu)}
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

function GUCard({ gu, videoModel, videoResolution, onGenerateImage, onGenerateVideo }) {
  const isCC123 = videoModel.startsWith('cc123/');
  // 模型名简化展示
  let modelLabel;
  if (isCC123) {
    // cc123/sd-2 → "sd-2"；cc123/sd-2-vip → "sd-2 · VIP"
    modelLabel = videoModel.replace('cc123/', '').replace('-vip', ' · VIP');
  } else {
    // 即梦：seedance2.0fast_vip → "fast · VIP"
    const stripped = videoModel.replace('seedance2.0', '');
    modelLabel = stripped.replace(/^_/, '').replace('_vip', ' · VIP') || '标准';
  }
  const providerLabel = isCC123 ? 'cc123' : '即梦';

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
        {/* 产线 B — 视频（按顶部工具栏选 provider + model） */}
        <PipelineColumn
          icon={<Film size={14} />}
          label={`产线 B · 15秒视频（${providerLabel} seedance2.0 ${modelLabel} · ${videoResolution}）`}
          prompt={gu.pipeline_b_video}
          taskState={gu.video_task}
          onGenerate={onGenerateVideo}
          mediaType="video"
          payload={gu.cli_payload}
        />
      </div>
    </div>
  );
}

function PipelineColumn({ icon, label, prompt, taskState, onGenerate, mediaType, payload = null }) {
  const [copied, setCopied] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const copyPrompt = async () => {
    const ok = await copyToClipboard(prompt || '');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      alert('复制失败（浏览器拒绝写入剪贴板）');
    }
  };

  const copyJson = async () => {
    if (!payload) return;
    const ok = await copyToClipboard(JSON.stringify(payload, null, 2));
    if (ok) {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1500);
    } else {
      alert('复制 JSON 失败');
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
        <div className="flex items-center gap-1">
          {payload && (
            <button
              onClick={copyJson}
              className="px-2 py-0.5 rounded text-[10px] flex items-center gap-1"
              style={{ background: copiedJson ? 'var(--accent-subtle)' : 'var(--surface-2)', color: copiedJson ? 'var(--accent)' : 'var(--text-secondary)' }}
              title="复制 (B9) Dreamina CLI JSON"
            >
              {copiedJson ? <CheckCheck size={11} /> : <Copy size={11} />}
              {copiedJson ? '已复制 JSON' : 'JSON'}
            </button>
          )}
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
          disabled={inflight || !prompt}
          className="w-full px-2 py-1.5 rounded text-xs flex items-center justify-center gap-1.5 transition"
          style={{
            background: inflight ? 'var(--surface-3)' : (succeeded ? 'var(--surface-2)' : 'var(--accent)'),
            color: inflight ? 'var(--text-tertiary)' : (succeeded ? 'var(--text-secondary)' : '#fff'),
            cursor: (inflight || !prompt) ? 'not-allowed' : 'pointer',
          }}
        >
          {inflight && <Loader2 size={12} className="animate-spin" />}
          {inflight
            ? STATUS_LABEL[taskState?.status] || '处理中'
            : succeeded
              ? '重新生成'
              : (mediaType === 'image' ? '一键出图' : '一键出视频')}
        </button>
      </div>
    </div>
  );
}
