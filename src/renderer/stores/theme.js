import { defineStore } from 'pinia'
import { ref } from 'vue'

// 玻璃拟态默认值（与主进程 fs-engine GLASS_DEFAULTS 保持一致）
const GLASS_DEFAULTS = {
  enabled: true,          // 是否启用玻璃拟态（关闭回到原生界面）
  blur: 18,               // 玻璃模糊度 (px)
  frost: 55,              // 玻璃磨砂度（不透明度 %）
  bgMode: 'fluid',        // 背景模式：'fluid' 流体 | 'wallpaper' 自定义壁纸
  bgBlur: 8,              // 壁纸模糊度 (px)
  bgFrost: 45,            // 壁纸磨砂度（可读性遮罩 %）
  fluidStyle: 'aurora',   // 流体渐变样式
  fluidColors: ['#6b8afd', '#8b5cf6', '#0ea5e9'], // 自定义流体光斑颜色
}

const hexToRgba = (hex, alpha) => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || ''))
  if (!m) return `rgba(107,138,253,${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref('dark')
  const glass = ref({ ...GLASS_DEFAULTS })
  const bgUrl = ref('')          // 自定义壁纸 dataURL

  function set(v) {
    theme.value = v
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', v)
    }
  }

  // 将玻璃配置应用到 <html> 上的 CSS 变量，驱动全局玻璃效果
  function applyGlass() {
    if (typeof document === 'undefined') return
    const el = document.documentElement
    const g = glass.value
    el.setAttribute('data-glass', g.enabled ? 'on' : 'off')
    el.setAttribute('data-fluid', g.fluidStyle || 'aurora')
    // 自定义流体颜色：内联变量直接覆盖 [data-fluid] 预设；切回预设时移除内联值
    if (g.fluidStyle === 'custom' && Array.isArray(g.fluidColors)) {
      const alphas = [0.2, 0.17, 0.13]
      g.fluidColors.forEach((hex, i) => {
        if (i < 3) el.style.setProperty(`--fl-${i + 1}`, hexToRgba(hex, alphas[i]))
      })
    } else {
      ;['--fl-1', '--fl-2', '--fl-3'].forEach((v) => el.style.removeProperty(v))
    }
    el.style.setProperty('--glass-blur', `${g.blur}px`)
    el.style.setProperty('--glass-frost', String(g.frost / 100))
    el.style.setProperty('--glass-saturation', '180%')
    el.style.setProperty('--bg-blur', `${g.bgBlur}px`)
    el.style.setProperty('--bg-frost', String(g.bgFrost / 100))
  }

  // 更新玻璃配置（局部合并）并即时生效；原地合并保持对象引用稳定
  function setGlass(patch) {
    Object.assign(glass.value, patch || {})
    applyGlass()
  }

  function setBackground(url) {
    bgUrl.value = url || ''
  }

  return { theme, glass, bgUrl, set, applyGlass, setGlass, setBackground, GLASS_DEFAULTS }
})
