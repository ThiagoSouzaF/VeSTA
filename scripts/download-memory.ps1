$ErrorActionPreference = 'Stop'
$omphalosRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$omphalosRuntime = Join-Path $omphalosRoot 'runtime'
$omphalosDownloads = Join-Path $omphalosRuntime 'downloads'
New-Item -ItemType Directory -Path $omphalosDownloads -Force | Out-Null
$omphalosBase = 'https://github.com/akitaonrails/ai-memory/releases/download/v3.0.0'
$omphalosZip = Join-Path $omphalosDownloads 'ai-memory-windows-x86_64.zip'
Invoke-WebRequest "$omphalosBase/ai-memory-windows-x86_64.zip" -OutFile $omphalosZip
$omphalosChecksum = (Invoke-WebRequest "$omphalosBase/ai-memory-windows-x86_64.zip.sha256").Content.Split(' ')[0].Trim()
if ((Get-FileHash -LiteralPath $omphalosZip -Algorithm SHA256).Hash -ne $omphalosChecksum) { throw 'AI Memory checksum mismatch' }
Expand-Archive -LiteralPath $omphalosZip -DestinationPath $omphalosRuntime -Force
Write-Host 'AI Memory 3.0.0 downloaded and verified.'
