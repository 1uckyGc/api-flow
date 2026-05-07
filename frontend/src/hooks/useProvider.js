import { useEffect } from 'react';
import { create } from 'zustand';
import apiClient from '../api/client';

// 全局缓存当前 AI provider（"holo" 或 "flow2api"）
const useProviderStore = create((set) => ({
  provider: 'flow2api', // 兜底默认；fetch 完成后会被覆盖
  loaded: false,
  setProvider: (p) => set({ provider: p, loaded: true }),
}));

let inFlight = null;

async function fetchProviderOnce() {
  if (inFlight) return inFlight;
  inFlight = apiClient
    .get('/config/ai-provider')
    .then((r) => {
      const p = (r.data?.provider || 'flow2api').toLowerCase();
      useProviderStore.getState().setProvider(p);
      return p;
    })
    .catch(() => {
      // 后端没有该接口或网络异常时，保留默认 flow2api，避免 UI 卡住
      useProviderStore.getState().setProvider('flow2api');
      return 'flow2api';
    });
  return inFlight;
}

export function useProvider() {
  const { provider, loaded } = useProviderStore();
  useEffect(() => {
    if (!loaded) fetchProviderOnce();
  }, [loaded]);
  return provider;
}
