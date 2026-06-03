Write-Host "Please ensure you have executed: 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned' to allow this script to run properly."

$SSHDir = "$HOME\.ssh"

if (-not (Test-Path -Path $SSHDir)) {
    Write-Host "The ~/.ssh directory does not exist. Creating it..."
    New-Item -ItemType Directory -Path $SSHDir -Force | Out-Null
}

# Collect inputs
$Email = Read-Host "GitHub Email"

$DefaultKeyName = "id_rsa_github"
Write-Host "SSH key file name (default: $DefaultKeyName):"
$KeyInput = Read-Host "Key name"
$KeyFileName = if ($KeyInput.Trim() -ne "") { $KeyInput.Trim() } else { $DefaultKeyName }

$DefaultHost = "github.com"
Write-Host "SSH config host alias (default: $DefaultHost - use a custom alias like 'github-work' for multiple accounts):"
$HostInput = Read-Host "Host alias"
$HostAlias = if ($HostInput.Trim() -ne "") { $HostInput.Trim() } else { $DefaultHost }

$DefaultLabel = $KeyFileName
Write-Host "Key label shown in GitHub (default: $DefaultLabel):"
$LabelInput = Read-Host "Key label"
$KeyLabel = if ($LabelInput.Trim() -ne "") { $LabelInput.Trim() } else { $DefaultLabel }

# Generate SSH key
$KeyPath = "$SSHDir\$KeyFileName"
Write-Host ""
Write-Host "Generating SSH key '$KeyFileName' for $Email..."
try {
    & ssh-keygen -t rsa -b 4096 -C "$Email" -f "$KeyPath" -N '""'
} catch {
    Write-Host "Failed to generate SSH key. Ensure OpenSSH Client is installed and available in PATH."
    exit 1
}

$PublicKeyPath = "$KeyPath.pub"
if (!(Test-Path -Path $PublicKeyPath)) {
    Write-Host "Error: key generation failed - $PublicKeyPath not found."
    exit 1
}

# Write SSH config block
$ConfigPath = "$SSHDir\config"
$ConfigBlock = @"

Host $HostAlias
  HostName github.com
  User git
  IdentityFile ~/.ssh/$KeyFileName
  IdentitiesOnly yes
"@

if (Test-Path $ConfigPath) {
    $existing = Get-Content $ConfigPath -Raw
    if ($existing -match "Host $([regex]::Escape($HostAlias))") {
        Write-Host ""
        Write-Host "Warning: a 'Host $HostAlias' entry already exists in $ConfigPath - skipping config update."
        Write-Host "Edit it manually if needed."
    } else {
        Add-Content -Path $ConfigPath -Value $ConfigBlock
        Write-Host ""
        Write-Host "SSH config updated: $ConfigPath"
    }
} else {
    Set-Content -Path $ConfigPath -Value $ConfigBlock.TrimStart()
    Write-Host ""
    Write-Host "SSH config created: $ConfigPath"
}

# Display public key
Write-Host ""
Write-Host "Your SSH public key ($KeyLabel):"
Write-Host "----------------------------------------"
Get-Content $PublicKeyPath
Write-Host "----------------------------------------"

# Final instructions
$GitHubHost = if ($HostAlias -eq "github.com") { "github.com" } else { $HostAlias }
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Go to https://github.com/settings/keys"
Write-Host "  2. Click 'New SSH Key', set title to '$KeyLabel', paste the key above."
Write-Host "  3. Paste the public key and save it with a descriptive name."  
Write-Host "  4. If using GitHub org SSO, authorize the key for your organization."
Write-Host ""
Write-Host "Test the connection with:"
Write-Host "  ssh -T git@$GitHubHost"
Write-Host "  ssh -i `"$HOME\.ssh\$KeyFileName`" -T git@github.com"
Write-Host ""
Write-Host "For git remotes using a custom alias, use:"
Write-Host "  git remote set-url origin git@${GitHubHost}:<org>/<repo>.git"
Write-Host ""
Write-Host "SSH key '$KeyFileName' generated and configured."
