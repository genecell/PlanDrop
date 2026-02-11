#!/usr/bin/env python3
"""
PlanDrop Native Messaging Host

Handles communication between Chrome extension and SSH/SCP commands.

V1 actions: send_file, check_file, test_conn
V2 actions: init_queue, send_plan, poll_responses, read_heartbeat
"""

import json
import os
import re
import struct
import subprocess
import sys
import shlex
import tempfile
import logging
from datetime import datetime
from pathlib import Path

# Setup logging
LOG_DIR = Path.home() / ".plandrop"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "relay.log"

logging.basicConfig(
    filename=str(LOG_FILE),
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

# Timeouts in seconds
SSH_TIMEOUT = 5  # ConnectTimeout for SSH - first connection can take longer, but ControlMaster reuses it
SCP_TIMEOUT = 30

# Security: Characters that could enable shell injection
DANGEROUS_PATH_CHARS = re.compile(r'[;&|`$()<>\n\r\x00]')
DANGEROUS_TARGET_CHARS = re.compile(r'[;&|`$()<>\n\r\x00\s]')


def validate_path(path):
    """
    Validate remote path to prevent command injection.
    Rejects paths containing shell metacharacters.
    """
    if not path:
        raise ValueError("Path cannot be empty")

    if DANGEROUS_PATH_CHARS.search(path):
        raise ValueError(f"Path contains invalid characters")

    # Also reject paths that look like they're trying to escape quotes
    if '\\"' in path or "\\'" in path:
        raise ValueError("Path contains invalid escape sequences")

    return path


def validate_ssh_target(target):
    """
    Validate SSH target to prevent command injection.
    Accepts: hostname, user@hostname, or SSH config alias.
    """
    if not target:
        raise ValueError("SSH target cannot be empty")

    if DANGEROUS_TARGET_CHARS.search(target):
        raise ValueError("SSH target contains invalid characters")

    return target


def read_message():
    """Read a message from stdin using Chrome native messaging protocol."""
    # Read the 4-byte message length
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        logging.info("No more input, exiting")
        sys.exit(0)

    if len(raw_length) != 4:
        logging.error(f"Invalid message length header: {len(raw_length)} bytes")
        sys.exit(1)

    # Unpack the length (little-endian unsigned int)
    message_length = struct.unpack('<I', raw_length)[0]
    logging.debug(f"Reading message of {message_length} bytes")

    # Read the message
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    logging.debug(f"Received: {message[:500]}...")

    return json.loads(message)


def send_message(message):
    """Send a message to stdout using Chrome native messaging protocol."""
    encoded = json.dumps(message).encode('utf-8')
    length = struct.pack('<I', len(encoded))

    sys.stdout.buffer.write(length)
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

    logging.debug(f"Sent: {message}")


def build_ssh_args(ssh_target, ssh_key=None, ssh_port=None):
    """Build SSH/SCP argument list from target configuration."""
    args = []

    # Add key if specified
    if ssh_key:
        args.extend(['-i', ssh_key])

    # Add port if specified
    if ssh_port:
        args.extend(['-p', str(ssh_port)])

    # Add common options for non-interactive operation
    # ControlMaster enables SSH connection reuse (critical for frequent polling)
    args.extend([
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', f'ConnectTimeout={SSH_TIMEOUT}',
        '-o', 'ControlMaster=auto',
        '-o', 'ControlPath=/tmp/plandrop-%r@%h:%p',
        '-o', 'ControlPersist=60'
    ])

    return args


def build_scp_args(ssh_target, ssh_key=None, ssh_port=None):
    """Build SCP argument list (uses -P instead of -p for port)."""
    args = []

    if ssh_key:
        args.extend(['-i', ssh_key])

    if ssh_port:
        args.extend(['-P', str(ssh_port)])

    # ControlMaster enables SSH connection reuse (critical for frequent polling)
    args.extend([
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', f'ConnectTimeout={SSH_TIMEOUT}',
        '-o', 'ControlMaster=auto',
        '-o', 'ControlPath=/tmp/plandrop-%r@%h:%p',
        '-o', 'ControlPersist=60'
    ])

    return args


def action_test_conn(data):
    """Test SSH connection to server."""
    ssh_target = data.get('ssh_target')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target:
        return {"status": "error", "message": "Missing ssh_target"}

    # Security: Validate inputs to prevent command injection
    try:
        ssh_target = validate_ssh_target(ssh_target)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    logging.info(f"Testing connection to {ssh_target}")

    try:
        args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        args.extend([ssh_target, 'echo ok'])

        logging.debug(f"Running: {' '.join(args)}")

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=SSH_TIMEOUT + 5
        )

        if result.returncode == 0:
            # Try to get hostname for confirmation
            hostname_result = subprocess.run(
                ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port) + [ssh_target, 'hostname'],
                capture_output=True,
                text=True,
                timeout=SSH_TIMEOUT + 5
            )
            hostname = hostname_result.stdout.strip() if hostname_result.returncode == 0 else ssh_target

            return {
                "status": "success",
                "message": f"Connected to {ssh_target} ({hostname})"
            }
        else:
            error = result.stderr.strip() or "Connection failed"
            logging.error(f"SSH test failed: {error}")
            return {"status": "error", "message": error}

    except subprocess.TimeoutExpired:
        logging.error(f"SSH timeout connecting to {ssh_target}")
        return {"status": "error", "message": "Connection timed out"}
    except FileNotFoundError:
        logging.error("SSH command not found")
        return {"status": "error", "message": "SSH command not found on system"}
    except Exception as e:
        logging.exception("Unexpected error in test_conn")
        return {"status": "error", "message": str(e)}


def action_check_file(data):
    """Check if a file exists on the remote server."""
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target or not remote_path:
        return {"status": "error", "message": "Missing ssh_target or remote_path"}

    # Security: Validate inputs to prevent command injection
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    logging.info(f"Checking file {remote_path} on {ssh_target}")

    try:
        # Use stat to get file info
        # Try GNU stat first (Linux), fall back to BSD stat (macOS)
        # GNU: stat -c "%s %Y" = size, mtime (epoch)
        # BSD: stat -f "%z %m" = size, mtime (epoch)
        stat_cmd = (
            f'stat -c "%s %Y" "{remote_path}" 2>/dev/null || '
            f'stat -f "%z %m" "{remote_path}" 2>/dev/null'
        )
        args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        args.extend([ssh_target, stat_cmd])

        logging.debug(f"Running: {' '.join(args)}")

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=SSH_TIMEOUT + 5
        )

        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split()
            if len(parts) >= 2:
                size = int(parts[0])
                mtime = int(parts[1])
                modified = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")

                return {
                    "status": "success",
                    "exists": True,
                    "size": size,
                    "modified": modified
                }

        # File doesn't exist
        return {"status": "success", "exists": False}

    except subprocess.TimeoutExpired:
        logging.error(f"SSH timeout checking file on {ssh_target}")
        return {"status": "error", "message": "Connection timed out"}
    except Exception as e:
        logging.exception("Unexpected error in check_file")
        return {"status": "error", "message": str(e)}


def action_send_file(data):
    """Send a file to the remote server via SCP."""
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    content = data.get('content')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')
    overwrite = data.get('overwrite', False)

    if not ssh_target or not remote_path or content is None:
        return {"status": "error", "message": "Missing ssh_target, remote_path, or content"}

    # Security: Validate inputs to prevent command injection
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    logging.info(f"Sending file to {ssh_target}:{remote_path} (overwrite={overwrite})")

    # Create temp file with content
    temp_fd = None
    temp_path = None

    try:
        # Write content to temp file
        temp_fd, temp_path = tempfile.mkstemp(suffix='.md', prefix='plandrop_')
        with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
            f.write(content)
        temp_fd = None  # File descriptor is now closed

        logging.debug(f"Wrote {len(content)} bytes to {temp_path}")

        # Ensure remote directory exists
        remote_dir = os.path.dirname(remote_path)
        if remote_dir:
            mkdir_args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
            mkdir_args.extend([ssh_target, f'mkdir -p "{remote_dir}"'])

            mkdir_result = subprocess.run(
                mkdir_args,
                capture_output=True,
                text=True,
                timeout=SSH_TIMEOUT + 5
            )

            if mkdir_result.returncode != 0:
                error = mkdir_result.stderr.strip() or "Failed to create directory"
                logging.error(f"mkdir failed: {error}")
                return {"status": "error", "message": f"Cannot create directory: {error}"}

        # SCP the file
        scp_args = ['scp'] + build_scp_args(ssh_target, ssh_key, ssh_port)
        scp_args.extend([temp_path, f'{ssh_target}:{remote_path}'])

        logging.debug(f"Running: {' '.join(scp_args)}")

        result = subprocess.run(
            scp_args,
            capture_output=True,
            text=True,
            timeout=SCP_TIMEOUT
        )

        if result.returncode == 0:
            logging.info(f"Successfully sent to {ssh_target}:{remote_path}")
            return {
                "status": "success",
                "message": f"Sent to {ssh_target}:{remote_path}"
            }
        else:
            error = result.stderr.strip() or "SCP failed"
            logging.error(f"SCP failed: {error}")
            return {"status": "error", "message": error}

    except subprocess.TimeoutExpired:
        logging.error(f"SCP timeout sending to {ssh_target}")
        return {"status": "error", "message": "Transfer timed out"}
    except FileNotFoundError:
        logging.error("SCP command not found")
        return {"status": "error", "message": "SCP command not found on system"}
    except Exception as e:
        logging.exception("Unexpected error in send_file")
        return {"status": "error", "message": str(e)}
    finally:
        # Clean up temp file
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
                logging.debug(f"Cleaned up temp file {temp_path}")
            except Exception as e:
                logging.warning(f"Failed to clean up temp file: {e}")


# ============================================
# V2 Actions - Interactive Queue System
# ============================================

def action_init_queue(data):
    """
    Create .plandrop/ queue structure on server and copy watch.sh.
    This sets up a project for V2 interactive mode.
    """
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target or not remote_path:
        return {"status": "error", "message": "Missing ssh_target or remote_path"}

    # Security: Validate inputs
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    logging.info(f"Initializing queue at {ssh_target}:{remote_path}/.plandrop")

    plandrop_dir = f"{remote_path}/.plandrop"

    try:
        # Create directory structure
        dirs = [
            f"{plandrop_dir}/plans",
            f"{plandrop_dir}/responses",
            f"{plandrop_dir}/completed"
        ]
        mkdir_cmd = f'mkdir -p {" ".join(dirs)}'

        args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        args.extend([ssh_target, mkdir_cmd])

        logging.debug(f"Running: {' '.join(args)}")

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=SSH_TIMEOUT + 5
        )

        if result.returncode != 0:
            error = result.stderr.strip() or "Failed to create directories"
            logging.error(f"mkdir failed: {error}")
            return {"status": "error", "message": error}

        # Copy watch.sh to server
        watch_script = Path(__file__).parent / 'watch.sh'
        if not watch_script.exists():
            return {"status": "error", "message": "watch.sh not found in native-host directory"}

        scp_args = ['scp'] + build_scp_args(ssh_target, ssh_key, ssh_port)
        scp_args.extend([str(watch_script), f'{ssh_target}:{plandrop_dir}/watch.sh'])

        logging.debug(f"Running: {' '.join(scp_args)}")

        result = subprocess.run(
            scp_args,
            capture_output=True,
            text=True,
            timeout=SCP_TIMEOUT
        )

        if result.returncode != 0:
            error = result.stderr.strip() or "Failed to copy watch.sh"
            logging.error(f"SCP failed: {error}")
            return {"status": "error", "message": error}

        # Make watch.sh executable
        chmod_args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        chmod_args.extend([ssh_target, f'chmod +x "{plandrop_dir}/watch.sh"'])

        result = subprocess.run(
            chmod_args,
            capture_output=True,
            text=True,
            timeout=SSH_TIMEOUT + 5
        )

        if result.returncode != 0:
            error = result.stderr.strip() or "Failed to make watch.sh executable"
            logging.error(f"chmod failed: {error}")
            return {"status": "error", "message": error}

        logging.info(f"Queue initialized at {ssh_target}:{plandrop_dir}")
        return {
            "status": "success",
            "message": f"Queue initialized at {plandrop_dir}"
        }

    except subprocess.TimeoutExpired:
        logging.error(f"Timeout initializing queue on {ssh_target}")
        return {"status": "error", "message": "Connection timed out"}
    except Exception as e:
        logging.exception("Unexpected error in init_queue")
        return {"status": "error", "message": str(e)}


def action_send_plan(data):
    """
    Send a plan JSON to .plandrop/plans/ via SCP.
    The plan will be picked up by watch.sh and processed.
    """
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    plan_data = data.get('plan_data')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target or not remote_path or not plan_data:
        return {"status": "error", "message": "Missing ssh_target, remote_path, or plan_data"}

    # Security: Validate inputs
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    # Parse plan to get ID
    try:
        plan = json.loads(plan_data)
        plan_id = plan.get('id')
        if not plan_id:
            return {"status": "error", "message": "Plan data missing 'id' field"}
        # Security: Validate plan_id to prevent path traversal
        if not re.match(r'^[a-zA-Z0-9_-]+$', plan_id):
            return {"status": "error", "message": "Invalid plan_id format"}
    except json.JSONDecodeError as e:
        return {"status": "error", "message": f"Invalid plan JSON: {e}"}

    logging.info(f"Sending plan {plan_id} to {ssh_target}:{remote_path}/.plandrop/plans/")

    temp_path = None
    try:
        # Write plan to temp file
        temp_fd, temp_path = tempfile.mkstemp(suffix='.json', prefix='plandrop_plan_')
        with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
            f.write(plan_data)

        # SCP to plans/ directory
        dest = f"{remote_path}/.plandrop/plans/{plan_id}.json"
        scp_args = ['scp'] + build_scp_args(ssh_target, ssh_key, ssh_port)
        scp_args.extend([temp_path, f'{ssh_target}:{dest}'])

        logging.debug(f"Running: {' '.join(scp_args)}")

        result = subprocess.run(
            scp_args,
            capture_output=True,
            text=True,
            timeout=SCP_TIMEOUT
        )

        if result.returncode == 0:
            logging.info(f"Plan {plan_id} sent successfully")
            return {"status": "success", "id": plan_id}
        else:
            error = result.stderr.strip() or "SCP failed"
            logging.error(f"SCP failed: {error}")
            return {"status": "error", "message": error}

    except subprocess.TimeoutExpired:
        logging.error(f"Timeout sending plan to {ssh_target}")
        return {"status": "error", "message": "Transfer timed out"}
    except Exception as e:
        logging.exception("Unexpected error in send_plan")
        return {"status": "error", "message": str(e)}
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception:
                pass


def action_poll_responses(data):
    """
    Read Claude Code response JSONL file for a specific plan.
    Returns the file content if it exists, empty otherwise.
    """
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    plan_id = data.get('plan_id')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target or not remote_path or not plan_id:
        return {"status": "error", "message": "Missing ssh_target, remote_path, or plan_id"}

    # Security: Validate inputs
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
        # plan_id should be alphanumeric with underscores
        if not re.match(r'^[a-zA-Z0-9_-]+$', plan_id):
            raise ValueError("Invalid plan_id format")
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    response_file = f"{remote_path}/.plandrop/responses/{plan_id}.jsonl"
    logging.debug(f"Polling response: {ssh_target}:{response_file}")

    try:
        # Read the response file via SSH
        args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        args.extend([ssh_target, f'cat "{response_file}" 2>/dev/null'])

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=SSH_TIMEOUT + 5
        )

        if result.stdout.strip():
            return {"status": "ok", "content": result.stdout}
        else:
            return {"status": "empty"}

    except subprocess.TimeoutExpired:
        logging.error(f"Timeout polling responses from {ssh_target}")
        return {"status": "error", "message": "Connection timed out"}
    except Exception as e:
        logging.exception("Unexpected error in poll_responses")
        return {"status": "error", "message": str(e)}


def action_read_heartbeat(data):
    """
    Read heartbeat file to check if watch.sh is running.
    Returns the timestamp if available, or not_running status.
    """
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target or not remote_path:
        return {"status": "error", "message": "Missing ssh_target or remote_path"}

    # Security: Validate inputs
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    heartbeat_file = f"{remote_path}/.plandrop/heartbeat"
    logging.debug(f"Reading heartbeat: {ssh_target}:{heartbeat_file}")

    try:
        args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        args.extend([ssh_target, f'cat "{heartbeat_file}" 2>/dev/null'])

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=SSH_TIMEOUT + 5
        )

        timestamp = result.stdout.strip()
        if timestamp:
            return {"status": "ok", "timestamp": timestamp}
        else:
            return {"status": "not_running"}

    except subprocess.TimeoutExpired:
        logging.error(f"Timeout reading heartbeat from {ssh_target}")
        return {"status": "error", "message": "Connection timed out"}
    except Exception as e:
        logging.exception("Unexpected error in read_heartbeat")
        return {"status": "error", "message": str(e)}


def action_write_settings(data):
    """
    Write .claude/settings.json to server.
    This sets up permission rules for Claude Code based on the selected profile.
    """
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    settings_json = data.get('settings_json')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target or not remote_path or not settings_json:
        return {"status": "error", "message": "Missing ssh_target, remote_path, or settings_json"}

    # Security: Validate inputs
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    # Validate that settings_json is valid JSON
    try:
        json.loads(settings_json)
    except json.JSONDecodeError as e:
        return {"status": "error", "message": f"Invalid settings JSON: {e}"}

    logging.info(f"Writing settings.json to {ssh_target}:{remote_path}/.claude/")

    temp_path = None
    try:
        # Ensure .claude/ directory exists
        claude_dir = f"{remote_path}/.claude"
        mkdir_args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        mkdir_args.extend([ssh_target, f'mkdir -p "{claude_dir}"'])

        result = subprocess.run(
            mkdir_args,
            capture_output=True,
            text=True,
            timeout=SSH_TIMEOUT + 5
        )

        if result.returncode != 0:
            error = result.stderr.strip() or "Failed to create .claude directory"
            logging.error(f"mkdir failed: {error}")
            return {"status": "error", "message": error}

        # Write settings to temp file
        temp_fd, temp_path = tempfile.mkstemp(suffix='.json', prefix='plandrop_settings_')
        with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
            f.write(settings_json)

        # SCP to .claude/settings.json
        dest = f"{claude_dir}/settings.json"
        scp_args = ['scp'] + build_scp_args(ssh_target, ssh_key, ssh_port)
        scp_args.extend([temp_path, f'{ssh_target}:{dest}'])

        logging.debug(f"Running: {' '.join(scp_args)}")

        result = subprocess.run(
            scp_args,
            capture_output=True,
            text=True,
            timeout=SCP_TIMEOUT
        )

        if result.returncode == 0:
            logging.info(f"Settings written to {ssh_target}:{dest}")
            return {"status": "success", "message": "Settings written"}
        else:
            error = result.stderr.strip() or "SCP failed"
            logging.error(f"SCP failed: {error}")
            return {"status": "error", "message": error}

    except subprocess.TimeoutExpired:
        logging.error(f"Timeout writing settings to {ssh_target}")
        return {"status": "error", "message": "Connection timed out"}
    except Exception as e:
        logging.exception("Unexpected error in write_settings")
        return {"status": "error", "message": str(e)}
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except Exception:
                pass


def action_read_session(data):
    """
    Read the current session_id from server.
    Returns the session ID if it exists.
    """
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target or not remote_path:
        return {"status": "error", "message": "Missing ssh_target or remote_path"}

    # Security: Validate inputs
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    session_file = f"{remote_path}/.plandrop/session_id"
    logging.debug(f"Reading session: {ssh_target}:{session_file}")

    try:
        args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        args.extend([ssh_target, f'cat "{session_file}" 2>/dev/null'])

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=SSH_TIMEOUT + 5
        )

        session_id = result.stdout.strip()
        if session_id:
            return {"status": "ok", "session_id": session_id}
        else:
            return {"status": "empty"}

    except subprocess.TimeoutExpired:
        logging.error(f"Timeout reading session from {ssh_target}")
        return {"status": "error", "message": "Connection timed out"}
    except Exception as e:
        logging.exception("Unexpected error in read_session")
        return {"status": "error", "message": str(e)}


def action_reset_session(data):
    """
    Archive the current session to history and delete session_id.
    Appends session info to session_history.jsonl before deleting.
    """
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    session_id = data.get('session_id')
    timestamp = data.get('timestamp')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target or not remote_path:
        return {"status": "error", "message": "Missing ssh_target or remote_path"}

    # Security: Validate inputs
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    plandrop_dir = f"{remote_path}/.plandrop"
    session_file = f"{plandrop_dir}/session_id"
    history_file = f"{plandrop_dir}/session_history.jsonl"

    logging.info(f"Resetting session on {ssh_target}:{remote_path}")

    try:
        # Build the command to archive and delete
        # If session_id provided, append to history first
        if session_id:
            entry = json.dumps({"session_id": session_id, "ended": timestamp or ""})
            # Escape for shell
            entry_escaped = entry.replace("'", "'\\''")
            archive_cmd = f"echo '{entry_escaped}' >> \"{history_file}\" && "
        else:
            archive_cmd = ""

        # Delete session_id file
        delete_cmd = f"rm -f \"{session_file}\""

        full_cmd = archive_cmd + delete_cmd

        args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        args.extend([ssh_target, full_cmd])

        logging.debug(f"Running: {' '.join(args)}")

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=SSH_TIMEOUT + 5
        )

        if result.returncode == 0:
            logging.info(f"Session reset successfully on {ssh_target}")
            return {"status": "success", "message": "Session reset"}
        else:
            error = result.stderr.strip() or "Failed to reset session"
            logging.error(f"Reset failed: {error}")
            return {"status": "error", "message": error}

    except subprocess.TimeoutExpired:
        logging.error(f"Timeout resetting session on {ssh_target}")
        return {"status": "error", "message": "Connection timed out"}
    except Exception as e:
        logging.exception("Unexpected error in reset_session")
        return {"status": "error", "message": str(e)}


def action_run_command(data):
    """
    Run a restricted command on the remote server via SSH.
    Security: Only allows plandrop-history commands.
    """
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    command = data.get('command', '')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target or not remote_path:
        return {"status": "error", "message": "Missing ssh_target or remote_path"}

    # Security: Validate inputs
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    # Security: Only allow plandrop-history commands
    # Strip the cd prefix if present
    cmd_to_check = command.strip()
    if cmd_to_check.startswith('cd ') and '&&' in cmd_to_check:
        # Extract the command after cd ... &&
        cmd_to_check = cmd_to_check.split('&&', 1)[1].strip()

    if not cmd_to_check.startswith('plandrop-history'):
        # Also allow python3 .plandrop/history.py as fallback
        if not (cmd_to_check.startswith('python3 ') and 'history.py' in cmd_to_check):
            logging.warning(f"Blocked command: {command}")
            return {"status": "error", "message": "Only plandrop-history commands allowed"}

    logging.info(f"Running command on {ssh_target}: {command[:100]}...")

    try:
        args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        args.extend([ssh_target, command])

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=60  # Allow longer timeout for history export
        )

        if result.returncode == 0:
            return {
                "status": "ok",
                "output": result.stdout,
                "error": result.stderr
            }
        else:
            return {
                "status": "error",
                "output": result.stdout,
                "error": result.stderr or f"Exit code: {result.returncode}"
            }

    except subprocess.TimeoutExpired:
        logging.error(f"Timeout running command on {ssh_target}")
        return {"status": "error", "message": "Command timed out"}
    except Exception as e:
        logging.exception("Unexpected error in run_command")
        return {"status": "error", "message": str(e)}


def action_interrupt(data):
    """
    Send interrupt signal to stop a running Claude Code task.
    Creates an interrupt file that watch.sh polls for.
    """
    ssh_target = data.get('ssh_target')
    remote_path = data.get('remote_path')
    ssh_key = data.get('ssh_key')
    ssh_port = data.get('ssh_port')

    if not ssh_target or not remote_path:
        return {"status": "error", "message": "Missing ssh_target or remote_path"}

    # Security: Validate inputs
    try:
        ssh_target = validate_ssh_target(ssh_target)
        remote_path = validate_path(remote_path)
    except ValueError as e:
        logging.warning(f"Input validation failed: {e}")
        return {"status": "error", "message": str(e)}

    interrupt_path = f"{remote_path}/.plandrop/interrupt"
    logging.info(f"Sending interrupt signal to {ssh_target}:{interrupt_path}")

    try:
        args = ['ssh'] + build_ssh_args(ssh_target, ssh_key, ssh_port)
        args.extend([ssh_target, f'touch {shlex.quote(interrupt_path)}'])

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=10
        )

        if result.returncode == 0:
            logging.info(f"Interrupt signal sent successfully")
            return {"status": "interrupt_sent"}
        else:
            logging.error(f"Failed to send interrupt: {result.stderr}")
            return {"status": "error", "message": result.stderr or f"Exit code: {result.returncode}"}

    except subprocess.TimeoutExpired:
        logging.error(f"Timeout sending interrupt to {ssh_target}")
        return {"status": "error", "message": "SSH connection timed out"}
    except Exception as e:
        logging.exception("Unexpected error in action_interrupt")
        return {"status": "error", "message": str(e)}


def handle_message(message):
    """Route message to appropriate action handler."""
    action = message.get('action')

    logging.info(f"Handling action: {action}")

    # V1 actions
    if action == 'test_conn':
        return action_test_conn(message)
    elif action == 'check_file':
        return action_check_file(message)
    elif action == 'send_file':
        return action_send_file(message)
    # V2 actions
    elif action == 'init_queue':
        return action_init_queue(message)
    elif action == 'send_plan':
        return action_send_plan(message)
    elif action == 'poll_responses':
        return action_poll_responses(message)
    elif action == 'read_heartbeat':
        return action_read_heartbeat(message)
    elif action == 'write_settings':
        return action_write_settings(message)
    elif action == 'read_session':
        return action_read_session(message)
    elif action == 'reset_session':
        return action_reset_session(message)
    elif action == 'run_command':
        return action_run_command(message)
    elif action == 'interrupt':
        return action_interrupt(message)
    else:
        logging.warning(f"Unknown action: {action}")
        return {"status": "error", "message": f"Unknown action: {action}"}


def main():
    """Main loop: read messages, process, respond."""
    logging.info("PlanDrop native host started")
    logging.info(f"Python version: {sys.version}")
    logging.info(f"Log file: {LOG_FILE}")

    try:
        while True:
            message = read_message()
            response = handle_message(message)
            send_message(response)
    except KeyboardInterrupt:
        logging.info("Interrupted, exiting")
    except Exception as e:
        logging.exception("Fatal error in main loop")
        # Try to send error response
        try:
            send_message({"status": "error", "message": str(e)})
        except:
            pass
        sys.exit(1)


if __name__ == '__main__':
    main()
