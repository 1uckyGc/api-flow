import React from 'react';
import { FolderOpen, FolderX, Check, AlertTriangle } from 'lucide-react';
import { useAutoSaveFolder } from '../hooks/useAutoSaveFolder';

export default function FolderPickerBar({ scopeKey, label = '自动保存到本地' }) {
  const { folderName, handle, isSupported, isSecure, pick, clear } = useAutoSaveFolder(scopeKey);

  if (!isSupported) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>
        <AlertTriangle size={11} />
        本地保存不可用 ({isSecure ? '需 Chrome/Edge' : '需 HTTPS'})
      </div>
    );
  }

  const isAuthorized = !!handle;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}:</span>
      {folderName ? (
        <>
          <span
            className="flex items-center gap-1 px-2 py-1 rounded font-mono text-[11px]"
            style={isAuthorized
              ? { background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }
              : { background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }
            }
            title={folderName}
          >
            {isAuthorized ? <Check size={11} /> : <AlertTriangle size={11} />}
            <span className="max-w-[160px] truncate">{folderName}</span>
          </span>
          <button
            onClick={pick}
            className="px-2 py-1 rounded text-[11px]"
            style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            title="换一个文件夹"
          >
            切换
          </button>
          <button
            onClick={clear}
            className="px-2 py-1 rounded text-[11px] flex items-center gap-1"
            style={{ background: 'var(--surface-2)', color: '#f87171', border: '1px solid var(--border-subtle)' }}
            title="解绑文件夹"
          >
            <FolderX size={11} /> 解绑
          </button>
        </>
      ) : (
        <button
          onClick={pick}
          className="px-3 py-1 rounded font-bold text-white text-[11px] flex items-center gap-1"
          style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)' }}
        >
          <FolderOpen size={12} /> 选择文件夹
        </button>
      )}
    </div>
  );
}
