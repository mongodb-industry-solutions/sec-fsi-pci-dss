# ============================================================
#  GitHub Key & Auth Manager
# ============================================================

function ok     { param($msg) Write-Host "[ok]     $msg" }
function warn   { param($msg) Write-Host "[warn]   $msg" }
function fail   { param($msg) Write-Host "[error]  $msg" }
function action { param($msg) Write-Host "[action] $msg" }
function chk    { param($msg) Write-Host "[check]  $msg" }
function run {
    param([scriptblock]$Block)
    Write-Host "[cmd]    $($Block.ToString().Trim())"
    & $Block
}

# ---- Dependency checks -------------------------------------

function Ensure-ExecutionPolicy {
    chk "Execution policy..."
    $policy = Get-ExecutionPolicy -Scope CurrentUser
    if ($policy -eq "Restricted") {
        action "Setting execution policy to RemoteSigned for current user..."
        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
        ok "Execution policy set to RemoteSigned."
    } else {
        ok "Execution policy: $policy"
    }
}

function Ensure-OpenSSH {
    chk "OpenSSH Client (ssh-keygen)..."
    if (Get-Command ssh-keygen -ErrorAction SilentlyContinue) {
        ok "ssh-keygen is available."
        return
    }
    action "Installing OpenSSH Client via Windows optional features..."
    run { Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0 } | Out-Null
    if (Get-Command ssh-keygen -ErrorAction SilentlyContinue) {
        ok "OpenSSH Client installed."
    } else {
        fail "Could not install OpenSSH Client automatically."
        Write-Host "  > Go to: Settings -> System -> Optional Features -> Add: OpenSSH Client"
        exit 1
    }
}

function Ensure-GitHubCLI {
    chk "GitHub CLI (gh)..."
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        ok "gh is available: $(gh --version | Select-Object -First 1)"
        return
    }
    action "Installing GitHub CLI via winget..."
    run { winget install --id GitHub.cli --silent --accept-package-agreements --accept-source-agreements }
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        ok "GitHub CLI installed: $(gh --version | Select-Object -First 1)"
    } else {
        fail "Could not install GitHub CLI."
        Write-Host "  > Install manually from: https://cli.github.com"
        Write-Host "  > Then re-run this script."
        exit 1
    }
}

function Ensure-SSHDir {
    chk "~/.ssh directory..."
    $dir = "$HOME\.ssh"
    if (!(Test-Path $dir)) {
        action "Creating ~/.ssh directory..."
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        ok "~/.ssh created."
    } else {
        ok "~/.ssh directory exists."
    }
}

# ---- Option 1: Create SSH key ------------------------------

function Invoke-CreateSSHKey {
    $SSHDir = "$HOME\.ssh"

    Write-Host ""
    $Email = Read-Host "GitHub Email"

    $DefaultKeyName = "id_rsa_github"
    $KeyInput = Read-Host "SSH key file name (default: $DefaultKeyName)"
    $KeyFileName = if ($KeyInput.Trim() -ne "") { $KeyInput.Trim() } else { $DefaultKeyName }

    $DefaultHost = "github.com"
    $HostInput = Read-Host "SSH config host alias (default: $DefaultHost)"
    $HostAlias = if ($HostInput.Trim() -ne "") { $HostInput.Trim() } else { $DefaultHost }

    $DefaultLabel = $KeyFileName
    $LabelInput = Read-Host "Key label shown in GitHub (default: $DefaultLabel)"
    $KeyLabel = if ($LabelInput.Trim() -ne "") { $LabelInput.Trim() } else { $DefaultLabel }

    $KeyPath = "$SSHDir\$KeyFileName"
    Write-Host ""
    action "Generating SSH key '$KeyFileName' for $Email..."

    try {
        run { ssh-keygen -t rsa -b 4096 -C "$Email" -f "$KeyPath" -N '""' }
    } catch {
        fail "ssh-keygen failed. Ensure OpenSSH Client is installed and in PATH."
        return
    }

    $PublicKeyPath = "$KeyPath.pub"
    if (!(Test-Path $PublicKeyPath)) {
        fail "Key generation failed - $PublicKeyPath not found."
        return
    }

    # Update ~/.ssh/config
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
            warn "Host '$HostAlias' already exists in $ConfigPath - skipping config update."
        } else {
            Add-Content -Path $ConfigPath -Value $ConfigBlock
            ok "SSH config updated: $ConfigPath"
        }
    } else {
        Set-Content -Path $ConfigPath -Value $ConfigBlock.TrimStart()
        ok "SSH config created: $ConfigPath"
    }

    Write-Host ""
    Write-Host "Public key ($KeyLabel):"
    Write-Host "----------------------------------------"
    Get-Content $PublicKeyPath
    Write-Host "----------------------------------------"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Go to https://github.com/settings/keys"
    Write-Host "  2. Click 'New SSH Key', set title to '$KeyLabel', paste the key above."
    Write-Host "  3. If using GitHub org SSO, authorize the key for your organization."
    Write-Host ""
    $GitHubHost = if ($HostAlias -eq "github.com") { "github.com" } else { $HostAlias }
    Write-Host "Test your connection with:"
    Write-Host "  ssh -T git@$GitHubHost"
    Write-Host "  ssh -i `"$HOME\.ssh\$KeyFileName`" -T git@github.com"
}

# ---- Option 2: Authenticate with GitHub CLI ----------------

function Invoke-GitHubAuth {
    Write-Host ""
    chk "GitHub CLI authentication status..."
    $status = gh auth status 2>&1
    if ($LASTEXITCODE -eq 0) {
        ok "Already authenticated with GitHub:"
        Write-Host $status
        return
    }
    action "Starting GitHub CLI authentication via browser (OAuth)..."
    Write-Host "  > A code will appear - open https://github.com/login/device and paste it."
    Write-Host "  > If your org has app restrictions, approve 'GitHub CLI' access when prompted."
    Write-Host ""
    run { gh auth login --web --git-protocol ssh --scopes repo,read:org,workflow }
    if ($LASTEXITCODE -eq 0) {
        ok "Authentication successful."
        Write-Host ""
        gh auth status
    } else {
        fail "Authentication failed. Try running: gh auth login --web --scopes repo,read:org,workflow"
    }
}

# ---- Option 5: Logout / switch user -----------------------

function Invoke-GitHubLogout {
    Write-Host ""
    chk "GitHub CLI authentication status..."
    $status = gh auth status 2>&1
    if ($LASTEXITCODE -ne 0) {
        warn "No active GitHub CLI session found. Nothing to log out from."
        return
    }
    Write-Host $status
    Write-Host ""
    $confirm = Read-Host "Log out from GitHub CLI? This will remove the stored token. (y/N)"
    if ($confirm.Trim().ToLower() -ne "y") {
        Write-Host "Logout cancelled."
        return
    }
    run { gh auth logout }
    if ($LASTEXITCODE -eq 0) {
        ok "Logged out successfully. Run option 2 to authenticate as a different user."
    } else {
        fail "Logout failed. Try running: gh auth logout"
    }
}

# ---- Option 4: List SSH keys -------------------------------

function Invoke-ListSSHKeys {
    $SSHDir = "$HOME\.ssh"
    Write-Host ""
    Write-Host "SSH keys found in $SSHDir :"
    Write-Host "------------------------------------------------------------"

    $pubKeys = Get-ChildItem -Path $SSHDir -Filter "*.pub" -ErrorAction SilentlyContinue
    if (-not $pubKeys) {
        warn "No public keys found in $SSHDir."
        return
    }

    $ConfigPath = "$SSHDir\config"
    $configContent = if (Test-Path $ConfigPath) { Get-Content $ConfigPath -Raw } else { "" }

    foreach ($pub in $pubKeys) {
        $keyName = $pub.BaseName
        $fingerprint = & ssh-keygen -lf $pub.FullName 2>&1
        $inConfig = if ($configContent -match "IdentityFile\s+[~\w/\\]*$keyName") { "yes" } else { "no" }
        Write-Host ""
        Write-Host "  Key      : $keyName"
        Write-Host "  File     : $($pub.FullName)"
        Write-Host "  In config: $inConfig"
        Write-Host "  Details  : $fingerprint"
    }

    Write-Host ""
    Write-Host "------------------------------------------------------------"
    Write-Host "SSH config: $ConfigPath"
    if (Test-Path $ConfigPath) {
        Get-Content $ConfigPath
    } else {
        warn "No SSH config file found."
    }
}

# ---- Option 3: List pull requests --------------------------

function Invoke-ListPRs {
    Write-Host ""
    chk "GitHub CLI authentication..."
    gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        fail "Not authenticated with GitHub CLI. Run option 2 first."
        return
    }
    ok "Authenticated."

    $RepoInput = Read-Host "Repository owner/repo (leave empty to use current directory)"
    $BaseInput = Read-Host "Base branch to filter (default: staging)"
    $BaseBranch = if ($BaseInput.Trim() -ne "") { $BaseInput.Trim() } else { "staging" }

    Write-Host ""
    if ($RepoInput.Trim() -ne "") {
        Write-Host "Pull requests targeting '$BaseBranch' in $($RepoInput.Trim()):"
        gh pr list --repo $RepoInput.Trim() --base $BaseBranch
    } else {
        Write-Host "Pull requests targeting '$BaseBranch' in current repo:"
        gh pr list --base $BaseBranch
    }
}

# ---- Option 6: Merge a pull request ------------------------

function Invoke-MergePR {
    Write-Host ""
    chk "GitHub CLI authentication..."
    gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        fail "Not authenticated with GitHub CLI. Run option 2 first."
        return
    }
    ok "Authenticated."

    chk "Token scopes (repo scope required to merge)..."
    $scopes = gh auth status 2>&1 | Select-String "Token scopes"
    if ($scopes -notmatch "\brepo\b") {
        warn "Token is missing the 'repo' scope. Attempting to refresh..."
        run { gh auth refresh --scopes repo,read:org }
        if ($LASTEXITCODE -ne 0) {
            fail "Could not refresh token scopes. Try running: gh auth refresh --scopes repo,read:org"
            return
        }
        ok "Token scopes refreshed."
    } else {
        ok "Token scopes OK: $scopes"
    }

    $RepoInput = Read-Host "Repository owner/repo (leave empty to use current directory)"
    $BaseInput = Read-Host "Base branch (default: staging)"
    $BaseBranch = if ($BaseInput.Trim() -ne "") { $BaseInput.Trim() } else { "staging" }
    $RepoFlag  = if ($RepoInput.Trim() -ne "") { @("--repo", $RepoInput.Trim()) } else { @() }

    Write-Host ""
    Write-Host "Open pull requests targeting '$BaseBranch':"
    Write-Host "------------------------------------------------------------"
    Write-Host "[cmd]    gh pr list $($RepoFlag -join ' ') --base $BaseBranch --state open"
    & gh pr list @RepoFlag --base $BaseBranch --state open
    Write-Host "------------------------------------------------------------"
    Write-Host ""

    $PRNumber = Read-Host "PR number to merge (leave empty to cancel)"
    if ($PRNumber.Trim() -eq "") {
        Write-Host "Cancelled."
        return
    }

    Write-Host ""
    Write-Host "Merge strategy:"
    Write-Host "  1. merge   - standard merge commit (default)"
    Write-Host "  2. squash  - squash all commits into one"
    Write-Host "  3. rebase  - rebase commits onto base branch"
    $stratInput = Read-Host "Strategy (default: 1)"
    $strategy = switch ($stratInput.Trim()) {
        "2" { "--squash" }
        "3" { "--rebase" }
        default { "--merge" }
    }

    Write-Host ""
    Write-Host "Branch protection (pick one - these flags are mutually exclusive):"
    Write-Host "  1. --admin  - bypass ALL requirements now: reviews, CI, branch rules (default)"
    Write-Host "  2. --auto   - queue merge: auto-merges once CI and reviews pass (does NOT skip checks)"
    Write-Host "  3. none     - standard merge, fails if any requirement is not met"
    $policyInput = Read-Host "Policy (default: 1)"
    $policyFlag = switch ($policyInput.Trim()) {
        "2" { "--auto" }
        "3" { "" }
        default { "--admin" }
    }
    $policyLabel = if ($policyFlag -eq "") { "none" } else { $policyFlag }

    Write-Host ""
    $confirm = Read-Host "Merge PR #$($PRNumber.Trim()) into '$BaseBranch' [$($strategy.TrimStart('-'))] [$policyLabel]? (y/N)"
    if ($confirm.Trim().ToLower() -ne "y") {
        Write-Host "Cancelled."
        return
    }

    $mergeArgs = @($PRNumber.Trim()) + $RepoFlag + @($strategy, "--delete-branch")
    if ($policyFlag -ne "") { $mergeArgs += $policyFlag }
    Write-Host "[cmd]    gh pr merge $($mergeArgs -join ' ')"
    $mergeOutput = & gh pr merge @mergeArgs 2>&1
    $mergeOutput | Write-Host
    if ($LASTEXITCODE -eq 0) {
        ok "PR #$($PRNumber.Trim()) merged successfully."
    } else {
        fail "Merge failed."
        if ($mergeOutput -match "Resource not accessible by personal access token") {
            Write-Host ""
            Write-Host "  This error means the GitHub CLI OAuth app is not authorized for the organization."
            Write-Host "  Fix options:"
            Write-Host "    A) Go to https://github.com/settings/connections/applications"
            Write-Host "       Find 'GitHub CLI' and click 'Grant' next to your organization."
            Write-Host ""
            Write-Host "    B) Re-authenticate and authorize the org during the browser flow:"
            Write-Host "       gh auth refresh --scopes repo,read:org,workflow"
        }
    }
}

# ============================================================
#  Bootstrap
# ============================================================

Write-Host ""
Write-Host "============================================"
Write-Host " GitHub Key & Auth Manager"
Write-Host "============================================"
Write-Host ""
Write-Host "Checking dependencies..."
Write-Host ""

Ensure-ExecutionPolicy
Ensure-OpenSSH
Ensure-GitHubCLI
Ensure-SSHDir

Write-Host ""
ok "All dependencies satisfied."

# ============================================================
#  Main menu
# ============================================================

do {
    Write-Host ""
    Write-Host "============================================"
    Write-Host " Menu"
    Write-Host "============================================"
    Write-Host "  1. Create SSH key for GitHub"
    Write-Host "  2. Authenticate with GitHub CLI (gh auth login)"
    Write-Host "  3. List pull requests in a project"
    Write-Host "  4. List SSH keys"
    Write-Host "  5. Logout / switch GitHub account"
    Write-Host "  6. Merge a pull request"
    Write-Host "  0. Exit"
    Write-Host ""
    $choice = Read-Host "Select an option"

    switch ($choice) {
        "1" { Invoke-CreateSSHKey }
        "2" { Invoke-GitHubAuth }
        "3" { Invoke-ListPRs }
        "4" { Invoke-ListSSHKeys }
        "5" { Invoke-GitHubLogout }
        "6" { Invoke-MergePR }
        "0" { Write-Host ""; Write-Host "Goodbye." }
        default { warn "Invalid option. Enter 1-6 or 0." }
    }

    if ($choice -ne "0") {
        Write-Host ""
        Read-Host "Press Enter to return to menu"
    }

} while ($choice -ne "0")
