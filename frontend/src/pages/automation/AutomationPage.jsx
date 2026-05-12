import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Zap, Play, Pause, Square, Save, Edit3, Trash2, FolderOpen, Upload, X, Image as ImageIcon } from 'lucide-react';
import api from '../../api/client';
import useTaskStore from '../../stores/useTaskStore';
import { copyToClipboard } from '../../utils/clipboard';
import FolderPickerBar from '../../components/FolderPickerBar';
import { useAutoSaveFolder } from '../../hooks/useAutoSaveFolder';

const B5_MAX_TASKS = 5;
const B4_SLOTS = 5;
const CONCURRENCY_OPTIONS = [1, 2, 3, 5, 10];

// 默认模型
const DEFAULT_MODEL = 'dreamina/seedance2.0fast-omniref';

// ---------- localStorage helpers ----------
const LS_ACTIVE_KEY = 'auto_active_task_id';
const LS_TASK_KEY = (n) => `auto_task_${n}_config`;
const LS_SLOTS_KEY = 'auto_saved_slots';
const LS_RECENT_KEY = 'auto_recent_prompts';

const loadJSON = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback; }
  catch { return fallback; }
};
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('LS write fail', k, e); } };

const makeEmptyTask = (id) => ({
  id, name: `任务 ${id}`, prompt: '', model: DEFAULT_MODEL, concurrency: 1, productImage: null,
  rounds: 50,
  runtime: {
    running: false, paused: false, cancelled: false,
    completedRounds: 0, failedRounds: 0, totalRounds: 0,
    groupIds: [], thumbnails: [], log: [],
  },
});

const loadTask = (id) => {
  const saved = loadJSON(LS_TASK_KEY(id), null);
  const empty = makeEmptyTask(id);
  if (!saved) return empty;
  return {
    ...empty,
    name: saved.name || `任务 ${id}`,
    prompt: saved.prompt || '',
    model: saved.model || DEFAULT_MODEL,
    concurrency: saved.concurrency || 1,
    productImage: saved.productImage || null,
    rounds: saved.rounds || 50,
    runtime: {
      ...empty.runtime,
      // 恢复已提交的 groupIds —— 4s 轮询会重建 thumbnails / completed / failed
      groupIds: Array.isArray(saved.groupIds) ? saved.groupIds : [],
      totalRounds: saved.totalRounds || 0,
    },
  };
};

const saveTaskConfig = (task) => {
  saveJSON(LS_TASK_KEY(task.id), {
    name: task.name, prompt: task.prompt, model: task.model,
    concurrency: task.concurrency, productImage: task.productImage,
    rounds: task.rounds,
    // 持久化运行态：刷新页面后还能看到已发起的批次
    groupIds: task.runtime?.groupIds || [],
    totalRounds: task.runtime?.totalRounds || 0,
  });
};

// ---------- 模型下拉 options（跟 /i2v ToolPanel 一致，hard-code 9:16 portrait 主流场景）----------
function ModelDropdown({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="mt-1 flex h-9 w-full rounded-md px-3 py-2 text-sm cursor-pointer"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
      <option disabled>──── HOLO ────</option>
      <option value="veo_3_1_i2v_lite_portrait">I2V Lite 竖屏 720p (~55c)</option>
      <option value="veo_3_1_i2v_fast_portrait">I2V Fast 竖屏 720p (~65c)</option>
      <option value="veo_3_1_i2v_s_portrait">I2V Quality 竖屏 720p (~114c)</option>
      <option value="veo_3_1_i2v_fast_portrait_4k">I2V Fast 竖屏 4K (~110c)</option>
      <option disabled>──── HOLO · Sora 2 ────</option>
      <option value="Sora-2-12">HOLO · Sora-2 (12s)</option>
      <option value="Sora-2-16">HOLO · Sora-2 (16s)</option>
      <option disabled>──── Flow2API ────</option>
      <option value="flow2api/veo_3_1_i2v_s_fast_portrait_ultra_fl">Flow2API · I2V Fast 竖屏</option>
      <option value="flow2api/veo_3_1_r2v_fast_portrait">Flow2API · R2V 竖屏 (多图参考)</option>
      <option value="veo_i2v_lite">VEO 3.1 I2V Lite — 首帧</option>
      <option value="veo_interpolation_lite">VEO 3.1 Interpolation Lite — 首尾帧</option>
      <option disabled>──── Dreamina（即梦）────</option>
      <option value="dreamina/seedance2.0fast">即梦 · seedance 2.0 fast (720p · 首帧 · 推荐)</option>
      <option value="dreamina/seedance2.0">即梦 · seedance 2.0 标准 (720p · 首帧)</option>
      <option value="dreamina/seedance2.0fast_vip">即梦 · seedance 2.0 fast · VIP (1080p · 首帧)</option>
      <option value="dreamina/seedance2.0_vip">即梦 · seedance 2.0 · VIP (1080p · 首帧)</option>
      <option value="dreamina/seedance2.0fast-omniref">即梦 · seedance 2.0 fast · 全能参考 (720p)</option>
      <option value="dreamina/seedance2.0-omniref">即梦 · seedance 2.0 标准 · 全能参考 (720p)</option>
      <option value="dreamina/seedance2.0fast_vip-omniref">即梦 · seedance 2.0 fast · VIP · 全能参考 (1080p)</option>
      <option value="dreamina/seedance2.0_vip-omniref">即梦 · seedance 2.0 · VIP · 全能参考 (1080p)</option>
      <option disabled>──── 第三方 · cc123.ai ────</option>
      <option value="cc123/sd-2">cc123 · sd-2 (Seedance 2.0 · 15s)</option>
      <option value="cc123/sd-2-vip">cc123 · sd-2-vip (Seedance 2.0 · 15s · 队列优先)</option>
      <option value="cc123/sora-2">cc123 · sora-2 (OpenAI Sora 2)</option>
      <option disabled>──── Grok ────</option>
      <option value="grok-imagine-video-i2v">Grok Imagine Video (Super+)</option>
    </select>
  );
}

// ---------- 主页面 ----------
export default function AutomationPage() {
  const taskProgressMap = useTaskStore((s) => s.taskProgressMap);

  // 5 个 task state（一次性初始化 from localStorage）
  const [tasks, setTasks] = useState(() => Array.from({ length: B5_MAX_TASKS }, (_, i) => loadTask(i + 1)));
  const [activeTaskId, setActiveTaskId] = useState(() => loadJSON(LS_ACTIVE_KEY, 1));
  const [savedSlots, setSavedSlots] = useState(() => loadJSON(LS_SLOTS_KEY, Array(B4_SLOTS).fill(null)));
  const [globalLog, setGlobalLog] = useState([]);
  const [editingSlot, setEditingSlot] = useState(null);  // { idx, name, prompt, isNew }

  // task runner refs（避免 closure stale）
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // 本地文件夹 auto-save（automation scope）
  const { saveFromUrl: saveAutoToFolder, handle: autoFolderHandle } = useAutoSaveFolder('automation');
  const autoSavedRef = useRef(new Set());

  // 监听所有 task 的 thumbnails，success 视频自动写入用户绑定文件夹
  useEffect(() => {
    if (!autoFolderHandle) return;
    const candidates = [];
    for (const t of tasks) {
      for (const th of (t.runtime?.thumbnails || [])) {
        if (th.status === 'success' && th.output && th.taskId && !autoSavedRef.current.has(th.taskId)) {
          candidates.push(th);
        }
      }
    }
    if (candidates.length === 0) return;
    candidates.forEach(async (th) => {
      const url = th.output.startsWith('/') ? th.output : `/${th.output}`;
      const filename = th.output.split('/').pop() || `auto-${th.taskId.slice(0, 8)}.mp4`;
      const r = await saveAutoToFolder(url, filename);
      if (r.ok) autoSavedRef.current.add(th.taskId);
    });
  }, [tasks, autoFolderHandle, saveAutoToFolder]);

  // 持久化 activeTaskId
  useEffect(() => { saveJSON(LS_ACTIVE_KEY, activeTaskId); }, [activeTaskId]);

  // 持久化所有 5 个 task（包含 runtime.groupIds），刷新页面后能继续轮询
  useEffect(() => {
    tasks.forEach(t => saveTaskConfig(t));
  }, [tasks]);

  // mount 时主动从后端拉所有 auto_task_id 标记的 group，灌回对应 task.runtime.groupIds
  // 应对场景：localStorage 丢失 / 切浏览器 / 第一次进 AutomationPage
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/tasks/');
        const byAutoTask = {};  // auto_task_id → set of group ids
        for (const g of res.data) {
          const cj = g.config_json || {};
          const aid = cj.auto_task_id;
          if (!aid) continue;
          if (!byAutoTask[aid]) byAutoTask[aid] = new Set();
          byAutoTask[aid].add(g.id);
        }
        if (Object.keys(byAutoTask).length === 0) return;
        setTasks(prev => prev.map(t => {
          const recovered = byAutoTask[t.id];
          if (!recovered || recovered.size === 0) return t;
          const merged = Array.from(new Set([...(t.runtime.groupIds || []), ...recovered]));
          if (merged.length === t.runtime.groupIds.length) return t;
          return {
            ...t,
            runtime: { ...t.runtime, groupIds: merged, totalRounds: Math.max(t.runtime.totalRounds || 0, merged.length) },
          };
        }));
      } catch (e) { console.warn('recover auto tasks failed', e); }
    })();
  }, []);  // 仅 mount 一次

  // 当前 task helper
  const activeTask = tasks[activeTaskId - 1];

  // 改 task 配置（不动 runtime）
  const updateActiveTask = useCallback((patch) => {
    setTasks(prev => {
      const next = [...prev];
      next[activeTaskId - 1] = { ...next[activeTaskId - 1], ...patch };
      saveTaskConfig(next[activeTaskId - 1]);
      return next;
    });
  }, [activeTaskId]);

  // 改特定 task runtime（runner 用）
  const updateTaskRuntime = useCallback((taskId, runtimePatch) => {
    setTasks(prev => {
      const next = [...prev];
      next[taskId - 1] = {
        ...next[taskId - 1],
        runtime: { ...next[taskId - 1].runtime, ...runtimePatch },
      };
      return next;
    });
  }, []);

  const appendTaskLog = useCallback((taskId, level, message) => {
    setTasks(prev => {
      const next = [...prev];
      const t = next[taskId - 1];
      const log = [...(t.runtime.log || []), { ts: Date.now(), level, message }].slice(-200);
      next[taskId - 1] = { ...t, runtime: { ...t.runtime, log } };
      return next;
    });
  }, []);

  const appendGlobalLog = useCallback((level, message) => {
    setGlobalLog(prev => [...prev, { ts: Date.now(), level, message }].slice(-300));
  }, []);

  // ---------- 收藏槽 ----------
  const persistSlots = useCallback((next) => {
    setSavedSlots(next);
    saveJSON(LS_SLOTS_KEY, next);
  }, []);

  const openEditSlot = (idx) => {
    const cur = savedSlots[idx];
    setEditingSlot({
      idx, isNew: !cur,
      name: cur?.name || '',
      prompt: cur?.prompt || activeTask.prompt,
    });
  };
  const saveEditSlot = () => {
    if (!editingSlot) return;
    if (!editingSlot.name.trim() || !editingSlot.prompt.trim()) {
      alert('名称和提示词都不能为空');
      return;
    }
    const next = [...savedSlots];
    next[editingSlot.idx] = { name: editingSlot.name.trim(), prompt: editingSlot.prompt };
    persistSlots(next);
    setEditingSlot(null);
  };
  const loadSlot = (idx) => {
    const s = savedSlots[idx];
    if (s) updateActiveTask({ prompt: s.prompt });
  };
  const clearSlot = (idx) => {
    if (!window.confirm(`确认清空收藏槽 ${idx + 1}?`)) return;
    const next = [...savedSlots];
    next[idx] = null;
    persistSlots(next);
  };

  // ---------- 文件上传 ----------
  const fileInputRef = useRef(null);
  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('图片不能超过 10MB'); return; }
    const fd = new FormData();
    fd.append('files', file);
    try {
      const res = await api.post('/upload/', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const path = res.data.paths?.[0];
      if (!path) throw new Error('upload returned no path');
      updateActiveTask({ productImage: path });
      appendGlobalLog('ok', `产品图上传成功: ${path}`);
    } catch (err) {
      alert('上传失败: ' + (err.response?.data?.detail || err.message));
    }
    e.target.value = '';
  };

  // ---------- 任务发起 ----------
  const submitOneRound = async (task, roundIdx) => {
    const body = {
      title: `${task.name} · 第 ${roundIdx + 1} 轮`,
      task_type: 'image_to_video',
      source: 'FISSION',
      global_prompt: task.prompt,
      config_json: {
        model: task.model, aspectRatio: '9:16', count: 1,
        auto_task_id: task.id, auto_round_index: roundIdx + 1,
      },
      tasks: [{ prompt: '', input_files: task.productImage ? [task.productImage] : [] }],
    };
    const res = await api.post('/tasks/', body);
    return res.data.id;
  };

  // ---------- task runner ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const runTask = async (taskId) => {
    // 标记 running
    updateTaskRuntime(taskId, {
      running: true, paused: false, cancelled: false,
      completedRounds: 0, failedRounds: 0,
      groupIds: [], thumbnails: [], log: [],
    });
    const startTask = tasksRef.current[taskId - 1];
    const rounds = startTask.rounds;
    const concurrency = startTask.concurrency;

    updateTaskRuntime(taskId, { totalRounds: rounds });
    appendTaskLog(taskId, 'ok', `启动批次: 共 ${rounds} 轮, 并发 ${concurrency}`);
    appendGlobalLog('ok', `[${startTask.name}] 启动 ${rounds} 轮`);

    if (!startTask.prompt.trim()) {
      appendTaskLog(taskId, 'err', '提示词为空，已停止');
      updateTaskRuntime(taskId, { running: false });
      return;
    }
    if (!startTask.productImage) {
      appendTaskLog(taskId, 'err', '产品图未上传，已停止');
      updateTaskRuntime(taskId, { running: false });
      return;
    }

    for (let r = 0; r < rounds; r++) {
      // 检查暂停
      while (true) {
        const cur = tasksRef.current[taskId - 1];
        if (cur.runtime.cancelled) {
          appendTaskLog(taskId, 'warn', '已取消，剩余轮次终止');
          updateTaskRuntime(taskId, { running: false });
          return;
        }
        if (!cur.runtime.paused) break;
        await sleep(1000);
      }

      // 检查 task 内并发：count(groupIds 中还在跑的)
      while (true) {
        const cur = tasksRef.current[taskId - 1];
        if (cur.runtime.cancelled) {
          updateTaskRuntime(taskId, { running: false });
          return;
        }
        const inflight = cur.runtime.groupIds.length - cur.runtime.completedRounds - cur.runtime.failedRounds;
        if (inflight < concurrency) break;
        await sleep(2000);
      }

      // 提交本轮
      try {
        const gid = await submitOneRound(tasksRef.current[taskId - 1], r);
        setTasks(prev => {
          const next = [...prev];
          const t = next[taskId - 1];
          next[taskId - 1] = { ...t, runtime: { ...t.runtime, groupIds: [...t.runtime.groupIds, gid] } };
          return next;
        });
        appendTaskLog(taskId, 'ok', `第 ${r + 1}/${rounds} 轮已提交 group=${gid.slice(0, 8)}`);
      } catch (e) {
        setTasks(prev => {
          const next = [...prev];
          const t = next[taskId - 1];
          next[taskId - 1] = { ...t, runtime: { ...t.runtime, failedRounds: t.runtime.failedRounds + 1 } };
          return next;
        });
        appendTaskLog(taskId, 'err', `第 ${r + 1} 轮提交失败: ${e.response?.data?.detail || e.message}`);
      }

      await sleep(800);  // 避免短时间频繁 POST
    }

    appendTaskLog(taskId, 'ok', `全部 ${rounds} 轮已提交`);
    updateTaskRuntime(taskId, { running: false });
  };

  // 轮询同步完成的 group + 把 group.progress_message 增量加进日志
  // 后端 dreamina_batch 每 60s 通过 progress_callback 把 dreamina 上游
  // 实时状态（队列位置、已耗时、本批完成数、dreamina credits 等）
  // 写到 group.progress_message。前端 4s 拉一次，message 变化时追加日志。
  const lastSeenProgressRef = useRef({});  // groupId → 上次见到的 progress_message
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await api.get('/tasks/');
        const groupsById = new Map(res.data.map(g => [g.id, g]));
        setTasks(prev => prev.map(task => {
          if (task.runtime.groupIds.length === 0) return task;
          let completed = 0, failed = 0;
          const thumbnails = [];
          const newLogEntries = [];
          for (const gid of task.runtime.groupIds) {
            const g = groupsById.get(gid);
            if (!g) continue;
            const subTasks = g.tasks || [];
            // ① 把 group.progress_message 增量加日志（仅当 dreamina 推了新内容）
            const progMsg = (g.progress_message || '').trim();
            if (progMsg) {
              const lastSeen = lastSeenProgressRef.current[gid];
              if (lastSeen !== progMsg) {
                lastSeenProgressRef.current[gid] = progMsg;
                newLogEntries.push({
                  ts: Date.now(),
                  level: 'ok',
                  message: `group ${gid.slice(0, 8)}: ${progMsg}`,
                });
              }
            }
            // ② 统计 + 缩略图（含 progress_message 给 tooltip）
            for (const t of subTasks) {
              const status = (t.status || '').toLowerCase();
              if (status === 'success') {
                completed++;
                thumbnails.push({ groupId: gid, taskId: t.id, status: 'success', output: t.output_file, thumbnail: t.output_thumbnail, progress: progMsg });
              } else if (status === 'failed') {
                failed++;
                thumbnails.push({ groupId: gid, taskId: t.id, status: 'failed', error: t.error_message, progress: progMsg });
              } else {
                thumbnails.push({ groupId: gid, taskId: t.id, status: status || 'queued', progress: progMsg });
              }
            }
          }
          // 把新日志条目并入 task.runtime.log（cap 200）
          const log = newLogEntries.length
            ? [...(task.runtime.log || []), ...newLogEntries].slice(-200)
            : task.runtime.log;
          return {
            ...task,
            runtime: {
              ...task.runtime,
              completedRounds: completed,
              failedRounds: failed,
              thumbnails,
              log,
            },
          };
        }));
      } catch (e) { /* silent */ }
    }, 4000);
    return () => clearInterval(t);
  }, []);

  // ---------- 全局动作 ----------
  const startAll = () => tasks.forEach(t => { if (!t.runtime.running) runTask(t.id); });
  const pauseAll = () => tasks.forEach(t => { if (t.runtime.running) updateTaskRuntime(t.id, { paused: true }); });
  const resumeAll = () => tasks.forEach(t => { if (t.runtime.running && t.runtime.paused) updateTaskRuntime(t.id, { paused: false }); });
  const cancelAll = () => {
    if (!window.confirm('确认取消所有正在跑的任务？已提交到 dreamina 上游的不会中断（dreamina 没 cancel CLI），但后续轮不再发起。')) return;
    tasks.forEach(t => { if (t.runtime.running) updateTaskRuntime(t.id, { cancelled: true, paused: false }); });
  };

  const runningCount = tasks.filter(t => t.runtime.running).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--surface-0)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header className="px-6 py-3 flex items-center gap-4 flex-shrink-0"
        style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="font-bold text-lg flex items-center gap-2"><Zap size={18} className="text-violet-400" /> 自动化批量生成</span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>🎨 提示词模板 → Doubao 洗稿 → 视频引擎 批量产出</span>
        <div className="ml-auto">
          <FolderPickerBar scopeKey="automation" label="批次视频自动保存" />
        </div>
      </header>

      {/* Global Toolbar (B5) */}
      <div className="px-6 py-3 flex items-center gap-3 flex-shrink-0"
        style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex gap-1.5 flex-1 flex-wrap">
          {tasks.map(t => (
            <button key={t.id} onClick={() => setActiveTaskId(t.id)}
              className="px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5"
              style={{
                background: activeTaskId === t.id ? 'var(--accent)' : 'var(--surface-2)',
                color: activeTaskId === t.id ? '#fff' : 'var(--text-secondary)',
                border: t.runtime.running ? '1px solid #10b981' : '1px solid var(--border-subtle)',
              }}>
              {t.name}
              {t.runtime.running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
              {t.runtime.paused && <span className="text-[9px]">⏸</span>}
              {t.runtime.totalRounds > 0 && <span className="text-[9px] opacity-70">{t.runtime.completedRounds + t.runtime.failedRounds}/{t.runtime.totalRounds}</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={startAll}
            className="px-2.5 py-1 rounded-md text-xs font-bold text-white" style={{ background: '#10b981' }}>
            ▶ 全部启动
          </button>
          <button onClick={pauseAll}
            className="px-2.5 py-1 rounded-md text-xs font-bold"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
            ⏸ 全部暂停
          </button>
          <button onClick={resumeAll}
            className="px-2.5 py-1 rounded-md text-xs font-bold"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
            ▶ 全部恢复
          </button>
          <button onClick={cancelAll}
            className="px-2.5 py-1 rounded-md text-xs font-bold"
            style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>
            ⏹ 全部取消
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
        <div className="grid grid-cols-12 gap-4">
          {/* Config Panel */}
          <div className="col-span-5 rounded-lg p-5 space-y-3"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
            <h2 className="text-base font-semibold">⚙️ ① {activeTask.name} 配置</h2>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>任务名称</label>
              <input type="text" value={activeTask.name}
                onChange={e => updateActiveTask({ name: e.target.value })}
                placeholder="例如 厨房展示"
                className="mt-1 flex h-9 w-full rounded-md px-3 py-2 text-sm"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>提示词模板</label>
              <textarea rows={8} value={activeTask.prompt}
                onChange={e => updateActiveTask({ prompt: e.target.value })}
                placeholder="完整描述模板。Doubao 会自动识别可变要素做随机替换 → 出 N 个变体..."
                className="mt-1 flex w-full rounded-md px-3 py-2 text-sm font-mono"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
            </div>

            {/* Saved Slots (B4) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>收藏槽 (B4)</label>
                <button onClick={() => {
                  if (!activeTask.prompt.trim()) { alert('当前任务提示词为空'); return; }
                  // 找第一个空槽，没有就让用户选
                  const emptyIdx = savedSlots.findIndex(s => !s);
                  if (emptyIdx === -1) { alert('5 个槽都满了，请直接编辑某个槽'); return; }
                  setEditingSlot({ idx: emptyIdx, isNew: true, name: activeTask.name, prompt: activeTask.prompt });
                }} className="text-[10px] px-2 py-0.5 rounded flex items-center gap-1"
                  style={{ background: 'var(--accent-subtle)', color: 'var(--accent-hover)' }}>
                  <Save size={10} /> 收藏当前
                </button>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {savedSlots.map((slot, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
                    <span className="w-5 text-center font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>#{idx + 1}</span>
                    {slot ? (
                      <>
                        <span className="flex-1 truncate font-medium">{slot.name}</span>
                        <button onClick={() => loadSlot(idx)} title="载入"
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>载入</button>
                        <button onClick={() => openEditSlot(idx)} title="编辑"
                          className="text-[10px] p-0.5 rounded hover:opacity-80"
                          style={{ color: 'var(--text-tertiary)' }}><Edit3 size={10} /></button>
                        <button onClick={() => clearSlot(idx)} title="清空"
                          className="text-[10px] p-0.5 rounded hover:opacity-80"
                          style={{ color: '#f87171' }}><Trash2 size={10} /></button>
                      </>
                    ) : (
                      <span className="flex-1 italic" style={{ color: 'var(--text-tertiary)' }}>空槽，点收藏当前可填</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>视频模型</label>
              <ModelDropdown value={activeTask.model} onChange={v => updateActiveTask({ model: v })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>并发数</label>
                <select value={activeTask.concurrency} onChange={e => updateActiveTask({ concurrency: parseInt(e.target.value) })}
                  className="mt-1 flex h-9 w-full rounded-md px-3 py-2 text-sm cursor-pointer"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                  {CONCURRENCY_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>总轮次</label>
                <input type="number" min={1} max={999} value={activeTask.rounds}
                  onChange={e => updateActiveTask({ rounds: Math.max(1, Math.min(999, parseInt(e.target.value || 1))) })}
                  className="mt-1 flex h-9 w-full rounded-md px-3 py-2 text-sm font-bold"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>产品图（所有轮共用）</label>
              <div className="mt-1 flex items-center gap-2">
                <button onClick={() => fileInputRef.current?.click()}
                  className="px-3 h-9 rounded-md text-sm font-medium flex items-center gap-1.5"
                  style={{ background: 'var(--accent-subtle)', color: 'var(--accent-hover)', border: '1px solid var(--accent-muted)' }}>
                  <Upload size={13} /> 上传
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFilePick} />
                <span className="flex-1 truncate text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {activeTask.productImage || '未选择'}
                </span>
                {activeTask.productImage && (
                  <button onClick={() => updateActiveTask({ productImage: null })}
                    className="p-1 rounded hover:opacity-80" style={{ color: '#f87171' }}>
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <button onClick={() => runTask(activeTask.id)}
              disabled={activeTask.runtime.running}
              className="w-full h-10 rounded-md font-bold text-sm flex items-center justify-center gap-2 text-white disabled:opacity-50"
              style={{ background: activeTask.runtime.running ? 'var(--surface-3)' : 'linear-gradient(135deg, var(--accent), #8b5cf6)' }}>
              {activeTask.runtime.running ? '运行中...' : <><Play size={14} /> 🚀 启动批次（{activeTask.rounds} 轮）</>}
            </button>
            {activeTask.runtime.running && (
              <div className="flex gap-2">
                <button onClick={() => updateTaskRuntime(activeTask.id, { paused: !activeTask.runtime.paused })}
                  className="flex-1 h-8 rounded-md text-xs font-bold"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                  {activeTask.runtime.paused ? <><Play size={11} className="inline" /> 恢复</> : <><Pause size={11} className="inline" /> 暂停</>}
                </button>
                <button onClick={() => {
                  if (window.confirm('取消本任务？已 submit 的不打断')) updateTaskRuntime(activeTask.id, { cancelled: true });
                }} className="flex-1 h-8 rounded-md text-xs font-bold"
                  style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>
                  <Square size={11} className="inline" /> 取消
                </button>
              </div>
            )}
          </div>

          {/* Progress Pane */}
          <div className="col-span-7 rounded-lg p-5 space-y-3"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
            <h2 className="text-base font-semibold flex items-center justify-between">
              <span>📊 ② {activeTask.name} 进度</span>
              <span className="text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>
                完成 {activeTask.runtime.completedRounds} / 失败 {activeTask.runtime.failedRounds} / 已提交 {activeTask.runtime.groupIds.length} / 总 {activeTask.runtime.totalRounds || activeTask.rounds}
              </span>
            </h2>

            {activeTask.runtime.thumbnails.length > 0 ? (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
                {activeTask.runtime.thumbnails.slice(0, 200).map((th, i) => (
                  <div key={`${th.taskId || i}-${i}`} className="relative rounded overflow-hidden group"
                    style={{ aspectRatio: '9/16', background: 'var(--surface-3)' }}
                    title={th.error || th.progress || ''}>
                    {th.status === 'success' && th.thumbnail && (
                      <img src={`/${th.thumbnail}`} className="w-full h-full object-cover" />
                    )}
                    <span className="absolute left-0.5 top-0.5 text-[9px] px-1 rounded bg-black/60 text-white">{i + 1}</span>
                    <span className="absolute right-0.5 top-0.5 text-[9px] px-1 rounded text-white"
                      style={{ background: th.status === 'success' ? '#10b981' : th.status === 'failed' ? '#ef4444' : '#3b82f6' }}>
                      {th.status === 'success' ? 'OK' : th.status === 'failed' ? 'ERR' : th.status === 'running' ? 'RUN' : 'WAIT'}
                    </span>
                    {/* running / queued 状态显示 progress 文字 */}
                    {th.status !== 'success' && th.status !== 'failed' && th.progress && (
                      <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[8px] leading-tight text-white bg-black/70 max-h-12 overflow-hidden">
                        {th.progress.length > 60 ? th.progress.slice(0, 60) + '...' : th.progress}
                      </div>
                    )}
                    {th.status === 'success' && th.output && (
                      <a href={`/${th.output}`} target="_blank" rel="noreferrer" download
                        className="absolute inset-0 bg-black/0 hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 text-white text-[10px] font-bold">
                        下载
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-xs rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-tertiary)' }}>
                还没有任务，点击"启动批次"开始
              </div>
            )}

            {/* per-task log */}
            <div className="mt-3">
              <details>
                <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  任务日志 ({activeTask.runtime.log?.length || 0})
                </summary>
                <div className="mt-2 max-h-40 overflow-y-auto p-2 rounded font-mono text-[11px] space-y-0.5 custom-scrollbar"
                  style={{ background: 'var(--surface-0)' }}>
                  {(activeTask.runtime.log || []).slice().reverse().map((l, i) => (
                    <div key={i} className={l.level === 'err' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-emerald-400'}>
                      [{new Date(l.ts).toLocaleTimeString()}] {l.message}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        </div>

        {/* Global Log */}
        <details className="mt-4 rounded-lg px-5 py-3"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            全局日志 ({globalLog.length})
          </summary>
          <div className="mt-2 max-h-72 overflow-y-auto p-2 rounded font-mono text-[11px] space-y-0.5 custom-scrollbar"
            style={{ background: 'var(--surface-0)' }}>
            {globalLog.slice().reverse().map((l, i) => (
              <div key={i} className={l.level === 'err' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-emerald-400'}>
                [{new Date(l.ts).toLocaleTimeString()}] {l.message}
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* Edit Slot Dialog */}
      {editingSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-lg rounded-2xl p-6 space-y-3"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="text-lg font-bold">{editingSlot.isNew ? '收藏到槽' : '编辑收藏'} #{editingSlot.idx + 1}</h3>
            <div>
              <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>名称</label>
              <input value={editingSlot.name} maxLength={40}
                onChange={e => setEditingSlot(s => ({ ...s, name: e.target.value }))}
                className="mt-1 flex h-9 w-full rounded-md px-3 py-2 text-sm"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>提示词模板</label>
              <textarea rows={8} value={editingSlot.prompt}
                onChange={e => setEditingSlot(s => ({ ...s, prompt: e.target.value }))}
                className="mt-1 flex w-full rounded-md px-3 py-2 text-xs font-mono"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingSlot(null)}
                className="px-4 h-9 rounded-md text-sm"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={saveEditSlot}
                className="px-4 h-9 rounded-md text-sm font-bold text-white"
                style={{ background: 'var(--accent)' }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
