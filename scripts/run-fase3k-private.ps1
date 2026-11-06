param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
function Read-SessionCredentials {
  Add-Type -AssemblyName System.Windows.Forms
  $picker = New-Object System.Windows.Forms.OpenFileDialog
  $picker.Title = 'Selecciona tu archivo local con las dos claves aisladas de Fase 3K'
  $picker.Filter = 'Archivos de texto|*.txt|Todos los archivos|*.*'
  if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    throw 'No se selecciono el archivo de claves.'
  }
  $content = Get-Content -LiteralPath $picker.FileName -Raw -ErrorAction Stop
  $access = [regex]::Match($content, '(?<![A-Za-z0-9_-])(sbp_[A-Za-z0-9_-]{20,})')
  $secret = [regex]::Match($content, '(?<![A-Za-z0-9_-])(sb_secret_[A-Za-z0-9_-]{20,})')
  if (-not $access.Success -or -not $secret.Success) {
    throw 'El archivo debe contener un token sbp_ y una Secret key sb_secret_ completos.'
  }
  return @{ AccessToken = $access.Groups[1].Value; SecretKey = $secret.Groups[1].Value }
}
# Las claves nunca se imprimen ni se escriben: se mantienen solo en memoria
# durante Node y se eliminan del entorno de la sesión al finalizar.
$credentials = Read-SessionCredentials
$env:SUPABASE_ACCESS_TOKEN = $credentials.AccessToken
$env:SUPABASE_SECRET_KEY = $credentials.SecretKey
try { node (Join-Path $PSScriptRoot 'fase3k-isolated-runner.cjs') }
finally {
  Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
  Remove-Variable credentials -ErrorAction SilentlyContinue
}
