$ErrorActionPreference = "Stop"

$projectPath = "D:\media-desk"
$nodePath = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$pnpmPath = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
$appUrl = "http://localhost:3000/"

function Test-MediaDesk {
  try {
    $response = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match "workspace-shell"
  }
  catch {
    return $false
  }
}

if (-not (Test-MediaDesk)) {
  $env:PATH = "$nodePath;$([System.IO.Path]::GetDirectoryName($pnpmPath));$env:PATH"
  Start-Process -FilePath $pnpmPath -ArgumentList @("run", "dev") -WorkingDirectory $projectPath -WindowStyle Hidden

  $started = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-MediaDesk) {
      $started = $true
      break
    }
  }

  if (-not $started) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      "Media Desk could not start. Please try again.",
      "Media Desk",
      "OK",
      "Error"
    ) | Out-Null
    exit 1
  }
}

Start-Process -FilePath $appUrl
