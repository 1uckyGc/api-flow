import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../api/client';
import useAuthStore from './useAuthStore';

const useTaskStore = create(
  persist(
    (set, get) => ({
      taskGroups: [],
      activeGroupId: null,
      wsConnection: null,
      _heartbeatTimer: null,
      _wsDebounceTimer: null,
      taskProgressMap: {},
      
      // 筛选与搜索状态
      filter: 'all', // all, review, running, done, failed
      searchQuery: '',

      // 表单二次编辑下放承接数据
      draftData: null,
      setDraftData: (data) => set({ draftData: data }),

      setFilter: (filter) => set({ filter }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setActiveGroup: (id) => set({ activeGroupId: id }),

      fetchTaskGroups: async () => {
        try {
          const res = await api.get('/tasks/');
          set({ taskGroups: res.data });
          // 如果没有选中的任务，且有数据，默认选中第一个
          const currentActive = get().activeGroupId;
          if (!currentActive && res.data.length > 0) {
            set({ activeGroupId: res.data[0].id });
          }
        } catch (error) {
          console.error('Failed to fetch task groups', error);
        }
      },

      connectWebSocket: () => {
        const token = useAuthStore.getState().token;
        if (!token) return;

        // 防止重复连接
        const existingWs = get().wsConnection;
        if (existingWs && existingWs.readyState === WebSocket.OPEN) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Vite proxy is handling /ws/
        const wsUrl = `${protocol}//${window.location.host}/ws/${token}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('WebSocket Connected');
          // 清理旧心跳，启动新心跳
          const oldTimer = get()._heartbeatTimer;
          if (oldTimer) clearInterval(oldTimer);
          const heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send('ping');
            }
          }, 30000);
          set({ _heartbeatTimer: heartbeat });
        };

        ws.onmessage = (event) => {
          if (event.data === 'pong') return;
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'TASK_UPDATE') {
              // 防抖：2秒内多个 TASK_UPDATE 合并为一次拉取
              const store = get();
              if (store._wsDebounceTimer) clearTimeout(store._wsDebounceTimer);
              const timer = setTimeout(() => {
                get().fetchTaskGroups();
              }, 2000);
              set({ _wsDebounceTimer: timer });
            } else if (message.type === 'TASK_PROGRESS') {
              // 单个任务状态更新 (生成进度等)
              set((state) => ({
                taskProgressMap: {
                  ...state.taskProgressMap,
                  [message.task_id]: message.message
                }
              }));
            } else if (message.type === 'GROUP_PROGRESS') {
              // 裂变组进度更新 (思维日志)
              set((state) => ({
                taskProgressMap: {
                  ...state.taskProgressMap,
                  [`group_${message.group_id}`]: message.message
                }
              }));
            }
          } catch (e) {
            console.error('Error parsing WS message', e);
          }
        };

        ws.onclose = () => {
          console.log('WebSocket Disconnected. Reconnecting...');
          // 清理心跳定时器
          const timer = get()._heartbeatTimer;
          if (timer) {
            clearInterval(timer);
            set({ _heartbeatTimer: null });
          }
          // 断线重连
          setTimeout(() => {
            get().connectWebSocket();
          }, 5000);
        };

        set({ wsConnection: ws });
      },

      disconnectWebSocket: () => {
        const timer = get()._heartbeatTimer;
        if (timer) {
          clearInterval(timer);
          set({ _heartbeatTimer: null });
        }
        const debounce = get()._wsDebounceTimer;
        if (debounce) clearTimeout(debounce);
        const ws = get().wsConnection;
        if (ws) {
          ws.close();
          set({ wsConnection: null });
        }
      }
    }),
    {
      name: 'followmeeeaigc-tasks-storage',
      // 指定哪些字段需要持久化
      partialize: (state) => ({ 
        taskGroups: state.taskGroups,
        taskProgressMap: state.taskProgressMap,
        filter: state.filter,
        searchQuery: state.searchQuery,
        activeGroupId: state.activeGroupId 
      }),
    }
  )
);

export default useTaskStore;
