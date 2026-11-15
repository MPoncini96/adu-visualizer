# Downloads free (CC0) textures and furniture models for the walk-in tour into assets-src\.
# Run from the project folder in PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File scripts\fetch-assets.ps1            # step 1: catalog (small, ~1-2 min)
#   powershell -ExecutionPolicy Bypass -File scripts\fetch-assets.ps1 -Fetch     # step 2: download the picks in scripts\asset-picks.json
#
# Sources: Poly Haven (polyhaven.com, CC0) and ambientCG (ambientcg.com, CC0). Nothing is uploaded anywhere.
# assets-src\ is ignored by git; the processed, compressed files the site uses go to public\ instead.
param([switch]$Fetch)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # makes Invoke-WebRequest much faster
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Join-Path (Split-Path $PSScriptRoot -Parent) "assets-src"
New-Item -ItemType Directory -Force -Path $root | Out-Null
$ua = @{ "User-Agent" = "ValleyADUStudio-asset-fetch/1.0" }

function Get-Json($url) { Invoke-RestMethod -Uri $url -Headers $ua -TimeoutSec 60 }
function Save($url, $path) {
  if (Test-Path $path) { return }
  New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
  for ($i = 0; $i -lt 3; $i++) {
    try { Invoke-WebRequest -Uri $url -OutFile $path -Headers $ua -TimeoutSec 180; return }
    catch { Start-Sleep -Seconds 2; if ($i -eq 2) { Write-Warning "failed: $url" } }
  }
}

if (-not $Fetch) {
  # ---------------- step 1: catalog ----------------
  Write-Host "Poly Haven models..."
  $models = Get-Json "https://api.polyhaven.com/assets?t=models"
  $models | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $root "polyhaven-models.json")
  Write-Host "Poly Haven textures..."
  $tex = Get-Json "https://api.polyhaven.com/assets?t=textures"
  $tex | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $root "polyhaven-textures.json")

  # small thumbnails of the models that could go in a house, so the picks can be judged by eye
  $keep = "furniture|seating|table|bed|storage|shelf|lighting|lamp|plant|decor|appliance|kitchen|bathroom|electronic|container|interior|cabinet|sofa|chair|rug|mirror|frame|vase|book|clock|curtain"
  $n = 0
  foreach ($p in $models.PSObject.Properties) {
    $a = $p.Value
    $text = (($a.categories + $a.tags) -join " ") + " " + $a.name
    if ($text -match $keep) {
      $t = if ($a.thumbnail_url) { $a.thumbnail_url -replace "width=\d+", "width=256" -replace "height=\d+", "height=256" } else { "https://cdn.polyhaven.com/asset_img/thumbs/$($p.Name).png?width=256&height=256" }
      Save $t (Join-Path $root "thumbs\models\$($p.Name).png")
      $n++
    }
  }
  Write-Host "  $n model thumbnails"

  Write-Host "ambientCG materials..."
  $acg = @{}
  foreach ($q in "tiles", "wood floor", "planks", "plaster", "painted", "marble", "granite", "terrazzo", "fabric", "carpet", "concrete", "laminate", "wallpaper", "leather") {
    $r = Get-Json ("https://ambientcg.com/api/v2/full_json?type=Material&sort=Popular&limit=25&include=tagData,displayData&q=" + [uri]::EscapeDataString($q))
    $acg[$q] = @($r.foundAssets | ForEach-Object { [pscustomobject]@{ id = $_.assetId; name = $_.displayName; tags = $_.tags } })
  }
  $acg | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $root "ambientcg-materials.json")

  Write-Host ""
  Write-Host "Done. Catalog saved in $root - tell Claude it's ready."
  exit 0
}

# ---------------- step 2: download the picks ----------------
# the picks live in the repo (scripts\asset-picks.json), so the same files can be fetched again anywhere
$picksFile = Join-Path $PSScriptRoot "asset-picks.json"
if (-not (Test-Path $picksFile)) { throw "No $picksFile yet - Claude writes it after looking at the catalog." }
$picks = Get-Content $picksFile -Raw | ConvertFrom-Json
$modelRes = if ($picks.modelRes) { $picks.modelRes } else { "1k" }
$textureRes = if ($picks.textureRes) { $picks.textureRes } else { "1k" }

$modelIds = @($picks.furniture.PSObject.Properties | ForEach-Object { $_.Value.polyhaven } | Where-Object { $_ } | Select-Object -Unique)
foreach ($id in $modelIds) {
  Write-Host "model $id"
  try { $f = Get-Json "https://api.polyhaven.com/files/$id" } catch { Write-Warning "  not found: $id"; continue }
  $g = $f.gltf.$modelRes
  if (-not $g) { $g = $f.gltf."1k" }
  if (-not $g) { Write-Warning "  no glTF for $id"; continue }
  $dir = Join-Path $root "polyhaven\models\$id"
  Save $g.gltf.url (Join-Path $dir ([IO.Path]::GetFileName(([uri]$g.gltf.url).AbsolutePath)))
  foreach ($inc in $g.gltf.include.PSObject.Properties) { Save $inc.Value.url (Join-Path $dir $inc.Name) }
}

$texIds = @($picks.textures.PSObject.Properties | ForEach-Object { $_.Value.polyhaven } | Where-Object { $_ } | Select-Object -Unique)
foreach ($id in $texIds) {
  Write-Host "texture $id"
  try { $f = Get-Json "https://api.polyhaven.com/files/$id" } catch { Write-Warning "  not found: $id"; continue }
  $dir = Join-Path $root "polyhaven\textures\$id"
  foreach ($map in "Diffuse", "nor_gl", "Rough", "AO", "arm") {
    $m = $f.$map
    if (-not $m) { continue }
    $r = $m.$textureRes; if (-not $r) { $r = $m."1k" }
    if ($r.jpg) { Save $r.jpg.url (Join-Path $dir ("$map.jpg")) } elseif ($r.png) { Save $r.png.url (Join-Path $dir ("$map.png")) }
  }
}

$picks | Add-Member -NotePropertyName ambientcgMaterials -NotePropertyValue @($picks.textures.PSObject.Properties | ForEach-Object { $_.Value.ambientcg } | Where-Object { $_ } | Select-Object -Unique) -Force
foreach ($id in $picks.ambientcgMaterials) {
  Write-Host "material $id"
  $zip = Join-Path $root "ambientcg\$id.zip"
  Save "https://ambientcg.com/get?file=$($id)_1K-JPG.zip" $zip
  if (Test-Path $zip) { Expand-Archive -Force $zip (Join-Path $root "ambientcg\$id") }
}

foreach ($id in $picks.polyhavenHdris) {
  Write-Host "hdri $id"
  $f = Get-Json "https://api.polyhaven.com/files/$id"
  $r = $f.hdri.($picks.hdriRes); if (-not $r) { $r = $f.hdri."1k" }
  Save $r.hdr.url (Join-Path $root "polyhaven\hdri\$id.hdr")
}

$size = (Get-ChildItem $root -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ""
Write-Host ("Done. {0:N0} MB in $root - tell Claude it's ready." -f $size)
