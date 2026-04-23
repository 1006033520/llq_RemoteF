# RemoteF Edge Icon Resizer
# Usage: .\resize-icons.ps1
# Generates icon-128.png, icon-48.png, icon-32.png, icon-16.png from source

Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Find source image
$sourceFile = $null
$names = @(
    "Modern_browser_extension_icon__2026-04-23T17-07-41.png",
    "logo-512.png",
    "icon-512.png",
    "source.png"
)
foreach ($n in $names) {
    $p = Join-Path $scriptDir $n
    if (Test-Path $p) { $sourceFile = $p; break }
}

if (-not $sourceFile) {
    Write-Host "[ERROR] Source image not found." -ForegroundColor Red
    Write-Host "Please save the AI-generated icon as logo-512.png in this folder." -ForegroundColor Yellow
    exit 1
}

Write-Host "Source: $sourceFile" -ForegroundColor Cyan
$sizes = @(128, 48, 32, 16)

$img = [System.Drawing.Image]::FromFile($sourceFile)
foreach ($sz in $sizes) {
    $out = Join-Path $scriptDir "icon-$sz.png"
    $bmp = New-Object System.Drawing.Bitmap($sz, $sz)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($img, 0, 0, $sz, $sz)
    $g.Dispose()
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  Created: icon-$sz.png" -ForegroundColor Green
}
$img.Dispose()

Write-Host ""
Write-Host "Done. Files:" -ForegroundColor Cyan
Get-ChildItem "$scriptDir\*.png" | ForEach-Object { Write-Host "  $($_.Name)" }
