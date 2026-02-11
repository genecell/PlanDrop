#!/bin/bash
# PlanDrop Server Setup
# Usage: curl -sL https://raw.githubusercontent.com/genecell/PlanDrop/master/server/setup.sh | bash
# Or:    bash setup.sh

set -e

echo "========================================="
echo "  PlanDrop Server Setup"
echo "  Plan, review, execute. From browser."
echo "========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }

# ---- Step 1: Check prerequisites ----
echo "Step 1: Checking prerequisites..."
echo ""

# Check Node.js
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  success "Node.js found: $NODE_VERSION"
else
  fail "Node.js not found"
  echo "   Install Node.js first:"
  echo "   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
  echo "   sudo apt-get install -y nodejs"
  echo ""
  echo "   Or with nvm (recommended):"
  echo "   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash"
  echo "   source ~/.bashrc"
  echo "   nvm install --lts"
  exit 1
fi

# Check npm
if command -v npm &> /dev/null; then
  success "npm found: $(npm --version)"
else
  fail "npm not found (should come with Node.js)"
  exit 1
fi

echo ""

# ---- Step 2: Install Claude Code ----
echo "Step 2: Checking Claude Code..."
echo ""

if command -v claude &> /dev/null; then
  CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
  success "Claude Code found: $CLAUDE_VERSION"
else
  warn "Claude Code not found. Installing..."
  npm install -g @anthropic-ai/claude-code
  if command -v claude &> /dev/null; then
    success "Claude Code installed: $(claude --version)"
  else
    fail "Claude Code installation failed"
    echo "   Try manually: npm install -g @anthropic-ai/claude-code"
    exit 1
  fi
fi

echo ""

# ---- Step 3: Check Claude Code authentication ----
echo "Step 3: Checking authentication..."
echo ""

# Check if ANTHROPIC_API_KEY is set (warn about cost)
if [ -n "$ANTHROPIC_API_KEY" ]; then
  warn "ANTHROPIC_API_KEY is set in your environment"
  echo "   Claude Code will use your API key (costs money per token)"
  echo "   If you have a Claude Max subscription, unset it:"
  echo ""
  echo "   unset ANTHROPIC_API_KEY"
  echo "   # Remove from ~/.bashrc or ~/.zshrc permanently"
  echo ""
  echo "   Then run: claude login"
  echo ""
  read -p "   Continue with API key? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "   Run 'unset ANTHROPIC_API_KEY' then 'claude login' and re-run this script."
    exit 0
  fi
else
  # Check if logged in
  # Try a quick claude command to see if auth works
  echo "   Testing Claude Code authentication..."
  if claude -p --model haiku "say ok" --max-turns 1 --output-format text 2>/dev/null | grep -qi "ok"; then
    success "Claude Code authenticated"
  else
    warn "Claude Code may not be authenticated"
    echo "   Run: claude login"
    echo "   This will open a browser for OAuth login with your Max subscription"
    echo ""
    read -p "   Run 'claude login' now? (Y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      claude login
    fi
  fi
fi

echo ""

# ---- Step 4: Install plandrop-watch globally ----
echo "Step 4: Installing PlanDrop watcher..."
echo ""

INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"

# Function to validate downloaded file
validate_download() {
  local file="$1"
  local name="$2"
  local min_size="${3:-100}"  # Minimum expected size in bytes

  # Check file exists
  if [ ! -f "$file" ]; then
    fail "Download failed: $name not found"
    return 1
  fi

  # Check file is not empty
  local size=$(wc -c < "$file" 2>/dev/null || echo 0)
  if [ "$size" -lt "$min_size" ]; then
    fail "Download failed: $name is too small ($size bytes, expected >$min_size)"
    rm -f "$file"
    return 1
  fi

  # Check it's a valid shell script (starts with shebang or has bash content)
  local first_line=$(head -1 "$file" 2>/dev/null)
  if [[ ! "$first_line" =~ ^#! ]] && [[ ! "$first_line" =~ ^# ]]; then
    fail "Download failed: $name doesn't appear to be a valid script"
    echo "   First line: $first_line"
    rm -f "$file"
    return 1
  fi

  return 0
}

# Download watch.sh or copy from local
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCH_FILE="$INSTALL_DIR/plandrop-watch"

if [ -f "$SCRIPT_DIR/../native-host/watch.sh" ]; then
  cp "$SCRIPT_DIR/../native-host/watch.sh" "$WATCH_FILE"
  success "Copied plandrop-watch from local source"
elif [ -f "$SCRIPT_DIR/watch.sh" ]; then
  cp "$SCRIPT_DIR/watch.sh" "$WATCH_FILE"
  success "Copied plandrop-watch from local source"
else
  # Download from GitHub with validation
  echo "   Downloading plandrop-watch from GitHub..."
  curl -fsSL --retry 3 --retry-delay 2 \
    "https://raw.githubusercontent.com/genecell/PlanDrop/master/native-host/watch.sh" \
    -o "$WATCH_FILE"

  if ! validate_download "$WATCH_FILE" "plandrop-watch" 5000; then
    echo ""
    echo "   Manual installation:"
    echo "   curl -sL https://raw.githubusercontent.com/genecell/PlanDrop/master/native-host/watch.sh -o ~/.local/bin/plandrop-watch"
    echo "   chmod +x ~/.local/bin/plandrop-watch"
    exit 1
  fi
  success "Downloaded plandrop-watch"
fi

chmod +x "$WATCH_FILE"

# Install plandrop-history
HISTORY_FILE="$INSTALL_DIR/plandrop-history"

if [ -f "$SCRIPT_DIR/plandrop-history" ]; then
  cp "$SCRIPT_DIR/plandrop-history" "$HISTORY_FILE"
  success "Copied plandrop-history from local source"
else
  # Download from GitHub with validation
  echo "   Downloading plandrop-history from GitHub..."
  curl -fsSL --retry 3 --retry-delay 2 \
    "https://raw.githubusercontent.com/genecell/PlanDrop/master/server/plandrop-history" \
    -o "$HISTORY_FILE"

  if ! validate_download "$HISTORY_FILE" "plandrop-history" 1000; then
    warn "Could not download plandrop-history (optional component)"
    echo "   History export will not be available"
  else
    success "Downloaded plandrop-history"
  fi
fi

if [ -f "$HISTORY_FILE" ]; then
  chmod +x "$HISTORY_FILE"
fi

# Add to PATH if not already
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo "" >> "$HOME/.bashrc"
  echo "# PlanDrop" >> "$HOME/.bashrc"
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
  warn "Added $INSTALL_DIR to PATH in ~/.bashrc"
  echo "   Run: source ~/.bashrc"
  export PATH="$INSTALL_DIR:$PATH"
fi

success "Installed plandrop-watch to $INSTALL_DIR/plandrop-watch"
success "Installed plandrop-history to $INSTALL_DIR/plandrop-history"
echo ""

# ---- Step 5: Initialize a project (optional) ----
echo "Step 5: Initialize a project"
echo ""
echo "   To set up PlanDrop in a project directory:"
echo ""
echo "   cd /path/to/your/project"
echo "   plandrop-watch --init"
echo ""
echo "   This creates the .plandrop/ directory structure."
echo ""
echo "   To start watching:"
echo ""
echo "   cd /path/to/your/project"
echo "   plandrop-watch"
echo ""
echo "   Or in the background:"
echo ""
echo "   plandrop-watch --daemon"
echo ""

# ---- Summary ----
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "  Next steps:"
echo "  1. cd /your/project"
echo "  2. plandrop-watch --init    (first time per project)"
echo "  3. plandrop-watch           (start watching)"
echo ""
echo "  Then in your browser:"
echo "  4. Install PlanDrop Chrome extension"
echo "  5. Add this server in PlanDrop settings"
echo "  6. Open Side Panel and start planning!"
echo ""
echo "  Docs: https://github.com/genecell/PlanDrop"
echo "========================================="
