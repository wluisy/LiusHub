import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 资产库 store - 缓存从主进程读取的连接配置 (不缓存 secret)
 */
export const useAssetsStore = defineStore('assets', () => {
  const list = ref([])
  const loading = ref(false)

  async function load(type) {
    loading.value = true
    try {
      list.value = await window.liushub.asset.list(type)
    } finally {
      loading.value = false
    }
  }

  async function save(asset) {
    // 深拷贝为纯 JSON 对象：响应式 Proxy 无法通过 structured clone（IPC 传输会报
    // "An object could not be cloned."），先净化再发送。
    const clean = JSON.parse(JSON.stringify(asset))
    const saved = await window.liushub.asset.save(clean)
    const idx = list.value.findIndex((a) => a.id === saved.id)
    if (idx >= 0) list.value[idx] = saved
    else list.value.push(saved)
    return saved
  }

  async function remove(id) {
    await window.liushub.asset.remove(id)
    list.value = list.value.filter((a) => a.id !== id)
  }

  return { list, loading, load, save, remove }
})
