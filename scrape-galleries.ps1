$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GalleryNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@

function Find-All($root) {
  return $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
}

function Copy-ImageAddress($element) {
  $rect = $element.Current.BoundingRectangle
  $x = [int]($rect.X + [Math]::Min($rect.Width / 2, 820))
  $y = [int]($rect.Y + [Math]::Min($rect.Height / 2, 580))
  [GalleryNative]::SetCursorPos($x, $y) | Out-Null
  [GalleryNative]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
  [GalleryNative]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 260
  $desktop = [System.Windows.Automation.AutomationElement]::RootElement
  $copyCondition = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Copy image address'))
  )
  $copyItem = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $copyCondition)
  if (-not $copyItem) { [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); return '' }
  try { $copyItem.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch {
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    return ''
  }
  Start-Sleep -Milliseconds 180
  $value = [System.Windows.Forms.Clipboard]::GetText()
  if ($value -match '^https?://fang-community\.leyoujia\.com/' -and $value -notmatch 'default_detail') { return $value }
  return ''
}

$dataPath = Join-Path (Get-Location) '生活\租房找房\metro-rental-map\data.js'
$raw = Get-Content -Raw -Encoding UTF8 $dataPath
$data = ($raw -replace '^window\.RENTAL_DATA=', '' -replace ';\s*$', '') | ConvertFrom-Json
$priority = @{}
foreach ($station in $data.stations) {
  $data.rentals | Where-Object station -eq $station.name |
    Sort-Object @{Expression = {[Math]::Abs($_.rent - 3500)}}, @{Expression = {$_.area}; Descending = $true} |
    Select-Object -First 3 | ForEach-Object { $priority[$_.url] = $true }
}

$chrome = Get-Process chrome | Where-Object MainWindowTitle | Select-Object -First 1
if (-not $chrome) { throw 'Chrome main window not found.' }
[GalleryNative]::SetForegroundWindow($chrome.MainWindowHandle) | Out-Null
$root = [System.Windows.Automation.AutomationElement]::FromHandle($chrome.MainWindowHandle)
$addressCondition = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Address and search bar'))
)
$address = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)
$addressValue = $address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)

$results = @()
$total = $data.rentals.Count
$startAt = if ($env:RENTAL_START) { [int]$env:RENTAL_START } else { 1 }
$take = if ($env:RENTAL_TAKE) { [int]$env:RENTAL_TAKE } else { $total }
$batch = @($data.rentals | Select-Object -Skip ($startAt - 1) -First $take)
$index = $startAt - 1
foreach ($rental in $batch) {
  $index++
  [Console]::Error.WriteLine("SCRAPE $index/$total $($rental.station) $($rental.name)")
  $imagesForRental = New-Object System.Collections.Generic.List[string]
  $addressValue.SetValue($rental.url)
  $address.SetFocus()
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 4500
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($chrome.MainWindowHandle)
  $all = Find-All $root
  $photoTab = $null
  $photoCount = 0
  for ($i = 0; $i -lt $all.Count; $i++) {
    $element = $all.Item($i)
    if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Hyperlink -and $element.Current.Name -match '^房源图片\((\d+)\)$') {
      $photoTab = $element
      $photoCount = [int]$Matches[1]
      break
    }
  }
  if (-not $photoTab -or $photoCount -lt 1) {
    [Console]::Error.WriteLine("NO_TAB $index")
    $results += [pscustomobject]@{ url = $rental.url; name = $rental.name; station = $rental.station; images = @() }
    continue
  }
  try { $photoTab.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView() } catch {}
  Start-Sleep -Milliseconds 250
  try { $photoTab.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch {
    $results += [pscustomobject]@{ url = $rental.url; name = $rental.name; station = $rental.station; images = @() }
    continue
  }
  Start-Sleep -Milliseconds 1100
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($chrome.MainWindowHandle)
  $listCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)
  $listItems = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $listCondition)
  $hero = $null
  for ($i = 0; $i -lt $listItems.Count; $i++) {
    $candidate = $listItems.Item($i)
    $rect = $candidate.Current.BoundingRectangle
    if ($rect.Width -gt 1000 -and $rect.Height -gt 700) { $hero = $candidate; break }
  }
  if (-not $hero) {
    [Console]::Error.WriteLine("NO_HERO $index")
    $results += [pscustomobject]@{ url = $rental.url; name = $rental.name; station = $rental.station; images = @() }
    continue
  }

  try { $hero.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch {
    $results += [pscustomobject]@{ url = $rental.url; name = $rental.name; station = $rental.station; images = @() }
    continue
  }
  Start-Sleep -Milliseconds 650
  $wanted = if ($priority.ContainsKey($rental.url)) { [Math]::Min($photoCount, 8) } else { 1 }
  for ($photoIndex = 0; $photoIndex -lt $wanted; $photoIndex++) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($chrome.MainWindowHandle)
    $imageCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Image)
    $pageImages = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $imageCondition)
    $overlayImage = $null
    for ($i = 0; $i -lt $pageImages.Count; $i++) {
      $candidate = $pageImages.Item($i)
      $rect = $candidate.Current.BoundingRectangle
      if ($rect.Width -gt 1450 -and $rect.Height -gt 900) { $overlayImage = $candidate; break }
    }
    if ($overlayImage) {
      $copied = Copy-ImageAddress $overlayImage
      if ($copied -and -not $imagesForRental.Contains($copied)) { $imagesForRental.Add($copied) }
      elseif (-not $copied) { [Console]::Error.WriteLine("COPY_FAIL $index/$photoIndex") }
    } else { [Console]::Error.WriteLine("NO_OVERLAY $index/$photoIndex") }
    if ($photoIndex -lt ($wanted - 1)) {
      [System.Windows.Forms.SendKeys]::SendWait('{RIGHT}')
      Start-Sleep -Milliseconds 420
    }
  }
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
  Start-Sleep -Milliseconds 120
  $results += [pscustomobject]@{ url = $rental.url; name = $rental.name; station = $rental.station; images = @($imagesForRental) }
}

Write-Output '===GALLERY_JSON_BEGIN==='
$results | ConvertTo-Json -Depth 5 -Compress
Write-Output '===GALLERY_JSON_END==='
