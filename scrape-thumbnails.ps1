$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RentalNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@

$raw = Get-Content -Raw -Encoding UTF8 (Join-Path (Get-Location) '生活\租房找房\metro-rental-map\data.js')
$data = ($raw -replace '^window\.RENTAL_DATA=', '' -replace ';\s*$', '') | ConvertFrom-Json
$picked = foreach ($station in $data.stations) {
  $data.rentals | Where-Object station -eq $station.name |
    Sort-Object @{Expression = {[Math]::Abs($_.rent - 3500)}}, @{Expression = {$_.area}; Descending = $true} |
    Select-Object -First 3
}
$picked += $data.rentals | Where-Object { $_.name -match '京基100|星广建' }
$picked = $picked | Sort-Object url -Unique

$chrome = Get-Process chrome | Where-Object MainWindowTitle | Select-Object -First 1
if (-not $chrome) { throw 'Chrome main window not found.' }
[RentalNative]::SetForegroundWindow($chrome.MainWindowHandle) | Out-Null
$root = [System.Windows.Automation.AutomationElement]::FromHandle($chrome.MainWindowHandle)
$addressCondition = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Address and search bar'))
)
$address = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)
$addressValue = $address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)

$results = foreach ($rental in $picked) {
  $addressValue.SetValue($rental.url)
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 2400
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($chrome.MainWindowHandle)
  $imageCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Image)
  $images = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $imageCondition)
  $main = $null
  for ($i = 0; $i -lt $images.Count; $i++) {
    $candidate = $images.Item($i)
    $rect = $candidate.Current.BoundingRectangle
    if ($rect.Width -gt 500 -and $rect.Height -gt 350 -and $rect.Y -gt 150 -and $rect.Y -lt 1400) { $main = $candidate; break }
  }
  $imageUrl = ''
  if ($main) {
    $rect = $main.Current.BoundingRectangle
    [RentalNative]::SetCursorPos([int]($rect.X + $rect.Width / 2), [int]($rect.Y + [Math]::Min($rect.Height / 2, 280))) | Out-Null
    [RentalNative]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
    [RentalNative]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 350
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $copyCondition = New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)),
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Copy image address'))
    )
    $copyItem = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $copyCondition)
    if ($copyItem) {
      $copyItem.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Start-Sleep -Milliseconds 250
      $candidateUrl = [System.Windows.Forms.Clipboard]::GetText()
      if ($candidateUrl -match '^https?://') { $imageUrl = $candidateUrl }
    } else {
      [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    }
  }
  [pscustomobject]@{ url = $rental.url; name = $rental.name; station = $rental.station; image = $imageUrl }
}
$results | ConvertTo-Json -Compress
