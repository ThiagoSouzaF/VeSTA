$ErrorActionPreference = 'Stop'
$vestaRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$vestaRuntime = Join-Path $vestaRoot 'runtime'
$vestaDownloads = Join-Path $vestaRuntime 'downloads'
New-Item -ItemType Directory -Path $vestaDownloads -Force | Out-Null
$vestaBase = 'https://github.com/akitaonrails/ai-memory/releases/download/v3.0.0'
$vestaZip = Join-Path $vestaDownloads 'ai-memory-windows-x86_64.zip'
Invoke-WebRequest "$vestaBase/ai-memory-windows-x86_64.zip" -OutFile $vestaZip
$vestaChecksum = (Invoke-WebRequest "$vestaBase/ai-memory-windows-x86_64.zip.sha256").Content.Split(' ')[0].Trim()
if ((Get-FileHash -LiteralPath $vestaZip -Algorithm SHA256).Hash -ne $vestaChecksum) { throw 'AI Memory checksum mismatch' }
Expand-Archive -LiteralPath $vestaZip -DestinationPath $vestaRuntime -Force
Write-Host 'AI Memory 3.0.0 downloaded and verified.'
