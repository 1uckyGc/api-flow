import axios from 'axios';
import useAuthStore from '../stores/useAuthStore';

// 使用 Vite 配置的 proxy
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const { logout, token } = useAuthStore.getState();
      if (token) {
        logout();
        // 使用 replace 避免回退到已失效的页面
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
