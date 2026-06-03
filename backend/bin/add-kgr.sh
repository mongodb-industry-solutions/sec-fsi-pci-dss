#!/bin/bash  
  
# Ask for the GitHub email  
echo "Please enter your GitHub email: "  
read EMAIL  
  
# Variables  
KEY_FILE_NAME="id_rsa_github" # Custom name for the SSH key  
SSH_DIR="$HOME/.ssh"  
  
# Check if ~/.ssh exists, if not, create it  
if [ ! -d "$SSH_DIR" ]; then  
  echo "The ~/.ssh directory does not exist. Creating it..."  
  mkdir -p "$SSH_DIR"  
fi  
  
# Generate the SSH key  
echo "Generating a new SSH key with the email: $EMAIL..."  
ssh-keygen -t rsa -b 4096 -C "$EMAIL" -f "$SSH_DIR/$KEY_FILE_NAME" -N "" # No passphrase (-N "")  
  
# Display the public key  
echo ""  
echo "Your SSH public key is:"  
cat "$SSH_DIR/$KEY_FILE_NAME.pub"  
  
# Instructions to add the SSH key to GitHub  
echo ""  
echo "Please copy the public key above and follow these steps:"  
echo "  1. Go to https://github.com/settings/keys"  
echo "  2. Click 'New SSH Key'"  
echo "  3. Paste the public key and save it with a descriptive name."  
echo ""  
echo "Once added, test the connection to GitHub using:"  
echo "  ssh -T git@github.com"  
echo ""  
echo "SSH key generated and ready to use!"  
