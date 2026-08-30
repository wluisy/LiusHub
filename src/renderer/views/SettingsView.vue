<template>
  <div class="settings-view">
    <div class="settings-card glass">
      <h3>外观</h3>
      <el-form label-width="120px">
        <el-form-item label="主题">
          <el-radio-group v-model="theme" @change="onThemeChange">
            <el-radio value="dark">深色</el-radio>
            <el-radio value="light">亮色</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
    </div>

    <div class="settings-card glass">
      <h3>玻璃拟态</h3>
      <el-form label-width="120px">
        <el-form-item label="启用玻璃拟态">
          <div class="row gap-12">
            <el-switch v-model="glass.enabled" @change="onGlassChange" />
            <span class="muted" style="font-size: 12px;">
              {{ glass.enabled ? '顶栏 / 侧边栏 / 输入框 / 面板均为磨砂玻璃' : '关闭后回到原生实色界面' }}
            </span>
          </div>
        </el-form-item>

        <el-form-item label="玻璃模糊度">
          <div class="glass-control">
            <el-slider
              v-model="glass.blur"
              :min="0" :max="40" :step="1"
              :disabled="!glass.enabled"
              @change="onGlassChange"
            />
            <div class="glass-control-meta">
              <el-input-number
                v-model="glass.blur"
                :min="0" :max="40" :step="1"
                size="small"
                :disabled="!glass.enabled"
                @change="onGlassChange"
              />
              <span class="muted">px · 越大背景穿透越模糊</span>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="玻璃磨砂度">
          <div class="glass-control">
            <el-slider
              v-model="glass.frost"
              :min="0" :max="90" :step="1"
              :disabled="!glass.enabled"
              @change="onGlassChange"
            />
            <div class="glass-control-meta">
              <el-input-number
                v-model="glass.frost"
                :min="0" :max="90" :step="1"
                size="small"
                :disabled="!glass.enabled"
                @change="onGlassChange"
              />
              <span class="muted">% · 面板不透明度，越高越实、越低越通透</span>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="背景模式">
          <el-radio-group v-model="glass.bgMode" :disabled="!glass.enabled" @change="onGlassChange">
            <el-radio value="fluid">流体渐变</el-radio>
            <el-radio value="wallpaper">自定义壁纸</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="glass.bgMode === 'fluid'" label="流体样式">
          <div class="fluid-grid">
            <div
              v-for="s in FLUID_STYLES"
              :key="s.key"
              class="fluid-swatch"
              :data-fluid="s.key"
              :class="{ active: (glass.fluidStyle || 'aurora') === s.key }"
              @click="pickFluid(s.key)"
            >
              <span class="fluid-swatch-name">{{ s.label }}</span>
            </div>
          </div>
        </el-form-item>

        <el-form-item v-if="glass.bgMode === 'fluid' && glass.fluidStyle === 'custom'" label="自定义颜色">
          <div class="custom-colors">
            <div v-for="(c, i) in customColors" :key="i" class="custom-color-item">
              <el-color-picker v-model="customColors[i]" @change="onCustomColorChange" />
              <span class="muted">光斑 {{ i + 1 }}</span>
            </div>
          </div>
        </el-form-item>

        <template v-if="glass.bgMode === 'wallpaper' && glass.enabled">
          <el-form-item label="壁纸模糊度">
            <div class="glass-control">
              <el-slider
                v-model="glass.bgBlur"
                :min="0" :max="40" :step="1"
                @change="onGlassChange"
              />
              <div class="glass-control-meta">
                <el-input-number
                  v-model="glass.bgBlur"
                  :min="0" :max="40" :step="1"
                  size="small"
                  @change="onGlassChange"
                />
                <span class="muted">px · 壁纸虚化程度</span>
              </div>
            </div>
          </el-form-item>

          <el-form-item label="壁纸磨砂度">
            <div class="glass-control">
              <el-slider
                v-model="glass.bgFrost"
                :min="0" :max="90" :step="1"
                @change="onGlassChange"
              />
              <div class="glass-control-meta">
                <el-input-number
                  v-model="glass.bgFrost"
                  :min="0" :max="90" :step="1"
                  size="small"
                  @change="onGlassChange"
                />
                <span class="muted">% · 遮罩越浓壁纸越柔和</span>
              </div>
            </div>
          </el-form-item>
        </template>
      </el-form>
    </div>

    <div class="settings-card glass">
      <h3>自定义壁纸</h3>
      <el-form label-width="120px">
        <el-form-item label="背景预览">
          <div
            class="bg-preview"
            :class="{ 'has-image': glass.bgMode === 'wallpaper' && !!bgUrl }"
            :data-fluid="glass.fluidStyle || 'aurora'"
            :style="previewBoxStyle"
          >
            <!-- 壁纸模式：容器比例随图片自然比例变化，图片直接铺满预览区（无框无裁切） -->
            <div
              v-if="glass.bgMode === 'wallpaper' && bgUrl"
              class="bg-preview-img"
              :style="{ backgroundImage: `url(&quot;${bgUrl}&quot;)` }"
            />
            <div v-else class="bg-preview-fluid" />
          </div>
          <div class="muted" style="font-size: 12px; width: 100%; margin-top: 6px;">
            {{ glass.bgMode === 'wallpaper' && bgUrl
              ? '完整显示图片（实际背景会等比铺满全屏，并叠加模糊/磨砂）'
              : `流体渐变 · ${currentFluidLabel}（可在「玻璃拟态」卡片更换样式）` }}
          </div>
        </el-form-item>
        <el-form-item label="上传图片">
          <input
            ref="fileInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style="display: none;"
            @change="onFileChange"
          />
          <el-button @click="fileInput?.click()">
            <el-icon><Picture /></el-icon><span>选择图片</span>
          </el-button>
          <el-button v-if="bgUrl" type="danger" plain @click="onClear">恢复默认</el-button>
          <span class="muted" style="margin-left: 8px;">PNG / JPG / WebP · ≤20MB · 建议 1920×1080 以上</span>
        </el-form-item>
        <el-form-item label="提示">
          <span class="muted" style="font-size: 12px;">上传后自动切换到「自定义壁纸」模式；壁纸模糊/磨砂在上方「玻璃拟态」卡片单独调节。</span>
        </el-form-item>
      </el-form>
    </div>

    <div class="settings-card glass">
      <h3>应用</h3>
      <el-form label-width="120px">
        <el-form-item label="版本">
          <span class="muted mono">V-{{ version }}</span>
        </el-form-item>
        <el-form-item label="数据目录">
          <span class="muted mono">{{ userData }}</span>
        </el-form-item>
        <el-form-item label=" ">
          <el-button @click="onChangeDataDir">更改数据目录…</el-button>
          <el-button :disabled="!dataDirCustom" @click="onResetDataDir">恢复默认</el-button>
        </el-form-item>
        <el-form-item label="加密存储">
          <span class="row gap-8">
            <span :class="['dot', encryptionOk ? 'success' : 'warning']" />
            <span class="muted">{{ encryptionOk ? 'OS 级密钥可用 (DPAPI/Keychain)' : '明文回退 (建议启用 OS 密钥库)' }}</span>
          </span>
        </el-form-item>
      </el-form>
    </div>

    <div class="settings-card glass">
      <h3>关于</h3>
      <p class="muted">LiusHub 是一站式开发运维工作台，整合 SSH、SFTP、数据库、Docker 等功能到统一界面。</p>
      <p class="muted">无聊时间的产物，就好像未寄出的通关文牒，在第七页夹着褪色海棠。</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useThemeStore } from '../stores/theme'
import { ElMessage } from 'element-plus'

const themeStore = useThemeStore()
const theme = ref('dark')
const version = ref('0.1.0')   // 统一取自 package.json
const userData = ref('')
const dataDirCustom = ref(false)
const encryptionOk = ref(true)
const bgUrl = ref('')
const fileInput = ref(null)

// 玻璃配置本地副本（与 store 保持同步，实时预览 + 松手持久化）
// 深拷贝：浅拷贝会把 themeStore 里嵌套的响应式 Proxy（fluidColors 数组）带进来，
// 后续过 IPC 时报 "An object could not be cloned"
const glass = ref(JSON.parse(JSON.stringify(themeStore.glass)))

watch(glass, (v) => {
  themeStore.setGlass({ ...v })
}, { deep: true })

/** 流体渐变样式预设（key 与 glassmorphism.css 的 [data-fluid] 规则对应；custom 走 JS 内联变量） */
const FLUID_STYLES = [
  { key: 'aurora', label: '极光' },
  { key: 'sunset', label: '落日' },
  { key: 'ocean', label: '深海' },
  { key: 'forest', label: '翠林' },
  { key: 'nebula', label: '星云' },
  { key: 'graphite', label: '石墨' },
  { key: 'custom', label: '自定义' },
]
const currentFluidLabel = computed(() =>
  (FLUID_STYLES.find((s) => s.key === (glass.value.fluidStyle || 'aurora')) || FLUID_STYLES[0]).label)

/** 自定义流体的三个光斑颜色（#rrggbb） */
const CUSTOM_COLOR_FALLBACK = ['#6b8afd', '#8b5cf6', '#0ea5e9']
const customColors = ref([...(glass.value.fluidColors || CUSTOM_COLOR_FALLBACK)])
watch(() => glass.value.fluidColors, (v) => {
  if (Array.isArray(v) && v.length === 3) customColors.value = [...v]
})

function pickFluid(key) {
  glass.value.fluidStyle = key
  if (key === 'custom' && (!Array.isArray(glass.value.fluidColors) || glass.value.fluidColors.length !== 3)) {
    glass.value.fluidColors = [...CUSTOM_COLOR_FALLBACK]
  }
  onGlassChange()
}

/** 预览容器：读取图片自然宽高比，让预览框大小跟随图片（宽度 100%，高度按比例） */
const previewRatio = ref(null)
function loadPreviewRatio(url) {
  previewRatio.value = null
  if (!url) return
  const img = new Image()
  img.onload = () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      previewRatio.value = img.naturalWidth / img.naturalHeight
    }
  }
  img.src = url
}
watch(bgUrl, loadPreviewRatio)
const previewBoxStyle = computed(() =>
  (glass.value.bgMode === 'wallpaper' && bgUrl.value && previewRatio.value)
    ? { aspectRatio: String(previewRatio.value) }
    : {})

function onCustomColorChange() {
  glass.value.fluidColors = [...customColors.value]
  onGlassChange()
}

onMounted(async () => {
  theme.value = themeStore.theme
  try {
    const info = await window.liushub.app.ready()
    userData.value = info.userData
    version.value = info.version
    dataDirCustom.value = !!info.dataDirCustom
    encryptionOk.value = await window.liushub.app.getEncryptionAvailable()
  } catch {}
  try {
    const cfg = await window.liushub.settings.getGlass()
    glass.value = cfg
    themeStore.setGlass(cfg)
  } catch {}
  try {
    bgUrl.value = await window.liushub.settings.getBackground() || ''
  } catch {}
})

// 数据目录：主进程弹目录选择框写入 bootstrap 配置，重启后生效（自动迁移数据文件）
async function onChangeDataDir() {
  try {
    const r = await window.liushub.settings.setDataDir()
    if (!r) return // 用户取消
    if (!r.restartRequired) { ElMessage.info('所选目录即当前目录，无需更改'); return }
    try {
      await ElMessageBox.confirm(
        `数据目录已设置为：\n${r.dir}\n\n重启应用后生效，首次启动会自动迁移资产库、主题等数据文件（原目录文件保留）。是否立即重启？`,
        '需要重启', { type: 'warning', confirmButtonText: '立即重启', cancelButtonText: '稍后手动重启' },
      )
      await window.liushub.app.restart()
    } catch {/* 稍后重启 */}
  } catch (e) {
    ElMessage.error('设置失败: ' + (e?.message || e))
  }
}

async function onResetDataDir() {
  try {
    await ElMessageBox.confirm('恢复为系统默认数据目录？重启应用后生效（原目录文件保留，不会删除）。', '恢复默认', {
      type: 'warning', confirmButtonText: '恢复并重启',
    })
  } catch { return }
  try {
    await window.liushub.settings.resetDataDir()
    await window.liushub.app.restart()
  } catch (e) {
    ElMessage.error('操作失败: ' + (e?.message || e))
  }
}

function onThemeChange(v) {
  themeStore.set(v)
  window.liushub.app.setTheme(v)
  ElMessage.success('已切换主题')
}

// 玻璃参数变化 → 持久化（滑块松手/切换开关时触发，避免高频写盘）
function onGlassChange() {
  window.liushub.settings.saveGlass(JSON.parse(JSON.stringify(glass.value)))
    .then((saved) => { glass.value = saved })
    .catch((err) => ElMessage.error('保存失败: ' + (err?.message || err)))
}

function onFileChange(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  if (file.size > 20 * 1024 * 1024) {
    ElMessage.warning('图片过大（>20MB）')
    e.target.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      bgUrl.value = await window.liushub.settings.saveBackground(reader.result)
      // 直接同步全局背景状态：背景立即显示，不依赖事件链
      themeStore.setBackground(bgUrl.value)
      // 上传壁纸后自动切到「自定义壁纸」模式
      onGlassChangeMode('wallpaper')
      ElMessage.success('壁纸已更新')
      window.dispatchEvent(new Event('liushub:bg-changed'))
    } catch (err) {
      ElMessage.error('保存失败: ' + (err?.message || err))
    }
  }
  reader.readAsDataURL(file)
  e.target.value = ''
}

async function onClear() {
  try {
    bgUrl.value = await window.liushub.settings.clearBackground() || ''
    themeStore.setBackground(bgUrl.value)
    ElMessage.success('已恢复默认背景')
    window.dispatchEvent(new Event('liushub:bg-changed'))
  } catch (err) {
    ElMessage.error('操作失败: ' + (err?.message || err))
  }
}

// 上传壁纸时自动切换背景模式，避免“已上传但不显示”的困惑
function onGlassChangeMode(mode) {
  glass.value.bgMode = mode
  // 关键：深拷贝为纯 JSON 再过 IPC——浅拷贝会把嵌套的响应式 Proxy（fluidColors 数组）
  // 带进 structured clone，同步抛 "An object could not be cloned"，
  // 导致模式切换失败、全局背景不更新
  const payload = JSON.parse(JSON.stringify(glass.value))
  window.liushub.settings.saveGlass(payload)
    .then((saved) => { glass.value = saved })
    .catch(() => {})
  // 本地立即同步全局状态：背景模式即时切换（不等 IPC 往返）
  themeStore.setGlass(payload)
}
</script>

<style scoped>
.settings-view { display: flex; flex-direction: column; gap: 12px; max-width: 800px; }
.settings-card { padding: 18px 22px; }
.settings-card h3 { margin: 0 0 12px; font-size: 14px; }
.bg-preview {
  width: 100%;
  height: 160px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--glass-border);
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}
/* 预览层：与全局背景同构（复用 [data-fluid] 颜色变量），含漂移动画 */
.bg-preview .bg-preview-fluid {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 20% 20%, var(--fl-1), transparent 55%),
    radial-gradient(ellipse at 80% 75%, var(--fl-2), transparent 55%),
    radial-gradient(ellipse at 65% 20%, var(--fl-3), transparent 45%),
    var(--bg-base);
  background-size: 200% 200%;
  background-position: 0% 0%, 100% 100%, 50% 50%;
  background-repeat: no-repeat;
  filter: saturate(140%);
  animation: lh-fluid-drift 12s ease-in-out infinite alternate;
}
/* 壁纸模式：无外框，预览框大小跟随图片自然比例（极端竖图限制最大高度） */
.bg-preview.has-image {
  border: none;
  height: auto;
  max-height: 460px;
}
/* 图片层：容器比例与图片一致时 cover 即完整显示 */
.bg-preview .bg-preview-img {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}
/* 自定义流体颜色选择器 */
.custom-colors { display: flex; gap: 16px; }
.custom-color-item { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.custom-color-item .muted { font-size: 11px; }
/* 流体样式色卡 */
.fluid-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  width: 100%;
}
.fluid-swatch {
  position: relative;
  height: 56px;
  border-radius: 10px;
  border: 2px solid transparent;
  cursor: pointer;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 25% 25%, var(--fl-1), transparent 60%),
    radial-gradient(ellipse at 75% 75%, var(--fl-2), transparent 60%),
    radial-gradient(ellipse at 60% 25%, var(--fl-3), transparent 50%),
    var(--bg-base);
  filter: saturate(150%) brightness(108%);
  transition: border-color var(--transition), transform var(--transition);
}
.fluid-swatch:hover { transform: translateY(-2px); }
.fluid-swatch.active {
  border-color: var(--accent);
  filter: saturate(150%) brightness(115%);
}
.fluid-swatch-name {
  position: absolute;
  left: 8px;
  bottom: 4px;
  font-size: 11px;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  z-index: 1;
}
/* 玻璃调节控件：滑块占满整行，下方数值标签 + 提示，避免内嵌输入框挤压/错位 */
.glass-control { width: 100%; }
.glass-control .el-slider { width: 100%; }
.glass-control-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  font-size: 12px;
}
.glass-control-meta :deep(.el-input-number) { width: 120px; }
</style>
