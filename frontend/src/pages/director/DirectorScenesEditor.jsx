import React, { useState } from 'react';
import { Sparkles, ArrowLeft, Image as ImageIcon } from 'lucide-react';

export default function DirectorScenesEditor({ scenes, onBack, onConfirm, submitting }) {
  const [editedScenes, setEditedScenes] = useState(scenes || []);

  const handleChange = (index, field, value) => {
    const newScenes = [...editedScenes];
    newScenes[index] = { ...newScenes[index], [field]: value };
    setEditedScenes(newScenes);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--surface-0)] overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar">
        <div className="bg-[var(--surface-2)] border border-[var(--border-subtle)] p-3 rounded-xl mb-2">
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            大模型已将你的剧本拆分为 <b className="text-[var(--text-primary)]">{editedScenes.length}</b> 个分镜描述。下面是发往生图引擎的终极提示词，你可以手动修改运镜和光影细节，确保最终画面符合预期。
          </p>
        </div>

        {editedScenes.map((scene, idx) => (
          <div key={idx} className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl overflow-hidden shadow-sm">
            <div className="px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--border-subtle)] flex items-center gap-2">
              <span className="w-5 h-5 flex items-center justify-center bg-[var(--accent)] text-white text-[10px] font-bold rounded-full">
                {idx + 1}
              </span>
              <input
                type="text"
                value={scene.title || ''}
                onChange={(e) => handleChange(idx, 'title', e.target.value)}
                className="flex-1 bg-transparent border-none text-xs font-bold text-[var(--text-primary)] focus:outline-none"
                placeholder="分镜名称或核心动作"
              />
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--surface-3)] rounded text-[10px] text-[var(--text-secondary)]">
                <ImageIcon size={10} />
                <input
                  type="text"
                  value={scene.shot_type || ''}
                  onChange={(e) => handleChange(idx, 'shot_type', e.target.value)}
                  className="bg-transparent border-none w-16 text-center focus:outline-none text-[var(--text-primary)]"
                  placeholder="景别(如近景)"
                />
              </div>
            </div>
            
            <div className="p-3 space-y-3">
              <div>
                <label className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1 block tracking-wider">动作核心 (Action)</label>
                <textarea
                  value={scene.action || ''}
                  onChange={(e) => handleChange(idx, 'action', e.target.value)}
                  rows={2}
                  className="w-full bg-[var(--surface-0)] border border-[var(--border-default)] rounded-lg p-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none resize-none transition-colors duration-200"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1 block tracking-wider">画面细节提示词 (Prompt)</label>
                <textarea
                  value={scene.description || ''}
                  onChange={(e) => handleChange(idx, 'description', e.target.value)}
                  rows={3}
                  className="w-full bg-[var(--surface-0)] border border-[var(--border-default)] rounded-lg p-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none resize-none transition-colors duration-200"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer Controls */}
      <div className="flex-shrink-0 p-4 border-t border-[var(--border-subtle)] bg-[var(--surface-1)] flex gap-3">
        {onBack && (
          <button
            onClick={onBack}
            disabled={submitting}
            className="px-4 py-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] text-xs font-bold text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50 flex items-center shadow-sm"
          >
            <ArrowLeft size={14} className="mr-1.5" />
            上一步
          </button>
        )}
        <button
          onClick={() => onConfirm(editedScenes)}
          disabled={submitting}
          className="flex-1 text-white font-semibold py-2.5 rounded-xl transition-all duration-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{
            background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
            boxShadow: '0 4px 16px rgba(99, 102, 241, 0.25)',
          }}
        >
          {submitting ? (
            <><span className="animate-pulse">⟳</span> 提交列队中...</>
          ) : (
            <><Sparkles size={15} /> 确认无误，锁定生图</>
          )}
        </button>
      </div>
    </div>
  );
}
