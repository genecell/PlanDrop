/**
 * PlanDrop Popup Script
 * Handles UI logic for the main popup
 */

// ============================================
// Theme Management
// ============================================

/**
 * Initialize theme on load
 */
function initTheme() {
  chrome.storage.local.get('theme', (result) => {
    const mode = result.theme || 'auto';
    applyTheme(mode);
  });

  // Listen for OS theme changes (for auto mode)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    chrome.storage.local.get('theme', (result) => {
      const mode = result.theme || 'auto';
      if (mode === 'auto') {
        applyTheme('auto');
      }
    });
  });

  // Listen for theme changes from other extension surfaces
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.theme) {
      const newTheme = changes.theme.newValue || 'auto';
      applyTheme(newTheme);
    }
  });
}

/**
 * Apply theme to document
 */
function applyTheme(mode) {
  let effectiveTheme;

  if (mode === 'auto') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    effectiveTheme = mode;
  }

  document.documentElement.setAttribute('data-theme', effectiveTheme);
}

/**
 * Debounce helper - must be defined before use
 */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// State
let config = {
  servers: [],
  defaultServerId: null,
  defaultFilename: 'plan.md',
  autoClipboard: true,
  defaultViewMode: 'split'
};
let selectedServer = null;
let selectedProject = null;
let fileExists = false;
let overwriteConfirmed = false;
let currentViewMode = 'split';

// DOM Elements
const elements = {};

// Debounced functions
const debouncedSaveDraft = debounce(saveDraft, 300);
const debouncedUpdatePreview = debounce(updatePreview, 200);

/**
 * Initialize the popup
 */
async function init() {
  // Cache DOM elements
  elements.noConfig = document.getElementById('no-config');
  elements.mainContent = document.getElementById('main-content');
  elements.serverSelect = document.getElementById('server-select');
  elements.projectSelect = document.getElementById('project-select');
  elements.filenameInput = document.getElementById('filename-input');
  elements.editor = document.getElementById('editor');
  elements.preview = document.getElementById('preview');
  elements.editorContainer = document.querySelector('.editor-container');
  elements.collisionWarning = document.getElementById('collision-warning');
  elements.collisionText = document.getElementById('collision-text');
  elements.status = document.getElementById('status');
  elements.sendBtn = document.getElementById('send-btn');
  elements.settingsBtn = document.getElementById('settings-btn');
  elements.setupBtn = document.getElementById('setup-btn');
  elements.setDefaultBtn = document.getElementById('set-default-btn');
  elements.renameBtn = document.getElementById('rename-btn');
  elements.overwriteBtn = document.getElementById('overwrite-btn');
  elements.toggleBtns = document.querySelectorAll('.toggle-btn');
  elements.clearBtn = document.getElementById('clear-btn');
  elements.pasteBtn = document.getElementById('paste-btn');
  elements.interactiveBtn = document.getElementById('interactive-btn');

  // Load config
  await loadConfig();

  // Setup event listeners
  setupEventListeners();

  // Initialize theme
  initTheme();

  // Initial UI update
  updateUI();

  // Restore draft or auto-fill from clipboard
  await restoreOrAutoFill();

  // Setup markdown preview
  setupMarkdownPreview();
}

/**
 * Load configuration from storage
 */
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['servers', 'defaultServerId', 'defaultFilename', 'autoClipboard', 'defaultViewMode'], (data) => {
      config.servers = data.servers || [];
      config.defaultServerId = data.defaultServerId || null;
      config.defaultFilename = data.defaultFilename || 'plan.md';
      config.autoClipboard = data.autoClipboard !== false;
      config.defaultViewMode = data.defaultViewMode || 'split';

      elements.filenameInput.value = config.defaultFilename;
      resolve();
    });
  });
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Server selection
  elements.serverSelect.addEventListener('change', () => {
    onServerChange();
    debouncedSaveDraft();
  });

  // Project selection
  elements.projectSelect.addEventListener('change', () => {
    onProjectChange();
    debouncedSaveDraft();
  });

  // Filename change
  elements.filenameInput.addEventListener('input', () => {
    onFilenameChange();
    debouncedSaveDraft();
  });

  // Editor input (for preview and draft save)
  elements.editor.addEventListener('input', () => {
    debouncedUpdatePreview();
    debouncedSaveDraft();
  });

  // View mode toggle
  elements.toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      setViewMode(btn.dataset.mode);
      debouncedSaveDraft();
    });
  });

  // Send button
  elements.sendBtn.addEventListener('click', sendFile);

  // Settings button
  elements.settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Setup button (no config state)
  elements.setupBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Set default button
  elements.setDefaultBtn.addEventListener('click', setAsDefault);

  // Collision warning buttons
  elements.renameBtn.addEventListener('click', () => {
    elements.filenameInput.focus();
    elements.filenameInput.select();
  });

  elements.overwriteBtn.addEventListener('click', () => {
    overwriteConfirmed = true;
    hideCollisionWarning();
    updateSendButton();
  });

  // Clear button
  if (elements.clearBtn) {
    elements.clearBtn.addEventListener('click', clearDraft);
  }

  // Paste from clipboard button
  if (elements.pasteBtn) {
    elements.pasteBtn.addEventListener('click', pasteFromClipboard);
  }

  // Interactive mode button
  if (elements.interactiveBtn) {
    elements.interactiveBtn.addEventListener('click', openInteractiveMode);
  }
}

/**
 * Open the side panel for interactive mode
 */
async function openInteractiveMode() {
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      // Open side panel
      await chrome.sidePanel.open({ tabId: tab.id });
      // Close popup
      window.close();
    }
  } catch (e) {
    console.error('Failed to open side panel:', e);
    setStatus('Error opening side panel', 'error');
  }
}

/**
 * Update UI based on config
 */
function updateUI() {
  if (config.servers.length === 0) {
    elements.noConfig.classList.remove('hidden');
    elements.mainContent.classList.add('hidden');
    return;
  }

  elements.noConfig.classList.add('hidden');
  elements.mainContent.classList.remove('hidden');

  // Populate server dropdown
  populateServerDropdown();

  // Set default view mode
  setViewMode(config.defaultViewMode);
}

/**
 * Populate server dropdown
 */
function populateServerDropdown() {
  elements.serverSelect.innerHTML = '<option value="">Select server...</option>';

  config.servers.forEach(server => {
    const option = document.createElement('option');
    option.value = server.id;
    option.textContent = server.name + (server.id === config.defaultServerId ? ' ★' : '');
    elements.serverSelect.appendChild(option);
  });

  // Select default server
  if (config.defaultServerId) {
    elements.serverSelect.value = config.defaultServerId;
    onServerChange();
  }
}

/**
 * Handle server selection change
 */
function onServerChange() {
  const serverId = elements.serverSelect.value;
  selectedServer = config.servers.find(s => s.id === serverId) || null;

  // Reset collision state
  fileExists = false;
  overwriteConfirmed = false;
  hideCollisionWarning();

  // Populate projects
  populateProjectDropdown();

  updateSendButton();
}

/**
 * Populate project dropdown for selected server
 */
function populateProjectDropdown() {
  elements.projectSelect.innerHTML = '<option value="">Select project...</option>';

  if (!selectedServer || !selectedServer.projects) {
    elements.projectSelect.disabled = true;
    selectedProject = null;
    return;
  }

  elements.projectSelect.disabled = false;

  selectedServer.projects.forEach(project => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name + (project.id === selectedServer.defaultProjectId ? ' ★' : '');
    elements.projectSelect.appendChild(option);
  });

  // Select default project
  if (selectedServer.defaultProjectId) {
    elements.projectSelect.value = selectedServer.defaultProjectId;
    onProjectChange();
  }
}

/**
 * Handle project selection change
 */
function onProjectChange() {
  const projectId = elements.projectSelect.value;
  if (selectedServer && selectedServer.projects) {
    selectedProject = selectedServer.projects.find(p => p.id === projectId) || null;
  } else {
    selectedProject = null;
  }

  // Reset collision state
  fileExists = false;
  overwriteConfirmed = false;
  hideCollisionWarning();

  updateSendButton();
}

/**
 * Handle filename change
 */
function onFilenameChange() {
  fileExists = false;
  overwriteConfirmed = false;
  hideCollisionWarning();
  updateSendButton();
}

/**
 * Save current state as draft
 */
function saveDraft() {
  const draft = {
    content: elements.editor.value,
    filename: elements.filenameInput.value,
    selectedServer: elements.serverSelect.value,
    selectedProject: elements.projectSelect.value,
    viewMode: currentViewMode,
    lastSaved: new Date().toISOString()
  };
  chrome.storage.local.set({ draft });
}

/**
 * Restore draft or auto-fill from clipboard/pending content
 */
async function restoreOrAutoFill() {
  // First check for pending content (from context menu) - highest priority
  const data = await new Promise(resolve => {
    chrome.storage.local.get(['pendingContent', 'draft'], resolve);
  });

  if (data.pendingContent) {
    elements.editor.value = data.pendingContent;
    chrome.storage.local.remove(['pendingContent']);
    updatePreview();
    updateSendButton();
    saveDraft();
    return;
  }

  // Check for saved draft (restore if any field is saved)
  if (data.draft && (data.draft.content || data.draft.selectedServer || data.draft.filename)) {
    // 1. Restore editor content
    elements.editor.value = data.draft.content || '';

    // 2. Restore filename
    if (data.draft.filename) {
      elements.filenameInput.value = data.draft.filename;
    }

    // 3. Restore view mode
    if (data.draft.viewMode) {
      setViewMode(data.draft.viewMode);
    }

    // 4. Restore server selection and trigger change event
    if (data.draft.selectedServer) {
      elements.serverSelect.value = data.draft.selectedServer;
      onServerChange(); // This populates the project dropdown

      // 5. Restore project selection after dropdown populates
      if (data.draft.selectedProject) {
        // 100ms delay needed for project dropdown to populate asynchronously
        setTimeout(() => {
          elements.projectSelect.value = data.draft.selectedProject;
          onProjectChange();
          updateSendButton();
        }, 100);
      }
    }

    updatePreview();
    updateSendButton();
    return;
  }

  // No draft - try clipboard auto-fill
  if (config.autoClipboard) {
    await pasteFromClipboard();
  }
}

/**
 * Paste content from clipboard
 */
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) {
      elements.editor.value = text;
      updatePreview();
      updateSendButton();
      saveDraft();
    }
  } catch (e) {
    // Clipboard access denied or empty
    console.log('Could not read clipboard:', e);
  }
}

/**
 * Clear editor and draft
 */
async function clearDraft() {
  elements.editor.value = '';
  elements.filenameInput.value = config.defaultFilename || 'plan.md';
  await chrome.storage.local.remove(['draft']);
  updatePreview();
  updateSendButton();
  setStatus('Cleared', 'info');
}

/**
 * Setup markdown preview
 */
function setupMarkdownPreview() {
  // Configure marked if available
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
  }
  updatePreview();
}

/**
 * Update markdown preview
 */
function updatePreview() {
  const content = elements.editor.value;

  if (typeof marked !== 'undefined') {
    try {
      elements.preview.innerHTML = marked.parse(content);
    } catch (e) {
      elements.preview.textContent = content;
    }
  } else {
    // Fallback: just show text
    elements.preview.textContent = content;
  }

  updateSendButton();
}

/**
 * Set view mode (split, edit, preview)
 */
function setViewMode(mode) {
  currentViewMode = mode;
  elements.editorContainer.dataset.mode = mode;

  elements.toggleBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

/**
 * Update send button state
 */
function updateSendButton() {
  const hasServer = !!selectedServer;
  const hasProject = !!selectedProject;
  const hasContent = elements.editor.value.trim().length > 0;
  const hasFilename = elements.filenameInput.value.trim().length > 0;
  const canSend = hasServer && hasProject && hasContent && hasFilename;

  elements.sendBtn.disabled = !canSend || (fileExists && !overwriteConfirmed);
}

/**
 * Show collision warning
 */
function showCollisionWarning(info) {
  elements.collisionText.textContent = `"${elements.filenameInput.value}" already exists (${formatSize(info.size)}, modified ${info.modified})`;
  elements.collisionWarning.classList.remove('hidden');
}

/**
 * Hide collision warning
 */
function hideCollisionWarning() {
  elements.collisionWarning.classList.add('hidden');
}

/**
 * Format file size
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Set current selection as default
 */
async function setAsDefault() {
  if (!selectedServer) return;

  config.defaultServerId = selectedServer.id;

  if (selectedProject) {
    selectedServer.defaultProjectId = selectedProject.id;
  }

  await new Promise(resolve => {
    chrome.storage.sync.set({
      servers: config.servers,
      defaultServerId: config.defaultServerId
    }, resolve);
  });

  setStatus('Saved as default', 'success');
  populateServerDropdown();
  populateProjectDropdown();
}

/**
 * Send file to server
 */
async function sendFile() {
  if (!selectedServer || !selectedProject) return;

  const content = elements.editor.value.trim();
  const filename = elements.filenameInput.value.trim();

  if (!content || !filename) return;

  // Build remote path
  const remotePath = selectedProject.path.replace(/\/$/, '') + '/' + filename;

  // Build SSH target
  let sshTarget = selectedServer.sshTarget;
  if (selectedServer.sshType === 'direct') {
    sshTarget = `${selectedServer.username}@${selectedServer.host}`;
  }

  try {
    // Step 1: Check if file exists (unless already confirmed overwrite)
    if (!overwriteConfirmed) {
      setStatus('Checking...', 'working');
      elements.sendBtn.disabled = true;

      const checkResult = await sendNativeMessage({
        action: 'check_file',
        ssh_target: sshTarget,
        remote_path: remotePath,
        ssh_key: selectedServer.sshKey || undefined,
        ssh_port: selectedServer.sshPort || undefined
      });

      if (checkResult.status === 'error') {
        setStatus('Error: ' + checkResult.message, 'error');
        updateSendButton();
        return;
      }

      if (checkResult.exists) {
        fileExists = true;
        showCollisionWarning(checkResult);
        setStatus('File exists - rename or confirm overwrite', 'warning');
        updateSendButton();
        return;
      }
    }

    // Step 2: Send the file
    setStatus('Sending...', 'working');
    elements.sendBtn.disabled = true;

    const sendResult = await sendNativeMessage({
      action: 'send_file',
      ssh_target: sshTarget,
      remote_path: remotePath,
      content: content,
      overwrite: overwriteConfirmed,
      ssh_key: selectedServer.sshKey || undefined,
      ssh_port: selectedServer.sshPort || undefined
    });

    if (sendResult.status === 'success') {
      setStatus('✓ Sent to ' + selectedServer.name, 'success');
      fileExists = false;
      overwriteConfirmed = false;
      hideCollisionWarning();
      // Clear draft after successful send
      await chrome.storage.local.remove(['draft']);
    } else {
      setStatus('Error: ' + sendResult.message, 'error');
    }

  } catch (e) {
    setStatus('Error: ' + e.message, 'error');
  }

  updateSendButton();
}

/**
 * Send message to native host via background script
 */
function sendNativeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'native', payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || 'Unknown error'));
      }
    });
  });
}

/**
 * Set status message
 */
function setStatus(message, type = 'info') {
  elements.status.textContent = message;
  elements.status.className = 'status ' + type;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
