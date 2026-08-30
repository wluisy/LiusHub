import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

// 图标按需注册：模板中以字符串动态 :is 引用的图标全集（全量 import 会打包 300+ 个）
import {
  Box, CaretBottom, CaretRight, CircleCheck, Close, Coin, Connection,
  CopyDocument, Cpu, DataAnalysis, Delete, Document, Download, Edit, EditPen,
  Expand, Fold, Folder, FolderAdd, FolderOpened, Grid, House, Key, Lightning,
  Link, Loading, Monitor, Moon, Operation, Picture, Plus, Refresh, Search,
  Setting, Share, Sort, Star, Sunny, Tools, Upload, VideoCamera, View,
} from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import './styles/global.css'
import './styles/glassmorphism.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElementPlus)

// 按需注册 Element 图标（Sidebar/资产卡/树节点/右键菜单等均以字符串名动态引用）
const appIcons = {
  Box, CaretBottom, CaretRight, CircleCheck, Close, Coin, Connection,
  CopyDocument, Cpu, DataAnalysis, Delete, Document, Download, Edit, EditPen,
  Expand, Fold, Folder, FolderAdd, FolderOpened, Grid, House, Key, Lightning,
  Link, Loading, Monitor, Moon, Operation, Picture, Plus, Refresh, Search,
  Setting, Share, Sort, Star, Sunny, Tools, Upload, VideoCamera, View,
}
for (const [k, v] of Object.entries(appIcons)) {
  app.component(k, v)
}

// 全局错误兜底：未捕获的渲染层异常 / Promise 拒绝不再静默丢失
app.config.errorHandler = (err, _inst, info) => {
  console.error('[vue-error]', err, info)
}
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled-rejection]', e.reason)
})

app.mount('#app')
