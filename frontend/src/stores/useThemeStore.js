import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: 'dark',

      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        document.documentElement.className = next;
        set({ theme: next });
      },

      initTheme: () => {
        const { theme } = get();
        document.documentElement.className = theme;
      },
    }),
    { name: 'followmeeeaigc-theme' }
  )
);

export default useThemeStore;
