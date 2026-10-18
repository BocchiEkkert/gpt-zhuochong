# Mori 本机数据接口 v1

接口用于可信工具上报它们**实际掌握的数据**，不会自动赋予获取 ChatGPT 官方额度的能力。

## 连接

1. 启动 Mori，进入「设置 → 数据连接」，确认接口就绪。
2. 点击「复制连接密钥」，安全提供给自己的本机程序。
3. 只使用 `http://127.0.0.1:47831`，每次请求附带 `Authorization: Bearer <密钥>`。

密钥保存在当前用户的本机应用数据目录，不显示在日志中。不要将密钥提交到 Git。该接口不接收浏览器 Origin 请求，不提供 CORS，不支持远程访问。Windows 用户目录的访问权限也应仅开放给信任的用户。端口被占用时设置中会报告错误；桌宠其他功能可继续使用。

`GET /v1/health` 同样需要鉴权，返回 `{"ok":true,"version":1}`。

## 上报状态

`POST /v1/state`，`Content-Type: application/json`，请求体最多 16 KiB。以下是**示例数据**，并非任何账户的真实额度：

```json
{
  "day": "2026-10-18",
  "todayTokens": 18420,
  "fiveHour": { "remainingPercent": 72 },
  "weekly": { "remainingPercent": 43 },
  "task": { "status": "running", "label": "正在整理项目笔记" }
}
```

- 所有信息按需发送，未发送的字段保留原值。至少发送一个可更新字段。
- `todayTokens`：当天累计的非负安全整数，或 `null`（未知）；必须同时提供本机当天的 `day`。发送同一累计值多次不会重复增加。
- `fiveHour` / `weekly`：必须含 `remainingPercent`（0–100，可用小数；`null` 表示未知）。`resetsAt` 可选，应为未来且带时区的 ISO 时间，如 `2026-10-19T04:00:00+08:00`。不填重置时间表示未知。更新额度时会整体替换该项。
- `task.status`：`running` / `idle` / `error` / `unknown`；`label` 可选，最多 100 字符。说明仅当作纯文本显示。
- 任务每 30–60 秒发送心跳，2 分钟未更新后回退到界面检测。用量不会随着任务心跳过期。
- 连接工具只发送自己负责的字段，避免覆盖其他来源的数值。当前同一字段采用最后一次有效写入；多账号 / 多模型需要在接入层自行选择统计范围。

PowerShell 示例（使用自己可信数据替换数值；密钥通过安全输入读取，不写入历史记录）：

```powershell
$secureToken = Read-Host 'Mori 连接密钥' -AsSecureString
$credential = New-Object System.Net.NetworkCredential('', $secureToken)
$headers = @{ Authorization = 'Bearer ' + $credential.Password }
$body = @{
  day = (Get-Date).ToString('yyyy-MM-dd')
  todayTokens = 18420 # 示例：替换为实际的今日累计值
  task = @{ status = 'running'; label = '我的本机任务' }
} | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:47831/v1/state' `
  -Headers $headers -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
Remove-Variable secureToken, credential, headers
```

成功：HTTP 200，`{"ok":true}`。无效数据：400；未授权：401；网页来源或非预期 Host：403；未知路径：404；超大请求：413；内容类型错误：415；存储失败：500。请求不会部分保存。
