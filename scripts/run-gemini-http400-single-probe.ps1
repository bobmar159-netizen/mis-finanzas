$ErrorActionPreference = 'Stop'

function Read-Secret([string]$Prompt) {
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$env:YARBI_PROBE_PUBLISHABLE_KEY = Read-Host 'Publishable key (sb_publishable_) del proyecto yarbi-audit-preview'
$env:YARBI_PROBE_OWNER_EMAIL = Read-Host 'Correo del usuario sintetico con owner scope aislado'
$env:YARBI_PROBE_OWNER_PASSWORD = Read-Secret 'Contrasena del usuario sintetico'

try {
  node (Join-Path $PSScriptRoot 'run-gemini-http400-single-probe.cjs')
}
finally {
  'YARBI_PROBE_PUBLISHABLE_KEY','YARBI_PROBE_OWNER_EMAIL','YARBI_PROBE_OWNER_PASSWORD' |
    ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
}
