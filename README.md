# Mori · ChatGPT 桌宠

一个面向 **Windows 10 / 11、ChatGPT 桌面版**的本地桌面伙伴。原创薄荷绿短发形象，可继续扩展功能。

<img src="assets/mori.svg" width="160" alt="原创桌宠 Mori">

## 使用

先登录 GitHub，打开 [Windows 构建与下载页面](https://github.com/BocchiEkkert/gpt-zhuochong/actions/workflows/windows.yml)，选择成功运行，在页面底部 **Artifacts** 下载 `Mori-Windows-x64`。GitHub 会额外包装一层 ZIP，先解开下载文件，再解压里面的程序 ZIP。若存在 `Mori-Windows-Installer-x64`，也可下载并解压其中的 EXE 安装向导。

直接构建得到的程序包为 `dist/Mori-GPT-Pet-0.1.0-x64.zip`，**完整解压**到固定目录，双击 `Mori GPT Pet.exe`。首次启动会显示桌宠。不要单独移动 exe，旁边的资源目录是程序的一部分。

- 悬停：查看今日 token、5 小时剩余额度、周剩余额度与任务状态。
- 单击形象或名字：固定 / 收起面板；拖动形象：移动桌宠。
- 右键：打开设置；面板上的 `−`：隐藏到托盘；`×`：真正退出。
- 单击 / 双击托盘图标可恢复，托盘右键可设置或退出。
- 设置中可调节 65%–160% 大小、置顶、减少动画和重置位置。

**启动联动需要 Mori 在后台待命。** 解压运行后在设置中开启「开机后在托盘待命」，并保留「随 ChatGPT 显示」。此后每 5 秒检测 `ChatGPT.exe`：启动时出现，进程退出后隐藏。最小化到托盘后不会马上弹回来，下次 ChatGPT 启动会再次出现。退出 Mori 后将停止检测，需再次打开 Mori 或下次登录后启动。ChatGPT 窗口关闭但后台进程仍在时，视为仍在运行。

源码运行时不会修改系统开机项，开机选项仅在打包后的 Windows 程序中启用。开启后请保留程序目录位置，移动目录后需要重新关闭再开启该选项。

## 哪些信息能自动读取

| 信息 | 当前数据来源 | 无法读取时 |
| --- | --- | --- |
| ChatGPT 是否启动 | Windows 进程检测 | 说明探测失败，不误报已退出 |
| 是否正在生成 | Windows UI Automation 的发送 / 停止按钮 | 显示「任务状态未知」 |
| 今日 token | 手动录入，或可信本机工具推送 | 显示 `—` |
| 5 小时、周剩余额度 | 手动录入，或可信本机工具推送 | 显示「未知」 |

ChatGPT **没有公开的个人用量 / 订阅额度查询接口**。OpenAI API 账单也不等于 ChatGPT 订阅额度。程序不会从请求次数估算 token，不请求账户密码，不读取 Cookie、聊天正文或调用私有账户接口。手动数据和接口数据会分别标明来源与更新时间。

「5 小时」是额度窗口名称，并非启动桌宠后开始计时。可根据 ChatGPT 实际展示的信息录入剩余百分比和重置时间；不同套餐、模型和账户可能采用不同的限制。重置时间可留空。

- token 是**本机当天累计值**，不是单次增量；跨本地零点后恢复未知。
- 重置时间到期后，额度恢复未知，不假定恢复到 100%。未提供重置时间的记录会保留，按更新时间自行判断。
- 接口任务心跳超过 2 分钟后失效，回退到界面检测；需要长任务持续显示时每 30–60 秒发一次心跳。
- 手动任务状态会保留到选择「自动检测 / 接口」或程序重启。接口下次上报任务可覆盖手动状态。
- 只保存修改过的录入字段，避免把未修改的接口数据重新标记为手动。

## 源码启动与打包

需要 Node.js **22.12+**（推荐 24 LTS）、npm 和联网下载 Electron。

```powershell
npm ci
npm start
```

生成 Windows x64 免安装程序包：

```powershell
npm run dist:win
```

产物在 `dist/`。如需安装 / 卸载向导，在 Windows 上执行 `npm run dist:installer`，生成 `Mori-GPT-Pet-0.1.0-x64.exe`。程序尚未配置发行者代码签名。ARM Windows 用户可在受支持的 x64 兼容环境运行，原生 ARM64 打包尚未验证。

macOS / Linux 可用于界面和本机接口开发，但 ChatGPT 启动联动、开机项和任务界面探测以 Windows 为目标。

## 扩展接口

见 [本机接口文档](docs/connector.md)。例如后续可接入自己的任务执行器、可靠的用量采集器、提醒、更多皮肤或交互。

- `src/model.cjs`：数据校验、跨日、额度到期、来源与任务有效期。
- `src/bridge.cjs`：只监听 `127.0.0.1:47831` 的鉴权接口。
- `src/monitor.cjs`、`src/windows/observe.ps1`：Windows 探测。
- `src/main.cjs`：托盘、窗口、开机项、单实例与拖动位置。
- `renderer/`：桌宠和设置界面，隔离运行，无 Node.js 权限。
- `assets/mori.svg`：可编辑的原创矢量角色，支持透明背景和任意缩放。

数据保存于 Electron 的用户数据目录，Windows 通常为 `%APPDATA%\Mori GPT Pet\`。包括 `state.json` 和 `bridge-token`；不会上传到服务器。可在 Electron 中通过 `app.getPath('userData')` 确认实际路径。不要分享 `bridge-token`。

## 验证

```powershell
npm test
npx playwright-core install chromium
npm run test:ui
npm run test:desktop
```

界面测试使用 Chromium，本机已安装的 Chromium 可通过 `CHROMIUM_PATH` 指定。Linux 默认使用 `/usr/bin/chromium`；桌面测试还需 X11 显示服务（例如 `xvfb-run -a npm run test:desktop`）。生产程序启用 Electron 沙箱；受限 CI 的测试可单独指定 `MORI_TEST_NO_SANDBOX=1`，不会改变生产设置。

现有测试覆盖输入校验、跨日与到期、存储恢复、接口鉴权与拒绝网页请求、悬停与设置交互、窗口隐藏恢复，以及真实 Electron 进程中的 IPC、接口更新与重启。测试数据与真实账户数据无关。界面测试截图位于 `test-results/`。

本次在 Linux 云环境中通过核心测试、界面测试和真实 Electron 冒烟测试，并构建 Windows 免安装程序包。云端 NSIS 安装包构建受 Wine 运行时兼容问题阻塞；免安装包不依赖 Wine，安装版应在 Windows 构建。**Windows 本机的 ChatGPT 进程检测、UI Automation、托盘、开机启动和安装 / 卸载仍需验收**：

1. 解压运行，分别验证悬停、拖动、大小、托盘恢复及退出。
2. 开启开机待命，退出并重新登录 Windows，确认托盘出现。
3. 打开 ChatGPT，确认桌宠在约 5 秒内显示；完全退出 ChatGPT，确认隐藏。
4. 让 ChatGPT 生成回复，检查任务来源为「界面检测」；客户端版本未暴露匹配按钮时，应显示未知。
5. 保存手动用量，重启 Mori，确认用量和设置保留；免安装版删除前先关闭开机待命并退出 Mori；使用安装版时，另行验证卸载会移除快捷方式和开机项。

仓库包含 Windows CI，在代码推送后运行测试和打包。免安装 ZIP 会先保存为 `Mori-Windows-x64` 下载产物，安装器作为独立可选步骤构建，不影响已生成的 ZIP。Windows CI 的核心、界面、Electron 冒烟测试和探测脚本检查已经通过；ChatGPT 实际运行时的联动和生成按钮识别仍需实机验收。
