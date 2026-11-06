$ErrorActionPreference = 'Stop'
function Read-Secret([string]$Prompt) {
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$env:F3G_SUPABASE_PUBLISHABLE_KEY = Read-Host 'Pega la Publishable key (sb_publishable_) del proyecto aislado'
$env:F3G_OWNER_EMAIL = Read-Host 'Correo del owner sintético con scope aislado'
$env:F3G_OWNER_PASSWORD = Read-Secret 'Contraseña del owner sintético'
try { node (Join-Path $PSScriptRoot 'run-gemini-owner-understanding-real.cjs') }
finally { 'F3G_SUPABASE_PUBLISHABLE_KEY','F3G_OWNER_EMAIL','F3G_OWNER_PASSWORD' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue } }
