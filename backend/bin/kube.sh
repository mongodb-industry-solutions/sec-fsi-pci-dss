#!/bin/bash
# ============================================================
#  Kanopy Deployment Manager — FSI PSP Leafy Pay
#  Platform: Linux / macOS (bash)
# ============================================================

# ── Constants ────────────────────────────────────────────────
IST_NAMESPACE="industrysolutions"
ECR_REGISTRY="795250896452.dkr.ecr.us-east-1.amazonaws.com"
STAGING_API="https://api.staging.corp.mongodb.com"
PROD_API="https://api.prod.corp.mongodb.com"
HELM_REPO_NAME="mongodb"
HELM_REPO_URL="https://10gen.github.io/helm-charts"
HELM_CHART="mongodb/web-app"
HELM_CHART_VERSION="4.25.0"
DRONE_URL="https://drone.corp.mongodb.com"

DEMO_NAME="sec-fsi-pci-dss"
RELEASE_BACKEND="${DEMO_NAME}-backend"
RELEASE_FRONTEND="${DEMO_NAME}-frontend"
KSEC_SECRET_STAGING="${DEMO_NAME}-secrets-staging"
KSEC_SECRET_PROD="${DEMO_NAME}-secrets-prod"

STAGING_HOST_BE="${RELEASE_BACKEND}.${IST_NAMESPACE}.staging.corp.mongodb.com"
STAGING_HOST_FE="${RELEASE_FRONTEND}.${IST_NAMESPACE}.staging.corp.mongodb.com"
PROD_HOST_BE="${RELEASE_BACKEND}.${IST_NAMESPACE}.prod.corp.mongodb.com"
PROD_HOST_FE="${RELEASE_FRONTEND}.${IST_NAMESPACE}.prod.corp.mongodb.com"

KANOPY_CLUSTER_SECRET="${KANOPY_CLUSTER_SECRET:-}"
KANOPY_CONFIG_PATH="$HOME/.kanopy/config.yaml"
KUBE_DIR="$HOME/.kube"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Helpers ──────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; DIM='\033[90m'; NC='\033[0m'
ok()     { echo -e "${GREEN}[ok]${NC}     $1"; }
warn()   { echo -e "${YELLOW}[warn]${NC}   $1"; }
fail()   { echo -e "${RED}[error]${NC}  $1"; }
action() { echo -e "${CYAN}[action]${NC} $1"; }
chk()    { echo "[check]  $1"; }
run()    { echo -e "${DIM}[cmd]    $*${NC}"; "$@"; }

# ============================================================
#  1. SETUP — Install prerequisites
# ============================================================

install_kubectl() {
    chk "kubectl..."
    if command -v kubectl &>/dev/null; then
        ok "kubectl is available: $(kubectl version --client --short 2>/dev/null || kubectl version --client 2>/dev/null | head -1)"
        return
    fi
    action "Installing kubectl..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        run brew install kubectl
    elif command -v apt-get &>/dev/null; then
        run sudo apt-get update -q && sudo apt-get install -y kubectl
    elif command -v yum &>/dev/null; then
        run sudo yum install -y kubectl
    else
        fail "Cannot install kubectl automatically."
        echo "  > Install from: https://kubernetes.io/docs/tasks/tools/"
        return
    fi
    command -v kubectl &>/dev/null && ok "kubectl installed." || fail "Installation failed."
}

install_helm() {
    chk "Helm..."
    if command -v helm &>/dev/null; then
        ok "Helm is available: $(helm version --short 2>/dev/null)"
        return
    fi
    action "Installing Helm..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        run brew install helm
    elif command -v apt-get &>/dev/null; then
        curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
    else
        fail "Cannot install Helm automatically."
        echo "  > Install from: https://helm.sh/docs/intro/install/"
        return
    fi
    command -v helm &>/dev/null && ok "Helm installed." || fail "Installation failed."
}

install_kanopy_oidc() {
    chk "kanopy-oidc..."
    if command -v kanopy-oidc &>/dev/null; then
        ok "kanopy-oidc is available."
        return
    fi
    echo ""
    warn "kanopy-oidc is not installed."
    echo "  Manual steps required:"
    echo "  1. Download from: https://github.com/kanopy-platform/kanopy-oidc/releases/"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        ARCH=$(uname -m)
        if [ "$ARCH" = "arm64" ]; then
            echo "     - macOS ARM64: kanopy-oidc-macos-arm64-v0.5.3.tgz"
        else
            echo "     - macOS AMD64: kanopy-oidc-macos-amd64-v0.5.3.tgz"
        fi
    else
        echo "     - Linux AMD64: kanopy-oidc-linux-amd64-v0.5.3.tgz"
    fi
    echo "  2. Extract:"
    echo "     tar -xzvf kanopy-oidc-*.tgz"
    echo "  3. Move to PATH:"
    echo "     sudo mv bin/kanopy-oidc-* /usr/local/bin/kanopy-oidc"
    echo "     chmod +x /usr/local/bin/kanopy-oidc"
    echo ""
}

setup_helm_repo() {
    chk "Helm repo '$HELM_REPO_NAME'..."
    if helm repo list 2>/dev/null | grep -q "$HELM_REPO_NAME"; then
        ok "Helm repo '$HELM_REPO_NAME' already added."
    else
        action "Adding Helm repo '$HELM_REPO_NAME'..."
        run helm repo add "$HELM_REPO_NAME" "$HELM_REPO_URL"
    fi
    action "Updating Helm repos..."
    run helm repo update
    ok "Helm repos up to date."
}

install_ksec_plugin() {
    chk "Helm ksec plugin..."
    if helm plugin list 2>/dev/null | grep -q "ksec"; then
        ok "ksec plugin installed."
        return
    fi
    action "Installing ksec Helm plugin..."
    run helm plugin install https://github.com/kanopy-platform/ksec
    if [ $? -eq 0 ]; then
        ok "ksec plugin installed."
    else
        fail "Could not install ksec plugin."
        echo "  > Try manually: helm plugin install https://github.com/kanopy-platform/ksec"
    fi
}

create_kanopy_config() {
    chk "Kanopy OIDC config at $KANOPY_CONFIG_PATH..."
    if [ -f "$KANOPY_CONFIG_PATH" ]; then
        ok "Config already exists."
        read -rp "Overwrite? (y/N): " OVERWRITE
        if [[ "${OVERWRITE,,}" != "y" ]]; then return; fi
    fi

    local SECRET="$KANOPY_CLUSTER_SECRET"
    if [ -z "$SECRET" ]; then
        echo ""
        echo "  KANOPY_CLUSTER_SECRET env var is not set."
        echo "  Get the value from: https://kanopy.corp.mongodb.com/docs/configuration/kubeconfig/"
        read -rp "  Enter Kanopy cluster secret: " SECRET
        if [ -z "$SECRET" ]; then fail "No secret provided. Cannot create config."; return; fi
    fi

    mkdir -p "$(dirname "$KANOPY_CONFIG_PATH")"
    cat > "$KANOPY_CONFIG_PATH" <<EOF
---
domain: corp.mongodb.com
issuer: dex
login:
  connector: oidc
clusters:
  prod:
    secret: ${SECRET}
  staging:
    secret: ${SECRET}
...
EOF
    ok "Kanopy config created at $KANOPY_CONFIG_PATH"
}

full_setup() {
    echo ""
    echo -e "${CYAN}=== Full Kanopy Setup ===${NC}"
    echo ""
    install_kubectl
    install_helm
    install_kanopy_oidc
    create_kanopy_config
    setup_helm_repo
    install_ksec_plugin
    echo ""
    ok "Setup complete. Next: run 'Generate kubeconfig' from the menu."
}

# ============================================================
#  2. CLUSTER CONFIG — kubeconfig and context
# ============================================================

generate_kubeconfig() {
    echo ""
    echo "Which cluster?"
    echo "  1. staging (default)"
    echo "  2. prod"
    echo "  3. both"
    read -rp "Choice: " INPUT

    case "$INPUT" in
        2) CLUSTERS=("prod") ;;
        3) CLUSTERS=("staging" "prod") ;;
        *) CLUSTERS=("staging") ;;
    esac

    for CLUSTER in "${CLUSTERS[@]}"; do
        echo ""
        action "Generating kubeconfig for '$CLUSTER'..."
        CONFIG_FILE="$KUBE_DIR/config.$CLUSTER"
        mkdir -p "$KUBE_DIR"

        KOLD="$KUBECONFIG"
        export KUBECONFIG="$CONFIG_FILE"

        echo -e "${DIM}[cmd]    kanopy-oidc kube setup $CLUSTER > $CONFIG_FILE${NC}"
        kanopy-oidc kube setup "$CLUSTER" > "$CONFIG_FILE"

        echo -e "${DIM}[cmd]    kanopy-oidc kube login${NC}"
        kanopy-oidc kube login

        echo -e "${DIM}[cmd]    kubectl config set-context ... --namespace=$IST_NAMESPACE${NC}"
        CTX=$(kubectl config current-context)
        kubectl config set-context "$CTX" --namespace="$IST_NAMESPACE"

        export KUBECONFIG="$KOLD"
        ok "Kubeconfig for '$CLUSTER' saved at $CONFIG_FILE"
    done

    echo ""
    echo "To combine configs, add to your ~/.zshrc or ~/.bashrc:"
    echo "  export KUBECONFIG=$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
}

kanopy_login() {
    action "Re-authenticating with kanopy-oidc..."
    run kanopy-oidc kube login
    [ $? -eq 0 ] && ok "Login successful." || fail "Login failed."
}

switch_context() {
    echo ""
    echo "  1. staging"
    echo "  2. prod"
    read -rp "Context: " INPUT
    TARGET=$([ "$INPUT" = "2" ] && echo "$PROD_API" || echo "$STAGING_API")

    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    run kubectl config use-context "$TARGET"
    run kubectl config set-context --current --namespace="$IST_NAMESPACE"
    ok "Switched to $TARGET / $IST_NAMESPACE"
}

verify_access() {
    echo ""
    action "Verifying cluster access..."
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    CTX=$(kubectl config current-context 2>/dev/null)
    echo "  Current context: $CTX"
    echo ""
    run kubectl get pods -n "$IST_NAMESPACE"
    [ $? -eq 0 ] && ok "Access verified." || fail "Access failed. Try: kanopy-oidc kube login"
}

# ============================================================
#  3. SECRETS — ksec management
# ============================================================

create_secrets() {
    echo ""
    echo "Create ksec secrets for which environment?"
    echo "  1. staging (default)"
    echo "  2. production"
    read -rp "Choice: " INPUT

    if [ "$INPUT" = "2" ]; then
        SECRET_NAME="$KSEC_SECRET_PROD"
        API_SERVER="$PROD_API"
    else
        SECRET_NAME="$KSEC_SECRET_STAGING"
        API_SERVER="$STAGING_API"
    fi

    echo ""
    action "Switching context to $API_SERVER..."
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    kubectl config use-context "$API_SERVER" >/dev/null
    kubectl config set-context --current --namespace="$IST_NAMESPACE" >/dev/null

    echo ""
    echo "Enter values for secret '$SECRET_NAME':"
    echo "(Press Enter to skip a field — it won't be set)"
    echo ""

    read -rp "  MONGODB_URI: " URI
    read -rp "  MONGODB_DB_NAME: " DB_NAME
    read -rp "  KMS_LOCAL_MASTER_KEY: " KMS_KEY
    read -rp "  KMS_KEY_VAULT_DATABASE: " KV_DB
    read -rp "  KMS_KEY_VAULT_COLLECTION: " KV_COL
    read -rp "  PSP_ADM_USER: " ADM_USER
    read -rp "  PSP_ADM_PASS: " ADM_PASS

    ARGS=""
    [ -n "$URI" ]      && ARGS="$ARGS MONGODB_URI=\"$URI\""
    [ -n "$DB_NAME" ]  && ARGS="$ARGS MONGODB_DB_NAME=\"$DB_NAME\""
    [ -n "$KMS_KEY" ]  && ARGS="$ARGS KMS_LOCAL_MASTER_KEY=\"$KMS_KEY\""
    [ -n "$KV_DB" ]    && ARGS="$ARGS KMS_KEY_VAULT_DATABASE=\"$KV_DB\""
    [ -n "$KV_COL" ]   && ARGS="$ARGS KMS_KEY_VAULT_COLLECTION=\"$KV_COL\""
    [ -n "$ADM_USER" ] && ARGS="$ARGS PSP_ADM_USER=\"$ADM_USER\""
    [ -n "$ADM_PASS" ] && ARGS="$ARGS PSP_ADM_PASS=\"$ADM_PASS\""

    if [ -z "$ARGS" ]; then
        warn "No values provided. Skipping."
        return
    fi

    echo -e "${DIM}[cmd]    helm ksec set $SECRET_NAME $ARGS${NC}"
    eval helm ksec set "$SECRET_NAME" $ARGS

    [ $? -eq 0 ] && ok "Secret '$SECRET_NAME' created/updated." || fail "Failed to create secret."
}

list_secrets() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    action "Listing ksec secrets in current context..."
    CTX=$(kubectl config current-context 2>/dev/null)
    echo "  Context: $CTX"
    echo ""
    run helm ksec list
}

get_secret() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    CTX=$(kubectl config current-context 2>/dev/null)
    echo "  Context: $CTX"
    echo ""
    echo "  Known secrets:"
    echo "    - $KSEC_SECRET_STAGING (staging)"
    echo "    - $KSEC_SECRET_PROD (production)"
    echo ""
    read -rp "Secret name (default: $KSEC_SECRET_STAGING): " NAME
    [ -z "$NAME" ] && NAME="$KSEC_SECRET_STAGING"
    run helm ksec get "$NAME"
}

# ============================================================
#  4. DEPLOYMENT — inspect and manage
# ============================================================

get_pods() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    run kubectl get pods -n "$IST_NAMESPACE" -l "app.kubernetes.io/instance in ($RELEASE_BACKEND,$RELEASE_FRONTEND)"
}

get_all() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    echo "--- Pods ---"
    kubectl get pods -n "$IST_NAMESPACE" -l "app.kubernetes.io/instance in ($RELEASE_BACKEND,$RELEASE_FRONTEND)" 2>/dev/null
    echo ""
    echo "--- Deployments ---"
    kubectl get deployments -n "$IST_NAMESPACE" 2>/dev/null | grep "$DEMO_NAME"
    echo ""
    echo "--- Services ---"
    kubectl get services -n "$IST_NAMESPACE" 2>/dev/null | grep "$DEMO_NAME"
    echo ""
    echo "--- Ingress ---"
    kubectl get ingress -n "$IST_NAMESPACE" 2>/dev/null | grep "$DEMO_NAME"
}

pod_logs() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    echo "  1. backend"
    echo "  2. frontend"
    read -rp "Which service? " INPUT
    RELEASE=$([ "$INPUT" = "2" ] && echo "$RELEASE_FRONTEND" || echo "$RELEASE_BACKEND")

    read -rp "Lines to show (default: 50): " TAIL
    [ -z "$TAIL" ] && TAIL="50"

    echo -e "${DIM}[cmd]    kubectl logs -l app.kubernetes.io/instance=$RELEASE -n $IST_NAMESPACE --tail=$TAIL${NC}"
    kubectl logs -l "app.kubernetes.io/instance=$RELEASE" -n "$IST_NAMESPACE" --tail="$TAIL"
}

helm_status() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    echo "--- Backend ---"
    helm status "$RELEASE_BACKEND" -n "$IST_NAMESPACE" 2>/dev/null
    echo ""
    echo "--- Frontend ---"
    helm status "$RELEASE_FRONTEND" -n "$IST_NAMESPACE" 2>/dev/null
}

rollout_restart() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    echo "  1. backend"
    echo "  2. frontend"
    echo "  3. both"
    read -rp "Restart which? " INPUT

    if [ "$INPUT" = "1" ] || [ "$INPUT" = "3" ]; then
        run kubectl rollout restart deployment "${RELEASE_BACKEND}-web-app" -n "$IST_NAMESPACE"
    fi
    if [ "$INPUT" = "2" ] || [ "$INPUT" = "3" ]; then
        run kubectl rollout restart deployment "${RELEASE_FRONTEND}-web-app" -n "$IST_NAMESPACE"
    fi
    ok "Rollout restart initiated."
}

resource_usage() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    run kubectl top pods -n "$IST_NAMESPACE" --containers 2>/dev/null | grep "$DEMO_NAME"
}

# ============================================================
#  5. DRONE CI — secrets and links
# ============================================================

extract_drone_secrets() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"

    echo -e "${CYAN}=== Extracting Drone secrets ===${NC}"
    echo ""

    action "Switching to staging context..."
    kubectl config use-context "$STAGING_API" >/dev/null
    kubectl config set-context --current --namespace="$IST_NAMESPACE" >/dev/null

    echo ""
    echo "--- staging_kubernetes_token ---"
    STAGING_TOKEN=$(kubectl get secret kanopy-cicd-token -o jsonpath="{.data.token}" 2>/dev/null | base64 --decode)
    if [ -n "$STAGING_TOKEN" ]; then
        echo -e "  Value: ${DIM}${STAGING_TOKEN:0:20}...${NC}"
    else
        warn "Could not extract staging token."
    fi

    echo ""
    echo "--- ecr_access_key ---"
    ECR_ACCESS=$(kubectl get secret ecr -o jsonpath="{.data.ecr_access_key}" 2>/dev/null | base64 --decode)
    if [ -n "$ECR_ACCESS" ]; then
        echo "  Value: $ECR_ACCESS"
    else
        warn "Could not extract ECR access key."
    fi

    echo ""
    echo "--- ecr_secret_key ---"
    ECR_SECRET=$(kubectl get secret ecr -o jsonpath="{.data.ecr_secret_key}" 2>/dev/null | base64 --decode)
    if [ -n "$ECR_SECRET" ]; then
        echo -e "  Value: ${DIM}${ECR_SECRET:0:10}...${NC}"
    else
        warn "Could not extract ECR secret key."
    fi

    echo ""
    action "Switching to prod context..."
    kubectl config use-context "$PROD_API" >/dev/null
    kubectl config set-context --current --namespace="$IST_NAMESPACE" >/dev/null

    echo ""
    echo "--- prod_kubernetes_token ---"
    PROD_TOKEN=$(kubectl get secret kanopy-cicd-token -o jsonpath="{.data.token}" 2>/dev/null | base64 --decode)
    if [ -n "$PROD_TOKEN" ]; then
        echo -e "  Value: ${DIM}${PROD_TOKEN:0:20}...${NC}"
    else
        warn "Could not extract prod token."
    fi

    echo ""
    echo -e "${CYAN}Add these 4 secrets in Drone UI:${NC}"
    echo "  $DRONE_URL → Repo Settings → Secrets"
    echo "  - staging_kubernetes_token"
    echo "  - prod_kubernetes_token"
    echo "  - ecr_access_key"
    echo "  - ecr_secret_key"
}

show_drone_info() {
    echo ""
    echo -e "${CYAN}=== Drone CI Info ===${NC}"
    echo ""
    echo "  Drone URL: $DRONE_URL"
    echo ""
    echo "  Pipeline triggers:"
    echo "    staging    → push to 'staging' branch"
    echo "    production → push to 'main' branch"
    echo ""
    echo "  Required Drone secrets:"
    echo "    - staging_kubernetes_token"
    echo "    - prod_kubernetes_token"
    echo "    - ecr_access_key"
    echo "    - ecr_secret_key"
    echo ""
    echo "  ECR repositories:"
    echo "    - $ECR_REGISTRY/$IST_NAMESPACE/$DEMO_NAME-backend"
    echo "    - $ECR_REGISTRY/$IST_NAMESPACE/$DEMO_NAME-frontend"
    echo ""
    echo "  Staging URLs:"
    echo "    Backend:  https://$STAGING_HOST_BE"
    echo "    Frontend: https://$STAGING_HOST_FE"
    echo ""
    echo "  Production URLs:"
    echo "    Backend:  https://$PROD_HOST_BE"
    echo "    Frontend: https://$PROD_HOST_FE"
}

# ============================================================
#  6. DIAGNOSTICS — troubleshooting
# ============================================================

describe_pod() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    read -rp "Pod name (or press Enter to pick from list): " POD_NAME
    if [ -z "$POD_NAME" ]; then
        kubectl get pods -n "$IST_NAMESPACE" -o name 2>/dev/null | grep "$DEMO_NAME"
        echo ""
        read -rp "Pod name: " POD_NAME
    fi
    [ -n "$POD_NAME" ] && run kubectl describe pod "$POD_NAME" -n "$IST_NAMESPACE"
}

exec_into_pod() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    echo "  1. backend"
    echo "  2. frontend"
    read -rp "Which service? " INPUT
    RELEASE=$([ "$INPUT" = "2" ] && echo "$RELEASE_FRONTEND" || echo "$RELEASE_BACKEND")
    DEPLOYMENT="${RELEASE}-web-app"

    echo -e "${DIM}[cmd]    kubectl exec -it deployment/$DEPLOYMENT -n $IST_NAMESPACE -- sh${NC}"
    kubectl exec -it "deployment/$DEPLOYMENT" -n "$IST_NAMESPACE" -- sh
}

check_env_vars() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    echo "  1. backend"
    echo "  2. frontend"
    read -rp "Which service? " INPUT
    RELEASE=$([ "$INPUT" = "2" ] && echo "$RELEASE_FRONTEND" || echo "$RELEASE_BACKEND")
    DEPLOYMENT="${RELEASE}-web-app"

    echo -e "${DIM}[cmd]    kubectl exec deployment/$DEPLOYMENT -n $IST_NAMESPACE -- env${NC}"
    kubectl exec "deployment/$DEPLOYMENT" -n "$IST_NAMESPACE" -- env 2>/dev/null | sort
}

test_urls() {
    echo ""
    export KUBECONFIG="$KUBE_DIR/config.staging:$KUBE_DIR/config.prod"
    CTX=$(kubectl config current-context 2>/dev/null)
    if echo "$CTX" | grep -q "staging"; then
        B_URL="https://$STAGING_HOST_BE/health"
        F_URL="https://$STAGING_HOST_FE"
    else
        B_URL="https://$PROD_HOST_BE/health"
        F_URL="https://$PROD_HOST_FE"
    fi
    echo "  Testing backend health: $B_URL"
    STATUS=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 10 "$B_URL" 2>/dev/null)
    [ "$STATUS" = "200" ] && ok "Backend: $STATUS" || warn "Backend: HTTP $STATUS"

    echo "  Testing frontend: $F_URL"
    STATUS=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 10 "$F_URL" 2>/dev/null)
    [ "$STATUS" = "200" ] && ok "Frontend: $STATUS" || warn "Frontend: HTTP $STATUS"
}

# ============================================================
#  7. PRE-DEPLOYMENT CHECKLIST
# ============================================================

pre_deploy_checklist() {
    echo ""
    echo -e "${CYAN}=== Pre-Deployment Checklist ===${NC}"
    echo ""

    PASSED=0; FAILED=0

    check_item() {
        local LABEL="$1"; local RESULT="$2"
        if [ "$RESULT" = "true" ]; then
            echo -e "  ${GREEN}[PASS]${NC} $LABEL"
            PASSED=$((PASSED + 1))
        else
            echo -e "  ${RED}[FAIL]${NC} $LABEL"
            FAILED=$((FAILED + 1))
        fi
    }

    check_item "kubectl installed"            "$(command -v kubectl &>/dev/null && echo true || echo false)"
    check_item "helm installed"               "$(command -v helm &>/dev/null && echo true || echo false)"
    check_item "kanopy-oidc installed"        "$(command -v kanopy-oidc &>/dev/null && echo true || echo false)"
    check_item "ksec plugin installed"        "$(helm plugin list 2>/dev/null | grep -q ksec && echo true || echo false)"
    check_item "Kanopy config exists"         "$([ -f "$KANOPY_CONFIG_PATH" ] && echo true || echo false)"
    check_item "Staging kubeconfig exists"    "$([ -f "$KUBE_DIR/config.staging" ] && echo true || echo false)"
    check_item "Production kubeconfig exists" "$([ -f "$KUBE_DIR/config.prod" ] && echo true || echo false)"
    check_item ".drone.yml exists"            "$([ -f "$PROJECT_ROOT/.drone.yml" ] && echo true || echo false)"
    check_item "environments/staging.yaml"    "$([ -f "$PROJECT_ROOT/environments/staging.yaml" ] && echo true || echo false)"
    check_item "environments/production.yaml" "$([ -f "$PROJECT_ROOT/environments/production.yaml" ] && echo true || echo false)"
    check_item "backend/Dockerfile exists"    "$([ -f "$PROJECT_ROOT/backend/Dockerfile" ] && echo true || echo false)"
    check_item "frontend/Dockerfile exists"   "$([ -f "$PROJECT_ROOT/frontend/Dockerfile" ] && echo true || echo false)"

    echo ""
    if [ $FAILED -eq 0 ]; then
        echo -e "  Result: ${GREEN}$PASSED passed, $FAILED failed${NC}"
    else
        echo -e "  Result: ${YELLOW}$PASSED passed, $FAILED failed${NC}"
    fi
}

# ============================================================
#  Bootstrap
# ============================================================

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN} Kanopy Deployment Manager${NC}"
echo -e "${DIM} $DEMO_NAME${NC}"
echo -e "${CYAN}============================================${NC}"

# ============================================================
#  Main menu
# ============================================================

while true; do
    echo ""
    echo "============================================"
    echo " Menu"
    echo "============================================"
    echo "  --- Setup ---"
    echo "  1.  Full setup (install all prerequisites)"
    echo "  2.  Install kubectl only"
    echo "  3.  Install Helm + MongoDB repo + ksec"
    echo "  4.  Install/check kanopy-oidc"
    echo "  5.  Create kanopy OIDC config file"
    echo "  --- Cluster ---"
    echo "  6.  Generate kubeconfig (staging/prod/both)"
    echo "  7.  Login (re-authenticate token)"
    echo "  8.  Switch context (staging/prod)"
    echo "  9.  Verify cluster access"
    echo "  --- Secrets ---"
    echo "  10. Create/update ksec secrets"
    echo "  11. List ksec secrets"
    echo "  12. Get ksec secret values"
    echo "  --- Deployment ---"
    echo "  13. Get pods (this demo)"
    echo "  14. Get all resources (pods/deploy/svc/ingress)"
    echo "  15. View pod logs"
    echo "  16. Helm release status"
    echo "  17. Rollout restart"
    echo "  18. Resource usage (top)"
    echo "  --- Drone CI ---"
    echo "  19. Extract Drone secrets from cluster"
    echo "  20. Show Drone/deployment info"
    echo "  --- Diagnostics ---"
    echo "  21. Describe pod"
    echo "  22. Exec into pod (shell)"
    echo "  23. Check env vars in pod"
    echo "  24. Test staging/prod URLs"
    echo "  25. Pre-deployment checklist"
    echo "  --- ---"
    echo "  0.  Exit"
    echo ""
    read -rp "Select an option: " CHOICE

    case "$CHOICE" in
        1)  full_setup ;;
        2)  install_kubectl ;;
        3)  install_helm; setup_helm_repo; install_ksec_plugin ;;
        4)  install_kanopy_oidc ;;
        5)  create_kanopy_config ;;
        6)  generate_kubeconfig ;;
        7)  kanopy_login ;;
        8)  switch_context ;;
        9)  verify_access ;;
        10) create_secrets ;;
        11) list_secrets ;;
        12) get_secret ;;
        13) get_pods ;;
        14) get_all ;;
        15) pod_logs ;;
        16) helm_status ;;
        17) rollout_restart ;;
        18) resource_usage ;;
        19) extract_drone_secrets ;;
        20) show_drone_info ;;
        21) describe_pod ;;
        22) exec_into_pod ;;
        23) check_env_vars ;;
        24) test_urls ;;
        25) pre_deploy_checklist ;;
        0)  echo ""; echo "Goodbye."; break ;;
        *)  warn "Invalid option. Enter 1-25 or 0." ;;
    esac

    if [ "$CHOICE" != "0" ]; then
        echo ""
        read -rp "Press Enter to return to menu..."
    fi
done
