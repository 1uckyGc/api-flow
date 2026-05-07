import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      
      login: (token, user) => set({ token, user }),
      
      logout: () => set({ token: null, user: null }),
      
      isAuthenticated: () => !!get().token,
    }),
    {
      name: 'followmeeeaigc-auth',
    }
  )
);

export default useAuthStore;
