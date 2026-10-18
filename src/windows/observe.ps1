# Only process presence and accessible button names are inspected.
# Conversation text, account cookies and credentials are never read.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$apps = @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue)
$result = @{ running = ($apps.Count -gt 0); status = 'unknown'; available = $false }
if ($apps.Count -gt 0) {
  try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button)
    $sendFound = $false
    foreach ($app in $apps) {
      if ($app.MainWindowHandle -eq 0) { continue }
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
      $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
      foreach ($button in $buttons) {
        $name = $button.Current.Name
        if ($name -match '^(Stop generating|Stop streaming|Stop response|停止生成|停止响应|停止流式传输|停止)$') {
          $result.status = 'running'; $result.available = $true; break
        }
        if ($name -match '^(Send prompt|Send message|发送提示|发送消息|发送)$') { $sendFound = $true }
      }
      if ($result.status -eq 'running') { break }
    }
    if ($result.status -ne 'running' -and $sendFound) { $result.status = 'idle'; $result.available = $true }
  } catch { $result.available = $false }
}
$result | ConvertTo-Json -Compress
