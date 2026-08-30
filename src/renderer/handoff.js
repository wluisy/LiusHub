/**
 * 跨视图一次性传参（内存级）
 *
 * 用于资产库 → SSH 等模块的「快速连接」跳转。替代原先把含明文密码的
 * 资产写入 sessionStorage 的做法（XSS 可读且窗口存活期间一直保留）。
 * 取出即清空（take 语义），避免残留。
 */
let pendingSsh = null

export function setPendingSsh(cfg) { pendingSsh = cfg }

export function takePendingSsh() {
  const v = pendingSsh
  pendingSsh = null
  return v
}
