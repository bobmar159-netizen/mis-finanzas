$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$env:F3G_SUPABASE_PUBLISHABLE_KEY = Read-Host 'Pega la Publishable key (sb_publishable_) del proyecto aislado'
$env:F3G_OWNER_EMAIL = Read-Host 'Correo del usuario sintético aislado'
$secure = Read-Host 'Contraseña del usuario sintético aislado' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:F3G_OWNER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  node (Join-Path $PSScriptRoot 'run-f3g-service-diagnostic.cjs')
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Item Env:F3G_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:F3G_OWNER_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:F3G_OWNER_PASSWORD -ErrorAction SilentlyContinue
}
