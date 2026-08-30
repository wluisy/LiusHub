/**
 * 确保 better-sqlite3 的原生二进制与 Electron ABI 匹配（npm postinstall 执行）。
 *
 * 背景：打包配置 npmRebuild=false（避免 electron-builder 源码重编译依赖 Python/VS 工具链）。
 * better-sqlite3 通过 prebuild-install 分发预编译产物，npm install 默认拉取 Node ABI 版；
 * Electron 主进程需要 Electron ABI 版，否则运行时报 NODE_MODULE_VERSION 不匹配。
 *
 * 流程：
 *   1. 用 Electron 自带的 Node 运行时试载 better-sqlite3 —— 已匹配则跳过；
 *   2. prebuild-install 常规拉取（GitHub）；
 *   3. 失败则从 npmmirror 镜像下载 tarball 放入本地 prebuilds/ 再安装（国内网络兜底）；
 *   4. 仍失败仅警告并给出手动修复指引，不中断安装。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')

const root = path.join(__dirname, '..')
const sqliteDir = path.join(root, 'node_modules', 'better-sqlite3')
const electronPkgDir = path.join(root, 'node_modules', 'electron')
const MIRROR_BASE = 'https://registry.npmmirror.com/-/binary/better-sqlite3'

function log(m) { console.log('[ensure-electron-sqlite] ' + m) }

if (!fs.existsSync(sqliteDir) || !fs.existsSync(electronPkgDir)) {
  log('better-sqlite3 / electron 未安装，跳过')
  process.exit(0)
}

const pkg = JSON.parse(fs.readFileSync(path.join(sqliteDir, 'package.json'), 'utf-8'))
let electronVersion = '32.3.3'
try {
  electronVersion = JSON.parse(fs.readFileSync(path.join(electronPkgDir, 'package.json'), 'utf-8')).version
} catch {}
let electronExe
try {
  electronExe = require(electronPkgDir) // electron 包入口导出即二进制路径
} catch {
  log('未找到 Electron 二进制，跳过')
  process.exit(0)
}

/** 在 Electron 的 Node 运行时（ELECTRON_RUN_AS_NODE）里执行一段 JS */
function runInElectron(code) {
  return spawnSync(electronExe, ['-e', code], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SQLITE_DIR: sqliteDir },
    encoding: 'utf-8',
  })
}

function testLoad() {
  const code = "try{new (require(process.env.SQLITE_DIR))(':memory:').prepare('select 1');console.log('SQLITE_OK')}catch(e){console.log('SQLITE_FAIL '+e.message);process.exit(1)}"
  const r = runInElectron(code)
  return r.status === 0 && /SQLITE_OK/.test(r.stdout || '')
}

/** 取 Electron 的 NODE_MODULE_VERSION（ABI） */
function electronAbi() {
  const r = runInElectron("console.log(process.versions.modules)")
  return (r.stdout || '').trim()
}

if (testLoad()) {
  log(`better-sqlite3 已匹配 Electron ${electronVersion}，跳过`)
  process.exit(0)
}

let bin
try { bin = require.resolve('prebuild-install/bin.js', { paths: [sqliteDir] }) } catch {}

/** 运行 prebuild-install（runtime=electron），返回是否成功 */
function installPrebuild() {
  if (!bin) return false
  const r = spawnSync(process.execPath, [bin, '--runtime=electron', `--target=${electronVersion}`], {
    cwd: sqliteDir, encoding: 'utf-8',
  })
  return r.status === 0
}

/** 从 npmmirror 镜像下载 tarball 到本地 prebuilds 目录（跟随重定向） */
function downloadMirrorTarball(abi) {
  const fileName = `better-sqlite3-v${pkg.version}-electron-v${abi}-${process.platform}-${process.arch}.tar.gz`
  const url = `${MIRROR_BASE}/v${pkg.version}/${fileName}`
  const prebuildsDir = path.join(sqliteDir, 'prebuilds')
  const target = path.join(prebuildsDir, fileName)
  fs.mkdirSync(prebuildsDir, { recursive: true })
  log(`从镜像下载 ${url}`)
  return new Promise((resolve) => {
    const get = (u, redirects) => {
      if (redirects > 5) return resolve(false)
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return get(res.headers.location, redirects + 1)
        }
        if (res.statusCode !== 200) { res.resume(); return resolve(false) }
        const ws = fs.createWriteStream(target)
        res.pipe(ws)
        ws.on('finish', () => resolve(true))
        ws.on('error', () => resolve(false))
      }).on('error', () => resolve(false))
    }
    get(url, 0)
  })
}

async function main() {
  log(`ABI 不匹配，尝试修复（Electron ${electronVersion}）...`)

  // 1. 常规渠道（GitHub）
  if (bin && installPrebuild()) {
    log(testLoad() ? `已修复：better-sqlite3 现匹配 Electron ${electronVersion}` : '安装完成但加载仍失败')
    process.exit(0)
  }

  // 2. npmmirror 镜像兜底（国内网络）
  const abi = electronAbi()
  if (!abi) { log('无法获取 Electron ABI，跳过镜像下载'); process.exit(0) }
  const ok = await downloadMirrorTarball(abi)
  if (ok && installPrebuild() && testLoad()) {
    log(`已修复（镜像）：better-sqlite3 现匹配 Electron ${electronVersion}`)
    process.exit(0)
  }

  log('自动修复失败。SQLite 功能将不可用；手动修复任选其一：')
  log('  a) 配置代理后重新执行 npm install（触发本脚本）')
  log('  b) 安装 Python + VS Build Tools 后执行 npx @electron/rebuild -f -w better-sqlite3')
  process.exit(0)
}

main()
