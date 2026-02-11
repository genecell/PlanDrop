# PlanDrop

**A structured plan-review-execute workflow for AI coding agents on remote servers, directly in your browser side panel.**

If you work on remote servers (HPC clusters, GPU nodes, cloud VMs), using AI coding assistants means constantly switching between ChatGPT and SSH terminals. You describe your analysis, copy the code, paste it into the terminal, hit an error, copy the error back. Prompts vanish from your terminal history. There is no structured record of what you asked or what the agent did. You have no control over execution.

PlanDrop fixes this with a minimalist file-queue architecture. No extra servers, no databases, no WebSockets. The Chrome extension uses native messaging to talk to a local Python script. That script uses your existing SSH config (ControlMaster for speed) to push/pull JSON files to a `.plandrop/` directory on your remote server. A simple `watch.sh` script on the server polls for plan files and runs the agent (Claude Code CLI).

## What Makes It Different

- **Enforced oversight**: The agent cannot execute code without you first reviewing a read-only plan and clicking "Execute" in the browser. This is enforced by architecture, not by prompting.
- **Zero infrastructure**: If you have SSH access, you can use it. Data never touches third-party servers.
- **Reproducibility**: Every prompt and response is saved as a file you can commit to Git. Full audit trail.
- **Built for remote scientific computing**: Computational biologists on HPC clusters, ML engineers on GPU servers, anyone working on sensitive remote infrastructure.

## Table of Contents

- [What It Does](#what-it-does)
- [Quick Start](#quick-start)
- [Why PlanDrop?](#why-plandrop)
- [Features](#features)
- [How It Works](#how-it-works)
- [Who Is This For?](#who-is-this-for)
- [Installation](#installation)
- [Usage: Claude Code (Interactive)](#usage-claude-code-interactive)
- [Usage: Quick Drop](#usage-quick-drop)
- [Permission Profiles](#permission-profiles)
- [SSH Setup](#ssh-setup)
- [Security and Privacy](#security-and-privacy)
- [API Key vs Subscription Login](#api-key-vs-subscription-login)
- [Browser Support](#browser-support)
- [Multi-Profile Setup](#multi-profile-setup)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [License](#license)
- [Contributing](#contributing)

---

## What It Does

PlanDrop bridges browser-based AI tools and terminal-based Claude Code sessions. Two modes:

**Claude Code (Interactive)**
Full plan-review-execute workflow:
1. Type a task in the side panel
2. Claude Code creates a plan (read-only, no file changes)
3. Review the plan in the activity feed
4. Click "Execute" to run it, or "Revise" to adjust
5. See results, costs, and blocked actions in real-time

**Quick Drop**
Select text or write markdown in the editor, send as a file to your server's project folder. Claude Code picks it up.

---

## Quick Start

### Prerequisites

**Your computer:**
- Chrome (or Edge/Brave/Arc)
- Python 3
- SSH key access to your server

**Your server:**
- Node.js 18+
- SSH access

### Step 1: Server Setup (one-time)

SSH to your server and run:

```bash
# Install Claude Code (requires Node.js)
npm install -g @anthropic-ai/claude-code

# Login with your Anthropic subscription
claude login

# Note: if ANTHROPIC_API_KEY is set in your environment,
# Claude Code will use it instead of your subscription login.
# To use your subscription, unset it: unset ANTHROPIC_API_KEY

# Or use the automated setup script:
curl -sL https://raw.githubusercontent.com/genecell/PlanDrop/master/server/setup.sh | bash

# Reload your shell to make plandrop-watch available
source ~/.bashrc
```

### Step 2: Initialize Your Project (per project)

```bash
cd /path/to/your/project
plandrop-watch --init      # Create .plandrop/ directory
plandrop-watch             # Start watching (foreground, use in tmux)
# or: plandrop-watch --daemon   # Start in background
```

### Step 3: Install Chrome Extension (one-time)

**Option A: Chrome Web Store** (when available)
[Install PlanDrop](link)

**Option B: Manual**
1. Clone this repo: `git clone https://github.com/genecell/PlanDrop.git`
2. Open `chrome://extensions`
3. Enable "Developer Mode"
4. Click "Load unpacked" and select the `extension/` folder
5. Note the Extension ID shown

### Step 4: Install Native Messaging Host (one-time)

```bash
cd native-host
./install.sh YOUR_EXTENSION_ID
```

### Step 5: Configure

1. Click PlanDrop icon and open Settings (gear icon)
2. Add Server:
   - **Name**: `myserver`
   - **SSH Target**: `myserver` (must match your `~/.ssh/config` Host name)
3. Add Project:
   - **Name**: `my-project`
   - **Path**: `/path/to/your/project` (same path from Step 2)
4. Enable "Interactive Mode" and set a permission profile

### Step 6: Use It!

1. Open PlanDrop side panel (click extension icon)
2. Select your server and project
3. Green dot = watcher is running
4. Type a task and click Send
5. Review Claude Code's plan
6. Click Execute, Revise, or Cancel

For the complete setup guide with troubleshooting, SSH config examples for HPC clusters and cloud VMs, and advanced configuration, see [docs/setup_instructions.md](docs/setup_instructions.md).

---

## Why PlanDrop?

### Enforced human oversight

The agent cannot execute without your approval. This is structural, not a prompt instruction that can be ignored.

### Interrupt anytime

Realized you sent the wrong prompt? Click Stop to kill the running task immediately.

### Zero infrastructure

No WebSocket servers, no databases, no cloud services. Just SSH, files, and a bash script.

### Reproducibility and audit trail

Every prompt saved as markdown, every response saved as JSONL. Git-trackable.

### Eliminate file transfer friction

Instead of: SSH, navigate to project, create file, paste, save

Just: Click PlanDrop, select project, send

### Prompts as persistent files

Every prompt you send is saved as a `.md` file on the server:
- **Natural backup**: Never lose a prompt again
- **Re-readable**: Review what you sent days or weeks later
- **Re-sendable**: Update and resend without retyping
- **Git-trackable**: Commit your prompts alongside your code
- **Debuggable**: When something goes wrong, see exactly what you asked for

### Multi-project routing

Running Claude Code on three different projects across two servers? PlanDrop remembers your servers and projects. Pick from a dropdown, click send. No more SSH juggling.

---

## Features

### Claude Code (Interactive)

- Plan, review, execute workflow with full human oversight
- Real-time activity feed (Claude's reasoning, file edits, bash commands, costs)
- Permission profiles (Plan Only, Edit Files Only, Standard, Full Access, Custom)
- Session continuity across tasks (Claude Code `--resume`)
- Interrupt/Stop running tasks
- Multi-server, multi-project dashboard
- Browser notifications on task completion
- Cost and duration tracking per task

### Quick Drop

- Markdown editor with live preview (Edit/Split/Preview modes)
- Send markdown files directly to any project via SCP
- Custom filenames, file collision detection
- Clipboard auto-fill, draft auto-save

### General

- Multi-server, multi-project configuration
- Settings import/export (JSON)
- Right-click context menu: "Send selection to PlanDrop"
- Cross-platform: macOS, Linux, Windows
- Works with Chrome, Edge, Brave, Arc

---

## How It Works

```
Browser (Chrome Side Panel)
    | Native Messaging (stdin/stdout)
Local Machine (plandrop_host.py)
    | SSH / SCP (reuses ControlMaster socket)
Remote Server (.plandrop/ directory)
    | watch.sh polls for plans
Claude Code CLI (plan -> execute)
    | JSONL response
Back to Browser (activity feed)
```

No WebSocket servers, no databases, no cloud services in between. Uses your existing SSH config. The `.plandrop/` directory is the entire communication layer.

---

## Who Is This For?

Developers running AI coding agents on remote machines:

- **ML engineers**: GPU servers, training clusters
- **Bioinformaticians**: HPC nodes, shared compute
- **DevOps/SREs**: Cloud VMs, containers
- **Anyone with a remote dev setup**: Lab servers, cloud instances

If you SSH into a machine to run Claude Code, Aider, Cursor, or similar tools, PlanDrop saves you time.

---

## Installation

### Extension Setup

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked** and select the `extension/` folder
4. Note the **Extension ID** shown on the card

### Native Host Setup

The native messaging host is a Python script that handles SSH communication.

**macOS / Linux:**
```bash
cd native-host
chmod +x install.sh
./install.sh <your-extension-id>
```

**Windows (PowerShell):**
```powershell
cd native-host
.\install.ps1 <your-extension-id>
```

### Server Configuration

1. Click the PlanDrop icon and open Settings (gear icon)
2. Add a server with SSH target (e.g., `labgpu` or `user@host`)
3. Add projects with remote paths (e.g., `/home/user/myproject`)
4. For Interactive Mode, enable "Interactive Mode" on the project

---

## Usage: Claude Code (Interactive)

Interactive mode adds a Chrome side panel for bidirectional communication with Claude Code. Instead of just sending files, you can:

- **Plan first, execute after**: Claude analyzes your request and proposes an approach. You review, revise if needed, then approve execution
- **Real-time progress**: See what Claude is doing as it happens: files created, commands run, errors encountered
- **Permission profiles**: Control what Claude can do: Plan Only, Edit Files Only, Standard, Full Access, or custom
- **Dynamic tool approval**: If Claude needs to run a blocked command, approve it from the browser and continue

### Plan-Review-Execute Workflow

1. **Plan Phase**: Send your request. Claude reads your codebase and proposes an implementation plan
2. **Review**: Read Claude's plan. Click Revise to request changes, or Execute to proceed
3. **Execute Phase**: Claude implements the plan. Blocked commands appear for approval
4. **Complete**: See results, costs, and start a new plan

### Setting Up Interactive Mode

1. **In PlanDrop Settings**, enable Interactive Mode for a project and select a permission profile

2. **Initialize the queue on your server**:
   - In the side panel, click "Setup Queue" to create the `.plandrop/` folder structure

3. **Start the watcher on your server**:
   ```bash
   cd ~/projects/your-project
   # Start in tmux (recommended):
   tmux new -s plandrop
   # If using conda:
   conda activate your-env
   plandrop-watch
   ```

   Or run in background:
   ```bash
   plandrop-watch --daemon
   ```

4. **Open the side panel**: Click the extension icon or use Chrome's side panel menu

5. **Send a plan**: The side panel shows Claude's response in real-time. Click Execute when ready.

### Dashboard View

When you have multiple projects with Interactive Mode enabled, the side panel shows a dashboard:
- See all interactive projects at a glance
- Green/red status indicators for each project's watcher
- Click to open a specific project
- Per-tab project binding: different browser tabs can be linked to different projects

### Session Management

- **Session continuity**: Claude remembers context across multiple tasks in the same session
- **Continue in Session**: After a task completes, send follow-up requests without losing context
- **New Task**: Clear the activity feed but keep the session
- **Reset**: Start a completely fresh session (clears Claude's memory)

---

## Usage: Quick Drop

### Example Workflow

#### Step 1: Plan in the browser

Use Claude.ai, ChatGPT, or any AI assistant to develop your implementation plan:

```markdown
# Add User Authentication

## Phase 1: Database
- Add users table (email, password_hash, created_at)
- Add sessions table for refresh tokens

## Phase 2: API
- POST /auth/register
- POST /auth/login
- POST /auth/logout

## Phase 3: Middleware
- JWT validation
- Rate limiting
```

#### Step 2: Send via PlanDrop

1. Copy the plan (`Ctrl+C`)
2. Click the PlanDrop extension icon
3. Plan auto-fills from clipboard, review/edit if needed
4. Select target: **Lab GPU Server > ml-training**
5. Click **Send File**

File saved: `~/projects/ml-training/plan.md`

#### Step 3: Execute on server

```bash
$ ssh labgpu
$ cd ~/projects/ml-training
$ claude

> read plan.md and implement step by step, testing each phase
```

Your AI coding agent reads the plan and implements autonomously.

---

## Permission Profiles

Control what Claude Code can do on your server:

| Profile | Description | What Claude Can Do |
|---------|-------------|-------------------|
| Plan Only | Read-only analysis | Read files, suggest changes, no execution |
| Edit Files Only | File modifications only | Read + write files, no shell commands |
| Standard | General development | Everything except dangerous commands (sudo, rm -rf /, etc.) |
| Full Access | No restrictions | Everything (use with caution, sandboxed environments only) |
| Custom | User-defined | Create your own deny list |

Create **custom profiles** in Settings to add or block specific commands based on your needs.

---

## SSH Setup

PlanDrop uses your `~/.ssh/config` to connect to servers. Recommended setup:

```bash
# Generate a key if you don't have one
ssh-keygen -t ed25519

# Copy it to your server
ssh-copy-id user@192.168.1.100
```

Then add to `~/.ssh/config`:

```ssh-config
Host myserver
    HostName 192.168.1.100
    User your-username
    IdentityFile ~/.ssh/id_ed25519
    # Recommended for PlanDrop (connection reuse):
    ControlMaster auto
    ControlPath /tmp/ssh-%r@%h:%p
    ControlPersist 60
```

The `Host` name (e.g., `myserver`) is what you enter as "SSH Target" in PlanDrop settings.

**Important**: Passwordless SSH must work. Test with:
```bash
ssh myserver "echo connected"
```

If prompted for a password, set up SSH keys:
```bash
ssh-copy-id myserver
```

The ControlMaster settings enable SSH connection reuse, making PlanDrop's polling much faster after the first connection.

---

## Security and Privacy

### Claude Code (Interactive)

- **Controlled read access**: Can read from `.plandrop/responses/` (Claude's output) and `.plandrop/heartbeat` (watcher status). Cannot read arbitrary files on your server
- **Controlled write access**: Writes to `.plandrop/plans/` (your requests) and `.claude/settings.json` (permission rules). Cannot write to arbitrary locations
- **Permission profiles**: You control exactly which commands Claude Code can run via deny lists

### Quick Drop

- **Write-only**: PlanDrop can send files to your server and check if a file already exists at the destination path (for collision detection). It cannot read arbitrary file contents, list directories, or download files from your server

### Both Modes

- **No third-party servers**: All data flows directly from your browser to local native host to your server via SSH
- **No analytics or telemetry**: Zero external network requests
- **SSH keys stay with your OS**: The extension never sees or accesses your SSH credentials. The native host uses your existing SSH agent
- **Sandboxed extension**: Chrome's native messaging protocol means the extension cannot access your filesystem or run commands directly. Only the native host (which you install and control) has SSH access
- **Input validation**: All paths and parameters are validated to prevent command injection attacks
- **Open source**: Full source code available for audit

---

## API Key vs Subscription Login

Claude Code uses your Anthropic subscription login by default (via `claude login`). However, if `ANTHROPIC_API_KEY` is set in your environment, Claude Code will use that instead, which costs money per token.

**To use your subscription login:**
```bash
unset ANTHROPIC_API_KEY
# Check it's gone:
env | grep ANTHROPIC
# Remove from ~/.bashrc, ~/.zshrc, or conda activate scripts permanently
```

watch.sh will warn you on startup if an API key is detected. The side panel will also show a warning if Claude Code reports using an API key.

---

## Browser Support

| Browser | Status |
|---------|--------|
| Chrome | Fully supported |
| Edge | Supported (Chromium-based) |
| Brave | Supported (Chromium-based) |
| Arc | Supported (Chromium-based) |
| Firefox | Not supported (different extension API) |
| Safari | Not supported (requires native Xcode wrapper) |

### Installing on Edge

1. Go to `edge://extensions/`
2. Enable **Developer mode** (toggle in left sidebar)
3. Click **Load unpacked** and select the `extension/` folder
4. Note the **Extension ID**
5. Run: `./install.sh <edge-extension-id>` (or add to existing IDs)

### Installing on Brave

1. Go to `brave://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked** and select the `extension/` folder
4. Note the **Extension ID**
5. Run: `./install.sh <brave-extension-id>` (or add to existing IDs)

### Installing on Arc

Arc uses Chrome's extension system. Follow the Chrome instructions but access extensions via Arc's settings menu.

### Using multiple browsers

Each browser gets its own Extension ID. Pass all IDs to the installer:

```bash
# macOS / Linux
./install.sh <chrome-id> <edge-id> <brave-id>

# Windows
.\install.ps1 <chrome-id> <edge-id> <brave-id>
```

---

## Multi-Profile Setup

If you use multiple Chrome profiles:

**Option A: Chrome Web Store (recommended)**

Publish as Unlisted ($5 one-time fee) and get one fixed Extension ID across all profiles. Install native host once.

**Option B: Self-distribute**

Each profile gets a different Extension ID. Collect all IDs and pass them to the installer:

```bash
./install.sh <profile1-id> <profile2-id> <profile3-id>
```

To avoid re-configuring servers in each profile, use Import/Export in Settings:

1. Configure everything in one profile
2. Settings > Export Settings > save JSON
3. In other profiles: Settings > Import Settings > load the same JSON

---

## Updating

```bash
cd ~/PlanDrop
git pull

# Extension: go to chrome://extensions/ and click the reload icon on PlanDrop
# Native host: automatically picks up the updated script
# Only re-run install.sh if instructed by release notes
```

---

## Troubleshooting

### General Issues

**"Send" button stays disabled**
- Must select both a server AND a project
- Add projects in Settings (gear icon)

**"Connection failed" on Test Connection**
- Verify SSH works manually: `ssh your-alias "echo ok"`
- Check that your SSH key is added: `ssh-add -l`
- On macOS, you may need to add to keychain: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`

**Extension can't connect to native host**
- Re-run the installer: `./install.sh <extension-id>` (macOS/Linux) or `.\install.ps1 <extension-id>` (Windows)
- Verify the Extension ID matches (check your browser's extensions page)
- Check log file: `~/.plandrop/relay.log` (macOS/Linux) or `%USERPROFILE%\.plandrop\relay.log` (Windows)
- Make sure the host script is executable: `chmod +x native-host/plandrop_host.py`

**Python not found**
- **macOS**: Python 3 is pre-installed on macOS 12.3+. If missing: `brew install python3`
- **Linux**: `sudo apt install python3` or `sudo yum install python3`
- **Windows**: Install from python.org and ensure it's in PATH

### Claude Code Mode Issues

**"Watcher not running" / Red dot**
- SSH to your server and check: `ps aux | grep plandrop-watch`
- Restart: `plandrop-watch`
- Make sure you're in the right project directory

**"Credit balance is too low"**
- You have ANTHROPIC_API_KEY set. Unset it to use your subscription login (see [API Key vs Subscription Login](#api-key-vs-subscription-login))

**"Connection error" / Timeouts**
- First SSH connection takes 3-5 seconds (ControlMaster establishes socket)
- Subsequent calls reuse the connection and are fast
- Check SSH config: `ssh your-server` should work without password prompt

**Side panel shows old activity**
- Activity persists per project. Click "New Task" to start fresh
- Click "Reset" to clear the session entirely

**Spinner stuck on "Executing..."**
- Check if watch.sh is still running on server
- Look at `.plandrop/responses/` for the response file
- Check watch.sh logs: `tail -f .plandrop/watch.log`

---

## Roadmap

**Planned:**
- Chrome Web Store release
- Dark mode
- Template system for common prompts
- MCP server integration
- Multi-agent orchestration across servers
- Streaming responses

---

## License

BSD-3-Clause

---

## Contributing

[https://github.com/genecell/PlanDrop](https://github.com/genecell/PlanDrop)

Issues and PRs welcome.
