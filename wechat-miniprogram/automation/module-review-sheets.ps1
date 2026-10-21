param([string]$Directory = '../.artifacts/module-review-2026-09-09')
Add-Type -AssemblyName System.Drawing
$reviewDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $Directory))
$report = Get-Content (Join-Path $reviewDirectory 'capture.json') -Raw | ConvertFrom-Json
for ($offset = 0; $offset -lt $report.pages.Count; $offset += 4) {
  $canvas = New-Object Drawing.Bitmap(1560, 1740)
  $graphics = [Drawing.Graphics]::FromImage($canvas)
  $graphics.Clear([Drawing.Color]::White)
  $font = New-Object Drawing.Font('Arial', 12)
  for ($column = 0; $column -lt 4 -and ($offset + $column) -lt $report.pages.Count; $column++) {
    $id = $report.pages[$offset + $column].id
    $graphics.DrawString($id, $font, [Drawing.Brushes]::Black, ($column * 390), 2)
    for ($row = 0; $row -lt 2; $row++) {
      $position = @('top', 'bottom')[$row]
      $sourceImage = [Drawing.Image]::FromFile((Join-Path $reviewDirectory "$id-$position.png"))
      $graphics.DrawImage($sourceImage, ($column * 390), (30 + $row * 850), 390, 844)
      $sourceImage.Dispose()
    }
  }
  $graphics.Dispose()
  $font.Dispose()
  $canvas.Save((Join-Path $reviewDirectory "sheet-$offset.png"), [Drawing.Imaging.ImageFormat]::Png)
  $canvas.Dispose()
}
