# KVMFlow

KVMFlow 是 DeepSeek Harness（DSH）原生插件：通过 IP-KVM 控制真实计算机，人工录制带前后截图的 HID 操作，让 DSH 里的 AI 编排成**带条件分支的图工作流**（类似 Dify 画布 / 蓝图），在画布上可视化编辑或自由组合，再由确定性图解释器逐节点执行并做画面验证。第一阶段适配 **Radxa Linkr**，不引入 FastAPI、Python、独立 Web 服务或其他 Agent 框架。

## 核心能力

- **原生双入口面板**：左侧栏 **KVMFlow** 打开全宽主面板；右侧栏 **+** 新建标签页选择 **KVMFlow** 可停靠在对话旁，边对话边操作目标机。自动适配 macOS / Windows 标题栏安全区。
- **多设备管理与状态指示**：全宽设备列表 + 弹窗添加/编辑，支持配置多台 IP-KVM 并随时切换；顶部状态点依据实时探测、截图与 WebRTC 状态显示连通（绿）或断开/不可达（红）。
- **实时画面与 HID 控制**：
  - 支持 **WebRTC 实时 H.264 视频**（需配置 Linkr Web 账号，Host 代理 WHEP 信令、浏览器点对点收流）与 **JPEG 截图轮询**（0.5 / 1 / 1.5 / 2 fps 可调，切到视频后自动停轮询）；
  - 自动检测非 16:9 画面的黑边并换算目标坐标，面板点击、Agent 工具与工作流回放共用同一映射；
  - 滚轮事件原生接管（不带动页面滚动）、拖拽同步、失焦/移出自动释放按键、聚焦后状态条提示「键盘已接管 · 按 Tab 退出」；
  - 宽屏/标准布局一键切换；ASCII 文本通道自动保存历史命令到 `~/.dsh/kvmflow/text-history.txt`（类似 `.bash_history`），支持输入框 `↑` / `↓` 翻历史与可展开的历史小面板（点击填入、直接发送、单条删除、清空全部）。
- **人工录制**：自动记录所有键鼠/文本 HID 事件与操作前后截图，可随时命名并划分人工步骤，一键打开新会话让 AI 生成图工作流。
- **图工作流（schema v2）与画布编辑器**：
  - 基于 React Flow 的画布：节点面板拖放或点击续接、端口连线、自动排版、撤销/重做、自动保存、问题标注、YAML 双向同步，以及在目标机上**单独试运行某个节点**；
  - 节点覆盖条件分支（`if` / `switch`）、一次视觉调用 N 路分叉（`vision_classify`）、等待条件（`wait_until`）、循环与回边（`loop` / `maxVisits`）、画面读值与定位（`vision_extract` / `locate`）、子流程（`subflow`）、人工确认选择（`human`）、变量与 `{{模板}}`、运行输入（含不落盘的密码）；
  - **多工作流组合**：支持在「组合」弹窗或用 Agent 工具把多个工作流按任意顺序合并成一个大工作流，提供 **引用编排（`subflow`）** 与 **展平合并（`inline`）** 两种模式；
  - **按工作流自定义执行视觉模型**：可在「工作流设置」中选择 DSH 里已配置的任意视觉模型（默认跟随 DSH 当前默认模型），仅用于本工作流的执行与单节点试运行，不改动 DSH 聊天默认模型；
  - 兼容旧版：v1 的 `steps:` 工作流首次加载时自动升级为线性 v2 图，原文件备份至 `workflows/.backup/<id>.v1.yaml`。详细设计见 [docs/design/flow-graph.md](docs/design/flow-graph.md)。
- **执行监督与历史清理**：
  - 实时流程图高亮当前节点与走过的边；点击执行轨迹可平滑定位到对应节点并查看判断理由、输出与前后截图；
  - 节点失败按 `retry` 重试 → 走 `error` 出口 → 无出口则暂停等待人工（重试 / 跳过 / 改走指定出口 / 中止）；
  - 四层安全上限（单节点访问、总访问次数、视觉调用次数、不含人工等待的执行时长），中止时自动释放目标机所有按住的键和鼠标键；
  - 支持 BIOS 前奏：开机前定时注入热键（默认 `F2`），检测到视频信号后自动开始；
  - 历史执行支持单条清理与一键清空（同步删除磁盘记录与截图目录）。

## 安装与开发

```text
git clone https://github.com/KawaiiHachimi/dsh-kvmflow.git
plugin_manager install_bundle target=/absolute/path/to/dsh-kvmflow
```

仓库已包含构建好的 `dist/`，克隆后可直接安装，或在 DSH 的 **插件** 页面点击 **添加插件** 选择该目录。

本地修改源码后：

```bash
npm install
npm run check   # Host + Client TypeScript 类型检查
npm run build   # tsc 编译 Host，esbuild 打包 Client（React 取自 DSH 页面）
npm test        # 运行引擎与 jsdom UI 测试
```

重新启用/安装插件即可让 Host 加载新代码，客户端刷新页面生效。

## 首次连接 Radxa Linkr

1. 在 Linkr Web 控制台的「系统设置 → 访问令牌」生成 API 访问令牌（`radxa_linkr_...`）。
2. 打开 KVMFlow 的 **设备** 页，点击 **+ 添加设备**，填写地址（例如 `http://192.168.1.100`）与访问令牌；如需 WebRTC 实时视频，一并填写 Linkr 的 Web 用户名与密码。
3. 保存后点击 **测试**：目标机未开机时提示「设备与令牌有效，但当前没有画面信号」属于正常状态；设备不可达时顶部状态点显示红色，连通后显示绿色。
4. 切到 **实时画面** 页查看画面；点击画面聚焦即可转发键盘输入，按 `Tab` 退出聚焦。

## 技术细节

### 预览模式与限流

- **公开 API（截图轮询）**：`GET /api/public/snapshot` 固定返回 JPEG（1080p 约 200 KB，单次往返约 50–125 ms）；`POST /api/public/control` 发送 USB HID 事件。设备限流 **5 次/秒** 且与键鼠共享配额，Host 串行调度并留出输入间隔，429 时自动指数退避（1s → 2s → 4s → 8s），页面不可见或滚出视野时停抓。
- **实时视频（WebRTC）**：配置 Web 账号后，Host 用 `SHA256("RADXA_FIXED_SALT_v1" + password)` 登录获取 Bearer 令牌并代理 `/api/rtc/whep` 信令（绕过设备无 CORS 头限制），浏览器点对点接收 H.264/90000 视频流。连通后自动停止 JPEG 轮询，5 次/秒配额全部留给键鼠；跨网段或 UDP 不通时自动以截图兜底并显示原因与「重试」。

### 画面映射与坐标语义

目标机分辨率与采集模式不一致（如 16:10 在 1920×1080 中左右各有 96px 黑边）时，浏览器端自动裁出有效目标区并按设备持久化，画虚线框提示并在状态条显示换算后的目标坐标。

| 入口 | 坐标空间 | 是否自动换算 |
| --- | --- | --- |
| 面板点击 / `kvmflow_mouse` / 工作流 `click`、`move`、`scroll` | 与截图一致的画面坐标 | 是 |
| `kvmflow_control` 的 `mouse_abs`、录制事件、工作流 `sequence` | 目标机原始绝对坐标 | 否（已是目标空间） |

### 数据目录

默认位于 `$DSH_HOME/kvmflow`（通常为 `~/.dsh/kvmflow`，可用插件配置 `dataDir` 修改）：

```text
~/.dsh/kvmflow/
├── devices.json        # 设备列表、访问令牌与 Web 密码（权限 0600）
├── text-history.txt    # ASCII 文本通道命令历史（每行一条，权限 0600，最多 100 条）
├── recordings/         # 录制事件流与操作前后截图
├── workflows/          # v2 工作流 YAML、.layout.json 画布坐标、.assets/ 参考图、.backup/ v1 备份
└── runs/               # 执行记录 JSON 与各节点截图（可在执行页清理）
```

## 推荐工作流闭环

1. 连接 KVM，在 **实时画面** 确认画面正常。
2. 到 **录制器** 开始录制；如需从冷开机进 BIOS，先关机再在 **实时画面** 边开机边按热键，关键节点点击「标记步骤」并填写描述，完成后停止录制。
3. 在录制详情点击 **让 AI 生成工作流**，在新打开的 DSH 会话里按需切换生成模型并补充目标；AI 会读取事件与截图，生成主干并用 `kvmflow_flow_patch` 补上条件分支。
4. 到 **工作流** 页在画布上审阅、调整连线、按需在右侧「工作流设置」里指定执行视觉模型，必要时对关键节点点 **在目标机上试运行**，也可以用 **组合** 把多个小工作流拼成一条大流程。
5. 点击 **执行**，在 **执行** 页实时查看流程图高亮与轨迹，需要人工决策时直接点选按钮。

## Agent 工具

| 工具 | 作用 |
| --- | --- |
| `kvmflow_device_list` / `kvmflow_device_add` | 查看 / 添加设备（永不返回令牌） |
| `kvmflow_snapshot` | 截图并作为图像返回给模型（附带 `targetArea`） |
| `kvmflow_keyboard` / `kvmflow_mouse` / `kvmflow_text` / `kvmflow_control` | 发送 USB HID 键鼠与文本事件 |
| `kvmflow_verify` | 用视觉模型判断当前画面是否满足条件 |
| `kvmflow_record_start` / `_mark_step` / `_stop` / `_status` / `_get` | 录制控制、步骤标记与证据读取 |
| `kvmflow_flow_catalog` | 获取全部节点类型、端口与配置字段说明 |
| `kvmflow_workflow_list` / `_get` / `_save` / `_generate` | 工作流列表、读取、整篇保存、从录制生成线性主干 |
| `kvmflow_flow_patch` / `kvmflow_flow_validate` | 批量增删改节点与连线（校验通过才保存）；不保存的校验 |
| `kvmflow_flow_compose` | 按顺序组合多个工作流（支持 `subflow` 与 `inline` 模式） |
| `kvmflow_node_test` | 在目标机上单独试运行一个节点，返回出口、理由、输出与截图 |
| `kvmflow_run_start` / `_status` / `_control` | 启动执行（支持 `inputs`）、读取轨迹、控制执行（`route` / `choose` / `retry` / `skip` / `abort` 等） |

## 工作流示例（schema v2）

以「识别当前画面 → 分支处理」为中心的 Windows OOBE 片段：

```yaml
version: 2
name: Windows OOBE 初始化
visionModel:
  provider: openai
  model: gpt-4o
inputs:
  username: { type: string }
  password: { type: secret }
start: detect
nodes:
  detect:
    type: vision_classify
    config:
      prompt: 当前是 OOBE 的哪一页？
      labels:
        region: 地区选择页 Is this the right country or region
        network: 网络连接页 Let's connect you to a network
        updating: 正在检查更新或进度圈
        desktop: 已进入 Windows 桌面
    maxVisits: 30
    next: { region: pickRegion, network: findSkip, updating: waitUpdate, desktop: done, unknown: ask }
  pickRegion:
    type: click
    config: { x: 0.78, y: 0.88 }
    verify: { mode: change }
    next: { next: detect }
  findSkip:
    type: locate
    config: { target: "I don't have internet 链接" }
    next: { found: clickSkip, not_found: ask }
  clickSkip:
    type: click
    config: { x: "{{nodes.findSkip.output.x}}", y: "{{nodes.findSkip.output.y}}" }
    next: { next: detect }
  waitUpdate:
    type: wait_until
    config: { condition: { vision: 进度圈已经消失 }, timeoutSec: 900, pollMs: 5000 }
    next: { ok: detect, timeout: ask }
  ask:
    type: human
    config: { message: 画面无法识别，请手动处理后选择, options: [retry, giveUp] }
    next: { retry: detect, giveUp: fail }
  done: { type: end, config: { result: success } }
  fail: { type: end, config: { result: failure, reason: 操作者放弃 } }
```

- **节点类型**：流程 `if` `switch` `wait_until` `loop` `subflow` `human` `set` `end`；动作 `key` `shortcut` `text` `click` `move` `scroll` `delay` `sequence`；感知 `vision_check` `vision_classify` `vision_extract` `locate` `image_match` `screen_change`。
- **条件与表达式**：支持 `{vision: …}`、`{expr: "vars.n < 3"}`、`{change: true}`、`{image: assets/x.jpg}` 及 `all` / `any` / `not` 组合；表达式只能读取 `vars`、`inputs`、`nodes.<id>.output`、`last`、`run`，不含 `eval`。
- **布局分离**：画布坐标存在 `<id>.layout.json`，拖动节点不会改动工作流 YAML。

## 当前边界

- 驱动目前实现 Radxa Linkr；其他 IP-KVM（如 GL.iNet GL-RM4PE / PiKVM）保留 `driver` 扩展点。
- 同一时刻只允许一个执行；图内不做并行分支（单台 KVM 同时只能发送一串 HID 事件）。
- `image_match` 按 JPEG 字节哈希/字节差比较，适合静态画面；动态界面请用 `vision_check` / `vision_classify` 或 `screen_change`。
- 视觉节点使用工作流指定的 `visionModel` 或 DSH 默认模型；模型不支持图像或调用失败时会走 `error` 出口或暂停，不会静默通过。同一帧画面上的同一判断在一次执行内自动缓存。
- Linkr `text` 通道仅支持可打印 ASCII、Tab 与 Enter；中文请用目标机输入法或键盘事件。
- 访问令牌与 Web 密码保存在 `devices.json`（权限 `0600`，已被 `.gitignore` 忽略），尚未接入 DSH 凭据存储；请勿提交到版本库。仓库内的 `192.168.1.100` 与 `radxa_linkr_...` 均为占位符。

## 许可证

MIT，见 [LICENSE](LICENSE)。

## 致谢

KVMFlow 完全建立在 DeepSeek Harness 的插件体系之上（Host 服务 / Client Slots / 原生 Tool Registry）。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
