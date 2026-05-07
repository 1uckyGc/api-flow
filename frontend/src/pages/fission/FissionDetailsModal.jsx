import React from 'react';
import { X, Activity, Terminal, Layers, Settings, FileCode, Cpu, Clock, Fingerprint, ShieldCheck } from 'lucide-react';

export default function FissionDetailsModal({ job, onClose }) {
  if (!job) return null;
  const fissionPrompts = job.config_json?.fission_prompts || [];
  const tasks = job.tasks || [];
  
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 md:p-8"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(16px)' }}
      onClick={onClose}>
      <div className="w-full max-w-5xl h-[85vh] rounded-3xl flex flex-col overflow-hidden shadow-2xl slide-up border border-[var(--border-subtle)]"
        style={{ background: 'var(--surface-2)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-8 py-5 flex justify-between items-center shrink-0 border-b border-[var(--border-subtle)] bg-[var(--surface-3)]/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent)] flex items-center justify-center shadow-lg shadow-[var(--accent-subtle)]">
              <ShieldCheck size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-display font-black text-[var(--text-primary)] tracking-tight">工作流全链路审计</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-tertiary)] flex items-center gap-1">
                  <Fingerprint size={10} /> {job.id}
                </span>
                <span className="w-1 h-1 rounded-full bg-[var(--border-default)]"></span>
                <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest flex items-center gap-1">
                  <Activity size={10} /> 系统可信合规
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--surface-4)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-1)] transition-all border border-[var(--border-subtle)]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar: Metadata */}
          <div className="w-72 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--surface-1)]/30 overflow-y-auto custom-scrollbar p-6 space-y-8">
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] mb-4 flex items-center gap-2">
                <Settings size={12} /> 元数据配置
              </h3>
              <div className="space-y-4">
                {[
                  { label: "任务类型", value: job.task_type, icon: Layers },
                  { label: "指令来源", value: job.source, icon: Terminal },
                  { label: "当前阶段", value: job.fission_stage || "ROOT", icon: Cpu },
                  { label: "运行状态", value: job.status, icon: Activity, color: job.status === 'completed' ? 'text-emerald-400' : 'text-amber-400' },
                  { label: "创建时间", value: new Date(job.created_at).toLocaleString(), icon: Clock },
                ].map((item, idx) => (
                  <div key={idx} className="group">
                    <div className="text-[10px] text-[var(--text-tertiary)] mb-1 flex items-center gap-1.5">
                      <item.icon size={10} className="group-hover:text-[var(--accent)] transition-colors" />
                      {item.label}
                    </div>
                    <div className={`text-xs font-mono font-bold break-all ${item.color || 'text-[var(--text-secondary)]'}`}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="pt-6 border-t border-[var(--border-subtle)]">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] mb-4">执行概览</h3>
              <div className="bg-[var(--surface-0)] rounded-xl p-4 border border-[var(--border-subtle)]">
                <div className="text-2xl font-black text-[var(--text-primary)] mb-1">{tasks.length}</div>
                <div className="text-[10px] text-[var(--text-tertiary)] uppercase font-bold tracking-wider">总计生成分身</div>
              </div>
            </section>
          </div>

          {/* Main Content: Pipeline */}
          <div className="flex-1 overflow-y-auto custom-scrollbar bg-[var(--surface-0)]/50 p-8 space-y-10">
            {/* Stage 1: Global Input */}
            <section className="relative pl-8">
              <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-[var(--accent)] to-transparent opacity-20"></div>
              <div className="absolute left-[-4px] top-0 w-2 h-2 rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--accent)]"></div>
              
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)]">STEP 01: 原始输入语义</h3>
                <span className="px-2 py-0.5 rounded bg-[var(--accent-subtle)] text-[var(--accent)] text-[9px] font-black uppercase">GLOBAL PROMPT</span>
              </div>
              
              <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-2xl p-6 shadow-xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-3 opacity-5 text-[var(--accent)]"><Terminal size={64} /></div>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)] italic relative z-10 font-medium">
                  「 {job.global_prompt || "未提供全局内容"} 」
                </p>
              </div>
            </section>

            {/* Stage 2: LLM Creative */}
            <section className="relative pl-8">
              <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-fuchsia-500 to-transparent opacity-20"></div>
              <div className="absolute left-[-4px] top-0 w-2 h-2 rounded-full bg-fuchsia-500 shadow-[0_0_10px_rgba(217,70,239,0.5)]"></div>

              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)]">STEP 02: 创意引擎扩写</h3>
                <span className="px-2 py-0.5 rounded bg-fuchsia-500/10 text-fuchsia-400 text-[9px] font-black uppercase">DEEPSEEK REASONING</span>
              </div>

              {fissionPrompts.length > 0 ? (
                <div className="grid gap-3">
                  {fissionPrompts.map((p, i) => (
                    <div key={i} className="bg-[var(--surface-2)] border border-fuchsia-500/10 rounded-xl p-4 flex gap-4 hover:border-fuchsia-500/30 transition-all group">
                      <div className="shrink-0 w-6 h-6 rounded-lg bg-fuchsia-500/10 text-fuchsia-400 flex items-center justify-center font-mono text-[10px] font-bold">
                        {String(i + 1).padStart(2, '0')}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-normal group-hover:text-[var(--text-primary)] transition-colors">
                        {p}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 border border-dashed border-[var(--border-subtle)] rounded-2xl text-center">
                  <span className="text-xs text-[var(--text-tertiary)] italic">该阶段无扩写记录（推理任务积压或未触发扩散）</span>
                </div>
              )}
            </section>

            {/* Stage 3: Final Execution */}
            <section className="relative pl-8">
              <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-cyan-500 to-transparent opacity-20"></div>
              <div className="absolute left-[-4px] top-0 w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>

              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)]">STEP 03: 最终执行流水线</h3>
                <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[9px] font-black uppercase">FINAL PROMPTS</span>
              </div>

              <div className="space-y-4">
                {tasks.map((task, i) => (
                  <div key={task.id} className="bg-[var(--surface-1)] border border-cyan-500/5 rounded-2xl overflow-hidden group hover:border-cyan-500/20 transition-all shadow-sm">
                    <div className="px-4 py-2 bg-cyan-500/5 flex justify-between items-center border-b border-cyan-500/10">
                      <span className="text-[9px] font-black text-cyan-400 uppercase tracking-tighter flex items-center gap-1.5">
                        <FileCode size={10} /> ATOMIC TASK #{i+1}
                      </span>
                      <span className="text-[9px] font-mono text-cyan-700/50">ID: {task.id.substring(0, 8)}</span>
                    </div>
                    <div className="p-4 bg-[var(--surface-3)]/30">
                      <p className="text-xs font-mono leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap group-hover:text-[var(--text-primary)] transition-colors">
                        {task.prompt}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 shrink-0 bg-[var(--surface-3)]/80 border-t border-[var(--border-subtle)] backdrop-blur-md flex justify-between items-center">
          <div className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1.5">
             <ShieldCheck size={12} className="text-emerald-500" />
             <span>审计加密受保护，仅当前工作区可见</span>
          </div>
          <button onClick={onClose}
            className="px-8 py-2.5 rounded-xl bg-[var(--accent)] text-white text-[11px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all shadow-lg shadow-[var(--accent-subtle)]"
          >
            完成审计
          </button>
        </div>
      </div>
    </div>
  );
}
