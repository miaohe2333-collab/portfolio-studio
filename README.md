# Portfolio Studio

一个自用的、以画布为主的网页排版编辑器，自带两种原创动态首页背景：
**🌸 花谷**（夜晚发光花海，可交互）和 **✦ 星系**（螺旋星系粒子）。
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

- **背景效果**：工具栏右侧下拉切换 🌸 花谷 / ✦ 星系，选择随项目保存并跨窗口同步。
  - 花谷可交互：鼠标推开花朵并在光标附近发光、滚轮向前漫游（静止时自动缓缓前进）、相机随鼠标轻微倾斜；旁边 🔇 按钮可开关程序生成的环境音。
  - 两种背景都在画布之下，你的 PNG 始终叠在上面。
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

- 花谷观感：`src/flowers.js` 里的 `build()`（`SPAN / DEPTH / GROUND / nFlower…`、`PALETTE`）、
  相机（`translate / rotX` 那几行）、亮度与大小（片元着色器 `a =` 一行、顶点 `gl_PointSize`）。
- 星系观感：`src/galaxy.js` 顶部 `build()` 里的 `PARTICLES / ARMS / RADIUS / inner / mid / outer`。
- 画布尺寸：`src/app.js` 顶部 `CANVAS_W / CANVAS_H`。
- 配色：`css/styles.css` 里的 `:root` 变量。

参考美术方向：momentchan/false-earth、dgreenheck/webgpu-galaxy，以及 Gladeye 的夜间花谷交互。
两种背景均为自写的原创实现（原创花朵贴图 + 自写 WebGL/着色器），未使用或复制上述任何项目的引擎、着色器或美术资产。
