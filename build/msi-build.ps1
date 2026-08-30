# ============================================================================
#  LiusHub - Build MSI installer with WiX Toolset 3.14
#
#  Prerequisites:
#    1) dist\win-unpacked must exist (run: electron-builder --win --dir)
#    2) WiX Toolset 3.14 must be present (override path via WIX_HOME env var)
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File build\msi-build.ps1
#    powershell -ExecutionPolicy Bypass -File build\msi-build.ps1 -AppDir dist-msi\win-unpacked
# ============================================================================
param(
    [string]$AppDir = 'dist\win-unpacked'
)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

# --- WiX 3.14 tools directory ------------------------------------------------
$Wix = if ($env:WIX_HOME) { $env:WIX_HOME }
        else { 'C:\Users\wluisy\AppData\Local\tauri\WixTools314' }
if (-not (Test-Path "$Wix\candle.exe")) {
    throw "WiX 3.14 not found at: $Wix (set WIX_HOME to point to the WiX folder)"
}
$candle = Join-Path $Wix 'candle.exe'
$light  = Join-Path $Wix 'light.exe'
$heat   = Join-Path $Wix 'heat.exe'

# --- Paths -------------------------------------------------------------------
$appDir = Join-Path $Root $AppDir
if (-not (Test-Path $appDir)) {
    throw "App dir not found: $appDir (run electron-builder --win --dir first)"
}

$msiDir = Join-Path $Root 'dist\msi'
$productWxs = Join-Path $Root 'build\msi\product.wxs'
# -Raw -Encoding UTF8：package.json 是 UTF-8 且含中文，PowerShell 5.1 默认按 ANSI 解码会变乱码导致 JSON 解析失败
$version = (Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'package.json') | ConvertFrom-Json).version
$outMsi = Join-Path $Root ("dist\LiusHub-{0}.msi" -f $version)

New-Item -ItemType Directory -Force -Path $msiDir | Out-Null

# --- 1) heat: harvest app files (file ids = file names, so shortcuts can use [#LiusHub.exe]) ---
Write-Host '==> heat: harvesting app files...'
& $heat dir "$appDir" `
    -gg -srd -scom -sreg -sfrag -suid -sw `
    -cg AppFiles -dr INSTALLFOLDER `
    -out (Join-Path $msiDir 'files.wxs')
if ($LASTEXITCODE -ne 0) { throw 'heat failed' }

# --- 2) candle: compile .wxs -> .wixobj ---------------------------------------
Write-Host '==> candle: compiling...'
& $candle -arch x64 `
    (Join-Path $msiDir 'files.wxs') `
    $productWxs `
    -out (Join-Path $msiDir '\')
if ($LASTEXITCODE -ne 0) { throw 'candle failed' }

# --- 3) light: link -> .msi ----------------------------------------------------
Write-Host '==> light: linking MSI...'
# -sice 抑制项均为 per-user 安装（InstallScope=perUser）下的 ICE 误报：
#   ICE38: 用户配置文件中的组件须用 HKCU 注册表键作 KeyPath（per-user 固定时安全）
#   ICE64: 用户配置文件目录须列入 RemoveFile（卸载时文件会被文件 KeyPath 删除）
#   ICE91: 文件装入 per-user 目录（per-machine 时才需要逐用户复制）
# -dcl:high: LZX 最高压缩（内容不变，仅压缩算法；默认 mszip 会使 MSI 明显偏大）
& $light -ext WixUIExtension -sice:ICE38 -sice:ICE64 -sice:ICE91 -dcl:high `
    -b $appDir `
    (Join-Path $msiDir 'product.wixobj') `
    (Join-Path $msiDir 'files.wixobj') `
    -o $outMsi
if ($LASTEXITCODE -ne 0) { throw 'light failed' }

Write-Host ''
Write-Host "MSI created: $outMsi"
Write-Host ("Size: {0:N1} MB" -f ((Get-Item $outMsi).Length / 1MB))
