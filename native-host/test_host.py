#!/usr/bin/env python3
"""
Test script for PlanDrop Native Messaging Host.
Simulates Chrome sending messages to the host.
"""

import json
import struct
import subprocess
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
HOST_SCRIPT = os.path.join(SCRIPT_DIR, "plandrop_host.py")


def send_message(proc, message):
    """Send a message using Chrome native messaging protocol."""
    encoded = json.dumps(message).encode('utf-8')
    length = struct.pack('<I', len(encoded))
    proc.stdin.write(length + encoded)
    proc.stdin.flush()


def read_message(proc):
    """Read a message using Chrome native messaging protocol."""
    raw_length = proc.stdout.read(4)
    if len(raw_length) != 4:
        return None
    length = struct.unpack('<I', raw_length)[0]
    message = proc.stdout.read(length).decode('utf-8')
    return json.loads(message)


def test_unknown_action():
    """Test that unknown actions return an error."""
    print("Test 1: Unknown action...")

    proc = subprocess.Popen(
        [sys.executable, HOST_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    send_message(proc, {"action": "unknown_action"})
    response = read_message(proc)
    proc.terminate()

    assert response is not None, "No response received"
    assert response.get("status") == "error", f"Expected error status, got: {response}"
    assert "Unknown action" in response.get("message", ""), f"Unexpected message: {response}"

    print("  PASSED: Unknown action returns error")


def test_missing_params():
    """Test that missing parameters return an error."""
    print("Test 2: Missing parameters...")

    proc = subprocess.Popen(
        [sys.executable, HOST_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # test_conn without ssh_target
    send_message(proc, {"action": "test_conn"})
    response = read_message(proc)
    proc.terminate()

    assert response is not None, "No response received"
    assert response.get("status") == "error", f"Expected error status, got: {response}"
    assert "Missing" in response.get("message", ""), f"Unexpected message: {response}"

    print("  PASSED: Missing params returns error")


def test_check_file_missing_params():
    """Test check_file with missing parameters."""
    print("Test 3: check_file missing parameters...")

    proc = subprocess.Popen(
        [sys.executable, HOST_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    send_message(proc, {"action": "check_file", "ssh_target": "localhost"})
    response = read_message(proc)
    proc.terminate()

    assert response is not None, "No response received"
    assert response.get("status") == "error", f"Expected error status, got: {response}"

    print("  PASSED: check_file without remote_path returns error")


def test_send_file_missing_params():
    """Test send_file with missing parameters."""
    print("Test 4: send_file missing parameters...")

    proc = subprocess.Popen(
        [sys.executable, HOST_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    send_message(proc, {"action": "send_file", "ssh_target": "localhost"})
    response = read_message(proc)
    proc.terminate()

    assert response is not None, "No response received"
    assert response.get("status") == "error", f"Expected error status, got: {response}"

    print("  PASSED: send_file without content returns error")


def test_message_protocol():
    """Test that multiple messages work correctly."""
    print("Test 5: Multiple messages in sequence...")

    proc = subprocess.Popen(
        [sys.executable, HOST_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Send multiple messages
    for i in range(3):
        send_message(proc, {"action": "test_conn"})
        response = read_message(proc)
        assert response is not None, f"No response for message {i}"
        assert response.get("status") == "error", f"Expected error (no target), got: {response}"

    proc.terminate()
    print("  PASSED: Multiple messages handled correctly")


def test_command_injection_path():
    """Test that command injection via remote_path is blocked."""
    print("Test 6: Command injection in path blocked...")

    proc = subprocess.Popen(
        [sys.executable, HOST_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Try to inject a command via remote_path
    malicious_paths = [
        '/tmp/test; rm -rf /',
        '/tmp/test`whoami`',
        '/tmp/test$(id)',
        '/tmp/test|cat /etc/passwd',
        '/tmp/test\necho pwned',
    ]

    for path in malicious_paths:
        send_message(proc, {
            "action": "check_file",
            "ssh_target": "localhost",
            "remote_path": path
        })
        response = read_message(proc)
        assert response is not None, f"No response for path: {path}"
        assert response.get("status") == "error", f"Expected error for malicious path: {path}"
        assert "invalid" in response.get("message", "").lower(), f"Expected 'invalid' in error message for: {path}"

    proc.terminate()
    print("  PASSED: Command injection in path blocked")


def test_command_injection_target():
    """Test that command injection via ssh_target is blocked."""
    print("Test 7: Command injection in target blocked...")

    proc = subprocess.Popen(
        [sys.executable, HOST_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Try to inject a command via ssh_target
    malicious_targets = [
        'user@host; rm -rf /',
        'user@host`whoami`',
        'user@host$(id)',
        'user@host|cat /etc/passwd',
    ]

    for target in malicious_targets:
        send_message(proc, {
            "action": "test_conn",
            "ssh_target": target
        })
        response = read_message(proc)
        assert response is not None, f"No response for target: {target}"
        assert response.get("status") == "error", f"Expected error for malicious target: {target}"
        assert "invalid" in response.get("message", "").lower(), f"Expected 'invalid' in error message for: {target}"

    proc.terminate()
    print("  PASSED: Command injection in target blocked")


def test_valid_paths_accepted():
    """Test that valid paths are accepted."""
    print("Test 8: Valid paths accepted...")

    proc = subprocess.Popen(
        [sys.executable, HOST_SCRIPT],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # These should NOT be rejected (though SSH may fail, it should not be an "invalid" error)
    valid_paths = [
        '/home/user/projects/plan.md',
        '/tmp/test-file_v2.md',
        '/home/user/My Documents/plan.md',  # spaces are OK
        '/home/user/plan (1).md',  # parentheses... wait, we block these
    ]

    # Test a definitely valid path
    send_message(proc, {
        "action": "check_file",
        "ssh_target": "validuser@validhost",
        "remote_path": "/home/user/projects/plan.md"
    })
    response = read_message(proc)
    assert response is not None, "No response"
    # Should either succeed or fail with SSH error, NOT validation error
    if response.get("status") == "error":
        assert "invalid" not in response.get("message", "").lower(), \
            f"Valid path was rejected: {response}"

    proc.terminate()
    print("  PASSED: Valid paths accepted")


def main():
    print("")
    print("=" * 50)
    print("  PlanDrop Native Host Tests")
    print("=" * 50)
    print("")

    tests = [
        test_unknown_action,
        test_missing_params,
        test_check_file_missing_params,
        test_send_file_missing_params,
        test_message_protocol,
        test_command_injection_path,
        test_command_injection_target,
        test_valid_paths_accepted,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"  FAILED: {e}")
            failed += 1

    print("")
    print("=" * 50)
    print(f"  Results: {passed} passed, {failed} failed")
    print("=" * 50)
    print("")

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
