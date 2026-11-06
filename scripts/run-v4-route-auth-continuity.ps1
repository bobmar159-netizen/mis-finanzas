$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:YARBI_V4_ROUTE_AUTH_PREVIEW = Read-Host 'Pega la URL HTTPS del NUEVO Preview V4 Auth-only'
$env:YARBI_V4_ROUTE_AUTH_PUBLISHABLE_KEY = Read-Host 'Pega la Publishable key sb_publishable_ del proyecto aislado'
$env:YARBI_V4_ROUTE_AUTH_OWNER_EMAIL = Read-Host 'Correo del owner sintético autorizado'
$securePassword = Read-Host 'Contraseña del owner sintético autorizado' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:YARBI_V4_ROUTE_AUTH_OWNER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  & node (Join-Path $PSScriptRoot 'run-v4-route-auth-continuity.cjs')
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Item Env:YARBI_V4_ROUTE_AUTH_PREVIEW -ErrorAction SilentlyContinue
  Remove-Item Env:YARBI_V4_ROUTE_AUTH_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:YARBI_V4_ROUTE_AUTH_OWNER_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:YARBI_V4_ROUTE_AUTH_OWNER_PASSWORD -ErrorAction SilentlyContinue
}
