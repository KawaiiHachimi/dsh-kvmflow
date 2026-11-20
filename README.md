# KVMFlow

KVMFlow 是 DeepSeek Harness（DSH）原生插件：通过 IP-KVM 控制真实计算机，人工录制 HID 操作与截图，让 DSH 里的 AI 生成**带条件分支的图工作流**（类似 Dify 画布 / 蓝图），在画布上可视化编辑，再由图解释器逐节点执行并做画面验证。第一阶段适配 **Radxa Linkr** 的公开 HTTP API，不引入 FastAPI、Python、独立 Web 服务或其它 Agent 框架。

## 能力

- **原生侧边栏页面**：设备管理、实时 KVM 画面、键鼠输入、录制器、工作流画布、执行监督与人工介入。
- **右侧可停靠标签页**：同一套面板以紧凑布局停靠在右侧栏，可边对话边看/操作 KVM。在右侧栏的“+”新建标签页里选择 KVMFlow 即可打开（也出现在右侧栏指南页的入口卡片中）。
- **KVM 控制**：`GET /api/public/snapshot` 截图，`POST /api/public/control` 发送 USB HID 事件；请求串行化并限制在设备 5 次/秒的公开 API 限制内。
- **人工录制**：所有键盘、鼠标、文本操作写入事件流，按 900ms 最小间隔保存操作前截图，操作结束后 700ms 去抖保存操作后截图；可随时命名并划分人工步骤。
- **AI 集成**：通过 DSH 原生工具注册暴露截图、键鼠、文本、画面验证、录制、工作流生成、执行控制等工具；在真实会话中由现有模型、Agent Loop、会话与 Tool Calling 驱动。
- **图工作流（schema v2）**：节点 + 带类型的出口端口，支持 `if` / `switch` / `wait_until` / `loop` / 回边、`vision_classify`（一次模型调用 N 路分支）、`vision_extract` / `locate`（从画面读值、找坐标）、`subflow`、`human`（人工选择出口）、变量与 `{{模板}}`、运行输入（含不落盘的密码）。设计文档见 [docs/design/flow-graph.md](docs/design/flow-graph.md)。
- **工作流画布**：基于 React Flow 的编辑器：节点面板拖放、端口连线、自动排版、按节点类型生成的属性面板、问题标注、撤销/重做、自动保存、YAML 双向切换，以及在目标机上**单独试运行某个节点**。
- **自动执行**：图解释器逐节点执行并记录访问轨迹；节点失败先按 `retry` 重试，再走 `error` 出口，没有出口就暂停让人选择重试/跳过/改走某个出口/中止。执行页在流程图上实时高亮当前节点和走过的边。
- **安全上限**：节点 `maxVisits`、整份工作流的访问总数、视觉调用次数和执行时长（不含等人工的时间）四层上限；中止时释放目标机上所有按住的键和鼠标键。
- **兼容旧版**：v1 的 `steps:` 工作流在首次读取时自动转成线性图，原文件备份到 `workflows/.backup/<id>.v1.yaml`。
- **BIOS 预置**：工作流可声明 `bios` 前奏，提前以固定间隔注入热键（默认 F2），等待目标机电源按下、视频信号出现后自动继续；可选人工确认“已进入 BIOS”。
- **数据位置**：默认 `$DSH_HOME/kvmflow`（通常是 `~/.dsh/kvmflow`），可用插件配置 `dataDir` 覆盖。设备令牌保存在 `devices.json`，权限 `0600`。

## 安装与打开

```text
git clone https://github.com/KawaiiHachimi/dsh-kvmflow.git
plugin_manager install_bundle target=/absolute/path/to/dsh-kvmflow
```

仓库里已带上构建好的 `dist/`，克隆后可以直接安装。也可以在 DSH 的 **插件** 页面点击 **添加插件** 并选择该目录。

安装后有两种打开方式，功能相同（右侧为紧凑布局）：

- 左侧栏的 **KVMFlow** 图标 → 主栏全宽面板；
- 右侧栏的 **+**（新建标签页）→ 选择 **KVMFlow** → 停靠在对话右侧，可边对话边操作目标机。

改源码后执行 `npm install && npm run build`（Host 用 `tsc`，客户端用 esbuild 把 React Flow 打进 bundle，React 取自 DSH 页面），`npm test` 跑引擎与界面测试；再重新安装一次插件：Host 侧会加载新的 `dist/`，客户端 bundle 刷新页面后生效。

## 首次连接 Radxa Linkr

1. 在 Linkr Web 控制台生成 API 访问令牌（`radxa_linkr_...`）。
2. 在 KVMFlow 的“设备”页添加地址（例如 `http://192.168.1.100`）和令牌，点击“测试”。
3. 目标机未开机时，测试会提示“设备与令牌有效，但当前没有画面信号”，这是正常状态。
4. 到“实时画面”页确认画面；点击画面获得焦点后，键盘事件会转发给目标机。

> 公开 API 只用访问令牌；Linkr 的 Web 用户名/密码不参与 HID/截图调用，因此可不填。填写密码也不会被保存。

## 画面比例与鼠标定位

IP-KVM 的截图分辨率是它协商到的采集模式，不一定等于目标机的输出分辨率。目标机输出 4:3、5:4、低于采集模式的分辨率时，截图里会出现黑边（左右或上下），此时"画面上的归一化坐标"和"目标机的绝对 HID 坐标"不是同一个空间，直接换算就会点偏。KVMFlow 因此把「目标画面在截图中的区域」记录为设备级映射：

- 预览里出现黑边时自动识别（纯黑且连续的边带才会被裁掉，并且要求内容区亮度、宽高比例合理），识别到后在画面上画一个虚线框，状态栏显示目标区域尺寸；
- 点击位置先按图片量测，再换算到目标区域，所以点哪儿就打哪儿；
- 状态栏实时显示换算后的目标坐标（`x.xxx, y.xxx`），可用来核对；
- 映射完全自动：出现黑边就按目标区域换算，没有黑边就是 1:1，界面上不提供手填或“整幅”切换；实测值可在“设备”页的设备行里查看（保存设备表单不会覆盖它）；
- 映射是设备级持久化设置，Agent 工具与工作流执行共用同一份，所以人点、AI 点、回放点得到同一个结果。

实测（Windows OOBE，目标 16:10、采集 1920×1080）：帧内左右各 96px 黑边 → 目标区 5%–95%，检测算法在 360px 缩略图上得到完全一致的 `0.05 / 0.95`；用画面坐标 `(0.788, 0.833)` 点击，光标精确落在「是」按钮上（换算后的目标坐标为 `(0.820, 0.833)`）。

## 预览格式与帧率

- **公开 API 只有 JPEG**。`GET /api/public/snapshot` 固定返回 `image/jpeg`：实测 `Accept: image/png`、`?format=png`、`?quality=50` 都仍返回 JPEG，`/api/public/stream`、`/api/public/mjpeg` 不存在（返回前端 index.html）。所以**用接口令牌只能截图轮询**。
- **登录后的 Web 会话有真实视频（WebRTC）**，已验证可用：
  - 密码不是明文发送，Web 端发的是 `SHA256("RADXA_FIXED_SALT_v1" + password)`，`POST /api/account/login {username, passwd}` 返回 `code:0` 与 Bearer 令牌（本机设备版本 1.6.0）；
  - 带 `Authorization: Bearer <token>` 后，`/api/video/codec`、`/api/video/quality`、`/api/rtc/health` 均返回 200；
  - `POST /api/rtc/whep {"offer": "<SDP>"}` 返回 `{answer, stream_id}`，answer 里是 `a=sendonly` 的 **H264/90000**，并带 host candidate `192.168.1.100:<port> UDP`，即同网段浏览器可以直接收流。
  - 障碍是 **CORS**：从 `http://127.0.0.1:60595` 发预检会被拒（`OPTIONS` 403，无 `Access-Control-Allow-Origin`），页面不能直接 POST WHEP。KVMFlow 的解法是**信令由 Host 代理、媒体走点对点**：Host 用 Bearer 会话调用 `/api/rtc/whep` 换回 answer，浏览器只管收 UDP 上的 H.264。

### 实时视频（WebRTC）

- **启用方式**：设备表单里填「Web 用户名 / Web 密码」（可选，只给实时视频用；截图与键鼠仍用访问令牌）。实时画面卡片里的下拉可切「实时视频 / 截图轮询」，默认视频。Web 密码与访问令牌一样存放在 `devices.json`（权限 0600）。
- **协商流程**：浏览器建 `RTCPeerConnection`（`recvonly`）→ 生成 offer 并等 ICE 收集完 → 经 Host RPC `rtc.offer` 换成 answer → `setRemoteDescription` → `ontrack` 挂到 `<video>`。
- **不占配额**：视频连通后自动停掉 JPEG 轮询，所以设备的 5 次/秒全部留给键鼠，操作更跟手。
- **不会自己改模式**：协商失败时保留你选的“实时视频”，画面继续用截图兜底，下方显示具体原因并提供「重试」；成功后状态栏显示 `分辨率 · WebRTC`，并停掉截图轮询。
- **协商只做一次**：协商 effect 不依赖每次渲染都会变的函数（早期版本把翻译函数列进依赖，导致反复重建 PeerConnection、模式立不住，已修正）。
- **登录细节**：Host 发送 `SHA256("RADXA_FIXED_SALT_v1" + password)`；令牌缓存在内存，遇 401/403 自动重登一次；账号若开了二次验证会明确报错（KVMFlow 无法完成 2FA）。
- **前提**：浏览器所在主机要能直达设备的 UDP 端口（同网段时就是 `192.168.1.100:<port>`）；跨网段/只放通 HTTP 的网络里会退回截图轮询。
- 已实测：Host 侧登录 → Bearer → `/api/rtc/whep` 返回 `a=sendonly` 的 `H264/90000` answer 与 host candidate `192.168.1.100`；浏览器侧在 DSH 页面里已确认播出流畅视频，鼠标/键盘/坐标映射同时可用。自动化测试（桩 PeerConnection）覆盖了协商顺序、`<video>` 挂载、停轮询、失败保留下拉与重试。
- **单帧体积**：1080p 约 **200 KB**（实测 203,9xx 字节）。所以 1 帧/秒 ≈ 200 KB/s；经过 JSON+base64 传输后约 270 KB/s。
- **延迟**：单次截图往返实测 50–125 ms（偶发 200 ms）。
- **限流**：设备头 `X-Rate-Limit-Limit: 5`，即 **5 次/秒**，并且**与键鼠事件共用同一个配额**；连续 8 次无间隔请求会收到 429「Try again in ~1000ms」。
- **当前帧率**：默认 1 帧/秒（每 1100 ms 抓一帧），页面不可见或画面滚出视野时自动停抓。
- **可调**：截图模式下，实时画面卡片里的下拉可切 0.5 / 1 / 1.5 / 2 帧每秒（选择记在浏览器本地）；**切到实时视频后这个下拉会隐藏**，因为视频帧率由设备编码决定，此时设备配额全部留给键鼠。调高轮询帧率会挤占键鼠配额，因此：
  - 429 时按指数退避（1s → 2s → 4s → 8s）自动降速，并显示错误提示；
  - 每次键鼠事件发送后会主动让预览停 300 ms，保证输入优先。

### 指针落在画面内时的事件归属

- **滚轮只滚目标机**：React 把 `wheel` 事件以 passive 方式挂在根节点上，合成事件里的 `preventDefault()` 会被忽略，页面照样滚动——这就是之前“滚一下整页跑掉”的原因。现在直接在画面元素上注册 `{ passive: false }` 的原生 `wheel` 监听并阻止默认行为，所以指针在画面内时滚轮/`Ctrl+滚轮` 都不会带动页面。
- **按需累加**：浏览器按像素（一格约 100）、行或页上报，触摸板还会给小数；KVMFlow 按步累加，凑满一步才发一次，不会把触摸板的细微滚动抹掉，也不会超过设备 5 次/秒的请求预算。
- **方向已实测校准**：浏览器 `deltaY > 0`（向下滚）对应 Linkr `wheelY` 正值；真机上 `wheelY +3` 让国家列表向后翻（坦桑尼亚→乌克兰→香港），`-3` 回退到巴拿马一带。
- **拖拽同步**：按住拖动会把移动转发给目标机（首帧立即发，之后约 200ms 合并一次取最新点），所以能拖动滚动条/窗口。
- **不会卡住按键**：在画面内按下、在画面外松开（甚至移到浏览器窗口外）会自动补一次松开事件，避免目标机一直处于按住状态。

坐标语义（重要）：

| 入口 | 坐标空间 | 是否自动换算 |
| --- | --- | --- |
| 面板点击 / `kvmflow_mouse` / 工作流 `click`、`move`、`scroll` | 与截图一致的画面坐标 | 是 |
| `kvmflow_control` 的 `mouse_abs`、录制事件、工作流 `sequence` | 目标机原始绝对坐标 | 否（已经是目标空间，重复换算会再次偏移） |

`kvmflow_snapshot` 在有映射时会附带 `targetArea` 与 `targetExtent`；`kvmflow_record_get` 会标注 `eventCoordinateSpace: "target"`。

## 推荐闭环

1. 连接 KVM，确认实时画面。
2. 目标机断电/关机。到“录制器”开始录制（例如“进入 BIOS 开启虚拟化”）。
3. 到“实时画面”手动按目标机电源，并在 POST 阶段点击快捷键按钮（如 F2）或直接使用键盘。
4. 进入 BIOS 后继续操作，每个关键阶段在“录制器”点击“标记步骤”，填写名称与描述；完成后停止录制。
5. 在录制详情点击“让 AI 生成工作流”。这会打开一个新的 DSH 会话：AI 用 `kvmflow_record_get` 读取事件与截图，用 `kvmflow_workflow_generate` 生成主干，再用 `kvmflow_flow_patch` 在“画面可能不同”的地方补上分支。
6. 到“工作流”页在画布上审阅：点节点看属性，拖线改连接，必要时点“在目标机上试运行”单独验证某个节点，然后点“执行”。
7. 对 BIOS 工作流，执行会先进入 armed 状态并注入热键；此时按目标机电源。视频信号出现后自动开始；执行页的流程图会高亮当前节点，需要人工时直接在卡片上选择。

也可以直接在对话里让 AI 操作：

- “截一张 KVM 画面，看看现在是什么界面。”
- “按 F2 进入 BIOS，然后读取当前屏幕。”
- “开始录制，名称叫安装 Windows OOBE，接下来我手动操作。”
- “根据录制 rec-xxx 生成工作流，目标是跳过 OOBE 联网。”

## Agent 工具

| 工具 | 作用 |
| --- | --- |
| `kvmflow_device_list` / `kvmflow_device_add` | 查看/添加设备 |
| `kvmflow_snapshot` | 截图并作为图像返回给模型 |
| `kvmflow_keyboard` / `kvmflow_mouse` / `kvmflow_text` / `kvmflow_control` | HID 输入 |
| `kvmflow_verify` | 用默认 DSH 视觉模型判断画面条件 |
| `kvmflow_record_start` / `_mark_step` / `_stop` / `_status` / `_get` | 录制与证据读取 |
| `kvmflow_flow_catalog` | 节点类型、端口与配置字段 |
| `kvmflow_workflow_list` / `_get` / `_save` / `_generate` | 工作流读取、整篇保存、从录制生成线性主干 |
| `kvmflow_flow_patch` / `kvmflow_flow_validate` | 增删改节点与连线（批量、校验后才落盘）；不保存的校验 |
| `kvmflow_node_test` | 在目标机上单独执行一个节点，返回出口、理由、输出与截图 |
| `kvmflow_run_start` / `_status` / `_control` | 启动（可传 `inputs`）、查看轨迹、控制执行（`route` / `choose` / `retry` / `skip` / `abort` …） |

## 工作流示例

以“识别当前画面 → 分支处理”为中心的 Windows OOBE 片段：

```yaml
version: 2
name: Windows OOBE 初始化
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

- 节点类型：流程 `if` `switch` `wait_until` `loop` `subflow` `human` `set` `end`；动作 `key` `shortcut` `text` `click` `move` `scroll` `delay` `sequence`；感知 `vision_check` `vision_classify` `vision_extract` `locate` `image_match` `screen_change`。
- 条件：`{vision: …}`、`{expr: "vars.n < 3"}`、`{change: true}`、`{image: assets/x.jpg}`，可用 `all` / `any` / `not` 组合。
- 表达式只能读 `vars` `inputs` `nodes.<id>.output` `last` `run`，没有 `eval`，也访问不到任何全局对象。
- 动作节点可带 `precondition` 与 `verify`；任何节点可带 `retry: {times, delayMs}` 与 `maxVisits`。
- 画布坐标单独存放在 `<id>.layout.json`，拖动节点不会改动工作流 YAML。

## 当前边界

- 只实现 Radxa Linkr 驱动；其他 IP-KVM（包括 GL.iNet GL-RM4PE）保留 `driver` 扩展点，未实现前不会伪装成可用。
- 同一时刻只允许一个执行；多设备并发调度是后续扩展。图里没有并行分支：一台 KVM 同时只能执行一串 HID 操作。
- `image` 验证按 JPEG 字节哈希/粗粒度字节差比较，适合静态画面；动态界面应使用 `vision` 或 `change`。
- 视觉节点调用当前默认模型；模型不支持图像或调用失败时节点报错（走 `error` 出口或暂停），不会静默通过。同一帧画面上的同一问题在一次执行里只问一次模型。
- Linkr `text` 事件只接受可打印 ASCII、Tab、Enter；中文输入请使用目标机输入法或键盘事件。
- 设备访问令牌与 Web 密码都保存在 `devices.json`（权限 0600，已被 `.gitignore` 忽略），尚未接入 DSH 凭据存储；请勿把该文件提交到版本库。
- 仓库内的示例地址（`192.168.1.100`）与令牌前缀（`radxa_linkr_...`）都是占位符，不含任何真实凭据。

## 致谢

KVMFlow 完全建立在 DeepSeek Harness 的插件体系之上（Host 服务 / Client Slots / 原生 Tool Registry）。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
