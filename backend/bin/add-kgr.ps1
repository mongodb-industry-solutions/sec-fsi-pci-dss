# Check for required permissions and provide a message about execution policies  
Write-Host "Please ensure you have executed: 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned' to allow this script to run properly."  
  
# Check if the script has necessary permissions (write to ~/.ssh)  
if (-not (Test-Path -Path "$HOME\.ssh")) {    
    Write-Host "The script needs to create the ~/.ssh directory, but it does not have the necessary permissions."    
    Write-Host "Please create the ~/.ssh folder manually or run this script with appropriate permissions."    
    exit    
}  
  
# Ask for the GitHub email  
Write-Host "Please enter your GitHub email:"  
$Email = Read-Host "GitHub Email"  
  
# Variables  
$KeyFileName = "id_rsa_github" # Custom name for the SSH key  
$SSHDir = "$HOME\.ssh"  
  
# Check if ~/.ssh exists; if not, create it  
if (!(Test-Path -Path $SSHDir)) {  
    Write-Host "The ~/.ssh directory does not exist. Creating it..."  
    New-Item -ItemType Directory -Path $SSHDir -Force  
}  
  
# Generate the SSH key  
Write-Host "Generating a new SSH key with the email: $Email..."  
try {  
    & ssh-keygen -t rsa -b 4096 -C "$Email" -f "$SSHDir\$KeyFileName" -N '""'  
} catch {  
    Write-Host "Failed to generate SSH key using ssh-keygen. Ensure OpenSSH Client is installed and available in PATH."  
    exit  
}  
  
# Verify if the public key was created  
$PublicKeyPath = "$SSHDir\$KeyFileName.pub"  
if (!(Test-Path -Path $PublicKeyPath)) {  
    Write-Host "Error: SSH key generation failed. The public key does not exist at $PublicKeyPath."  
    Write-Host "Please check the command `ssh-keygen` and try again."  
    exit  
}  
  
# Display the public key  
Write-Host ""  
Write-Host "Your SSH public key is:"  
Get-Content $PublicKeyPath  
  
# Final instructions  
Write-Host ""  
Write-Host "Please copy the public key above and follow these steps:"  
Write-Host "  1. Go to https://github.com/settings/keys"  
Write-Host "  2. Click 'New SSH Key'"  
Write-Host "  3. Paste the public key and save it with a descriptive name."  
Write-Host ""  
Write-Host "Once added, test the connection to GitHub using:"  
Write-Host "  ssh -T git@github.com"  
Write-Host ""  
Write-Host "SSH key successfully generated and ready to use!"  
