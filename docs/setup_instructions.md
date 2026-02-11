# PlanDrop Setup Instructions

Complete guide to installing and configuring PlanDrop — the Chrome extension that talks to Claude Code on remote servers.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Server Setup](#step-1-server-setup)
- [Step 2: Project Initialization](#step-2-project-initialization)
- [Step 3: Chrome Extension Installation](#step-3-chrome-extension-installation)
- [Step 4: Native Messaging Host Installation](#step-4-native-messaging-host-installation)
- [Step 5: Extension Configuration](#step-5-extension-configuration)
- [Step 6: Start the Watcher](#step-6-start-the-watcher)
- [Verifying the Setup](#verifying-the-setup)
- [Permission Profiles](#permission-profiles)
- [SSH Configuration](#ssh-configuration)
- [API Key vs Max Subscription](#api-key-vs-max-subscription)
- [Multi-Browser Setup](#multi-browser-setup)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Your Local Machine

| Requirement | How to Check | Install |
|-------------|--------------|---------|
| Chrome, Edge, Brave, or Arc | Browser installed | Download from official site |
| Python 3 | `python3 --version` | macOS: `brew install python3`<br>Linux: `apt install python3` |
| SSH client | `ssh -V` | Pre-installed on macOS/Linux |
| SSH key | `ls ~/.ssh/id_*` | `ssh-keygen -t ed25519` |

### Your Remote Server

| Requirement | How to Check | Install |
|-------------|--------------|---------|
| Node.js 18+ | `node --version` | `curl -fsSL https://deb.nodesource.com/setup_lts.x \| sudo -E bash - && sudo apt install nodejs`<br>Or: `nvm install --lts` |
| npm | `npm --version` | Comes with Node.js |
| SSH access | `ssh user@server` | Contact server admin |

---

## Step 1: Server Setup

SSH to your server and run the automated setup script:

```bash
curl -sL https://raw.githubusercontent.com/genecell/PlanDrop/master/server/setup.sh | bash
```

This script:
1. Checks for Node.js and npm
2. Installs Claude Code globally (`npm install -g @anthropic-ai/claude-code`)
3. Helps you authenticate with `claude login` (for Max subscription) or warns about API key usage
4. Installs `plandrop-watch` and `plandrop-history` to `~/.local/bin/`
5. Adds `~/.local/bin` to your PATH if needed

### Manual Installation (Alternative)

If you prefer manual installation:

```bash
# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Authenticate (opens browser for OAuth)
claude login

# Download and install plandrop-watch
mkdir -p ~/.local/bin
curl -sL https://raw.githubusercontent.com/genecell/PlanDrop/master/native-host/watch.sh -o ~/.local/bin/plandrop-watch
chmod +x ~/.local/bin/plandrop-watch

# Download and install plandrop-history
curl -sL https://raw.githubusercontent.com/genecell/PlanDrop/master/server/plandrop-history -o ~/.local/bin/plandrop-history
chmod +x ~/.local/bin/plandrop-history

# Add to PATH (if not already)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

---

## Step 2: Project Initialization

For each project where you want to use PlanDrop:

```bash
cd /path/to/your/project
plandrop-watch --init
```

This creates the `.plandrop/` directory structure:
```
.plandrop/
├── plans/        # Incoming task requests (JSON)
├── responses/    # Claude Code output (JSONL)
└── completed/    # Processed plans (archived)
```

---

## Step 3: Chrome Extension Installation

### Option A: Chrome Web Store
*(Coming soon)*

### Option B: Load Unpacked (Developer Mode)

1. Clone the repository:
   ```bash
   git clone https://github.com/genecell/PlanDrop.git
   ```

2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`

3. Enable **Developer Mode** (toggle in top right)

4. Click **Load unpacked** → select the `extension/` folder

5. **Copy the Extension ID** — you'll need this for the next step

   The ID is a 32-character string like `abcdefghijklmnopqrstuvwxyzaaaaaa`

---

## Step 4: Native Messaging Host Installation

The native messaging host is a Python script that handles communication between the browser and your SSH connections.

### macOS / Linux

```bash
cd PlanDrop/native-host
./install.sh YOUR_EXTENSION_ID
```

Replace `YOUR_EXTENSION_ID` with the ID you copied in Step 3.

**Example:**
```bash
./install.sh abcdefghijklmnopqrstuvwxyzaaaaaa
```

### Multiple Extension IDs

If using multiple browsers or Chrome profiles, pass all IDs:

```bash
./install.sh chrome_id edge_id brave_id
```

### What the Installer Does

1. Verifies Python 3, ssh, and scp are available
2. Makes `plandrop_host.py` executable
3. Creates a native messaging manifest at:
   - **Chrome (macOS):** `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.plandrop.host.json`
   - **Chrome (Linux):** `~/.config/google-chrome/NativeMessagingHosts/com.plandrop.host.json`
   - Similar paths for Edge, Brave, Chromium

### Uninstalling

```bash
./install.sh --uninstall
```

---

## Step 5: Extension Configuration

1. Click the PlanDrop extension icon to open the side panel
2. Click the **gear icon** (⚙) to open Settings
3. Click **Servers & Projects**

### Add a Server

| Field | Description | Example |
|-------|-------------|---------|
| Name | Friendly display name | "Lab GPU Server" |
| SSH Type | Alias (from ~/.ssh/config) or Direct | Alias |
| SSH Alias | Host name from your SSH config | `labgpu` |
| *or* Host | IP address or hostname | `192.168.1.100` |
| *or* Username | SSH username | `jsmith` |
| *or* SSH Key | Path to private key (optional) | `~/.ssh/id_ed25519` |
| *or* Port | SSH port (default: 22) | `22` |

**Tip:** Using an SSH alias from `~/.ssh/config` is recommended. It's simpler and leverages your existing SSH configuration.

### Add a Project

| Field | Description | Example |
|-------|-------------|---------|
| Name | Friendly display name | "RNA-seq Pipeline" |
| Path | Absolute path on the server | `/home/jsmith/rnaseq` |
| Interactive Mode | Enable Claude Code tab | ✓ Checked |
| Profile | Permission profile | Bioinformatics |
| Model | Claude model | Opus |

**Important:** The path must match where you ran `plandrop-watch --init`.

---

## Step 6: Start the Watcher

On your server, navigate to your project and start the watcher:

```bash
cd /path/to/your/project

# Option 1: Foreground (recommended with tmux)
tmux new -s plandrop
plandrop-watch

# Option 2: Background
plandrop-watch --daemon
```

### Watcher Commands

| Command | Description |
|---------|-------------|
| `plandrop-watch` | Start watching in foreground |
| `plandrop-watch --init` | Initialize .plandrop/ directory |
| `plandrop-watch --daemon` | Start in background |
| `plandrop-watch --stop` | Stop background watcher |
| `plandrop-watch --status` | Check if watcher is running |
| `plandrop-watch --model sonnet` | Use Sonnet model instead of Opus |

### Using tmux (Recommended)

```bash
# Start a new tmux session
tmux new -s plandrop

# Start the watcher
cd ~/your-project
plandrop-watch

# Detach: Ctrl+B, then D
# Reattach later: tmux attach -t plandrop
```

---

## Verifying the Setup

1. **Check watcher status on server:**
   ```bash
   plandrop-watch --status
   # ✓ Watcher running (PID: 12345, heartbeat: 2024-01-15T10:30:00Z)
   ```

2. **Check connection in browser:**
   - Open PlanDrop side panel
   - Select your server and project
   - Look for green status dot (●)
   - Status should say "Connected"

3. **Send a test task:**
   - Type "List the files in the current directory" in the message input
   - Click Send
   - Claude Code should respond in the activity feed

---

## Permission Profiles

PlanDrop uses a **deny-list approach** with Claude Code's `--disallowedTools` CLI flag for hard security boundaries. This provides better security than allow-lists because blocked commands cannot be bypassed by prompt injection.

### Profile Summary

| Profile | Shell Access | Blocked Commands | Best For |
|---------|--------------|------------------|----------|
| 📋 Plan Only | None | N/A | Code review, analysis |
| 📝 Edit Files Only | None | All Bash | Safe file editing |
| ⚡ Standard | Yes | Dangerous commands | General development |
| 🔓 Full Access | Yes | None | Sandboxed environments |
| ⚙️ Custom | Yes | User-defined | Specialized workflows |

### 📋 Plan Only

- **Permission mode:** `plan`
- **Capabilities:** Read files, analyze code, suggest changes
- **Cannot:** Write files, run any commands
- **Use for:** Code review, getting suggestions without any execution risk

### 📝 Edit Files Only

- **Permission mode:** `bypassPermissions`
- **Blocked tools:** `Bash` (all shell commands)
- **Capabilities:** Read, Write, Edit, Glob, Grep
- **Cannot:** Run any shell commands
- **Use for:** Safe file modifications without command execution risk

### ⚡ Standard (Default)

- **Permission mode:** `bypassPermissions`
- **Blocked commands:**
  - **Privilege escalation:** `sudo`, `su`, `pkexec`
  - **System control:** `shutdown`, `reboot`, `halt`, `poweroff`, `init 0/6`
  - **Destructive operations:** `mkfs`, `dd if=`, `rm -rf /`, `rm -rf /*`
  - **Dangerous modifications:** `chmod -R 777`, `killall`, `crontab`
- **Allowed:** All other commands (git, npm, python, docker, etc.)
- **Use for:** Most development tasks with reasonable safety

### 🔓 Full Access

- **Permission mode:** `bypassPermissions`
- **Blocked commands:** None
- **Requires:** Confirmation dialog before enabling
- **Use for:** Sandboxed or disposable environments only

> ⚠️ **Warning:** Full Access allows Claude to run any command, including `sudo`, `rm -rf`, and system modifications. Only use in environments where damage is acceptable.

### ⚙️ Custom

- **Permission mode:** `bypassPermissions`
- **Blocked commands:** User-defined deny list
- **Templates available:**
  - **Standard:** Same blocks as Standard profile
  - **Restrictive:** Standard + network (ssh, scp, rsync) + containers (docker) + package managers
  - **Minimal:** Block all Bash commands
  - **Empty:** No blocks (same as Full Access)

**Creating a custom profile:**
1. Select "Custom" from the profile dropdown
2. Choose a starting template
3. Edit the blocked commands list (one per line)
4. Use patterns like `Bash(sudo:*)` or just `Bash` to block all shell

**Example custom deny list:**
```
Bash(sudo:*)
Bash(rm -rf:*)
Bash(docker:*)
Bash(kubectl:*)
```

---

## SSH Configuration

PlanDrop uses your existing SSH configuration. Recommended setup in `~/.ssh/config`:

```ssh-config
Host labgpu
    HostName 192.168.1.100
    User jsmith
    IdentityFile ~/.ssh/id_ed25519
    # Connection reuse (highly recommended):
    ControlMaster auto
    ControlPath /tmp/ssh-%r@%h:%p
    ControlPersist 60
```

### Why ControlMaster Matters

PlanDrop polls your server every 3 seconds to check for responses. Without ControlMaster:
- Each poll creates a new SSH connection
- Each connection takes 1-3 seconds to establish
- Significant latency and overhead

With ControlMaster:
- First connection establishes a control socket
- Subsequent connections reuse the socket
- Near-instant response (milliseconds)

### Verify SSH Works

```bash
# Must work without password prompt
ssh labgpu "echo connected"
```

If prompted for a password:
```bash
# Copy your key to the server
ssh-copy-id labgpu
```

---

## API Key vs Max Subscription

Claude Code can use either:
1. **Max Subscription** (free, requires `claude login`)
2. **API Key** (pay-per-token, uses `ANTHROPIC_API_KEY`)

### Using Max Subscription (Recommended)

```bash
# On your server
claude login
# Opens browser for OAuth authentication
```

### Checking for API Key

If `ANTHROPIC_API_KEY` is set in your environment, Claude Code will use it instead of your Max subscription.

The watcher warns you on startup:
```
⚠️  WARNING: ANTHROPIC_API_KEY is set in your environment
   Claude Code will use your API key (costs money per token)
```

### Removing API Key

```bash
# Current session
unset ANTHROPIC_API_KEY

# Permanent (check all these files)
# ~/.bashrc
# ~/.zshrc
# ~/.profile
# conda activate scripts: ~/miniconda3/envs/*/etc/conda/activate.d/
```

---

## Multi-Browser Setup

PlanDrop supports Chrome, Edge, Brave, Arc, and other Chromium-based browsers.

### Installing on Multiple Browsers

Each browser has its own extension ID. Pass all IDs to the installer:

```bash
./install.sh chrome_id edge_id brave_id
```

### Native Messaging Host Paths

| Browser | macOS | Linux |
|---------|-------|-------|
| Chrome | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` | `~/.config/google-chrome/NativeMessagingHosts/` |
| Chromium | `~/Library/Application Support/Chromium/NativeMessagingHosts/` | `~/.config/chromium/NativeMessagingHosts/` |
| Brave | `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/` | `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/` |
| Edge | `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/` | `~/.config/microsoft-edge/NativeMessagingHosts/` |

---

## Troubleshooting

### Extension Issues

**"Native host not found" error**
- Re-run installer: `./install.sh YOUR_EXTENSION_ID`
- Verify extension ID matches (check chrome://extensions)
- Restart browser after installation

**Side panel won't open**
- Refresh extension (chrome://extensions → click reload icon)
- Make sure side panel is enabled (check extension permissions)

### Connection Issues

**Red status dot / "Not connected"**
- Check watcher is running: `plandrop-watch --status`
- Verify SSH works: `ssh your-alias "echo ok"`
- Check project path matches

**"Test Connection" fails**
- SSH key not added: `ssh-add ~/.ssh/id_ed25519`
- On macOS: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`
- Wrong SSH alias/host configuration

### Watcher Issues

**"Watcher not running"**
```bash
# Check if running
ps aux | grep plandrop-watch

# Start manually
cd /your/project
plandrop-watch
```

**"Credit balance is too low"**
- ANTHROPIC_API_KEY is set → use `unset ANTHROPIC_API_KEY`
- Or authenticate with Max: `claude login`

**Watcher stuck / not responding**
```bash
# Check logs
tail -f .plandrop/watch.log

# Stop and restart
plandrop-watch --stop
plandrop-watch
```

### Log Files

| Location | Purpose |
|----------|---------|
| `~/.plandrop/relay.log` | Native host logs (local machine) |
| `.plandrop/watch.log` | Watcher logs (server, if using --daemon) |
| `.plandrop/heartbeat` | Watcher heartbeat timestamp |
| `.plandrop/session_id` | Current Claude Code session ID |

---

## Quick Reference

### Server Commands
```bash
# Setup (one-time)
curl -sL https://raw.githubusercontent.com/genecell/PlanDrop/master/server/setup.sh | bash

# Initialize project (one-time per project)
cd /your/project && plandrop-watch --init

# Start watcher
plandrop-watch                    # Foreground
plandrop-watch --daemon           # Background
plandrop-watch --model sonnet     # Use Sonnet model

# Manage watcher
plandrop-watch --status           # Check status
plandrop-watch --stop             # Stop background watcher

# Export history
plandrop-history                  # Concise summary
plandrop-history --full           # With file contents
```

### Local Commands
```bash
# Install native host
cd PlanDrop/native-host
./install.sh YOUR_EXTENSION_ID

# Uninstall
./install.sh --uninstall
```

### Extension Workflow
1. Open side panel (click extension icon)
2. Select server and project
3. Green dot = watcher running
4. Type task → Send
5. Review Claude's plan
6. Click Execute, Revise, or Cancel
7. Continue in Session or New Task

---

## Support

- **GitHub Issues:** [github.com/genecell/PlanDrop/issues](https://github.com/genecell/PlanDrop/issues)
- **Documentation:** [plandrop.hiniki.com](https://plandrop.hiniki.com)
