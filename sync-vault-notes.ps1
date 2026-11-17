[CmdletBinding()]
param(
    [string]$VaultPath = $env:OBSIDIAN_VAULT_PATH
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($VaultPath)) {
    $VaultPath = 'C:\Users\allan\Downloads\Obsidian Vault - torn dbot\Obsidian Vault - Discord Floppy Bot'
}

$referencePath = Join-Path $VaultPath 'Project Reference'
if (-not (Test-Path -LiteralPath $referencePath -PathType Container)) {
    throw "Obsidian Project Reference folder not found at '$referencePath'. Set OBSIDIAN_VAULT_PATH or pass -VaultPath."
}

$files = @(
    @{ Source = 'AGENTS.md'; Destination = 'Agent Instructions.md' }
    @{ Source = 'README.md'; Destination = 'Project README.md' }
    @{ Source = 'progress.md'; Destination = 'Project Progress Snapshot.md' }
)

foreach ($file in $files) {
    $sourcePath = Join-Path $PSScriptRoot $file.Source
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required guide '$sourcePath' is missing. Restore or reconstruct it before syncing."
    }

    $destinationPath = Join-Path $referencePath $file.Destination
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force

    $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash
    if ($sourceHash -ne $destinationHash) {
        throw "Sync verification failed for '$($file.Source)' -> '$destinationPath'."
    }

    Write-Output "Synced and verified $($file.Source) -> Project Reference/$($file.Destination)"
}
