import { useState, useEffect, useCallback } from 'react';
import { idbPutHandle, idbGetHandle, idbClearHandle } from '../utils/idb';

export function useAutoSaveFolder(scopeKey) {
  const [handle, setHandle] = useState(null);
  const [folderName, setFolderName] = useState('');
  const isSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const isSecure = typeof window !== 'undefined' && window.isSecureContext;

  useEffect(() => {
    if (!isSupported) return;
    let cancelled = false;
    (async () => {
      try {
        const h = await idbGetHandle(scopeKey);
        if (!h || cancelled) return;
        const perm = await h.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted' && !cancelled) {
          setHandle(h);
          setFolderName(h.name);
        } else if (perm === 'prompt' && !cancelled) {
          // 不主动 request，需要 user gesture，留空显示文件夹名让用户感知"曾选过"
          setFolderName(h.name + ' (需重新授权)');
        }
      } catch (e) {
        // handle 失效，清掉
        await idbClearHandle(scopeKey).catch(() => {});
      }
    })();
    return () => { cancelled = true; };
  }, [scopeKey, isSupported]);

  const pick = useCallback(async () => {
    if (!isSupported) {
      alert('当前浏览器不支持本地文件夹保存。请使用 Chrome / Edge 并通过 HTTPS 访问。');
      return null;
    }
    try {
      const h = await window.showDirectoryPicker({ mode: 'readwrite' });
      await idbPutHandle(scopeKey, h);
      setHandle(h);
      setFolderName(h.name);
      return h;
    } catch (e) {
      if (e.name === 'AbortError') return null;
      console.error('pickFolder failed:', e);
      alert('选择文件夹失败: ' + e.message);
      return null;
    }
  }, [scopeKey, isSupported]);

  const clear = useCallback(async () => {
    await idbClearHandle(scopeKey).catch(() => {});
    setHandle(null);
    setFolderName('');
  }, [scopeKey]);

  const ensurePerm = useCallback(async () => {
    if (!handle) return false;
    try {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return true;
      const ask = await handle.requestPermission({ mode: 'readwrite' });
      return ask === 'granted';
    } catch { return false; }
  }, [handle]);

  const saveFromUrl = useCallback(async (url, filename) => {
    if (!handle) return { ok: false, reason: '未选文件夹' };
    if (!(await ensurePerm())) return { ok: false, reason: '无写权限' };
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, reason: `下载失败 HTTP ${res.status}` };
      const blob = await res.blob();
      const fh = await handle.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }, [handle, ensurePerm]);

  return { handle, folderName, isSupported, isSecure, pick, clear, saveFromUrl };
}
