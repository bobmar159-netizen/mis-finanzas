param([switch]$AvailabilityProbe)
$ErrorActionPreference = 'Stop'
function Read-Secret([string]$Prompt) {
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$env:F3M_SUPABASE_PUBLISHABLE_KEY = Read-Host 'Pega la Publishable key (sb_publishable_) del proyecto aislado'
$env:F3M_OWNER_EMAIL = Read-Host 'Correo del owner sintético con scope aislado'
$env:F3M_OWNER_PASSWORD = Read-Secret 'Contraseña del owner sintético'
$env:F3M_PREVIEW_URL = 'https://misfinanzas-backend-9s6vmn1rk-omar-dfc4.vercel.app'
if ($AvailabilityProbe) { $env:F3M_AVAILABILITY_PROBE = 'true' }
try { node (Join-Path $PSScriptRoot 'run-gemini-typed-mentions-real.cjs') }
finally { 'F3M_SUPABASE_PUBLISHABLE_KEY','F3M_OWNER_EMAIL','F3M_OWNER_PASSWORD','F3M_PREVIEW_URL','F3M_AVAILABILITY_PROBE' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue } }
