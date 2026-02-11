#!/bin/bash
# watch.sh - PlanDrop V2 orchestrator (also installed as plandrop-watch)
# Watches plans/ for new files and feeds them to Claude Code
#
# Usage:
#   plandrop-watch                    (start watching in foreground)
#   plandrop-watch --init             (initialize .plandrop/ in current directory)
#   plandrop-watch --daemon           (start in background)
#   plandrop-watch --stop             (stop background watcher)
#   plandrop-watch --status           (check watcher status)
#   plandrop-watch --model sonnet     (use sonnet model)
#
# Run in tmux (recommended):
#   tmux new -s plandrop
#   cd ~/projects/myproject
#   plandrop-watch

set -euo pipefail

# ---- Help ----
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "PlanDrop Watcher - watches for plans and runs Claude Code"
  echo ""
  echo "Usage: plandrop-watch [option]"
  echo ""
  echo "Options:"
  echo "  (none)          Start watching in foreground (use in tmux)"
  echo "  --init          Initialize .plandrop/ in current directory"
  echo "  --daemon        Start watching in background"
  echo "  --stop          Stop background watcher"
  echo "  --status        Check watcher status"
  echo "  --model MODEL   Use specified model (opus, sonnet)"
  echo "  --help          Show this help"
  echo ""
  echo "First time setup:"
  echo "  cd /your/project"
  echo "  plandrop-watch --init"
  echo "  plandrop-watch"
  echo ""
  exit 0
fi

# ---- Init ----
if [ "${1:-}" = "--init" ]; then
  echo "Initializing PlanDrop in $(pwd)..."
  mkdir -p .plandrop/plans .plandrop/responses .plandrop/completed
  echo "✓ Created .plandrop/plans/"
  echo "✓ Created .plandrop/responses/"
  echo "✓ Created .plandrop/completed/"

  # Copy history.py fallback if plandrop-history is installed
  if command -v plandrop-history &> /dev/null; then
    cp "$(which plandrop-history)" .plandrop/history.py 2>/dev/null || true
    echo "✓ Copied history.py fallback"
  fi

  echo ""
  echo "Ready! Run 'plandrop-watch' to start."
  exit 0
fi

# Determine .plandrop directory location
# If running from within .plandrop, use that; otherwise use .plandrop in current dir
if [ "$(basename "$(dirname "$0")")" = ".plandrop" ]; then
  PLANDROP_DIR="$(cd "$(dirname "$0")" && pwd)"
elif [ -d ".plandrop" ]; then
  PLANDROP_DIR="$(pwd)/.plandrop"
else
  echo "Error: .plandrop directory not found"
  echo "Run 'plandrop-watch --init' first to initialize."
  exit 1
fi

PLANS="$PLANDROP_DIR/plans"
RESPONSES="$PLANDROP_DIR/responses"
COMPLETED="$PLANDROP_DIR/completed"
SESSION_FILE="$PLANDROP_DIR/session_id"
HEARTBEAT_FILE="$PLANDROP_DIR/heartbeat"
PID_FILE="$PLANDROP_DIR/watcher.pid"
SETTINGS_DIR="$(dirname "$PLANDROP_DIR")/.claude"

# ---- Status ----
if [ "${1:-}" = "--status" ]; then
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      HEARTBEAT=$(cat "$HEARTBEAT_FILE" 2>/dev/null || echo "unknown")
      echo "✓ Watcher running (PID: $PID, heartbeat: $HEARTBEAT)"
    else
      echo "✗ Watcher not running (stale PID file)"
    fi
  elif [ -f "$HEARTBEAT_FILE" ]; then
    HEARTBEAT=$(cat "$HEARTBEAT_FILE")
    echo "? Heartbeat found ($HEARTBEAT) but no PID file"
    echo "  Watcher may be running in another terminal"
  else
    echo "✗ Watcher not running"
    echo "  Run: plandrop-watch"
  fi
  exit 0
fi

# ---- Stop ----
if [ "${1:-}" = "--stop" ]; then
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      rm -f "$PID_FILE"
      echo "✓ Watcher stopped (PID: $PID)"
    else
      echo "Watcher not running (stale PID file)"
      rm -f "$PID_FILE"
    fi
  else
    echo "No PID file found. Check: ps aux | grep plandrop-watch"
  fi
  exit 0
fi

# ---- Daemon ----
if [ "${1:-}" = "--daemon" ]; then
  echo "Starting PlanDrop watcher in background..."
  nohup "$0" "${@:2}" > "$PLANDROP_DIR/watch.log" 2>&1 &
  PID=$!
  echo $PID > "$PID_FILE"
  echo "✓ Watcher started (PID: $PID)"
  echo "  Log: $PLANDROP_DIR/watch.log"
  echo "  Stop: plandrop-watch --stop"
  exit 0
fi

# Parse remaining arguments
DEFAULT_MODEL="opus"
while [[ $# -gt 0 ]]; do
  case $1 in
    --model)
      DEFAULT_MODEL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: plandrop-watch [--help | --init | --daemon | --stop | --status | --model MODEL]"
      exit 1
      ;;
  esac
done

# Write PID for detection
echo $$ > "$PID_FILE"

# Clean up on exit
cleanup() {
  rm -f "$PID_FILE"
  echo "[$(date)] PlanDrop watcher stopped"
}
trap cleanup EXIT INT TERM

# Auto-cleanup completed files older than 7 days
cleanup_old_files() {
  find "$COMPLETED" -name "*.json" -mtime +7 -delete 2>/dev/null || true
  find "$COMPLETED" -name "*.jsonl" -mtime +7 -delete 2>/dev/null || true
  find "$RESPONSES" -name "*.jsonl" -mtime +7 -delete 2>/dev/null || true
}

echo "[$(date)] PlanDrop watcher started in $PLANDROP_DIR"
echo "[$(date)] Model: $DEFAULT_MODEL"
echo "[$(date)] Watching for plans in: $PLANS"

# Check for API key vs OAuth login
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  KEY_LAST4="${ANTHROPIC_API_KEY: -4}"
  echo ""
  echo "⚠️  WARNING: ANTHROPIC_API_KEY is set in your environment"
  echo "   Claude Code will use your API key (costs money per token)"
  echo "   If you have a Claude Max subscription, unset it to use Max instead:"
  echo ""
  echo "   unset ANTHROPIC_API_KEY"
  echo ""
  echo "   To remove permanently, check these files:"
  echo "   ~/.bashrc  ~/.zshrc  ~/.profile"
  echo "   conda activate scripts: ~/miniconda3/envs/*/etc/conda/activate.d/"
  echo ""
  echo "   Current key: sk-ant-...${KEY_LAST4} (last 4 chars shown)"
  echo ""
  read -p "   Press Enter to continue with API key, or Ctrl+C to stop and fix... "
  echo ""
else
  echo "[$(date)] ✓ Using Claude login (Max subscription)"
fi

# Clean up any stale interrupt file from previous runs
rm -f "$PLANDROP_DIR/interrupt"
rm -f "$PLANDROP_DIR/current_task.pid"

while true; do
  # Update heartbeat
  date -u +%Y-%m-%dT%H:%M:%SZ > "$HEARTBEAT_FILE"

  # Periodic cleanup (check every loop, find handles the age filter)
  cleanup_old_files

  # Process any .json files in plans/
  for f in "$PLANS"/*.json; do
    [ -f "$f" ] || continue

    # Parse plan JSON using jq
    PLAN_ID=$(jq -r '.id' "$f")
    ACTION=$(jq -r '.action // "plan"' "$f")
    CONTENT=$(jq -r '.content' "$f")
    PERM_MODE=$(jq -r '.permission_mode // "plan"' "$f")
    MODEL=$(jq -r '.model // "'"$DEFAULT_MODEL"'"' "$f")
    NEW_TOOLS=$(jq -r '.new_allowed_tools // empty' "$f")
    DISALLOWED_TOOLS=$(jq -r '.disallowed_tools // empty' "$f")

    # Validate permission mode
    case "$PERM_MODE" in
      plan|bypassPermissions|acceptEdits)
        ;; # valid
      *)
        echo "[$(date)] WARNING: Unknown permission mode '$PERM_MODE', defaulting to plan"
        PERM_MODE="plan"
        ;;
    esac

    echo "[$(date)] Processing: $PLAN_ID (action=$ACTION, mode=$PERM_MODE, model=$MODEL)"
    if [ -n "$DISALLOWED_TOOLS" ] && [ "$DISALLOWED_TOOLS" != "null" ]; then
      echo "[$(date)] Disallowed tools: $DISALLOWED_TOOLS"
    fi

    # If new tools need to be added to settings.json
    if [ -n "$NEW_TOOLS" ] && [ "$NEW_TOOLS" != "null" ]; then
      echo "[$(date)] Adding new allowed tools to settings.json"
      if [ -f "$SETTINGS_DIR/settings.json" ]; then
        # Add each tool to the allow list
        TMP_SETTINGS=$(mktemp)
        cp "$SETTINGS_DIR/settings.json" "$TMP_SETTINGS"
        echo "$NEW_TOOLS" | jq -r '.[]' 2>/dev/null | while read -r tool; do
          if [ -n "$tool" ]; then
            jq --arg t "$tool" '.permissions.allow += [$t] | .permissions.allow |= unique' \
              "$TMP_SETTINGS" > "$TMP_SETTINGS.new"
            mv "$TMP_SETTINGS.new" "$TMP_SETTINGS"
          fi
        done
        mv "$TMP_SETTINGS" "$SETTINGS_DIR/settings.json"
        echo "[$(date)] Updated settings.json with new tools"
      fi
    fi

    # Check for existing session to resume
    SID=""
    if [ -f "$SESSION_FILE" ]; then
      SID=$(cat "$SESSION_FILE")
      if [ -n "$SID" ]; then
        echo "[$(date)] Resuming session: $SID"
      fi
    fi

    RESPONSE_FILE="$RESPONSES/${PLAN_ID}.jsonl"

    # Build claude command using array (safer than string concatenation)
    CMD=(claude -p)
    if [ -n "$SID" ]; then
      CMD+=(--resume "$SID")
    fi
    CMD+=(--model "$MODEL")
    CMD+=(--permission-mode "$PERM_MODE")
    if [ -n "$DISALLOWED_TOOLS" ] && [ "$DISALLOWED_TOOLS" != "null" ]; then
      CMD+=(--disallowedTools "$DISALLOWED_TOOLS")
    fi
    CMD+=(--output-format stream-json --verbose)
    CMD+=("$CONTENT")

    # Run Claude Code in background for interrupt support
    echo "[$(date)] Running: ${CMD[*]}"
    "${CMD[@]}" > "$RESPONSE_FILE" 2>&1 &
    CLAUDE_PID=$!

    # Write PID file for diagnostics
    echo "$CLAUDE_PID" > "$PLANDROP_DIR/current_task.pid"

    # Track if interrupted
    WAS_INTERRUPTED=false

    # Poll for interrupt signal while Claude runs
    while kill -0 "$CLAUDE_PID" 2>/dev/null; do
      if [ -f "$PLANDROP_DIR/interrupt" ]; then
        echo "[$(date)] ⚠️ Interrupt requested — killing Claude Code (PID: $CLAUDE_PID)"
        WAS_INTERRUPTED=true

        # Send SIGTERM first (graceful shutdown)
        kill "$CLAUDE_PID" 2>/dev/null

        # Wait up to 5 seconds for graceful exit
        for i in 1 2 3 4 5; do
          kill -0 "$CLAUDE_PID" 2>/dev/null || break
          sleep 1
        done

        # If still running, force kill
        if kill -0 "$CLAUDE_PID" 2>/dev/null; then
          echo "[$(date)] Force killing Claude Code (PID: $CLAUDE_PID)"
          kill -9 "$CLAUDE_PID" 2>/dev/null
        fi

        # Clean up interrupt file
        rm -f "$PLANDROP_DIR/interrupt"

        # Append interrupted status to response JSONL so the browser knows
        echo '{"type":"result","subtype":"interrupted","is_error":true,"result":"Task interrupted by user.","duration_ms":0,"total_cost_usd":0}' >> "$RESPONSE_FILE"

        echo "[$(date)] ⚠️ Task interrupted: $PLAN_ID"
        break
      fi
      sleep 1
    done

    # Wait for process to fully exit (handles normal completion too)
    wait "$CLAUDE_PID" 2>/dev/null
    EXIT_CODE=$?

    # Clean up PID file
    rm -f "$PLANDROP_DIR/current_task.pid"

    # Handle completion based on whether it was interrupted
    if [ "$WAS_INTERRUPTED" = true ]; then
      echo "[$(date)] Done (interrupted): $PLAN_ID"
    else
      if [ $EXIT_CODE -ne 0 ]; then
        echo "[$(date)] Claude Code exited with error (exit code: $EXIT_CODE)"
      else
        echo "[$(date)] Claude Code completed successfully"
      fi

      # Check for permission denials in the response
      DENIALS=$(tail -1 "$RESPONSE_FILE" 2>/dev/null | jq -r '.permission_denials[]?.tool_input.command // empty' 2>/dev/null || true)
      if [ -n "$DENIALS" ]; then
        echo "[$(date)] ⚠️ Permission denials:"
        echo "$DENIALS" | while read -r cmd; do
          if [ -n "$cmd" ]; then
            echo "[$(date)]   Blocked: $cmd"
          fi
        done
      fi

      # Extract cost from the last line of the response (result event)
      COST=$(tail -1 "$RESPONSE_FILE" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('total_cost_usd', '?'))" 2>/dev/null || echo "?")
      echo "[$(date)] Done: $PLAN_ID -> $RESPONSE_FILE (cost: \$${COST})"
    fi

    # Capture session_id from init message (first run or if session file missing)
    if [ ! -f "$SESSION_FILE" ] || [ ! -s "$SESSION_FILE" ]; then
      SESSION_ID=$(head -1 "$RESPONSE_FILE" 2>/dev/null | jq -r '.session_id // empty' 2>/dev/null || true)
      if [ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "null" ]; then
        echo "$SESSION_ID" > "$SESSION_FILE"
        echo "[$(date)] Session ID captured: $SESSION_ID"
      fi
    fi

    # Move processed plan to completed
    mv "$f" "$COMPLETED/"
  done

  sleep 2
done
