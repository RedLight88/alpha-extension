<#
.SYNOPSIS
  One-time registration of the AlphaOCR native-messaging launcher for Chrome.

.DESCRIPTION
  Writes the host manifest (with your extension ID) and adds the HKCU registry
  key Chrome reads to find it. Run this once from PowerShell:

      powershell -ExecutionPolicy Bypass -File native_host\register_native_host.ps1

  You'll be asked for your AlphaOCR extension ID. Find it at chrome://extensions
  (Developer mode on) under the AlphaOCR card - a 32-letter string.

.PARAMETER ExtensionId
  The extension ID. If omitted, you'll be prompted.

.PARAMETER Browser
  Chrome (default), Edge, or Brave - picks the right registry hive.
#>
param(
  [string]$ExtensionId,
  [ValidateSet('Chrome', 'Edge', 'Brave')]
  [string]$Browser = 'Chrome'
)

$ErrorActionPreference = 'Stop'
$HostName = 'com.alphaocr.launcher'
$here = $PSScriptRoot
$manifestPath = Join-Path $here "$HostName.json"

if (-not $ExtensionId) {
  $ExtensionId = Read-Host 'Enter your AlphaOCR extension ID (from chrome://extensions)'
}
$ExtensionId = $ExtensionId.Trim()
if ($ExtensionId -notmatch '^[a-p]{32}$') {
  Write-Warning "That doesn't look like a 32-character extension ID - continuing anyway."
}

# Build the manifest. 'path' is relative to this manifest's folder (Chrome allows that on Windows).
$manifest = [ordered]@{
  name            = $HostName
  description     = 'AlphaOCR backend launcher'
  path            = 'alphaocr_launcher.bat'
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

# Write UTF-8 WITHOUT BOM (Chrome's manifest parser dislikes a BOM).
$json = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote manifest: $manifestPath"

$hive = switch ($Browser) {
  'Edge'  { 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts' }
  'Brave' { 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts' }
  default { 'HKCU:\Software\Google\Chrome\NativeMessagingHosts' }
}
$regKey = Join-Path $hive $HostName
New-Item -Path $regKey -Force | Out-Null
Set-ItemProperty -Path $regKey -Name '(default)' -Value $manifestPath
Write-Host "Registered for ${Browser}: $regKey"
Write-Host ''
Write-Host 'Done. Reload the extension, open the popup, and click "Start backend".'
