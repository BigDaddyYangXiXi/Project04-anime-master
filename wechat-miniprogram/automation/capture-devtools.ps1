param(
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int]$RightWidth = 620
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WindowCaptureNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
}
"@

$process = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match "wechat-miniprogram|WeChat Web Devtools"
} | Select-Object -First 1

if (-not $process) { throw "WeChat DevTools main window not found" }

$rect = New-Object WindowCaptureNative+RECT
if (-not [WindowCaptureNative]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) {
  throw "Unable to read WeChat DevTools window bounds"
}

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$ok = [WindowCaptureNative]::PrintWindow($process.MainWindowHandle, $hdc, 2)
$graphics.ReleaseHdc($hdc)
$graphics.Dispose()
if (-not $ok) { $bitmap.Dispose(); throw "WeChat DevTools window capture failed" }

$targetDirectory = Split-Path -Parent $OutputPath
if ($targetDirectory) { New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null }

if ($RightWidth -gt 0 -and $RightWidth -lt $width) {
  $crop = New-Object System.Drawing.Rectangle(($width - $RightWidth), 0, $RightWidth, $height)
  $result = $bitmap.Clone($crop, $bitmap.PixelFormat)
  $bitmap.Dispose()
} else {
  $result = $bitmap
}

$result.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$result.Dispose()
Write-Output $OutputPath
