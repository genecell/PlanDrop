#!/bin/bash
#
# PlanDrop Native Messaging Host Installer
# Supports: macOS, Linux
# Browsers: Chrome, Chromium, Brave, Edge
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/plandrop_host.py"
MANIFEST_TEMPLATE="$SCRIPT_DIR/com.plandrop.host.json"
MANIFEST_NAME="com.plandrop.host.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*)    echo "macos" ;;
        Linux*)     echo "linux" ;;
        *)          echo "unknown" ;;
    esac
}

# Get browser manifest paths for each OS/browser combo
get_manifest_paths() {
    local os="$1"
    local browser="$2"

    case "$os" in
        macos)
            case "$browser" in
                chrome)    echo "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
                chromium)  echo "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" ;;
                brave)     echo "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
                edge)      echo "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" ;;
            esac
            ;;
        linux)
            case "$browser" in
                chrome)    echo "$HOME/.config/google-chrome/NativeMessagingHosts" ;;
                chromium)  echo "$HOME/.config/chromium/NativeMessagingHosts" ;;
                brave)     echo "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
                edge)      echo "$HOME/.config/microsoft-edge/NativeMessagingHosts" ;;
            esac
            ;;
    esac
}

# Check if browser is installed
is_browser_installed() {
    local os="$1"
    local browser="$2"

    case "$os" in
        macos)
            case "$browser" in
                chrome)    [ -d "/Applications/Google Chrome.app" ] ;;
                chromium)  [ -d "/Applications/Chromium.app" ] ;;
                brave)     [ -d "/Applications/Brave Browser.app" ] ;;
                edge)      [ -d "/Applications/Microsoft Edge.app" ] ;;
            esac
            ;;
        linux)
            case "$browser" in
                chrome)    command -v google-chrome &> /dev/null || command -v google-chrome-stable &> /dev/null ;;
                chromium)  command -v chromium &> /dev/null || command -v chromium-browser &> /dev/null ;;
                brave)     command -v brave &> /dev/null || command -v brave-browser &> /dev/null ;;
                edge)      command -v microsoft-edge &> /dev/null || command -v microsoft-edge-stable &> /dev/null ;;
            esac
            ;;
    esac
}

# Install manifest for a browser
# Arguments: os, browser, extension_ids (space-separated)
install_for_browser() {
    local os="$1"
    local browser="$2"
    shift 2
    local extension_ids=("$@")

    local manifest_dir
    manifest_dir=$(get_manifest_paths "$os" "$browser")

    if [ -z "$manifest_dir" ]; then
        return 1
    fi

    # Create directory if needed
    mkdir -p "$manifest_dir"

    # Build allowed_origins array
    local origins=""
    local first=true
    for ext_id in "${extension_ids[@]}"; do
        if [ "$first" = true ]; then
            origins="\"chrome-extension://$ext_id/\""
            first=false
        else
            origins="$origins,
    \"chrome-extension://$ext_id/\""
        fi
    done

    # Create manifest with correct paths
    local manifest_file="$manifest_dir/$MANIFEST_NAME"

    cat > "$manifest_file" << EOF
{
  "name": "com.plandrop.host",
  "description": "PlanDrop - Send prompts to remote server via SSH",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    $origins
  ]
}
EOF

    log_success "Installed manifest for $browser at $manifest_file"
    return 0
}

# Verify dependencies
verify_dependencies() {
    local missing=()

    if ! command -v python3 &> /dev/null; then
        missing+=("python3")
    else
        log_success "Python 3: $(python3 --version 2>&1)"
    fi

    if ! command -v ssh &> /dev/null; then
        missing+=("ssh")
    fi

    if ! command -v scp &> /dev/null; then
        missing+=("scp")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing required dependencies: ${missing[*]}"
        return 1
    fi

    log_success "SSH tools found (ssh, scp)"

    # Check SSH config
    if [ -f ~/.ssh/config ]; then
        log_success "SSH config found at ~/.ssh/config"
    else
        log_warning "No SSH config found at ~/.ssh/config"
        echo "         You'll need to add your server. Example:"
        echo ""
        echo "         Host myserver"
        echo "             HostName 123.45.67.89"
        echo "             User myuser"
        echo "             IdentityFile ~/.ssh/id_rsa"
        echo ""
    fi

    return 0
}

# Uninstall native host
uninstall() {
    local os="$1"
    local browsers=("chrome" "chromium" "brave" "edge")

    echo ""
    log_info "Uninstalling PlanDrop native host..."
    echo ""

    for browser in "${browsers[@]}"; do
        local manifest_dir
        manifest_dir=$(get_manifest_paths "$os" "$browser")
        local manifest_file="$manifest_dir/$MANIFEST_NAME"

        if [ -f "$manifest_file" ]; then
            rm -f "$manifest_file"
            log_success "Removed manifest for $browser"
        fi
    done

    echo ""
    log_success "Uninstallation complete!"
    echo "         Restart your browser(s) to complete the removal."
    exit 0
}

# Main installation
main() {
    echo ""
    echo "========================================"
    echo "  PlanDrop Native Host Installer"
    echo "  Plan, review, execute — from browser"
    echo "========================================"
    echo ""

    # Detect OS first (needed for uninstall)
    local os
    os=$(detect_os)
    if [ "$os" == "unknown" ]; then
        log_error "Unsupported operating system. Use install.ps1 for Windows."
        exit 1
    fi

    # Handle --uninstall flag
    if [ "${1:-}" = "--uninstall" ]; then
        uninstall "$os"
    fi

    # Handle --help flag
    if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
        echo "Usage: ./install.sh [OPTIONS] [EXTENSION_ID...]"
        echo ""
        echo "Options:"
        echo "  --help        Show this help"
        echo "  --uninstall   Remove native host from all browsers"
        echo ""
        echo "Examples:"
        echo "  ./install.sh abcdefghijklmnopqrstuvwxyz"
        echo "  ./install.sh id1 id2 id3    # Multiple Chrome profiles"
        echo ""
        exit 0
    fi

    # Check files exist
    if [ ! -f "$HOST_SCRIPT" ]; then
        log_error "Host script not found: $HOST_SCRIPT"
        exit 1
    fi

    log_info "Detected OS: $os"

    # Verify dependencies
    if ! verify_dependencies; then
        exit 1
    fi

    # Make host script executable
    chmod +x "$HOST_SCRIPT"
    log_success "Made host script executable"

    # Get extension IDs (supports multiple for multi-profile setup)
    local extension_ids=()
    if [ $# -eq 0 ]; then
        extension_ids=("EXTENSION_ID_PLACEHOLDER")
        echo ""
        log_warning "No extension ID provided."
        echo "         After loading the extension in Chrome, run:"
        echo "         $0 <extension-id>"
        echo ""
        echo "         For multiple Chrome profiles, pass all IDs:"
        echo "         $0 <id1> <id2> <id3>"
        echo ""
        echo "         Proceeding with placeholder (you'll need to update later)..."
        echo ""
    else
        extension_ids=("$@")
        if [ ${#extension_ids[@]} -eq 1 ]; then
            log_info "Using extension ID: ${extension_ids[0]}"
        else
            log_info "Using ${#extension_ids[@]} extension IDs (multi-profile setup)"
            for ext_id in "${extension_ids[@]}"; do
                echo "         - $ext_id"
            done
        fi
    fi

    # Detect and install for each browser
    local browsers=("chrome" "chromium" "brave" "edge")
    local installed=()

    echo ""
    log_info "Checking for installed browsers..."

    for browser in "${browsers[@]}"; do
        if is_browser_installed "$os" "$browser"; then
            log_info "Found $browser, installing..."
            if install_for_browser "$os" "$browser" "${extension_ids[@]}"; then
                installed+=("$browser")
            fi
        fi
    done

    echo ""
    echo "========================================"
    echo "  Installation Summary"
    echo "========================================"
    echo ""

    if [ ${#installed[@]} -eq 0 ]; then
        log_warning "No supported browsers detected!"
        log_info "Manifest locations for manual installation:"
        echo ""
        for browser in "${browsers[@]}"; do
            local path
            path=$(get_manifest_paths "$os" "$browser")
            echo "  $browser: $path/$MANIFEST_NAME"
        done
    else
        log_success "Installed for: ${installed[*]}"
    fi

    echo ""
    log_info "Log file location: ~/.plandrop/relay.log"
    echo ""

    # Test connectivity hint
    if [ "${extension_ids[0]}" != "EXTENSION_ID_PLACEHOLDER" ]; then
        echo "Next steps:"
        echo "  1. Restart your browser(s)"
        echo "  2. Open the PlanDrop extension popup"
        echo "  3. Configure a server and test the connection"
        echo ""
    fi

    log_success "Installation complete!"
}

main "$@"
