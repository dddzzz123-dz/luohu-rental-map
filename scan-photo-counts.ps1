$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PhotoNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

$raw = Get-Content -LiteralPath '.\scan.js' -Raw -Encoding UTF8
$scan = ($raw -replace '^window\.RENTAL_SCAN=', '' -replace ';\s*$', '') | ConvertFrom-Json
$checkpointPath = '.\photo-counts.json'
$counts = @{}
if (Test-Path -LiteralPath $checkpointPath) {
  $saved = Get-Content -LiteralPath $checkpointPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($property in $saved.PSObject.Properties) { $counts[$property.Name] = [int]$property.Value }
}

$chrome = Get-Process chrome | Where-Object MainWindowTitle | Select-Object -First 1
if (-not $chrome) { throw 'Chrome main window not found' }
[PhotoNative]::SetForegroundWindow($chrome.MainWindowHandle) | Out-Null
$root = [System.Windows.Automation.AutomationElement]::FromHandle($chrome.MainWindowHandle)
$address = $root.FindFirst(
  [System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'view_1012'))
)
if (-not $address) { throw 'Chrome address bar not found' }
$addressValue = $address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)

$rentals = @($scan.rentals)
for ($index = 0; $index -lt $rentals.Count; $index++) {
  $rental = $rentals[$index]
  $url = [string]$rental.url
  if ($counts.ContainsKey($url)) { continue }
  [Console]::Error.WriteLine("PHOTO $($index + 1)/$($rentals.Count) $($rental.station) $($rental.name)")
  $addressValue.SetValue($url)
  $address.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  $photoCount = -1
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($chrome.MainWindowHandle)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $all.Count; $i++) {
      $name = [string]$all.Item($i).Current.Name
      if ($name -match '^房源图片\((\d+)\)$') { $photoCount = [int]$Matches[1]; break }
    }
    if ($photoCount -ge 0) { break }
  }
  if ($photoCount -lt 0) { $photoCount = 0 }
  $counts[$url] = $photoCount
  $counts | ConvertTo-Json -Compress | Set-Content -LiteralPath $checkpointPath -Encoding UTF8
}

$payload = [ordered]@{
  updated = (Get-Date).ToString('o')
  counts = $counts
  stats = [ordered]@{
    total = $counts.Count
    withImages = @($counts.Values | Where-Object { $_ -ge 2 }).Count
    withoutImages = @($counts.Values | Where-Object { $_ -le 1 }).Count
  }
}
$json = $payload | ConvertTo-Json -Depth 5 -Compress
Set-Content -LiteralPath '.\photo-counts.js' -Value ("window.RENTAL_PHOTO_COUNTS=" + $json + ";") -Encoding UTF8
$payload.stats | ConvertTo-Json
