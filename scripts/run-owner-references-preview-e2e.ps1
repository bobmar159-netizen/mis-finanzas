$ErrorActionPreference = 'Stop'

function Read-Secret([string]$Prompt) {
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$env:F3REF_SUPABASE_PUBLISHABLE_KEY = Read-Host 'Pega la Publishable key (sb_publishable_) del proyecto aislado'
$env:F3REF_OWNER_A_EMAIL = Read-Host 'Correo sintético del owner A'
$env:F3REF_OWNER_A_PASSWORD = Read-Secret 'Contraseña del owner A'
$env:F3REF_OWNER_B_EMAIL = Read-Host 'Correo sintético del owner B'
$env:F3REF_OWNER_B_PASSWORD = Read-Secret 'Contraseña del owner B'
$includeNoScope = Read-Host '¿Probar también un usuario válido sin scope? (s/N)'
if ($includeNoScope -match '^[sS]') {
  $env:F3REF_NO_SCOPE_EMAIL = Read-Host 'Correo sintético sin scope'
  $env:F3REF_NO_SCOPE_PASSWORD = Read-Secret 'Contraseña del usuario sin scope'
}

try {
  node (Join-Path $PSScriptRoot 'run-owner-references-preview-e2e.cjs')
} finally {
  'F3REF_SUPABASE_PUBLISHABLE_KEY','F3REF_OWNER_A_EMAIL','F3REF_OWNER_A_PASSWORD','F3REF_OWNER_B_EMAIL','F3REF_OWNER_B_PASSWORD','F3REF_NO_SCOPE_EMAIL','F3REF_NO_SCOPE_PASSWORD' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
}
