#!/usr/bin/env python3
"""
PlanDrop Native Messaging Host

Handles communication between Chrome extension and SSH/SCP commands.
Supports: send_file, check_file, test_conn actions.
"""

import json
import os
import re
import struct
import subprocess
import sys
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
SSH_TIMEOUT = 10
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
    args.extend([
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', f'ConnectTimeout={SSH_TIMEOUT}'
    ])

    return args


def build_scp_args(ssh_target, ssh_key=None, ssh_port=None):
    """Build SCP argument list (uses -P instead of -p for port)."""
    args = []

    if ssh_key:
        args.extend(['-i', ssh_key])

    if ssh_port:
        args.extend(['-P', str(ssh_port)])

    args.extend([
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', f'ConnectTimeout={SSH_TIMEOUT}'
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


def handle_message(message):
    """Route message to appropriate action handler."""
    action = message.get('action')

    logging.info(f"Handling action: {action}")

    if action == 'test_conn':
        return action_test_conn(message)
    elif action == 'check_file':
        return action_check_file(message)
    elif action == 'send_file':
        return action_send_file(message)
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
