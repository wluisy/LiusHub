# 从 icon.png 生成多尺寸 icon.ico（Win10/11 兼容，PNG 编码）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::FromFile((Join-Path $PSScriptRoot 'icon.png'))
$sizes = @(16, 32, 48, 256)
$parts = @()

foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $parts += , $ms.ToArray()
  $ms.Dispose()
}
$src.Dispose()

$out = Join-Path $PSScriptRoot 'icon.ico'
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([UInt16]0)          # reserved
$bw.Write([UInt16]1)          # type = icon
$bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $d = $sizes[$i]
  $bw.Write([Byte]($(if ($d -ge 256) { 0 } else { $d })))  # width (0 = 256)
  $bw.Write([Byte]($(if ($d -ge 256) { 0 } else { $d })))  # height
  $bw.Write([Byte]0)                                        # palette
  $bw.Write([Byte]0)                                        # reserved
  $bw.Write([UInt16]1)                                      # planes
  $bw.Write([UInt16]32)                                     # bpp
  $bw.Write([UInt32]$parts[$i].Length)
  $bw.Write([UInt32]$offset)
  $offset += $parts[$i].Length
}
foreach ($p in $parts) { $bw.Write($p) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($out, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()
Write-Host "OK -> $out"
