#!/bin/bash
# ============================================================
#  GitHub Key & Auth Manager
# ============================================================

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()     { echo -e "${GREEN}[ok]${NC}     $1"; }
warn()   { echo -e "${YELLOW}[warn]${NC}   $1"; }
fail()   { echo -e "${RED}[error]${NC}  $1"; }
action() { echo "[action] $1"; }
chk()    { echo "[check]  $1"; }

# ---- Dependency checks -------------------------------------

ensure_ssh_keygen() {
    chk "OpenSSH Client (ssh-keygen)..."
    if command -v ssh-keygen &>/dev/null; then
        ok "ssh-keygen is available."
        return
    fi
    action "Installing OpenSSH..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install openssh
    elif command -v apt-get &>/dev/null; then
        sudo apt-get install -y openssh-client
    elif command -v yum &>/dev/null; then
        sudo yum install -y openssh
    else
        fail "Cannot install ssh-keygen automatically."
        echo "  > Install OpenSSH manually and re-run this script."
        exit 1
    fi
    command -v ssh-keygen &>/dev/null && ok "ssh-keygen installed." || { fail "Failed to install ssh-keygen."; exit 1; }
}

ensure_gh() {
    chk "GitHub CLI (gh)..."
    if command -v gh &>/dev/null; then
        ok "gh is available: $(gh --version | head -1)"
        return
    fi
    action "Installing GitHub CLI..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install gh
    elif command -v apt-get &>/dev/null; then
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
            | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
https://cli.github.com/packages stable main" \
            | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
        sudo apt-get update -q && sudo apt-get install -y gh
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y gh
    else
        fail "Cannot install GitHub CLI automatically."
        echo "  > Install manually from: https://cli.github.com"
        exit 1
    fi
    command -v gh &>/dev/null && ok "GitHub CLI installed: $(gh --version | head -1)" || { fail "Failed to install GitHub CLI."; exit 1; }
}

ensure_ssh_dir() {
    chk "~/.ssh directory..."
    SSH_DIR="$HOME/.ssh"
    if [ ! -d "$SSH_DIR" ]; then
        action "Creating ~/.ssh directory..."
        mkdir -p "$SSH_DIR" && chmod 700 "$SSH_DIR"
        ok "~/.ssh created."
    else
        ok "~/.ssh directory exists."
    fi
}

# ---- Option 1: Create SSH key ------------------------------

create_ssh_key() {
    SSH_DIR="$HOME/.ssh"
    echo ""
    read -rp "GitHub Email: " EMAIL

    DEFAULT_KEY="id_rsa_github"
    read -rp "SSH key file name (default: $DEFAULT_KEY): " KEY_INPUT
    KEY_FILE="${KEY_INPUT:-$DEFAULT_KEY}"

    DEFAULT_HOST="github.com"
    read -rp "SSH config host alias (default: $DEFAULT_HOST): " HOST_INPUT
    HOST_ALIAS="${HOST_INPUT:-$DEFAULT_HOST}"

    DEFAULT_LABEL="$KEY_FILE"
    read -rp "Key label shown in GitHub (default: $DEFAULT_LABEL): " LABEL_INPUT
    KEY_LABEL="${LABEL_INPUT:-$DEFAULT_LABEL}"

    KEY_PATH="$SSH_DIR/$KEY_FILE"
    echo ""
    action "Generating SSH key '$KEY_FILE' for $EMAIL..."
    ssh-keygen -t rsa -b 4096 -C "$EMAIL" -f "$KEY_PATH" -N ""

    if [ ! -f "${KEY_PATH}.pub" ]; then
        fail "Key generation failed - ${KEY_PATH}.pub not found."
        return
    fi

    # Update ~/.ssh/config
    CONFIG="$SSH_DIR/config"
    BLOCK="
Host $HOST_ALIAS
  HostName github.com
  User git
  IdentityFile ~/.ssh/$KEY_FILE
  IdentitiesOnly yes"

    if [ -f "$CONFIG" ]; then
        if grep -q "^Host $HOST_ALIAS$" "$CONFIG"; then
            warn "Host '$HOST_ALIAS' already exists in $CONFIG - skipping config update."
        else
            echo "$BLOCK" >> "$CONFIG"
            ok "SSH config updated: $CONFIG"
        fi
    else
        echo "$BLOCK" > "$CONFIG"
        chmod 600 "$CONFIG"
        ok "SSH config created: $CONFIG"
    fi

    echo ""
    echo "Public key ($KEY_LABEL):"
    echo "----------------------------------------"
    cat "${KEY_PATH}.pub"
    echo "----------------------------------------"
    echo ""
    echo "Next steps:"
    echo "  1. Go to https://github.com/settings/keys"
    echo "  2. Click 'New SSH Key', set title to '$KEY_LABEL', paste the key above."
    echo "  3. If using GitHub org SSO, authorize the key for your organization."
    echo ""
    echo "Test your connection with:"
    echo "  ssh -T git@$HOST_ALIAS"
    echo "  ssh -i ~/.ssh/$KEY_FILE -T git@github.com"
}

# ---- Option 2: Authenticate with GitHub CLI ----------------

github_auth() {
    echo ""
    chk "GitHub CLI authentication status..."
    if gh auth status &>/dev/null; then
        ok "Already authenticated with GitHub:"
        gh auth status
        return
    fi
    action "Starting GitHub CLI authentication..."
    echo "  > When prompted, choose:"
    echo "      - GitHub.com"
    echo "      - SSH as preferred protocol"
    echo "      - Select your SSH key (e.g. id_rsa_github)"
    echo "      - Login with a web browser"
    echo ""
    gh auth login
    gh auth status &>/dev/null && ok "Authentication successful." || fail "Authentication failed. Try: gh auth login"
}

# ---- Option 3: List pull requests --------------------------

list_prs() {
    echo ""
    chk "GitHub CLI authentication..."
    if ! gh auth status &>/dev/null; then
        fail "Not authenticated with GitHub CLI. Run option 2 first."
        return
    fi
    ok "Authenticated."

    read -rp "Repository owner/repo (leave empty to use current directory): " REPO_INPUT
    read -rp "Base branch to filter (default: staging): " BASE_INPUT
    BASE="${BASE_INPUT:-staging}"

    echo ""
    if [ -n "$REPO_INPUT" ]; then
        echo "Pull requests targeting '$BASE' in $REPO_INPUT:"
        gh pr list --repo "$REPO_INPUT" --base "$BASE"
    else
        echo "Pull requests targeting '$BASE' in current repo:"
        gh pr list --base "$BASE"
    fi
}

# ---- Option 5: Logout / switch user -----------------------

github_logout() {
    echo ""
    chk "GitHub CLI authentication status..."
    if ! gh auth status &>/dev/null; then
        warn "No active GitHub CLI session found. Nothing to log out from."
        return
    fi
    gh auth status
    echo ""
    read -rp "Log out from GitHub CLI? This will remove the stored token. (y/N): " CONFIRM
    if [[ "${CONFIRM,,}" != "y" ]]; then
        echo "Logout cancelled."
        return
    fi
    gh auth logout
    gh auth status &>/dev/null \
        && fail "Logout failed. Try running: gh auth logout" \
        || ok "Logged out successfully. Run option 2 to authenticate as a different user."
}

# ---- Option 4: List SSH keys -------------------------------

list_ssh_keys() {
    SSH_DIR="$HOME/.ssh"
    CONFIG="$SSH_DIR/config"
    echo ""
    echo "SSH keys found in $SSH_DIR :"
    echo "------------------------------------------------------------"

    shopt -s nullglob
    PUB_KEYS=("$SSH_DIR"/*.pub)
    shopt -u nullglob

    if [ ${#PUB_KEYS[@]} -eq 0 ]; then
        warn "No public keys found in $SSH_DIR."
        return
    fi

    for pub in "${PUB_KEYS[@]}"; do
        KEY_NAME=$(basename "$pub" .pub)
        FINGERPRINT=$(ssh-keygen -lf "$pub" 2>/dev/null)
        IN_CONFIG="no"
        [ -f "$CONFIG" ] && grep -q "IdentityFile.*$KEY_NAME" "$CONFIG" && IN_CONFIG="yes"
        echo ""
        echo "  Key      : $KEY_NAME"
        echo "  File     : $pub"
        echo "  In config: $IN_CONFIG"
        echo "  Details  : $FINGERPRINT"
    done

    echo ""
    echo "------------------------------------------------------------"
    echo "SSH config: $CONFIG"
    if [ -f "$CONFIG" ]; then
        cat "$CONFIG"
    else
        warn "No SSH config file found."
    fi
}

# ============================================================
#  Bootstrap
# ============================================================

echo ""
echo "============================================"
echo " GitHub Key & Auth Manager"
echo "============================================"
echo ""
echo "Checking dependencies..."
echo ""

ensure_ssh_keygen
ensure_gh
ensure_ssh_dir

echo ""
ok "All dependencies satisfied."

# ============================================================
#  Main menu
# ============================================================

while true; do
    echo ""
    echo "============================================"
    echo " Menu"
    echo "============================================"
    echo "  1. Create SSH key for GitHub"
    echo "  2. Authenticate with GitHub CLI (gh auth login)"
    echo "  3. List pull requests in a project"
    echo "  4. List SSH keys"
    echo "  5. Logout / switch GitHub account"
    echo "  0. Exit"
    echo ""
    read -rp "Select an option: " CHOICE

    case "$CHOICE" in
        1) create_ssh_key ;;
        2) github_auth ;;
        3) list_prs ;;
        4) list_ssh_keys ;;
        5) github_logout ;;
        0) echo ""; echo "Goodbye."; break ;;
        *) warn "Invalid option. Enter 1-5 or 0." ;;
    esac

    if [ "$CHOICE" != "0" ]; then
        echo ""
        read -rp "Press Enter to return to menu..."
    fi
done
