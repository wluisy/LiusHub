import { ElMessage } from 'element-plus'
import { useSessionTabs } from './useSessionTabs'

/**
 * 连接会话管理 — SFTP / Docker / 数据库共用的连接生命周期样板。
 * （SSH 视图因终端实例与 data 订阅耦合较深，未纳入。）
 *
 * 统一管理：会话 tab 增删、连接/原地重连/复制连接/关闭连接、连接配置缓存（sessionMap）。
 * 各模块通过 hooks 注入差异：
 *   connect(cfg)          -> Promise<{ id, ... }>   后端连接
 *   disconnect(backendId) 后端断开
 *   getBackendId(s)       会话上后端连接 id 的字段读取（如 s.sshId / s.dockerId / s.dbId）
 *   setBackendId(s, id)   同上写回
 *   state(cfg)            新会话的模块专属字段初值
 *   titleOf(cfg)          新会话 tab 初始标题
 *   onConnected(s, r, cfg)  新连接成功后（记录 info / 加载数据）
 *   onReconnected(s, cfg)   原地重连成功后（更名 / 记录 info / 加载数据）
 */
export function useConnectionSessions(hooks) {
  const { sessions, activeId, activeSession, addSession, activate, setStatus, rename, removeSession } = useSessionTabs()

  /** 会话 id -> { cfg } 连接配置缓存（复制/编辑连接用） */
  const sessionMap = new Map()

  async function openSession(cfg, existing = null) {
    const s = existing
      ? existing
      : addSession(hooks.titleOf(cfg), { connected: false, ...(hooks.state ? hooks.state(cfg) : {}) })
    sessionMap.set(s.id, { cfg })
    if (existing) {
      const oldId = hooks.getBackendId(s)
      if (oldId) hooks.disconnect(oldId)
      hooks.setBackendId(s, null)
      s.connected = false
    }
    setStatus(s.id, 'connecting')
    try {
      const r = await hooks.connect(cfg)
      hooks.setBackendId(s, r.id)
      s.connected = true
      if (existing) {
        hooks.onReconnected?.(s, cfg)
      } else {
        hooks.onConnected?.(s, r, cfg)
      }
      setStatus(s.id, 'connected')
      return s
    } catch (e) {
      setStatus(s.id, 'error')
      ElMessage.error('连接失败: ' + (e?.message || e))
      return null
    }
  }

  /** 新建会话并连接 */
  async function connectWith(cfg) {
    return openSession(cfg)
  }

  /** 在指定会话上用新配置原地重连（保留会话内已有状态） */
  async function reconnectSession(s, cfg) {
    return openSession(cfg, s)
  }

  /** 关闭会话：断开后端 + 清理配置缓存 + 移除 tab */
  function closeSession(id) {
    const s = sessions.value.find((x) => x.id === id)
    const backendId = s && hooks.getBackendId(s)
    if (backendId) hooks.disconnect(backendId)
    sessionMap.delete(id)
    removeSession(id)
  }

  /** 复制连接：用同一配置新开会话 */
  function copySession(id) {
    const entry = sessionMap.get(id)
    if (!entry || !entry.cfg) { ElMessage.warning('该会话无连接配置，无法复制'); return }
    ElMessage.info('正在复制连接…')
    openSession({ ...entry.cfg })
  }

  return {
    sessions,
    activeId,
    activeSession,
    addSession,
    activate,
    setStatus,
    rename,
    removeSession,
    sessionMap,
    connectWith,
    reconnectSession,
    closeSession,
    copySession,
  }
}
