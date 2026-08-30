import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const rendererDir = fileURLToPath(new URL('./src/renderer', import.meta.url))

// LiusHub Vite config — for Electron renderer process.
export default defineConfig({
  // 关键：把 root 指向 src/renderer，dev server 才能找到 index.html
  root: rendererDir,
  plugins: [vue()],
  // dev 用绝对 base；生产（file:// 加载）必须相对 base './'
  base: process.env.NODE_ENV === 'development' ? '/' : './',
  resolve: {
    alias: {
      '@': rendererDir,
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // outDir 相对 root 解析，必须用绝对路径避免跑到 src/renderer 下
    outDir: fileURLToPath(new URL('./dist-renderer', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
    },
  },
})
