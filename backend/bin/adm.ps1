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

function Get-RepoContext {
    param([string]$Prompt = "Repository owner/repo (leave empty to detect from git remote)")
    $repoInput = Read-Host $Prompt
    if ($repoInput.Trim() -ne "") {
        return @{ Name = $repoInput.Trim(); Flag = @("--repo", $repoInput.Trim()) }
    }
    $gitUrl = & git remote get-url origin 2>&1
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty("$gitUrl")) {
        fail "Could not detect repo from git remote. Specify owner/repo manually."
        return $null
    }
    $name = "$gitUrl".Trim() -replace "^git@github\.com:", "" -replace "^https://github\.com/", "" -replace "\.git$", "" -replace "/$", ""
    return @{ Name = $name; Flag = @() }
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

# ---- Option 17: Set global GitHub login via SSH key -------

function Invoke-SetGlobalSSHLogin {
    Write-Host ""
    $SSHDir = "$HOME\.ssh"

    # List available public keys so the user can pick one
    $pubKeys = Get-ChildItem -Path $SSHDir -Filter "*.pub" -ErrorAction SilentlyContinue
    if (-not $pubKeys) {
        warn "No public keys found in $SSHDir."
        Write-Host "  > Run option 1 to generate a key first, then come back here."
        return
    }

    Write-Host "Available SSH keys in $SSHDir :"
    Write-Host "------------------------------------------------------------"
    $keyList = @()
    $idx = 1
    foreach ($pub in $pubKeys) {
        $fingerprint = & ssh-keygen -lf $pub.FullName 2>&1
        Write-Host "  $idx. $($pub.BaseName)"
        Write-Host "     $fingerprint"
        $keyList += $pub.BaseName
        $idx++
    }
    Write-Host "------------------------------------------------------------"
    Write-Host ""

    $sel = (Read-Host "Key number to use globally (leave empty to skip key configuration)").Trim()

    $keyName = ""
    if ($sel -ne "") {
        $selIdx = [int]$sel - 1
        if ($selIdx -lt 0 -or $selIdx -ge $keyList.Count) {
            fail "Invalid selection."
            return
        }
        $keyName = $keyList[$selIdx]
        $keyPath = "$SSHDir\$keyName"

        action "Setting global git SSH command to use key '$keyName'..."
        run { git config --global core.sshCommand "ssh -i `"$keyPath`" -o IdentitiesOnly=yes" }
        ok "git config --global core.sshCommand updated."

        Write-Host ""
        Write-Host "  Verify with : git config --global core.sshCommand"
        Write-Host "  Test SSH    : ssh -i `"$keyPath`" -T git@github.com"
        Write-Host ""
    }

    # Optional: signed commits via SSH key
    Write-Host "------------------------------------------------------------"
    Write-Host " Signed commits (optional)"
    Write-Host "------------------------------------------------------------"
    Write-Host "  Configures git to sign every commit with an SSH key so that"
    Write-Host "  VSCode and other tools can commit against strict branch rules."
    Write-Host "  Sets: gpg.format=ssh  user.signingkey=<pub>  commit.gpgsign=true"
    Write-Host ""

    $signKey = ""
    if ($keyName -ne "") {
        $enableSign = (Read-Host "Enable signed commits with key '$keyName'? (y/N)").Trim().ToLower()
        if ($enableSign -eq "y") { $signKey = $keyName }
    } else {
        $enableSign = (Read-Host "Enable signed commits? (y/N)").Trim().ToLower()
        if ($enableSign -eq "y") {
            Write-Host ""
            Write-Host "Select a key to use for signing:"
            $idx2 = 1
            foreach ($pub in $pubKeys) {
                $fp2 = & ssh-keygen -lf $pub.FullName 2>&1
                Write-Host "  $idx2. $($pub.BaseName)"
                Write-Host "     $fp2"
                $idx2++
            }
            Write-Host ""
            $signSel = (Read-Host "Key number for signing (leave empty to skip)").Trim()
            if ($signSel -ne "") {
                $signIdx = [int]$signSel - 1
                if ($signIdx -ge 0 -and $signIdx -lt $keyList.Count) {
                    $signKey = $keyList[$signIdx]
                } else {
                    fail "Invalid selection - skipping signed commits."
                }
            }
        }
    }

    if ($signKey -ne "") {
        $signPubPath = ("$SSHDir\$signKey.pub") -replace '\\', '/'
        action "Configuring signed commits with key '$signKey'..."
        run { git config --global gpg.format ssh }
        run { git config --global user.signingkey "$signPubPath" }
        run { git config --global commit.gpgsign true }
        ok "Signed commits enabled."
        Write-Host ""
        Write-Host "  Verify : git config --global --list | Select-String 'gpg|sign'"
        Write-Host "  Note   : Add the public key to GitHub as an SSH *Signing* key at"
        Write-Host "           https://github.com/settings/keys (type: Signing Key)"
        Write-Host ""
    }

    # Optionally authenticate / re-authenticate gh CLI with SSH protocol
    chk "GitHub CLI authentication status..."
    $status = gh auth status 2>&1
    $alreadyAuthed = ($LASTEXITCODE -eq 0)

    if ($alreadyAuthed) {
        ok "Already authenticated:"
        Write-Host $status
        Write-Host ""
        $reauth = (Read-Host "Re-authenticate to ensure SSH git-protocol is set? (y/N)").Trim().ToLower()
        if ($reauth -ne "y") {
            if ($keyName -ne "") {
                ok "Global SSH key configured. All git SSH operations will use '$keyName'."
            }
            return
        }
        action "Logging out first to allow fresh SSH-protocol login..."
        run { gh auth logout }
    }

    action "Starting GitHub CLI login with SSH git-protocol..."
    Write-Host "  > A browser window will open - authorize the GitHub CLI app."
    Write-Host ""
    run { gh auth login --web --git-protocol ssh --scopes repo,read:org,workflow }
    if ($LASTEXITCODE -eq 0) {
        ok "GitHub CLI authenticated with SSH protocol."
        Write-Host ""
        gh auth status
        if ($keyName -ne "") {
            Write-Host ""
            ok "Global SSH key '$keyName' + gh SSH protocol configured."
        }
    } else {
        fail "Authentication failed. Try: gh auth login --git-protocol ssh --scopes repo,read:org,workflow"
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
        Write-Host "[cmd]    ssh-keygen -lf $($pub.FullName)"
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
    Write-Host "[cmd]    gh auth status"
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
        Write-Host "[cmd]    gh pr list --repo $($RepoInput.Trim()) --base $BaseBranch"
        gh pr list --repo $RepoInput.Trim() --base $BaseBranch
    } else {
        Write-Host "Pull requests targeting '$BaseBranch' in current repo:"
        Write-Host "[cmd]    gh pr list --base $BaseBranch"
        gh pr list --base $BaseBranch
    }
}

# ---- Option 6: Merge a pull request ------------------------

function Invoke-MergePR {
    Write-Host ""
    chk "GitHub CLI authentication..."
    Write-Host "[cmd]    gh auth status"
    gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        fail "Not authenticated with GitHub CLI. Run option 2 first."
        return
    }
    ok "Authenticated."

    chk "Token scopes (repo scope required to merge)..."
    Write-Host "[cmd]    gh auth status"
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
        Write-Host ""
        Write-Host "[cmd]    gh pr view $($PRNumber.Trim()) --json state,mergedAt,mergedBy,title $($RepoFlag -join ' ')"
        & gh pr view $PRNumber.Trim() @RepoFlag --json state,mergedAt,mergedBy,title |
            ConvertFrom-Json |
            ForEach-Object {
                Write-Host "  state    : $($_.state)"
                Write-Host "  title    : $($_.title)"
                Write-Host "  mergedAt : $($_.mergedAt)"
                Write-Host "  mergedBy : $($_.mergedBy.login)"
            }
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

# ---- Option 7: Bypass rulesets and force merge -------------

function Invoke-BypassMerge {
    Write-Host ""
    chk "GitHub CLI authentication..."
    Write-Host "[cmd]    gh auth status"
    gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        fail "Not authenticated with GitHub CLI. Run option 2 first."
        return
    }
    ok "Authenticated."

    $ctx = Get-RepoContext
    if ($null -eq $ctx) { return }
    $RepoFlag = $ctx.Flag
    $RepoName = $ctx.Name

    Write-Host ""
    Write-Host "[cmd]    gh api repos/$RepoName/rulesets"
    $raw = & gh api repos/$RepoName/rulesets 2>&1
    if ($LASTEXITCODE -ne 0) { fail "API error: $raw"; return }
    $rulesets = $raw | ConvertFrom-Json
    if (-not $rulesets -or $rulesets.Count -eq 0) {
        warn "No rulesets found for $RepoName."
        return
    }

    Write-Host ""
    Write-Host "Active rulesets:"
    Write-Host "------------------------------------------------------------"
    $rulesets | ForEach-Object { Write-Host "  [$($_.id)] $($_.name) - enforcement: $($_.enforcement)" }
    Write-Host "------------------------------------------------------------"

    $PRInput = Read-Host "PR number to merge"
    if ($PRInput.Trim() -eq "") { Write-Host "Cancelled."; return }

    Write-Host ""
    Write-Host "Merge strategy (merge commits are often disabled - squash is safer):"
    Write-Host "  1. squash  - squash all commits into one (default)"
    Write-Host "  2. rebase  - rebase commits onto base branch"
    Write-Host "  3. merge   - standard merge commit"
    $stratInput = Read-Host "Strategy (default: 1)"
    $strategy = switch ($stratInput.Trim()) {
        "2" { "--rebase" }
        "3" { "--merge" }
        default { "--squash" }
    }

    Write-Host ""
    $confirm = Read-Host "Disable ALL rulesets, merge PR #$($PRInput.Trim()) [$($strategy.TrimStart('-'))], then re-enable rulesets? (y/N)"
    if ($confirm.Trim().ToLower() -ne "y") { Write-Host "Cancelled."; return }

    # Disable all active rulesets
    $disabledRulesets = @()
    foreach ($rs in $rulesets) {
        if ($rs.enforcement -ne "disabled") {
            $result = Invoke-RulesetPut -Ruleset $rs -RepoName $RepoName -State "disabled"
            if ($result.Ok) {
                $disabledRulesets += $rs
                ok "Ruleset '$($rs.name)' disabled."
            } else {
                warn "Could not disable '$($rs.name)': $($result.Output)"
            }
        }
    }

    # Merge
    $mergeArgs = @($PRInput.Trim()) + $RepoFlag + @($strategy, "--delete-branch")
    Write-Host "[cmd]    gh pr merge $($mergeArgs -join ' ')"
    $mergeOutput = & gh pr merge @mergeArgs 2>&1
    $mergeOutput | Write-Host
    $mergeOk = $LASTEXITCODE -eq 0

    # Re-enable rulesets (always, even if merge failed)
    foreach ($rs in $disabledRulesets) {
        $result = Invoke-RulesetPut -Ruleset $rs -RepoName $RepoName -State "active"
        if ($result.Ok) { ok "Ruleset '$($rs.name)' re-enabled." } else { warn "Could not re-enable '$($rs.name)'." }
    }

    if ($mergeOk) {
        ok "PR #$($PRInput.Trim()) merged successfully."
        Write-Host ""
        Write-Host "[cmd]    gh pr view $($PRInput.Trim()) --json state,mergedAt,mergedBy,title $($RepoFlag -join ' ')"
        & gh pr view $PRInput.Trim() @RepoFlag --json state,mergedAt,mergedBy,title |
            ConvertFrom-Json |
            ForEach-Object {
                Write-Host "  state    : $($_.state)"
                Write-Host "  title    : $($_.title)"
                Write-Host "  mergedAt : $($_.mergedAt)"
                Write-Host "  mergedBy : $($_.mergedBy.login)"
            }
    } else {
        fail "Merge failed even after bypassing rulesets. Check the output above."
    }
}

# ---- Option 8: List pending conversations ------------------

function Invoke-ListConversations {
    Write-Host ""
    $ctx = Get-RepoContext
    if ($null -eq $ctx) { return }
    $prNum = (Read-Host "PR number").Trim()
    if ($prNum -eq "") { Write-Host "Cancelled."; return }

    $owner, $repoOnly = $ctx.Name -split "/", 2
    $gqlQuery = 'query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){pullRequest(number:$num){reviewThreads(first:50){nodes{id isResolved comments(first:1){nodes{body author{login}}}}}}}}'
    Write-Host "[cmd]    gh api graphql -f query=<reviewThreads> -f owner=$owner -f name=$repoOnly -F num=$prNum"
    $raw = & gh api graphql -f query=$gqlQuery -f owner=$owner -f name=$repoOnly -F num=$([int]$prNum) 2>&1
    if ($LASTEXITCODE -ne 0) { fail "GraphQL error: $raw"; return }

    $threads = ($raw | ConvertFrom-Json).data.repository.pullRequest.reviewThreads.nodes
    $pending = $threads | Where-Object { -not $_.isResolved }

    if ($pending.Count -eq 0) { ok "No pending conversations in PR #$prNum."; return }

    Write-Host ""
    Write-Host "Pending conversations in PR #$prNum ($($pending.Count) unresolved):"
    Write-Host "------------------------------------------------------------"
    foreach ($t in $pending) {
        $c = $t.comments.nodes[0]
        $preview = if ($c.body.Length -gt 120) { $c.body.Substring(0, 120) + "..." } else { $c.body }
        Write-Host "  ID     : $($t.id)"
        Write-Host "  Author : $($c.author.login)"
        Write-Host "  Comment: $preview"
        Write-Host ""
    }
    Write-Host "------------------------------------------------------------"
}

# ---- Option 9: Resolve a conversation ----------------------

function Invoke-ResolveConversation {
    Write-Host ""
    $ctx = Get-RepoContext
    if ($null -eq $ctx) { return }
    $prNum = (Read-Host "PR number").Trim()
    if ($prNum -eq "") { Write-Host "Cancelled."; return }

    $owner, $repoOnly = $ctx.Name -split "/", 2
    $gqlQuery = 'query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){pullRequest(number:$num){reviewThreads(first:50){nodes{id isResolved comments(first:1){nodes{body author{login}}}}}}}}'
    Write-Host "[cmd]    gh api graphql -f query=<reviewThreads> -f owner=$owner -f name=$repoOnly -F num=$prNum"
    $raw = & gh api graphql -f query=$gqlQuery -f owner=$owner -f name=$repoOnly -F num=$([int]$prNum) 2>&1
    if ($LASTEXITCODE -ne 0) { fail "GraphQL error: $raw"; return }

    $threads = ($raw | ConvertFrom-Json).data.repository.pullRequest.reviewThreads.nodes
    $pending = $threads | Where-Object { -not $_.isResolved }

    if ($pending.Count -eq 0) { ok "No pending conversations in PR #$prNum."; return }

    Write-Host ""
    foreach ($t in $pending) {
        $c = $t.comments.nodes[0]
        $preview = if ($c.body.Length -gt 80) { $c.body.Substring(0, 80) + "..." } else { $c.body }
        Write-Host "  $($t.id)  |  $($c.author.login): $preview"
    }
    Write-Host ""
    $threadId = (Read-Host "Thread ID to resolve (or 'all' to resolve all)").Trim()
    if ($threadId -eq "") { Write-Host "Cancelled."; return }

    $toResolve = if ($threadId -eq "all") { $pending } else { $pending | Where-Object { $_.id -eq $threadId } }
    $gqlMutation = 'mutation($tid:ID!){resolveReviewThread(input:{threadId:$tid}){thread{id isResolved}}}'
    foreach ($t in $toResolve) {
        Write-Host "[cmd]    gh api graphql -f query=<resolveReviewThread> -f tid=$($t.id)"
        $res = & gh api graphql -f query=$gqlMutation -f tid=$($t.id) 2>&1
        if ($LASTEXITCODE -eq 0) { ok "Thread $($t.id) resolved." } else { fail "Failed: $res" }
    }
}

# ---- Option 10: List rulesets ------------------------------

function Invoke-ListRulesets {
    Write-Host ""
    $ctx = Get-RepoContext
    if ($null -eq $ctx) { return }
    Write-Host ""
    Write-Host "[cmd]    gh api repos/$($ctx.Name)/rulesets"
    $raw = & gh api repos/$($ctx.Name)/rulesets 2>&1
    if ($LASTEXITCODE -ne 0) { fail "API error: $raw"; return }
    $rulesets = $raw | ConvertFrom-Json
    if ($rulesets.Count -eq 0) { warn "No rulesets found."; return }
    Write-Host ""
    Write-Host "Rulesets for $($ctx.Name):"
    Write-Host "------------------------------------------------------------"
    $rulesets | ForEach-Object {
        Write-Host "  [$($_.id)] $($_.name)"
        Write-Host "       enforcement : $($_.enforcement)"
        Write-Host "       target      : $($_.target)"
        Write-Host ""
    }
    Write-Host "------------------------------------------------------------"
}

# ---- Options 11/12: Toggle a specific ruleset --------------

function Invoke-RulesetPut {
    param($Ruleset, [string]$RepoName, [string]$State)
    $srcType = if ($Ruleset.PSObject.Properties['source_type']) { $Ruleset.source_type } else { "Repository" }
    if ($srcType -eq "Organization") {
        $org = $RepoName -split "/" | Select-Object -First 1
        $endpoint = "orgs/$org/rulesets/$($Ruleset.id)"
    } else {
        $endpoint = "repos/$RepoName/rulesets/$($Ruleset.id)"
    }
    Write-Host "[cmd]    gh api --method PUT $endpoint -f enforcement=$State -f name=$($Ruleset.name)"
    $res = & gh api --method PUT $endpoint -f enforcement=$State -f name="$($Ruleset.name)" 2>&1
    return @{ Ok = ($LASTEXITCODE -eq 0); Output = $res }
}

function Invoke-SetRulesetState {
    param([string]$TargetState)
    Write-Host ""
    $ctx = Get-RepoContext
    if ($null -eq $ctx) { return }

    Write-Host "[cmd]    gh api repos/$($ctx.Name)/rulesets"
    $raw = & gh api repos/$($ctx.Name)/rulesets 2>&1
    if ($LASTEXITCODE -ne 0) { fail "API error: $raw"; return }
    $rulesets = $raw | ConvertFrom-Json

    Write-Host ""
    $rulesets | ForEach-Object {
        $srcLabel = if ($_.PSObject.Properties['source_type']) { $_.source_type } else { "?" }
        Write-Host "  [$($_.id)] $($_.name) - enforcement: $($_.enforcement) - source: $srcLabel"
    }
    Write-Host ""
    $id = (Read-Host "Ruleset ID to set to '$TargetState'").Trim()
    if ($id -eq "") { Write-Host "Cancelled."; return }

    $rs = $rulesets | Where-Object { "$($_.id)" -eq $id }
    $confirm = (Read-Host "Set ruleset '$($rs.name)' to '$TargetState'? (y/N)").Trim().ToLower()
    if ($confirm -ne "y") { Write-Host "Cancelled."; return }

    $result = Invoke-RulesetPut -Ruleset $rs -RepoName $ctx.Name -State $TargetState
    if ($result.Ok) { ok "Ruleset '$($rs.name)' is now '$TargetState'." } else { fail "Failed: $($result.Output)" }
}

function Invoke-DisableRuleset { Invoke-SetRulesetState -TargetState "disabled" }
function Invoke-EnableRuleset  { Invoke-SetRulesetState -TargetState "active" }

# ---- Option 13: Dependabot alerts --------------------------

function Invoke-ListDependabotAlerts {
    Write-Host ""
    $ctx = Get-RepoContext
    if ($null -eq $ctx) { return }

    $stateInput = (Read-Host "State filter (open/dismissed/fixed/auto_dismissed/all - default: all)").Trim()
    $filterState = if ($stateInput -ne "" -and $stateInput -ne "all") { $stateInput } else { "" }

    if ($filterState -ne "") {
        Write-Host "[cmd]    gh api --paginate repos/$($ctx.Name)/dependabot/alerts -f state=$filterState"
        $raw = & gh api --paginate "repos/$($ctx.Name)/dependabot/alerts" -f state=$filterState 2>&1
    } else {
        Write-Host "[cmd]    gh api --paginate repos/$($ctx.Name)/dependabot/alerts"
        $raw = & gh api --paginate "repos/$($ctx.Name)/dependabot/alerts" 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
        fail "Dependabot API error."
        Write-Host "  Possible causes:"
        Write-Host "    1. Dependabot is not enabled -> Settings -> Security -> Dependabot alerts"
        Write-Host "    2. Token missing scope -> run: gh auth refresh --scopes repo,security_events"
        return
    }

    $alerts = $raw | ConvertFrom-Json
    if ($alerts.Count -eq 0) { ok "No Dependabot alerts found."; return }

    Write-Host ""
    Write-Host "Dependabot alerts for $($ctx.Name) ($($alerts.Count) total):"
    Write-Host "------------------------------------------------------------"
    $alerts | ForEach-Object {
        $sev = $_.security_advisory.severity.ToUpper()
        $eco = $_.dependency.package.ecosystem
        $pkg = $_.dependency.package.name
        Write-Host "  [#$($_.number)] [$($_.state.ToUpper())] [$sev] $eco/$pkg"
        Write-Host "         $($_.security_advisory.summary)"
        Write-Host "         CVE: $($_.security_advisory.cve_id)  CVSS: $($_.security_advisory.cvss.score)"
        Write-Host ""
    }
    Write-Host "------------------------------------------------------------"
    Write-Host "Browser: https://github.com/$($ctx.Name)/security/dependabot"
}

# ---- Option 14: Secret scanning alerts ---------------------

function Invoke-ListSecretAlerts {
    Write-Host ""
    $ctx = Get-RepoContext
    if ($null -eq $ctx) { return }

    $stateInput = (Read-Host "State filter (open/resolved/all - default: all)").Trim()
    $filterState = if ($stateInput -ne "" -and $stateInput -ne "all") { $stateInput } else { "" }

    if ($filterState -ne "") {
        Write-Host "[cmd]    gh api --paginate repos/$($ctx.Name)/secret-scanning/alerts -f state=$filterState"
        $raw = & gh api --paginate "repos/$($ctx.Name)/secret-scanning/alerts" -f state=$filterState 2>&1
    } else {
        Write-Host "[cmd]    gh api --paginate repos/$($ctx.Name)/secret-scanning/alerts"
        $raw = & gh api --paginate "repos/$($ctx.Name)/secret-scanning/alerts" 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
        fail "Secret scanning API error."
        Write-Host "  Possible causes:"
        Write-Host "    1. Secret scanning not enabled -> Settings -> Security -> Secret scanning"
        Write-Host "    2. Token missing scope -> run: gh auth refresh --scopes repo,security_events"
        return
    }

    $alerts = $raw | ConvertFrom-Json
    if ($alerts.Count -eq 0) { ok "No secret scanning alerts found."; return }

    Write-Host ""
    Write-Host "Secret scanning alerts for $($ctx.Name) ($($alerts.Count) total):"
    Write-Host "------------------------------------------------------------"
    foreach ($a in $alerts) {
        Write-Host "  [#$($a.number)] [$($a.state.ToUpper())] $($a.secret_type_display_name)"
        Write-Host "         Validity : $($a.validity)"
        Write-Host "         Created  : $($a.created_at)"
        Write-Host "         URL      : $($a.html_url)"
        Write-Host ""
    }
    Write-Host "------------------------------------------------------------"
    Write-Host "Browser: https://github.com/$($ctx.Name)/security/secret-scanning"
}

# ---- Option 15: Code scanning alerts -----------------------

function Invoke-ListCodeAlerts {
    Write-Host ""
    $ctx = Get-RepoContext
    if ($null -eq $ctx) { return }

    $stateInput = (Read-Host "State filter (open/dismissed/fixed/all - default: all)").Trim()
    $filterState = if ($stateInput -ne "" -and $stateInput -ne "all") { $stateInput } else { "" }

    if ($filterState -ne "") {
        Write-Host "[cmd]    gh api --paginate repos/$($ctx.Name)/code-scanning/alerts -f state=$filterState"
        $raw = & gh api --paginate "repos/$($ctx.Name)/code-scanning/alerts" -f state=$filterState 2>&1
    } else {
        Write-Host "[cmd]    gh api --paginate repos/$($ctx.Name)/code-scanning/alerts"
        $raw = & gh api --paginate "repos/$($ctx.Name)/code-scanning/alerts" 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
        fail "Code scanning API error."
        Write-Host "  Possible causes:"
        Write-Host "    1. No code scanning analysis found (GitHub Actions workflow needed)"
        Write-Host "    2. Token missing scope -> run: gh auth refresh --scopes repo,security_events,admin:repo_hook"
        Write-Host "    3. Code scanning not configured -> Settings -> Security -> Code scanning"
        return
    }

    $alerts = $raw | ConvertFrom-Json
    if ($alerts.Count -eq 0) { ok "No code scanning alerts found."; return }

    Write-Host ""
    Write-Host "Code scanning alerts for $($ctx.Name) ($($alerts.Count) total):"
    Write-Host "------------------------------------------------------------"
    foreach ($a in $alerts) {
        $sev = if ($a.rule.PSObject.Properties['security_severity_level'] -and $a.rule.security_severity_level) `
               { $a.rule.security_severity_level } else { $a.rule.severity }
        $tags = if ($a.rule.PSObject.Properties['tags'] -and $a.rule.tags) { $a.rule.tags -join ", " } else { "" }
        Write-Host "  [#$($a.number)] [$($a.state.ToUpper())] [$($sev.ToUpper())] $($a.rule.name)"
        Write-Host "         $($a.rule.description)"
        if ($tags) { Write-Host "         Tags: $tags" }
        Write-Host "         Tool: $($a.tool.name) | Ref: $($a.most_recent_instance.ref)"
        Write-Host ""
    }
    Write-Host "------------------------------------------------------------"
    Write-Host "Browser: https://github.com/$($ctx.Name)/security/code-scanning"
}

# ---- Option 16: Generate JSON reports ----------------------

function Invoke-GenerateReport {
    Write-Host ""
    $ctx = Get-RepoContext
    if ($null -eq $ctx) { return }

    $tmpDir = "tmp"
    if (!(Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir | Out-Null; ok "Created $tmpDir/" }

    # PR report
    $prNum = (Read-Host "PR number for issue report (leave empty to skip)").Trim()
    if ($prNum -ne "") {
        Write-Host ""
        action "Generating PR report for #$prNum..."
        $owner, $repoOnly = $ctx.Name -split "/", 2

        Write-Host "[cmd]    gh api repos/$($ctx.Name)/pulls/$prNum"
        $prRaw = & gh api "repos/$($ctx.Name)/pulls/$prNum" 2>&1
        $prData = if ($LASTEXITCODE -eq 0) { $prRaw | ConvertFrom-Json } else { $null }

        $gqlQuery = 'query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){pullRequest(number:$num){title state body author{login} baseRefName headRefName createdAt mergedAt reviews(first:50){nodes{id state author{login} body submittedAt}} reviewThreads(first:50){nodes{id isResolved path line comments(first:20){nodes{body author{login} createdAt}}}}}}}'
        Write-Host "[cmd]    gh api graphql -f query=<PR full detail with threads>"
        $gqlRaw = & gh api graphql -f query=$gqlQuery -f owner=$owner -f name=$repoOnly -F num=$([int]$prNum) 2>&1
        $gqlData = if ($LASTEXITCODE -eq 0) { ($gqlRaw | ConvertFrom-Json).data.repository.pullRequest } else { $null }

        Write-Host "[cmd]    gh api repos/$($ctx.Name)/issues/$prNum/comments"
        $commentsRaw = & gh api "repos/$($ctx.Name)/issues/$prNum/comments" 2>&1
        $comments = if ($LASTEXITCODE -eq 0) { $commentsRaw | ConvertFrom-Json } else { @() }

        $pending = if ($gqlData) { $gqlData.reviewThreads.nodes | Where-Object { -not $_.isResolved } } else { @() }

        $report = [ordered]@{
            generated_at          = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
            repo                  = $ctx.Name
            pr_number             = [int]$prNum
            title                 = if ($prData) { $prData.title } else { $null }
            state                 = if ($prData) { $prData.state } else { $null }
            author                = if ($prData -and $prData.user) { $prData.user.login } else { $null }
            base_branch           = if ($prData -and $prData.base) { $prData.base.ref } else { $null }
            head_branch           = if ($prData -and $prData.head) { $prData.head.ref } else { $null }
            created_at            = if ($prData) { $prData.created_at } else { $null }
            merged_at             = if ($prData) { $prData.merged_at } else { $null }
            body                  = if ($prData) { $prData.body } else { $null }
            pending_count         = $pending.Count
            pending_conversations = $pending
            all_review_threads    = if ($gqlData -and $gqlData.reviewThreads) { $gqlData.reviewThreads.nodes } else { @() }
            reviews               = if ($gqlData -and $gqlData.reviews) { $gqlData.reviews.nodes } else { @() }
            comments              = $comments
        }

        $outFile = "$tmpDir/issue.pr$prNum.json"
        $report | ConvertTo-Json -Depth 15 | Set-Content -Path $outFile -Encoding UTF8
        ok "PR report saved: $outFile ($($pending.Count) pending conversations)"
    }

    # Security report
    $genSec = (Read-Host "Generate security report? (Y/n - default: y)").Trim().ToLower()
    if ($genSec -ne "n") {
        Write-Host ""
        action "Fetching Dependabot alerts..."
        Write-Host "[cmd]    gh api --paginate repos/$($ctx.Name)/dependabot/alerts"
        $depRaw = & gh api --paginate "repos/$($ctx.Name)/dependabot/alerts" 2>&1
        $depAlerts = if ($LASTEXITCODE -eq 0) { $depRaw | ConvertFrom-Json } else { @() }

        action "Fetching secret scanning alerts..."
        Write-Host "[cmd]    gh api --paginate repos/$($ctx.Name)/secret-scanning/alerts"
        $secRaw = & gh api --paginate "repos/$($ctx.Name)/secret-scanning/alerts" 2>&1
        $secAlerts = if ($LASTEXITCODE -eq 0) { $secRaw | ConvertFrom-Json } else { @() }

        action "Fetching code scanning alerts..."
        Write-Host "[cmd]    gh api --paginate repos/$($ctx.Name)/code-scanning/alerts"
        $codeRaw = & gh api --paginate "repos/$($ctx.Name)/code-scanning/alerts" 2>&1
        $codeAlerts = if ($LASTEXITCODE -eq 0) { $codeRaw | ConvertFrom-Json } else { @() }

        $secReport = [ordered]@{
            generated_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
            repo         = $ctx.Name
            summary      = [ordered]@{
                dependabot_total    = $depAlerts.Count
                secret_scan_total   = $secAlerts.Count
                code_scan_total     = $codeAlerts.Count
            }
            dependabot_alerts       = $depAlerts
            secret_scanning_alerts  = $secAlerts
            code_scanning_alerts    = $codeAlerts
        }

        $outFile = "$tmpDir/issue.security.json"
        $secReport | ConvertTo-Json -Depth 15 | Set-Content -Path $outFile -Encoding UTF8
        ok "Security report saved: $outFile (dep:$($depAlerts.Count) sec:$($secAlerts.Count) code:$($codeAlerts.Count))"
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
    Write-Host "  --- SSH & Auth ---"
    Write-Host "  1.  Create SSH key for GitHub"
    Write-Host "  2.  Authenticate with GitHub CLI (gh auth login)"
    Write-Host "  3.  Logout / switch GitHub account"
    Write-Host "  4.  List SSH keys"
    Write-Host "  5.  Set global GitHub login via SSH key (optional key selection)"
    Write-Host "  --- Pull Requests ---"
    Write-Host "  6.  List pull requests"
    Write-Host "  7.  Merge a pull request"
    Write-Host "  8.  Force merge (bypass all rulesets temporarily)"
    Write-Host "  9.  List pending conversations in a PR"
    Write-Host "  10. Resolve a conversation in a PR"
    Write-Host "  --- Rulesets ---"
    Write-Host "  11. List rulesets"
    Write-Host "  12. Disable a specific ruleset"
    Write-Host "  13. Enable a specific ruleset"
    Write-Host "  --- Security ---"
    Write-Host "  14. Dependabot alerts (dependency vulnerabilities)"
    Write-Host "  15. Secret scanning alerts"
    Write-Host "  16. Code scanning alerts (quality / malware)"
    Write-Host "  17. Generate JSON reports (PR conversations + security)"
    Write-Host "  --- ---"
    Write-Host "  0.  Exit"
    Write-Host ""
    $choice = Read-Host "Select an option"

    switch ($choice) {
        "1"  { Invoke-CreateSSHKey }
        "2"  { Invoke-GitHubAuth }
        "3"  { Invoke-GitHubLogout }
        "4"  { Invoke-ListSSHKeys }
        "5"  { Invoke-SetGlobalSSHLogin }
        "6"  { Invoke-ListPRs }
        "7"  { Invoke-MergePR }
        "8"  { Invoke-BypassMerge }
        "9"  { Invoke-ListConversations }
        "10" { Invoke-ResolveConversation }
        "11" { Invoke-ListRulesets }
        "12" { Invoke-DisableRuleset }
        "13" { Invoke-EnableRuleset }
        "14" { Invoke-ListDependabotAlerts }
        "15" { Invoke-ListSecretAlerts }
        "16" { Invoke-ListCodeAlerts }
        "17" { Invoke-GenerateReport }
        "0"  { Write-Host ""; Write-Host "Goodbye." }
        default { warn "Invalid option. Enter 1-17 or 0." }
    }

    if ($choice -ne "0") {
        Write-Host ""
        Read-Host "Press Enter to return to menu"
    }

} while ($choice -ne "0")
