import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  // 没有设置变量时，默认回退到 Beta 的开发端口 (8001 / 5173 / ws)
  const backendTarget = env.VITE_BACKEND_URL || 'http://127.0.0.1:8001'
  const wsTarget = backendTarget.replace('http://', 'ws://').replace('https://', 'wss://')
  
  return {
    plugins: [react()],
    server: {
      port: parseInt(env.VITE_PORT || '5173'),
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/ws': {
          target: wsTarget,
          ws: true,
        },
        '/outputs': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/uploads': {
          target: backendTarget,
          changeOrigin: true,
        }
      }
    }
  }
})
