# Miko · Codex 桌宠

面向 **Windows 10 / 11** 的本地桌面伙伴：随 ChatGPT / Codex 桌面版显示，悬停查看 **Codex 编程额度**、今日 token 和任务状态。支持原比例立绘与 Q 版切换、大小调整、暗色主题和托盘待命。

<img src="assets/dragon-chibi.png" width="180" alt="Q 版银发龙角少女"> <img src="assets/dragon-girl.png" width="145" alt="原比例银发龙角少女">

两个形象均采用银发紫瞳、龙角、白色龙翼和龙尾、蓝白金礼服，头饰与胸针使用 GPT 结形标识。

## 下载与使用

登录 GitHub，打开 [Windows 构建与下载页面](https://github.com/BocchiEkkert/gpt-zhuochong/actions/workflows/windows.yml)，选择 **0.4.0 或更新版本**的成功运行，在底部 **Artifacts** 下载 `Miko-Windows-x64`。

GitHub 会额外包装一层 ZIP：先解开下载文件，再完整解压里面的 `Miko-GPT-Pet-0.4.0-x64.zip` 到固定目录，运行 `Miko GPT Pet.exe`。不要单独移动 exe，旁边的资源目录也是程序的一部分。若该次构建提供 `Miko-Windows-Installer-x64`，也可解压并运行安装向导。

- 悬停查看用量和任务；单击形象或名字固定 / 收起面板，拖动形象可到达屏幕四角，也可跨显示器移动。
- 鼠标放在角色上，滚轮向上放大、向下缩小，按约 5% 调整，范围 65%–300%；大小自动保存。滚动额度面板不会缩放角色。
- 右键形象或点击齿轮打开设置；可切换两种形象、浅色 / 暗色主题、65%–300% 大小、置顶和减少动画。
- **点击窗口的 `×` 或在桌宠 / 设置窗口获得焦点时按 Esc，都收起到托盘，继续后台运行。** Esc 不会全局拦截其他软件的按键。新版不再提供最小化按钮。
- 单击 / 双击托盘图标恢复。**真正退出请点击设置底部或托盘右键菜单的「退出桌宠」。**

300% 按实际比例显示；如果角色大于当前屏幕，可以拖动查看被裁切的部分。额度面板会优先出现在角色上方、下方或侧边；空间不足时保持面板可读。展开额度面板时暂时收起短句气泡。

### 启动联动

Miko 需要先在后台运行。在设置中开启「开机后在托盘待命」，并保留启动联动选项。程序每约 5 秒检测带窗口的 ChatGPT / Codex 桌面进程，也可随近期本机 Codex 运行任务显示；不将自己启动的隐藏额度查询进程当作桌面应用。手动收起后不会立即弹回，下次桌面应用重新启动时恢复联动。

开机项仅在打包后的 Windows 程序启用。启用后保留程序目录位置，移动目录需重新关闭并开启开机选项。真正退出 Miko 后，联动检测停止。

### 升级已有版本

0.4.0 将显示名称改为 Miko；旧版用户数据目录继续沿用，首次运行会按已保存的设置更新开机项。

先在**托盘右键菜单退出旧版**，再将新版完整解压、覆盖原程序目录，最后运行 `Miko GPT Pet.exe`。如果目录里还留有旧版 `Mori GPT Pet.exe`，请运行新的 `Miko GPT Pet.exe`。保持目录位置可继续使用开机项；设置与手动记录保存在程序目录之外，升级后保留。旧版的启动联动设置会迁移，新版默认使用 Codex 自动数据源。

## Codex 编程额度怎么接入

设置默认选择「Codex 自动读取」。程序通过官方 **Codex CLI 的 `app-server` 协议**只读查询账户，不会执行编程任务、批准工具请求或替你登录。

本机需有可运行的官方 Codex 原生程序，并已通过 **ChatGPT 账户**登录：

1. 优先使用 Codex 桌面版内置的 `codex.exe`，或已安装的官方 [Codex CLI](https://developers.openai.com/codex/cli)。程序会尝试自动发现它们。
2. 如需安装 CLI，可在自己的终端运行 `npm install -g @openai/codex`，再运行 `codex login` 完成官方登录。
3. 设置中点击刷新。如果找不到程序，使用「选择 Codex 程序」指定官方 `codex.exe`；也可清除指定路径重新自动查找。只有 ChatGPT 桌面版、不含 Codex CLI 时，无法直接读取 Codex 额度。

桌宠不会索取密码、读取浏览器 Cookie 或复制登录凭证。Codex 子进程使用本机已有的登录配置，**无需把账户密钥交给桌宠**。API Key / 其他提供商登录不对应 ChatGPT 订阅的 Codex 五小时和周额度。

| 显示内容 | 自动来源与限制 |
| --- | --- |
| 5 小时 / 周剩余 | `account/rateLimits/read` 返回的 Codex 300 / 10080 分钟窗口；约 30 秒刷新。显示 `100 − usedPercent`，零余额正常显示。其他模型额度不冒充 Codex 额度。 |
| 今日 token | 可选的 `account/usage/read` 日统计；约 60 秒刷新，匹配本机当天日期。Codex 版本或服务端未提供时显示未知，可能有同步延迟。不是本机任务 token 的估算。 |
| 任务状态 | 读取近期本机 Codex 会话日志中的任务生命周期元数据；无法判断时尝试 Windows UI Automation 的停止 / 发送按钮，仍无法判断则显示未知。不是完整的云端任务列表。 |

「5 小时」表示账户额度窗口，不是桌宠运行倒计时。剩余百分比与重置时间以官方返回值为准；额度过期后显示未知，不假定自动恢复到 100%。断开连接、切换账户或数据超过 2 分钟时不继续展示旧额度。缺失的 token 不显示成 0，也不会把历史总量当作今日用量。

本地日志只提取事件类型和时间，不保存聊天正文；界面检测也不读取聊天正文。超过 2 分钟的任务状态失效，长时间没有新事件时可能显示未知。自动查询不会调用消费 token 的模型接口。

### 手动记录与扩展工具

设置可切换「手动记录」或「本机接口」数据源。各来源明确标注，不把手动数值当作官方查询结果。

- 保存手动记录会切换到手动数据源；今日 token 为当天累计值，跨本地零点后恢复未知。
- 本机接口推送不会自动切换当前来源，需在设置中选择「本机接口」才展示接口数据。
- 额度可带重置时间，到期恢复未知；未提供重置时间时按更新时间判断。
- 接口任务需每 30–60 秒发送心跳，超过 2 分钟显示未知。

接口格式、鉴权和示例见 [本机接口文档](docs/connector.md)。

## 本地文案（待审核）

已整理 120 条本地短句，分为点击、待机、贴贴、困困、招呼、打气 6 类，见 [本地文案初稿](docs/local-dialogue.md)。当前状态气泡已使用新文案；点击动画与定时待机发言将在动作审核后接入。

## 源码开发与打包

需要 Node.js **22.12+**（推荐 24 LTS）、npm 和联网下载 Electron。使用现有检出目录即可。

```powershell
npm ci
npm start
```

Windows x64 免安装包：

```powershell
npm run dist:win
```

产物位于 `dist/`。可在 Windows 执行 `npm run dist:installer` 生成安装向导。程序尚未配置发行者代码签名。原生 ARM64 尚未验证。

macOS / Linux 可用于界面、数据协议和本机接口开发；启动联动、开机项、UI Automation 和最终桌面体验以 Windows 为目标。

主要扩展位置：

- `src/codex-client.cjs`、`codex-service.cjs`、`codex-discovery.cjs`：只读协议、刷新、程序发现。
- `src/codex-data.cjs`、`view-state.cjs`、`model.cjs`：数据校验、来源选择、跨日与到期。
- `src/session-activity.cjs`：本地任务事件；`src/windows/observe.ps1`：Windows 界面探测。
- `src/main.cjs`：窗口、托盘、启动联动、开机项与 IPC；`src/bridge.cjs`：本机鉴权接口。
- `renderer/`：隔离运行的界面，无 Node.js 权限；`assets/dragon-chibi.png`、`dragon-girl.png`：透明角色素材。

设置与手动记录位于 Electron 用户数据目录，Windows 通常为 `%APPDATA%\Mori GPT Pet\`，包括 `state.json` 与 `bridge-token`。官方账户额度仅保存在内存，不写入记录文件；桌宠不上传这些本地记录。不要分享 `bridge-token`。

## 验证

```powershell
npm test
npx playwright-core install chromium
npm run test:ui
npm run test:desktop
npm exec --yes --package=@openai/codex@0.163.0 -- node scripts/verify-official-codex.cjs
```

核心测试覆盖额度窗口、过期、日统计、账户模式、协议传输、任务事件、存储、接口鉴权和数据源隔离，以及 300% 缩放、四角定位、多屏坐标、旧位置迁移和收起后的启动联动。界面与真实 Electron 测试覆盖两种形象、主题、滚轮缩放、角色到达四角、设置持久化、窗口 × / Esc 收起托盘，以及设置退出按钮结束进程和后台接口。

官方 Codex 协议验证使用**隔离的未登录配置**，不接触个人凭证；配额响应使用测试数据。云端无法替代用户已登录账户的实际额度验收。Windows CI 会运行上述检查、PowerShell 探测验证并打包，先保存 `Miko-Windows-x64`，再尝试独立的可选安装器步骤。

Linux 界面测试默认使用 `/usr/bin/chromium`，也可通过 `CHROMIUM_PATH` 指定；桌面测试需要 X11（例如 `xvfb-run -a npm run test:desktop`）。生产启用 Electron 沙箱，受限 CI 测试可指定 `MORI_TEST_NO_SANDBOX=1`。测试截图位于 `test-results/`。

Windows 实机需检查：登录 Codex 后刷新并对照官方额度页；ChatGPT / Codex 启动联动；任务生成时的状态；系统托盘恢复、开机项，以及安装 / 卸载。无法读取的字段应保持未知。
