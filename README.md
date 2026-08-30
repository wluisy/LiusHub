# LiusHub

> 一站式开发运维工作台 (All-in-One DevOps Workbench)
> 基于 **Electron + Vue 3 + Vite**，整合 SSH 终端 / SFTP / 多数据库 / Docker 到统一界面。

当前版本：`0.1.0`（唯一来源为 `package.json` 的 `version` 字段，界面各处自动同步，改版本只动它）

## 功能特性

| 模块 | 状态 | 能力 |
|------|------|------|
| SSH 终端 | ✅ | xterm.js 终端、密码/私钥、多会话子 Tab、原地重连、复制连接、快捷命令、F11 全屏 |
| SFTP | ✅ | 双栏文件管理、本机盘符切换、拖拽上传、传输真实进度（字节级）、失败自动清理残件 |
| 数据库 | ✅ | MySQL / PostgreSQL / SQLite / ClickHouse / Redis；Navicat 式树（字段/索引/外键/检查/触发器）、表设计器、视图、SQL 编辑器（多查询 Tab、可关闭结果框）、多语句 SQL 文件执行、数据字典、ER 模型导出、全库搜索 |
| Docker | ✅ | 容器/镜像列表、日志（demux 无乱码）、启停、实时 stats（切走自动暂停）、SSH 直连远端守护进程（`docker system dial-stdio`，需远端 Docker ≥ 18.09） |
| 资产库 | ✅ | OS 级加密（DPAPI/Keychain）保存连接配置，一键快速连接 |
| 工具坞 | ✅ | 内置 8 个常用命令模板 + 自定义模板 |
| 主题 | ✅ | 深色/亮色、玻璃拟态（模糊度/磨砂度可调）、6 种流体渐变预设 + 自定义光斑颜色、自定义壁纸（预览所见即整图） |
| 数据目录 | ✅ | 可自定义 userData 目录（重启生效，自动迁移数据文件，原目录保留） |
| 多标签 | ✅ | 路由级多 Tab + 模块内会话子 Tab |
| RDP / 跳板机 UI / SOCKS5 | ⏳ | 接口预留 |

## 快速开始

```bash
# 1. 安装依赖（首次；postinstall 会自动校准 better-sqlite3 与 Electron 的 ABI）
npm install

# 2. 开发模式（Vite 热更新 + Electron）
npm run dev

# 3. 生产构建
npm run build:win    # Windows Portable exe → dist\LiusHub <版本>.exe
npm run build:msi    # MSI 安装包（WiX LZX 高压缩）→ dist\LiusHub-<版本>.msi
```

### 构建产物与目录

| 路径 | 说明 |
|------|------|
| `dist\LiusHub <版本>.exe` | Portable 版（约 69 MB），双击即用 |
| `dist\LiusHub-<版本>.msi` | MSI 安装包（约 86 MB） |
| `dist-renderer/` | 仅 `vite build` 的渲染层产物（被上两者引用） |
| `dist-msi/` | `build:msi` 的中间产物（win-unpacked） |

### 构建要点

- **无需 Python / VS 工具链**：`npmRebuild` 已关闭，better-sqlite3 采用预编译产物。`postinstall` 钩子（`scripts/ensure-electron-sqlite.js`）会用 Electron 运行时实测 ABI，不匹配时自动从 GitHub / npmmirror 镜像拉取对应预编译版
- `package.json` 请保持 **UTF-8（无 BOM）** 编码；`build/msi-build.ps1` 为 **UTF-8 with BOM**（PowerShell 5.1 对无 BOM 文件按 ANSI 解析，中文会破坏语法）

## 项目结构

```
D:\LuisHub\
├── package.json                     # 版本唯一来源 + electron-builder 配置
├── vite.config.js
├── scripts/
│   └── ensure-electron-sqlite.js    # postinstall：better-sqlite3 ABI 校准守护
├── build/                           # 图标 + MSI 打包脚本（wix heat/candle/light）
└── src/
    ├── shared/
    │   └── ipc-channels.js          # IPC 通道常量 + 资产/数据库类型
    ├── main/                        # Electron 主进程
    │   ├── index.js                 # 生命周期 + IPC 注册 + 自定义数据目录 + 主题持久化
    │   ├── window-manager.js
    │   ├── secure-store.js          # 加密资产库（safeStorage，解密失败显式标记）
    │   ├── preload/index.js         # contextBridge 暴露受限 API
    │   └── engines/
    │       ├── ssh-engine.js        # SSH 连接 + PTY + 主机密钥 TOFU 校验
    │       ├── sftp-engine.js       # SFTP 传输（进度推送/错误清理）
    │       ├── fs-engine.js         # 本地文件系统（对话框路径授权）+ 设置/背景/玻璃配置
    │       ├── tool-engine.js       # 快捷命令模板
    │       ├── db-engine.js         # 5 种数据库适配器（SQLite 走 worker 线程）
    │       ├── sqlite-worker.js     # SQLite worker 线程（查询不阻塞主进程，支持超时中断）
    │       └── docker-engine.js     # dockerode 封装（日志 demux、stats 流式切分）
    └── renderer/                    # Vue 3 渲染进程
        ├── main.js                  # 图标按需注册 + 全局错误兜底
        ├── App.vue / router.js
        ├── handoff.js               # 跨视图一次性传参（内存级，替代 sessionStorage）
        ├── components/              # Sidebar / TopBar / TabBar / StatusBar / SessionTabs / ResultGrid
        ├── composables/
        │   ├── useSessionTabs.js
        │   └── useConnectionSessions.js  # 连接会话生命周期（连接/重连/复制/关闭）
        ├── stores/                  # Pinia: theme / tabs / assets
        ├── views/                   # Home / Assets / Ssh / Sftp / Database / Docker / Tools / Settings
        └── styles/                  # global.css + glassmorphism.css（流体样式变量唯一定义处）
```

## 安全说明

- 资产（host / port / username / password / privateKey）经 Electron `safeStorage` 加密后存于 `<数据目录>/vault.json`；跨环境解密失败时会显式提示重新录入，不静默失败
- `contextIsolation: true` + `nodeIntegration: false`；渲染层不加载 asar 内的任何前端依赖（全部由 Vite 打包）
- SSH 主机密钥 **TOFU 校验**：首次连接记录指纹（`<数据目录>/ssh-host-keys.json`），指纹变更即拒绝并给出处置指引
- 本地文本读写（`fs:read-text` / `fs:write-text`）仅允许访问**通过系统文件对话框选择过的路径**
- CSP：`connect-src` 限制为同源；上传壁纸经内存级 handoff 传递，不落 sessionStorage

## 常见问题 (FAQ)

**Q1: `npm install` 报 better-sqlite3 相关错误或安装后 SQLite 不可用？**
`postinstall` 会自动修复（GitHub 超时会走 npmmirror 镜像）。若仍失败：配置代理后重跑 `npm install`，或安装 Python + VS Build Tools 后执行 `npx @electron/rebuild -f -w better-sqlite3`。

**Q2: Electron 二进制下载超时？**
```bash
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm install
```

**Q3: 运行 `npm run dev` 打不开窗口 / `electron --version` 显示 Node 版本？**
检查环境变量 `ELECTRON_RUN_AS_NODE`（设为 1 时 Electron 以 Node 模式运行）：
```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
```

**Q4: 改了 `package.json` 的 version 后界面没变？**
dev 模式需重启 Electron 主进程（重跑 `npm run dev`）；打包产物需重新构建。

**Q5: MSI 构建报 ConvertFrom-Json / light 语法错误？**
确认 `build/msi-build.ps1` 为 UTF-8 with BOM（当前已是），`package.json` 为 UTF-8。两者编码被编辑器改动后按此恢复。

## 已知限制

1. SFTP 删除目录要求目录为空（递归删除未实现）；传输不支持断点续传
2. Docker SSH 直连要求远端 Docker ≥ 18.09 且账号有 docker 访问权限
3. PostgreSQL 为单连接模型，无法跨库浏览（树中会提示）
4. 数据库查询统一 30s 超时（SQLite 超时会发送中断；其他类型为竞速超时）
5. Element Plus 仍为全量引入（安装 `unplugin-vue-components` / `unplugin-auto-import` 后接入 vite 配置即可按需）

## 许可

MIT
