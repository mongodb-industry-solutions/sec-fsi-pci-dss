# ============================================================
#  Kanopy Deployment Manager — FSI PSP Leafy Pay
#  Platform: Windows (PowerShell)
# ============================================================

# ── Constants ────────────────────────────────────────────────
$IST_NAMESPACE       = "industrysolutions"
$ECR_REGISTRY        = "795250896452.dkr.ecr.us-east-1.amazonaws.com"
$STAGING_API         = "https://api.staging.corp.mongodb.com"
$PROD_API            = "https://api.prod.corp.mongodb.com"
$HELM_REPO_NAME      = "mongodb"
$HELM_REPO_URL       = "https://10gen.github.io/helm-charts"
$HELM_CHART          = "mongodb/web-app"
$HELM_CHART_VERSION  = "4.25.0"
$DRONE_URL           = "https://drone.corp.mongodb.com"

$DEMO_NAME           = "sec-fsi-pci-dss"
$RELEASE_BACKEND     = "$DEMO_NAME-backend"
$RELEASE_FRONTEND    = "$DEMO_NAME-frontend"
$KSEC_SECRET_STAGING = "$DEMO_NAME-secrets-staging"
$KSEC_SECRET_PROD    = "$DEMO_NAME-secrets-prod"

$STAGING_HOST_BE     = "$RELEASE_BACKEND.$IST_NAMESPACE.staging.corp.mongodb.com"
$STAGING_HOST_FE     = "$RELEASE_FRONTEND.$IST_NAMESPACE.staging.corp.mongodb.com"
$PROD_HOST_BE        = "$RELEASE_BACKEND.$IST_NAMESPACE.prod.corp.mongodb.com"
$PROD_HOST_FE        = "$RELEASE_FRONTEND.$IST_NAMESPACE.prod.corp.mongodb.com"

$KANOPY_CLUSTER_SECRET = if ($env:KANOPY_CLUSTER_SECRET) { $env:KANOPY_CLUSTER_SECRET } else { $null }
$KANOPY_CONFIG_PATH  = "$env:USERPROFILE\.kanopy\config.yaml"
$KUBE_DIR            = "$env:USERPROFILE\.kube"

# ── Helpers ──────────────────────────────────────────────────
function ok     { param($msg) Write-Host "[ok]     $msg" -ForegroundColor Green }
function warn   { param($msg) Write-Host "[warn]   $msg" -ForegroundColor Yellow }
function fail   { param($msg) Write-Host "[error]  $msg" -ForegroundColor Red }
function action { param($msg) Write-Host "[action] $msg" -ForegroundColor Cyan }
function chk    { param($msg) Write-Host "[check]  $msg" }
function run {
    param([scriptblock]$Block)
    Write-Host "[cmd]    $($Block.ToString().Trim())" -ForegroundColor DarkGray
    & $Block
}

# ============================================================
#  1. SETUP — Install prerequisites
# ============================================================

function Invoke-InstallKubectl {
    chk "kubectl..."
    if (Get-Command kubectl -ErrorAction SilentlyContinue) {
        ok "kubectl is available: $(kubectl version --client --short 2>$null)"
        return
    }
    action "Installing kubectl via winget..."
    run { winget install --id Kubernetes.kubectl --silent --accept-package-agreements --accept-source-agreements }
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    if (Get-Command kubectl -ErrorAction SilentlyContinue) {
        ok "kubectl installed."
    } else {
        fail "Could not install kubectl automatically."
        Write-Host "  > Install from: https://kubernetes.io/docs/tasks/tools/install-kubectl-windows/"
    }
}

function Invoke-InstallHelm {
    chk "Helm..."
    if (Get-Command helm -ErrorAction SilentlyContinue) {
        ok "Helm is available: $(helm version --short 2>$null)"
        return
    }
    action "Installing Helm via winget..."
    run { winget install --id Helm.Helm --silent --accept-package-agreements --accept-source-agreements }
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    if (Get-Command helm -ErrorAction SilentlyContinue) {
        ok "Helm installed."
    } else {
        fail "Could not install Helm automatically."
        Write-Host "  > Install from: https://helm.sh/docs/intro/install/"
    }
}

function Invoke-InstallKanopyOidc {
    chk "kanopy-oidc..."
    if (Get-Command kanopy-oidc -ErrorAction SilentlyContinue) {
        ok "kanopy-oidc is available."
        return
    }
    Write-Host ""
    warn "kanopy-oidc is not installed."
    Write-Host "  Manual steps required:"
    Write-Host "  1. Download from: https://github.com/kanopy-platform/kanopy-oidc/releases/"
    Write-Host "     - Windows: kanopy-oidc-windows-amd64-v0.5.3.zip"
    Write-Host "  2. Extract and move the binary to a folder in your PATH"
    Write-Host "     Example: C:\Users\$env:USERNAME\bin\kanopy-oidc.exe"
    Write-Host "  3. Add that folder to your PATH if not already present."
    Write-Host ""
}

function Invoke-SetupHelmRepo {
    chk "Helm repo '$HELM_REPO_NAME'..."
    $repos = helm repo list 2>$null
    if ($repos -match $HELM_REPO_NAME) {
        ok "Helm repo '$HELM_REPO_NAME' already added."
    } else {
        action "Adding Helm repo '$HELM_REPO_NAME'..."
        run { helm repo add $HELM_REPO_NAME $HELM_REPO_URL }
    }
    action "Updating Helm repos..."
    run { helm repo update }
    ok "Helm repos up to date."
}

function Invoke-InstallKsecPlugin {
    chk "Helm ksec plugin..."
    $plugins = helm plugin list 2>$null
    if ($plugins -match "ksec") {
        ok "ksec plugin installed."
        return
    }
    action "Installing ksec Helm plugin..."
    run { helm plugin install https://github.com/kanopy-platform/ksec }
    if ($LASTEXITCODE -eq 0) {
        ok "ksec plugin installed."
    } else {
        fail "Could not install ksec plugin."
        Write-Host "  > Try manually: helm plugin install https://github.com/kanopy-platform/ksec"
    }
}

function Invoke-CreateKanopyConfig {
    chk "Kanopy OIDC config at $KANOPY_CONFIG_PATH..."
    if (Test-Path $KANOPY_CONFIG_PATH) {
        ok "Config already exists."
        $overwrite = (Read-Host "Overwrite? (y/N)").Trim().ToLower()
        if ($overwrite -ne "y") { return }
    }

    $secret = $KANOPY_CLUSTER_SECRET
    if (-not $secret) {
        Write-Host ""
        Write-Host "  KANOPY_CLUSTER_SECRET env var is not set."
        Write-Host "  Get the value from: https://kanopy.corp.mongodb.com/docs/configuration/kubeconfig/"
        $secret = (Read-Host "  Enter Kanopy cluster secret").Trim()
        if (-not $secret) { fail "No secret provided. Cannot create config."; return }
    }

    $configContent = @"
---
domain: corp.mongodb.com
issuer: dex
login:
  connector: oidc
clusters:
  prod:
    secret: $secret
  staging:
    secret: $secret
...
"@

    $dir = Split-Path $KANOPY_CONFIG_PATH -Parent
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Set-Content -Path $KANOPY_CONFIG_PATH -Value $configContent -Encoding UTF8
    ok "Kanopy config created at $KANOPY_CONFIG_PATH"
}

function Invoke-FullSetup {
    Write-Host ""
    Write-Host "=== Full Kanopy Setup ===" -ForegroundColor Cyan
    Write-Host ""
    Invoke-InstallKubectl
    Invoke-InstallHelm
    Invoke-InstallKanopyOidc
    Invoke-CreateKanopyConfig
    Invoke-SetupHelmRepo
    Invoke-InstallKsecPlugin
    Write-Host ""
    ok "Setup complete. Next: run 'Generate kubeconfig' from the menu."
}

# ============================================================
#  2. CLUSTER CONFIG — kubeconfig and context
# ============================================================

function Invoke-GenerateKubeconfig {
    Write-Host ""
    Write-Host "Which cluster?"
    Write-Host "  1. staging (default)"
    Write-Host "  2. prod"
    Write-Host "  3. both"
    $input = (Read-Host "Choice").Trim()

    $clusters = switch ($input) {
        "2" { @("prod") }
        "3" { @("staging", "prod") }
        default { @("staging") }
    }

    foreach ($cluster in $clusters) {
        Write-Host ""
        action "Generating kubeconfig for '$cluster'..."
        $configFile = "$KUBE_DIR\config.$cluster"
        if (!(Test-Path $KUBE_DIR)) { New-Item -ItemType Directory -Path $KUBE_DIR -Force | Out-Null }

        $oldKube = $env:KUBECONFIG
        $env:KUBECONFIG = $configFile

        Write-Host "[cmd]    kanopy-oidc kube setup $cluster > $configFile"
        kanopy-oidc kube setup $cluster | Set-Content -Path $configFile -Encoding UTF8

        Write-Host "[cmd]    kanopy-oidc kube login"
        kanopy-oidc kube login

        Write-Host "[cmd]    kubectl config set-context ... --namespace=$IST_NAMESPACE"
        $ctx = kubectl config current-context
        kubectl config set-context $ctx --namespace=$IST_NAMESPACE

        $env:KUBECONFIG = $oldKube
        ok "Kubeconfig for '$cluster' saved at $configFile"
    }

    Write-Host ""
    Write-Host "To combine configs, set in your PowerShell profile:"
    Write-Host "  `$env:KUBECONFIG = `"$KUBE_DIR\config.staging;$KUBE_DIR\config.prod`""
}

function Invoke-KanopyLogin {
    action "Re-authenticating with kanopy-oidc..."
    run { kanopy-oidc kube login }
    if ($LASTEXITCODE -eq 0) { ok "Login successful." } else { fail "Login failed." }
}

function Invoke-SwitchContext {
    Write-Host ""
    Write-Host "  1. staging"
    Write-Host "  2. prod"
    $input = (Read-Host "Context").Trim()
    $target = if ($input -eq "2") { $PROD_API } else { $STAGING_API }

    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    run { kubectl config use-context $target }
    run { kubectl config set-context --current --namespace=$IST_NAMESPACE }
    ok "Switched to $target / $IST_NAMESPACE"
}

function Invoke-VerifyAccess {
    Write-Host ""
    action "Verifying cluster access..."
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    $ctx = kubectl config current-context
    Write-Host "  Current context: $ctx"
    Write-Host ""
    run { kubectl get pods -n $IST_NAMESPACE }
    if ($LASTEXITCODE -eq 0) { ok "Access verified." } else { fail "Access failed. Try: kanopy-oidc kube login" }
}

# ============================================================
#  3. SECRETS — ksec management
# ============================================================

function Invoke-CreateSecrets {
    Write-Host ""
    Write-Host "Create ksec secrets for which environment?"
    Write-Host "  1. staging (default)"
    Write-Host "  2. production"
    $input = (Read-Host "Choice").Trim()

    if ($input -eq "2") {
        $secretName = $KSEC_SECRET_PROD
        $apiServer = $PROD_API
    } else {
        $secretName = $KSEC_SECRET_STAGING
        $apiServer = $STAGING_API
    }

    Write-Host ""
    action "Switching context to $apiServer..."
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    kubectl config use-context $apiServer | Out-Null
    kubectl config set-context --current --namespace=$IST_NAMESPACE | Out-Null

    Write-Host ""
    Write-Host "Enter values for secret '$secretName':"
    Write-Host "(Press Enter to skip a field — it won't be set)"
    Write-Host ""

    $uri      = Read-Host "  MONGODB_URI"
    $dbName   = Read-Host "  MONGODB_DB_NAME"
    $kmsKey   = Read-Host "  KMS_LOCAL_MASTER_KEY"
    $kvDb     = Read-Host "  KMS_KEY_VAULT_DATABASE"
    $kvCol    = Read-Host "  KMS_KEY_VAULT_COLLECTION"
    $admUser  = Read-Host "  PSP_ADM_USER"
    $admPass  = Read-Host "  PSP_ADM_PASS"

    $args = @()
    if ($uri)     { $args += "MONGODB_URI=`"$uri`"" }
    if ($dbName)  { $args += "MONGODB_DB_NAME=`"$dbName`"" }
    if ($kmsKey)  { $args += "KMS_LOCAL_MASTER_KEY=`"$kmsKey`"" }
    if ($kvDb)    { $args += "KMS_KEY_VAULT_DATABASE=`"$kvDb`"" }
    if ($kvCol)   { $args += "KMS_KEY_VAULT_COLLECTION=`"$kvCol`"" }
    if ($admUser) { $args += "PSP_ADM_USER=`"$admUser`"" }
    if ($admPass) { $args += "PSP_ADM_PASS=`"$admPass`"" }

    if ($args.Count -eq 0) {
        warn "No values provided. Skipping."
        return
    }

    $cmdStr = "helm ksec set $secretName " + ($args -join " ")
    Write-Host "[cmd]    $cmdStr"
    Invoke-Expression $cmdStr

    if ($LASTEXITCODE -eq 0) {
        ok "Secret '$secretName' created/updated."
    } else {
        fail "Failed to create secret."
    }
}

function Invoke-ListSecrets {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    action "Listing ksec secrets in current context..."
    $ctx = kubectl config current-context
    Write-Host "  Context: $ctx"
    Write-Host ""
    run { helm ksec list }
}

function Invoke-GetSecret {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    $ctx = kubectl config current-context
    Write-Host "  Context: $ctx"
    Write-Host ""
    Write-Host "  Known secrets:"
    Write-Host "    - $KSEC_SECRET_STAGING (staging)"
    Write-Host "    - $KSEC_SECRET_PROD (production)"
    Write-Host ""
    $name = Read-Host "Secret name"
    if ($name.Trim() -eq "") { $name = $KSEC_SECRET_STAGING }
    run { helm ksec get $name }
}

# ============================================================
#  4. DEPLOYMENT — inspect and manage
# ============================================================

function Invoke-GetPods {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    run { kubectl get pods -n $IST_NAMESPACE -l "app.kubernetes.io/instance in ($RELEASE_BACKEND,$RELEASE_FRONTEND)" }
}

function Invoke-GetAll {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    Write-Host "--- Pods ---"
    kubectl get pods -n $IST_NAMESPACE -l "app.kubernetes.io/instance in ($RELEASE_BACKEND,$RELEASE_FRONTEND)" 2>$null
    Write-Host ""
    Write-Host "--- Deployments ---"
    kubectl get deployments -n $IST_NAMESPACE 2>$null | Select-String "$DEMO_NAME"
    Write-Host ""
    Write-Host "--- Services ---"
    kubectl get services -n $IST_NAMESPACE 2>$null | Select-String "$DEMO_NAME"
    Write-Host ""
    Write-Host "--- Ingress ---"
    kubectl get ingress -n $IST_NAMESPACE 2>$null | Select-String "$DEMO_NAME"
}

function Invoke-PodLogs {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    Write-Host "  1. backend"
    Write-Host "  2. frontend"
    $input = (Read-Host "Which service?").Trim()
    $release = if ($input -eq "2") { $RELEASE_FRONTEND } else { $RELEASE_BACKEND }

    $tailLines = Read-Host "Lines to show (default: 50)"
    if ($tailLines.Trim() -eq "") { $tailLines = "50" }

    Write-Host "[cmd]    kubectl logs -l app.kubernetes.io/instance=$release -n $IST_NAMESPACE --tail=$tailLines"
    kubectl logs -l "app.kubernetes.io/instance=$release" -n $IST_NAMESPACE --tail=$tailLines
}

function Invoke-HelmStatus {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    Write-Host "--- Backend ---"
    helm status $RELEASE_BACKEND -n $IST_NAMESPACE 2>$null
    Write-Host ""
    Write-Host "--- Frontend ---"
    helm status $RELEASE_FRONTEND -n $IST_NAMESPACE 2>$null
}

function Invoke-RolloutRestart {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    Write-Host "  1. backend"
    Write-Host "  2. frontend"
    Write-Host "  3. both"
    $input = (Read-Host "Restart which?").Trim()

    if ($input -eq "1" -or $input -eq "3") {
        run { kubectl rollout restart deployment "${RELEASE_BACKEND}-web-app" -n $IST_NAMESPACE }
    }
    if ($input -eq "2" -or $input -eq "3") {
        run { kubectl rollout restart deployment "${RELEASE_FRONTEND}-web-app" -n $IST_NAMESPACE }
    }
    ok "Rollout restart initiated."
}

function Invoke-ResourceUsage {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    run { kubectl top pods -n $IST_NAMESPACE --containers 2>$null | Select-String "$DEMO_NAME" }
}

# ============================================================
#  5. DRONE CI — secrets and links
# ============================================================

function Invoke-ExtractDroneSecrets {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"

    Write-Host "=== Extracting Drone secrets ===" -ForegroundColor Cyan
    Write-Host ""

    action "Switching to staging context..."
    kubectl config use-context $STAGING_API | Out-Null
    kubectl config set-context --current --namespace=$IST_NAMESPACE | Out-Null

    Write-Host ""
    Write-Host "--- staging_kubernetes_token ---"
    Write-Host "[cmd]    kubectl get secret kanopy-cicd-token -o jsonpath=`"{.data.token}`" | base64 decode"
    $stagingToken = kubectl get secret kanopy-cicd-token -o jsonpath="{.data.token}" 2>$null
    if ($stagingToken) {
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($stagingToken))
        Write-Host "  Value: $($decoded.Substring(0, [Math]::Min(20, $decoded.Length)))..." -ForegroundColor DarkGray
    } else {
        warn "Could not extract staging token."
    }

    Write-Host ""
    Write-Host "--- ecr_access_key ---"
    $ecrAccess = kubectl get secret ecr -o jsonpath="{.data.ecr_access_key}" 2>$null
    if ($ecrAccess) {
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($ecrAccess))
        Write-Host "  Value: $decoded"
    } else {
        warn "Could not extract ECR access key."
    }

    Write-Host ""
    Write-Host "--- ecr_secret_key ---"
    $ecrSecret = kubectl get secret ecr -o jsonpath="{.data.ecr_secret_key}" 2>$null
    if ($ecrSecret) {
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($ecrSecret))
        Write-Host "  Value: $($decoded.Substring(0, [Math]::Min(10, $decoded.Length)))..." -ForegroundColor DarkGray
    } else {
        warn "Could not extract ECR secret key."
    }

    Write-Host ""
    action "Switching to prod context..."
    kubectl config use-context $PROD_API | Out-Null
    kubectl config set-context --current --namespace=$IST_NAMESPACE | Out-Null

    Write-Host ""
    Write-Host "--- prod_kubernetes_token ---"
    $prodToken = kubectl get secret kanopy-cicd-token -o jsonpath="{.data.token}" 2>$null
    if ($prodToken) {
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($prodToken))
        Write-Host "  Value: $($decoded.Substring(0, [Math]::Min(20, $decoded.Length)))..." -ForegroundColor DarkGray
    } else {
        warn "Could not extract prod token."
    }

    Write-Host ""
    Write-Host "Add these 4 secrets in Drone UI:" -ForegroundColor Cyan
    Write-Host "  $DRONE_URL → Repo Settings → Secrets"
    Write-Host "  - staging_kubernetes_token"
    Write-Host "  - prod_kubernetes_token"
    Write-Host "  - ecr_access_key"
    Write-Host "  - ecr_secret_key"
}

function Invoke-ShowDroneInfo {
    Write-Host ""
    Write-Host "=== Drone CI Info ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Drone URL: $DRONE_URL"
    Write-Host ""
    Write-Host "  Pipeline triggers:"
    Write-Host "    staging    → push to 'staging' branch"
    Write-Host "    production → push to 'main' branch"
    Write-Host ""
    Write-Host "  Required Drone secrets:"
    Write-Host "    - staging_kubernetes_token"
    Write-Host "    - prod_kubernetes_token"
    Write-Host "    - ecr_access_key"
    Write-Host "    - ecr_secret_key"
    Write-Host ""
    Write-Host "  ECR repositories:"
    Write-Host "    - $ECR_REGISTRY/$IST_NAMESPACE/$DEMO_NAME-backend"
    Write-Host "    - $ECR_REGISTRY/$IST_NAMESPACE/$DEMO_NAME-frontend"
    Write-Host ""
    Write-Host "  Staging URLs:"
    Write-Host "    Backend:  https://$STAGING_HOST_BE"
    Write-Host "    Frontend: https://$STAGING_HOST_FE"
    Write-Host ""
    Write-Host "  Production URLs:"
    Write-Host "    Backend:  https://$PROD_HOST_BE"
    Write-Host "    Frontend: https://$PROD_HOST_FE"
}

# ============================================================
#  6. DIAGNOSTICS — troubleshooting
# ============================================================

function Invoke-DescribePod {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    $podName = Read-Host "Pod name (or press Enter to pick from list)"
    if ($podName.Trim() -eq "") {
        kubectl get pods -n $IST_NAMESPACE -o name 2>$null | Select-String "$DEMO_NAME" | ForEach-Object { Write-Host "  $_" }
        Write-Host ""
        $podName = Read-Host "Pod name"
    }
    if ($podName.Trim() -ne "") {
        run { kubectl describe pod $podName -n $IST_NAMESPACE }
    }
}

function Invoke-ExecIntoPod {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    Write-Host "  1. backend"
    Write-Host "  2. frontend"
    $input = (Read-Host "Which service?").Trim()
    $release = if ($input -eq "2") { $RELEASE_FRONTEND } else { $RELEASE_BACKEND }
    $deployment = "${release}-web-app"

    Write-Host "[cmd]    kubectl exec -it deployment/$deployment -n $IST_NAMESPACE -- sh"
    kubectl exec -it "deployment/$deployment" -n $IST_NAMESPACE -- sh
}

function Invoke-CheckEnvVars {
    Write-Host ""
    $env:KUBECONFIG = "$KUBE_DIR\config.staging;$KUBE_DIR\config.prod"
    Write-Host "  1. backend"
    Write-Host "  2. frontend"
    $input = (Read-Host "Which service?").Trim()
    $release = if ($input -eq "2") { $RELEASE_FRONTEND } else { $RELEASE_BACKEND }
    $deployment = "${release}-web-app"

    Write-Host "[cmd]    kubectl exec deployment/$deployment -n $IST_NAMESPACE -- env"
    kubectl exec "deployment/$deployment" -n $IST_NAMESPACE -- env 2>$null | Sort-Object
}

function Invoke-TestUrls {
    Write-Host ""
    $ctx = kubectl config current-context
    if ($ctx -match "staging") {
        $bUrl = "https://$STAGING_HOST_BE/health"
        $fUrl = "https://$STAGING_HOST_FE"
    } else {
        $bUrl = "https://$PROD_HOST_BE/health"
        $fUrl = "https://$PROD_HOST_FE"
    }
    Write-Host "  Testing backend health: $bUrl"
    try { $r = Invoke-WebRequest -Uri $bUrl -UseBasicParsing -TimeoutSec 10; ok "Backend: $($r.StatusCode)" } catch { warn "Backend unreachable: $_" }
    Write-Host "  Testing frontend: $fUrl"
    try { $r = Invoke-WebRequest -Uri $fUrl -UseBasicParsing -TimeoutSec 10; ok "Frontend: $($r.StatusCode)" } catch { warn "Frontend unreachable: $_" }
}

# ============================================================
#  7. PRE-DEPLOYMENT CHECKLIST
# ============================================================

function Invoke-PreDeployChecklist {
    Write-Host ""
    Write-Host "=== Pre-Deployment Checklist ===" -ForegroundColor Cyan
    Write-Host ""

    $checks = @(
        @{ Label = "kubectl installed";            Test = { Get-Command kubectl -ErrorAction SilentlyContinue } },
        @{ Label = "helm installed";               Test = { Get-Command helm -ErrorAction SilentlyContinue } },
        @{ Label = "kanopy-oidc installed";        Test = { Get-Command kanopy-oidc -ErrorAction SilentlyContinue } },
        @{ Label = "ksec plugin installed";        Test = { (helm plugin list 2>$null) -match "ksec" } },
        @{ Label = "Kanopy config exists";         Test = { Test-Path $KANOPY_CONFIG_PATH } },
        @{ Label = "Staging kubeconfig exists";    Test = { Test-Path "$KUBE_DIR\config.staging" } },
        @{ Label = "Production kubeconfig exists"; Test = { Test-Path "$KUBE_DIR\config.prod" } },
        @{ Label = ".drone.yml exists";            Test = { Test-Path (Join-Path $PSScriptRoot "..\..\\.drone.yml") } },
        @{ Label = "environments/staging.yaml";    Test = { Test-Path (Join-Path $PSScriptRoot "..\..\environments\staging.yaml") } },
        @{ Label = "environments/production.yaml"; Test = { Test-Path (Join-Path $PSScriptRoot "..\..\environments\production.yaml") } },
        @{ Label = "backend/Dockerfile exists";    Test = { Test-Path (Join-Path $PSScriptRoot "..\Dockerfile") } },
        @{ Label = "frontend/Dockerfile exists";   Test = { Test-Path (Join-Path $PSScriptRoot "..\..\frontend\Dockerfile") } }
    )

    $passed = 0; $failed = 0
    foreach ($c in $checks) {
        $result = & $c.Test
        if ($result) {
            Write-Host "  [PASS] $($c.Label)" -ForegroundColor Green
            $passed++
        } else {
            Write-Host "  [FAIL] $($c.Label)" -ForegroundColor Red
            $failed++
        }
    }

    Write-Host ""
    Write-Host "  Result: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })
}

# ============================================================
#  Bootstrap
# ============================================================

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Kanopy Deployment Manager" -ForegroundColor Cyan
Write-Host " $DEMO_NAME" -ForegroundColor DarkCyan
Write-Host "============================================" -ForegroundColor Cyan

# ============================================================
#  Main menu
# ============================================================

do {
    Write-Host ""
    Write-Host "============================================"
    Write-Host " Menu"
    Write-Host "============================================"
    Write-Host "  --- Setup ---"
    Write-Host "  1.  Full setup (install all prerequisites)"
    Write-Host "  2.  Install kubectl only"
    Write-Host "  3.  Install Helm + MongoDB repo + ksec"
    Write-Host "  4.  Install/check kanopy-oidc"
    Write-Host "  5.  Create kanopy OIDC config file"
    Write-Host "  --- Cluster ---"
    Write-Host "  6.  Generate kubeconfig (staging/prod/both)"
    Write-Host "  7.  Login (re-authenticate token)"
    Write-Host "  8.  Switch context (staging/prod)"
    Write-Host "  9.  Verify cluster access"
    Write-Host "  --- Secrets ---"
    Write-Host "  10. Create/update ksec secrets"
    Write-Host "  11. List ksec secrets"
    Write-Host "  12. Get ksec secret values"
    Write-Host "  --- Deployment ---"
    Write-Host "  13. Get pods (this demo)"
    Write-Host "  14. Get all resources (pods/deploy/svc/ingress)"
    Write-Host "  15. View pod logs"
    Write-Host "  16. Helm release status"
    Write-Host "  17. Rollout restart"
    Write-Host "  18. Resource usage (top)"
    Write-Host "  --- Drone CI ---"
    Write-Host "  19. Extract Drone secrets from cluster"
    Write-Host "  20. Show Drone/deployment info"
    Write-Host "  --- Diagnostics ---"
    Write-Host "  21. Describe pod"
    Write-Host "  22. Exec into pod (shell)"
    Write-Host "  23. Check env vars in pod"
    Write-Host "  24. Test staging/prod URLs"
    Write-Host "  25. Pre-deployment checklist"
    Write-Host "  --- ---"
    Write-Host "  0.  Exit"
    Write-Host ""
    $choice = Read-Host "Select an option"

    switch ($choice) {
        "1"  { Invoke-FullSetup }
        "2"  { Invoke-InstallKubectl }
        "3"  { Invoke-InstallHelm; Invoke-SetupHelmRepo; Invoke-InstallKsecPlugin }
        "4"  { Invoke-InstallKanopyOidc }
        "5"  { Invoke-CreateKanopyConfig }
        "6"  { Invoke-GenerateKubeconfig }
        "7"  { Invoke-KanopyLogin }
        "8"  { Invoke-SwitchContext }
        "9"  { Invoke-VerifyAccess }
        "10" { Invoke-CreateSecrets }
        "11" { Invoke-ListSecrets }
        "12" { Invoke-GetSecret }
        "13" { Invoke-GetPods }
        "14" { Invoke-GetAll }
        "15" { Invoke-PodLogs }
        "16" { Invoke-HelmStatus }
        "17" { Invoke-RolloutRestart }
        "18" { Invoke-ResourceUsage }
        "19" { Invoke-ExtractDroneSecrets }
        "20" { Invoke-ShowDroneInfo }
        "21" { Invoke-DescribePod }
        "22" { Invoke-ExecIntoPod }
        "23" { Invoke-CheckEnvVars }
        "24" { Invoke-TestUrls }
        "25" { Invoke-PreDeployChecklist }
        "0"  { Write-Host ""; Write-Host "Goodbye." }
        default { warn "Invalid option. Enter 1-25 or 0." }
    }

    if ($choice -ne "0") {
        Write-Host ""
        Read-Host "Press Enter to return to menu"
    }

} while ($choice -ne "0")
