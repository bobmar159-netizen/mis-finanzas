$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:YARBI_AUTH_CONTINUITY_PREVIEW = Read-Host 'Pega la URL HTTPS del NUEVO Preview Auth-only aislado'
$env:YARBI_AUTH_CONTINUITY_PUBLISHABLE_KEY = Read-Host 'Pega la Publishable key sb_publishable_ del proyecto aislado'
$env:YARBI_AUTH_CONTINUITY_OWNER_EMAIL = Read-Host 'Correo del owner sintético autorizado'
$securePassword = Read-Host 'Contraseña del owner sintético autorizado' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:YARBI_AUTH_CONTINUITY_OWNER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  & node (Join-Path $PSScriptRoot 'run-auth-continuity-preview.cjs')
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Item Env:YARBI_AUTH_CONTINUITY_PREVIEW -ErrorAction SilentlyContinue
  Remove-Item Env:YARBI_AUTH_CONTINUITY_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:YARBI_AUTH_CONTINUITY_OWNER_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:YARBI_AUTH_CONTINUITY_OWNER_PASSWORD -ErrorAction SilentlyContinue
}
