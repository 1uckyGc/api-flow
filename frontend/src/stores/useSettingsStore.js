import { create } from 'zustand';
import api from '../api/client';

const useSettingsStore = create((set) => ({
  isOpen: false,
  settings: null,
  loading: false,

  openModal: () => set({ isOpen: true }),
  closeModal: () => set({ isOpen: false }),

  fetchSettings: async () => {
    set({ loading: true });
    try {
      const res = await api.get('/settings/');
      set({ settings: res.data, loading: false });
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      set({ loading: false });
    }
  },

  updateSettings: async (updates) => {
    try {
      const res = await api.put('/settings/', updates);
      set({ settings: res.data });
      return true;
    } catch (err) {
      console.error('Failed to update settings:', err);
      return false;
    }
  }
}));

export default useSettingsStore;
