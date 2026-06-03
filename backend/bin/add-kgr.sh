#!/bin/bash

SSH_DIR="$HOME/.ssh"

if [ ! -d "$SSH_DIR" ]; then
  echo "The ~/.ssh directory does not exist. Creating it..."
  mkdir -p "$SSH_DIR"
  chmod 700 "$SSH_DIR"
fi

# Collect inputs
read -rp "GitHub Email: " EMAIL

DEFAULT_KEY_NAME="id_rsa_github"
read -rp "SSH key file name (default: $DEFAULT_KEY_NAME): " KEY_INPUT
KEY_FILE_NAME="${KEY_INPUT:-$DEFAULT_KEY_NAME}"

DEFAULT_HOST="github.com"
read -rp "SSH config host alias (default: $DEFAULT_HOST — use e.g. 'github-work' for multiple accounts): " HOST_INPUT
HOST_ALIAS="${HOST_INPUT:-$DEFAULT_HOST}"

DEFAULT_LABEL="$KEY_FILE_NAME"
read -rp "Key label shown in GitHub (default: $DEFAULT_LABEL): " LABEL_INPUT
KEY_LABEL="${LABEL_INPUT:-$DEFAULT_LABEL}"

# Generate SSH key
KEY_PATH="$SSH_DIR/$KEY_FILE_NAME"
echo ""
echo "Generating SSH key '$KEY_FILE_NAME' for $EMAIL..."
ssh-keygen -t rsa -b 4096 -C "$EMAIL" -f "$KEY_PATH" -N ""

if [ ! -f "${KEY_PATH}.pub" ]; then
  echo "Error: key generation failed — ${KEY_PATH}.pub not found."
  exit 1
fi

# Write SSH config block
CONFIG_PATH="$SSH_DIR/config"
CONFIG_BLOCK="
Host $HOST_ALIAS
  HostName github.com
  User git
  IdentityFile ~/.ssh/$KEY_FILE_NAME
  IdentitiesOnly yes"

if [ -f "$CONFIG_PATH" ]; then
  if grep -q "^Host $HOST_ALIAS$" "$CONFIG_PATH"; then
    echo ""
    echo "Warning: a 'Host $HOST_ALIAS' entry already exists in $CONFIG_PATH — skipping config update."
    echo "Edit it manually if needed."
  else
    echo "$CONFIG_BLOCK" >> "$CONFIG_PATH"
    echo ""
    echo "SSH config updated: $CONFIG_PATH"
  fi
else
  echo "$CONFIG_BLOCK" > "$CONFIG_PATH"
  chmod 600 "$CONFIG_PATH"
  echo ""
  echo "SSH config created: $CONFIG_PATH"
fi

# Display public key
echo ""
echo "Your SSH public key ($KEY_LABEL):"
echo "----------------------------------------"
cat "${KEY_PATH}.pub"
echo "----------------------------------------"

# Final instructions
GITHUB_HOST="$HOST_ALIAS"
echo ""
echo "Next steps:"
echo "  1. Go to https://github.com/settings/keys"
echo "  2. Click 'New SSH Key', set title to '$KEY_LABEL', paste the key above."
echo "  3. If using GitHub org SSO, authorize the key for your organization."
echo ""
echo "Test the connection with:"
echo "  ssh -T git@$GITHUB_HOST"
echo ""
echo "For git remotes using a custom alias, use:"
echo "  git remote set-url origin git@${GITHUB_HOST}:<org>/<repo>.git"
echo ""
echo "SSH key '$KEY_FILE_NAME' generated and configured."
