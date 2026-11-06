$ErrorActionPreference = 'Stop'

Write-Host 'Copia la Secret key sb_secret_ del proyecto aislado al portapapeles.'
Write-Host 'Cuando ya la hayas copiado, presiona solo Enter. No la pegues en PowerShell.'
[void](Read-Host)
$env:F3REF_SUPABASE_SERVICE_KEY = [string](Get-Clipboard -Raw)
try {
  node (Join-Path $PSScriptRoot 'read-owner-references-preview-traces.cjs')
} finally {
  Remove-Item 'Env:F3REF_SUPABASE_SERVICE_KEY' -ErrorAction SilentlyContinue
  # Reemplaza la clave del portapapeles sin imprimir ni guardarla en archivos.
  Set-Clipboard -Value ' '
}
