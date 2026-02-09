# PlanDrop Troubleshooting Guide

## Common Issues

### "Extension can't connect to native host"

**Symptoms:**
- Popup shows "Error: Disconnected" or similar
- Test Connection button fails immediately
- No response from native host

**Solutions:**

1. **Verify installation completed**
   ```bash
   cd native-host
   ./install.sh YOUR_EXTENSION_ID
   ```
   Check for any errors in the output.

2. **Check manifest location**

   The native messaging manifest must be in the correct location:

   | OS | Chrome Path |
   |----|-------------|
   | macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.plandrop.host.json` |
   | Linux | `~/.config/google-chrome/NativeMessagingHosts/com.plandrop.host.json` |
   | Windows | Registry: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.plandrop.host` |

3. **Verify manifest contents**
   ```bash
   cat ~/.config/google-chrome/NativeMessagingHosts/com.plandrop.host.json
   ```

   Check that:
   - `path` points to the correct absolute path of `plandrop_host.py`
   - `allowed_origins` contains your extension ID

4. **Check host script is executable**
   ```bash
   chmod +x /path/to/plandrop_host.py
   ```

5. **Verify Python 3 is available**
   ```bash
   python3 --version
   ```

6. **Restart Chrome completely**

   Chrome caches native messaging connections. Fully quit and restart Chrome.

7. **Check the log file**
   ```bash
   cat ~/.plandrop/relay.log
   ```

   Look for startup messages or errors.

---

### "SSH permission denied"

**Symptoms:**
- Test Connection fails with "Permission denied"
- Send fails with authentication errors

**Solutions:**

1. **Verify SSH key authentication works from terminal**
   ```bash
   ssh your-server "echo ok"
   ```

   If this prompts for a password, SSH key auth isn't set up.

2. **Set up SSH key authentication**
   ```bash
   # Generate key if needed
   ssh-keygen -t ed25519

   # Copy to server
   ssh-copy-id user@server
   ```

3. **Check SSH agent is running**
   ```bash
   eval $(ssh-agent)
   ssh-add ~/.ssh/id_ed25519
   ```

4. **Verify SSH config alias (if using)**
   ```bash
   ssh your-alias "echo ok"
   ```

5. **Check key permissions**
   ```bash
   chmod 600 ~/.ssh/id_ed25519
   chmod 644 ~/.ssh/id_ed25519.pub
   chmod 700 ~/.ssh
   ```

---

### "SCP timeout" or "Connection timed out"

**Symptoms:**
- Test Connection hangs then fails
- Send operation times out

**Solutions:**

1. **Verify server is reachable**
   ```bash
   ping your-server
   ssh your-server "echo ok"
   ```

2. **Check firewall rules**

   Ensure port 22 (or your custom SSH port) is open.

3. **Check SSH config for the server**
   ```bash
   cat ~/.ssh/config
   ```

   Verify hostname, port, and user are correct.

4. **Try with verbose SSH to diagnose**
   ```bash
   ssh -v your-server "echo ok"
   ```

5. **Check if server has connection limits**

   Some servers limit concurrent SSH connections. Close other sessions.

---

### "File exists" warning appears unexpectedly

**Symptoms:**
- Collision warning shows for a file you just created
- Warning appears even after renaming

**Solutions:**

1. **This is expected behavior**

   PlanDrop checks if the file exists before sending to prevent accidental overwrites.

2. **Options:**
   - Click **Rename** to change the filename
   - Click **Overwrite** to replace the existing file

3. **Change the filename pattern**

   Use timestamps in filenames: `plan-2024-01-15.md`

---

### Popup doesn't auto-fill from clipboard

**Symptoms:**
- Textarea is empty when popup opens
- Clipboard content not pasted

**Solutions:**

1. **Check clipboard permissions**

   Chrome may have blocked clipboard access. Check the permission in popup.

2. **Verify setting is enabled**

   Open Settings → ensure "Auto-fill from clipboard" is checked.

3. **Copy content again**

   Some content (like from PDFs) may not copy as plain text.

4. **Check if content is text**

   Only plain text is supported, not images or rich content.

---

### Markdown preview not rendering

**Symptoms:**
- Preview pane shows raw markdown
- No formatting in preview

**Solutions:**

1. **Check if marked.js loaded**

   Open Chrome DevTools (F12) → Console tab → look for errors.

2. **Verify lib folder exists**
   ```
   extension/lib/marked.min.js
   ```

3. **Reload the extension**

   Go to `chrome://extensions` → click the refresh icon on PlanDrop.

---

### Context menu "Send to PlanDrop" missing

**Symptoms:**
- Right-click doesn't show PlanDrop option

**Solutions:**

1. **Select text first**

   The context menu only appears when text is selected.

2. **Reload extension**

   Go to `chrome://extensions` → click refresh on PlanDrop.

3. **Check permissions**

   Ensure `contextMenus` permission is in manifest.json.

---

### Settings not saving

**Symptoms:**
- Servers disappear after reopening settings
- Configuration lost

**Solutions:**

1. **Check Chrome sync storage**

   PlanDrop uses Chrome's sync storage. Ensure you're signed into Chrome.

2. **Check storage quota**

   Chrome sync storage has limits (~100KB). If you have many servers, you might hit it.

3. **Export settings as backup**

   Settings → Export Settings → save the JSON file.

---

## Debug Mode

### Enable verbose logging

The native host logs to `~/.plandrop/relay.log`. To see real-time logs:

```bash
tail -f ~/.plandrop/relay.log
```

### Test native host manually

```bash
cd native-host
python3 test_host.py
```

### Test native messaging protocol

```python
import json
import struct

# Create a test message
msg = {"action": "test_conn", "ssh_target": "your-server"}
encoded = json.dumps(msg).encode('utf-8')
length = struct.pack('<I', len(encoded))

# Write to host stdin
# python3 plandrop_host.py < test_input
```

---

## Getting Help

1. **Check the log file first**
   ```bash
   cat ~/.plandrop/relay.log
   ```

2. **Run the test suite**
   ```bash
   cd native-host
   python3 test_host.py
   ```

3. **Open Chrome DevTools**

   Right-click popup → Inspect → check Console for errors.

4. **Check background service worker**

   Go to `chrome://extensions` → PlanDrop → "Inspect views: service worker"

5. **Report issues**

   Include:
   - OS and Chrome version
   - Contents of `~/.plandrop/relay.log`
   - Steps to reproduce
   - Any error messages
