# Portfolio Studio

一个自用的、以画布为主的网页排版编辑器，带一个原创的「星系粒子」动态首页背景。
无需打包、无构建步骤，纯 HTML / CSS / 原生 JS。

## 启动（简单）

在本目录下任选一种：

```bash
./start.sh
```

或者：

```bash
python3 -m http.server 8787
```

然后浏览器打开 **http://localhost:8787**

> 说明：数据存在浏览器的 IndexedDB 里，跨窗口实时共用同一份最新数据，
> 需要通过本地服务器访问（`http://localhost`），不要直接双击 `index.html`（`file://` 下
> IndexedDB 在部分浏览器会被禁用）。

## 功能

- **多页面**：顶部标签新建 `＋` / 切换 / 双击重命名 / `✕` 删除。各页面独立保存布局。
- **共用资产库**：左侧「素材库」。上传或拖入透明 PNG，所有页面共用。
  - 点击素材 → 添加到当前画布。
  - **删除画布图层不会删除原素材**；要从库里删素材用素材右上角的 `✕`。
- **画布直接操作**（像 Photoshop）：
  - 拖动 = 移动；四角手柄 = 缩放；顶部圆点 = 旋转（按住 Shift 以 15° 吸附）。
  - 方向键微移（Shift = 10px）。
- **图层面板**：上下拖动调层级，支持 显示/隐藏、锁定、删除，双击重命名。
- **撤销 / 重做**：`Ctrl/Cmd+Z` / `Ctrl+Shift+Z`（或工具栏 ↶ ↷）。
- **自动保存**：任何改动即时写入，无需手动保存。
- **预览**：工具栏「预览」或按 `P`，隐藏所有编辑界面只看成品；`Esc` 退出。
- **导入 / 导出**：导出为单个 `.json`（含所有图片），可备份或在另一台机器导入。
- **多窗口同步**：在多个标签/窗口打开，改动会实时同步。

## 文件结构

```
index.html         页面结构
css/styles.css     样式
src/galaxy.js      首页星系粒子背景（原创 WebGL，无依赖）
src/db.js          IndexedDB 存储 + 跨窗口同步 + 导入导出
src/app.js         编辑器全部逻辑
start.sh           一键启动
```

## 自己改（vibecoding）

- 背景观感：`src/galaxy.js` 顶部 `build()` 里的 `PARTICLES / ARMS / RADIUS / inner / mid / outer`。
- 画布尺寸：`src/app.js` 顶部 `CANVAS_W / CANVAS_H`。
- 配色：`css/styles.css` 里的 `:root` 变量。

参考美术方向：momentchan/false-earth、dgreenheck/webgpu-galaxy。
此处的星系背景为自写的原创实现，未复制上述项目代码。
