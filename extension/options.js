/**
 * PlanDrop Options Page Script
 * Handles server/project configuration
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
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.value = mode;
    }
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
      const themeSelect = document.getElementById('theme-select');
      if (themeSelect) {
        themeSelect.value = newTheme;
      }
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

// State
let config = {
  servers: [],
  defaultServerId: null,
  defaultFilename: 'plan.md',
  autoClipboard: true,
  defaultViewMode: 'split',
  customProfiles: {}
};

let editingServerId = null;
let editingProjectId = null;
let editingServerIdForProject = null;
let editingProfileId = null;
let profileAllowList = [];
let profileDenyList = [];

// DOM Elements
const elements = {};

/**
 * Initialize options page
 */
async function init() {
  // Cache DOM elements
  elements.serversList = document.getElementById('servers-list');
  elements.addServerBtn = document.getElementById('add-server-btn');
  elements.serverModal = document.getElementById('server-modal');
  elements.serverModalTitle = document.getElementById('server-modal-title');
  elements.projectModal = document.getElementById('project-modal');
  elements.projectModalTitle = document.getElementById('project-modal-title');

  // Server form fields
  elements.serverName = document.getElementById('server-name');
  elements.sshAlias = document.getElementById('ssh-alias');
  elements.sshHost = document.getElementById('ssh-host');
  elements.sshPort = document.getElementById('ssh-port');
  elements.sshUsername = document.getElementById('ssh-username');
  elements.sshKey = document.getElementById('ssh-key');
  elements.aliasFields = document.getElementById('alias-fields');
  elements.directFields = document.getElementById('direct-fields');
  elements.testConnectionBtn = document.getElementById('test-connection-btn');
  elements.testResult = document.getElementById('test-result');
  elements.saveServerBtn = document.getElementById('save-server-btn');

  // Project form fields
  elements.projectName = document.getElementById('project-name');
  elements.projectPath = document.getElementById('project-path');
  elements.projectInteractive = document.getElementById('project-interactive');
  elements.projectProfile = document.getElementById('project-profile');
  elements.projectModel = document.getElementById('project-model');
  elements.saveProjectBtn = document.getElementById('save-project-btn');

  // Custom profiles
  elements.customProfilesList = document.getElementById('custom-profiles-list');
  elements.addProfileBtn = document.getElementById('add-profile-btn');
  elements.profileModal = document.getElementById('profile-modal');
  elements.profileModalTitle = document.getElementById('profile-modal-title');
  elements.profileName = document.getElementById('profile-name');
  elements.profileBase = document.getElementById('profile-base');
  elements.profileAllowList = document.getElementById('profile-allow-list');
  elements.profileAllowInput = document.getElementById('profile-allow-input');
  elements.addAllowBtn = document.getElementById('add-allow-btn');
  elements.profileDenyList = document.getElementById('profile-deny-list');
  elements.profileDenyInput = document.getElementById('profile-deny-input');
  elements.addDenyBtn = document.getElementById('add-deny-btn');
  elements.saveProfileBtn = document.getElementById('save-profile-btn');

  // General settings
  elements.themeSelect = document.getElementById('theme-select');
  elements.defaultFilename = document.getElementById('default-filename');
  elements.autoClipboard = document.getElementById('auto-clipboard');
  elements.defaultView = document.getElementById('default-view');

  // Import/Export
  elements.exportBtn = document.getElementById('export-btn');
  elements.importBtn = document.getElementById('import-btn');
  elements.importFile = document.getElementById('import-file');

  // Load config
  await loadConfig();

  // Setup event listeners
  setupEventListeners();

  // Initialize theme
  initTheme();

  // Render lists
  renderServersList();
  renderCustomProfilesList();
}

/**
 * Load configuration from storage
 */
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['servers', 'defaultServerId', 'defaultFilename', 'autoClipboard', 'defaultViewMode'], (syncData) => {
      config.servers = syncData.servers || [];
      config.defaultServerId = syncData.defaultServerId || null;
      config.defaultFilename = syncData.defaultFilename || 'plan.md';
      config.autoClipboard = syncData.autoClipboard !== false;
      config.defaultViewMode = syncData.defaultViewMode || 'split';

      // Update UI
      elements.defaultFilename.value = config.defaultFilename;
      elements.autoClipboard.checked = config.autoClipboard;
      elements.defaultView.value = config.defaultViewMode;

      // Load custom profiles from local storage (can be larger)
      chrome.storage.local.get(['customProfiles'], (localData) => {
        config.customProfiles = localData.customProfiles || {};
        resolve();
      });
    });
  });
}

/**
 * Save configuration to storage
 */
async function saveConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.set({
      servers: config.servers,
      defaultServerId: config.defaultServerId,
      defaultFilename: config.defaultFilename,
      autoClipboard: config.autoClipboard,
      defaultViewMode: config.defaultViewMode
    }, resolve);
  });
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Add server button
  elements.addServerBtn.addEventListener('click', () => openServerModal());

  // SSH type toggle
  document.querySelectorAll('input[name="ssh-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const isAlias = e.target.value === 'alias';
      elements.aliasFields.classList.toggle('hidden', !isAlias);
      elements.directFields.classList.toggle('hidden', isAlias);
    });
  });

  // Test connection
  elements.testConnectionBtn.addEventListener('click', testConnection);

  // Save server
  elements.saveServerBtn.addEventListener('click', saveServer);

  // Save project
  elements.saveProjectBtn.addEventListener('click', saveProject);

  // Close modal buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.close;
      document.getElementById(modalId).classList.add('hidden');
    });
  });

  // Event delegation for dynamically created buttons
  elements.serversList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const serverId = btn.dataset.serverId;
    const projectId = btn.dataset.projectId;

    switch (action) {
      case 'set-default-server':
        setDefaultServer(serverId);
        break;
      case 'edit-server':
        openServerModal(serverId);
        break;
      case 'delete-server':
        deleteServer(serverId);
        break;
      case 'add-project':
        openProjectModal(serverId);
        break;
      case 'set-default-project':
        setDefaultProject(serverId, projectId);
        break;
      case 'edit-project':
        openProjectModal(serverId, projectId);
        break;
      case 'delete-project':
        deleteProject(serverId, projectId);
        break;
    }
  });

  // General settings changes
  elements.themeSelect.addEventListener('change', (e) => {
    const mode = e.target.value;
    chrome.storage.local.set({ theme: mode });
    applyTheme(mode);
  });

  elements.defaultFilename.addEventListener('change', () => {
    config.defaultFilename = elements.defaultFilename.value;
    saveConfig();
  });

  elements.autoClipboard.addEventListener('change', () => {
    config.autoClipboard = elements.autoClipboard.checked;
    saveConfig();
  });

  elements.defaultView.addEventListener('change', () => {
    config.defaultViewMode = elements.defaultView.value;
    saveConfig();
  });

  // Import/Export
  elements.exportBtn.addEventListener('click', exportSettings);
  elements.importBtn.addEventListener('click', () => elements.importFile.click());
  elements.importFile.addEventListener('change', importSettings);

  // Custom profiles
  elements.addProfileBtn.addEventListener('click', () => openProfileModal());
  elements.addAllowBtn.addEventListener('click', addAllowTag);
  elements.addDenyBtn.addEventListener('click', addDenyTag);
  elements.saveProfileBtn.addEventListener('click', saveProfile);

  // Allow enter key for adding tags
  elements.profileAllowInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addAllowTag();
    }
  });
  elements.profileDenyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addDenyTag();
    }
  });

  // Event delegation for custom profiles list
  elements.customProfilesList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const profileId = btn.dataset.profileId;

    switch (action) {
      case 'edit-profile':
        openProfileModal(profileId);
        break;
      case 'delete-profile':
        deleteProfile(profileId);
        break;
    }
  });
}

/**
 * Render servers list
 */
function renderServersList() {
  if (config.servers.length === 0) {
    elements.serversList.innerHTML = '<div class="empty-state">No servers configured. Add a server to get started.</div>';
    return;
  }

  elements.serversList.innerHTML = config.servers.map(server => `
    <div class="list-item server-item" data-server-id="${server.id}">
      <div class="item-header">
        <div class="item-info">
          <span class="item-name">${escapeHtml(server.name)}${server.id === config.defaultServerId ? ' <span class="default-badge">★ Default</span>' : ''}</span>
          <span class="item-detail">${escapeHtml(server.sshTarget || server.host)}</span>
        </div>
        <div class="item-actions">
          <button class="btn btn-small btn-secondary" data-action="set-default-server" data-server-id="${server.id}">Set Default</button>
          <button class="btn btn-small btn-secondary" data-action="edit-server" data-server-id="${server.id}">Edit</button>
          <button class="btn btn-small btn-danger" data-action="delete-server" data-server-id="${server.id}">Delete</button>
        </div>
      </div>
      <div class="projects-section">
        <div class="projects-header">
          <span>Projects</span>
          <button class="btn btn-small btn-secondary" data-action="add-project" data-server-id="${server.id}">+ Add Project</button>
        </div>
        <div class="projects-list">
          ${(server.projects || []).length === 0 ? '<div class="empty-state small">No projects. Add a project to specify remote directories.</div>' : ''}
          ${(server.projects || []).map(project => `
            <div class="project-item">
              <span class="project-name">${escapeHtml(project.name)}${project.id === server.defaultProjectId ? ' <span class="default-badge">★</span>' : ''}</span>
              <span class="project-path">${escapeHtml(project.path)}</span>
              <div class="project-settings">
                ${project.interactive ? '<span class="project-badge interactive">Interactive</span>' : ''}
                ${project.profile ? `<span class="project-badge">${escapeHtml(project.profile)}</span>` : ''}
              </div>
              <div class="project-actions">
                <button class="btn btn-tiny" data-action="set-default-project" data-server-id="${server.id}" data-project-id="${project.id}">Default</button>
                <button class="btn btn-tiny" data-action="edit-project" data-server-id="${server.id}" data-project-id="${project.id}">Edit</button>
                <button class="btn btn-tiny btn-danger" data-action="delete-project" data-server-id="${server.id}" data-project-id="${project.id}">×</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Open server modal for add/edit
 */
function openServerModal(serverId = null) {
  editingServerId = serverId;

  // Reset form
  elements.serverName.value = '';
  elements.sshAlias.value = '';
  elements.sshHost.value = '';
  elements.sshPort.value = '22';
  elements.sshUsername.value = '';
  elements.sshKey.value = '';
  elements.testResult.textContent = '';

  document.querySelector('input[name="ssh-type"][value="alias"]').checked = true;
  elements.aliasFields.classList.remove('hidden');
  elements.directFields.classList.add('hidden');

  if (serverId) {
    // Edit mode
    const server = config.servers.find(s => s.id === serverId);
    if (server) {
      elements.serverModalTitle.textContent = 'Edit Server';
      elements.serverName.value = server.name;

      if (server.sshType === 'direct') {
        document.querySelector('input[name="ssh-type"][value="direct"]').checked = true;
        elements.aliasFields.classList.add('hidden');
        elements.directFields.classList.remove('hidden');
        elements.sshHost.value = server.host || '';
        elements.sshPort.value = server.sshPort || '22';
        elements.sshUsername.value = server.username || '';
        elements.sshKey.value = server.sshKey || '';
      } else {
        elements.sshAlias.value = server.sshTarget || '';
      }
    }
  } else {
    elements.serverModalTitle.textContent = 'Add Server';
  }

  elements.serverModal.classList.remove('hidden');
}

/**
 * Save server
 */
async function saveServer() {
  const name = elements.serverName.value.trim();
  const sshType = document.querySelector('input[name="ssh-type"]:checked').value;

  if (!name) {
    alert('Please enter a server name');
    return;
  }

  let serverData = {
    name,
    sshType
  };

  if (sshType === 'alias') {
    const alias = elements.sshAlias.value.trim();
    if (!alias) {
      alert('Please enter an SSH alias');
      return;
    }
    serverData.sshTarget = alias;
  } else {
    const host = elements.sshHost.value.trim();
    const username = elements.sshUsername.value.trim();
    if (!host || !username) {
      alert('Please enter hostname and username');
      return;
    }
    serverData.host = host;
    serverData.username = username;
    serverData.sshPort = parseInt(elements.sshPort.value) || 22;
    serverData.sshKey = elements.sshKey.value.trim() || null;
    serverData.sshTarget = `${username}@${host}`;
  }

  if (editingServerId) {
    // Update existing
    const index = config.servers.findIndex(s => s.id === editingServerId);
    if (index >= 0) {
      serverData.id = editingServerId;
      serverData.projects = config.servers[index].projects || [];
      serverData.defaultProjectId = config.servers[index].defaultProjectId;
      config.servers[index] = serverData;
    }
  } else {
    // Add new
    serverData.id = generateId();
    serverData.projects = [];
    config.servers.push(serverData);

    // Set as default if it's the first server
    if (config.servers.length === 1) {
      config.defaultServerId = serverData.id;
    }
  }

  await saveConfig();
  renderServersList();
  elements.serverModal.classList.add('hidden');
}

/**
 * Delete server
 */
async function deleteServer(serverId) {
  if (!confirm('Delete this server and all its projects?')) return;

  config.servers = config.servers.filter(s => s.id !== serverId);

  if (config.defaultServerId === serverId) {
    config.defaultServerId = config.servers.length > 0 ? config.servers[0].id : null;
  }

  await saveConfig();
  renderServersList();
}

/**
 * Set default server
 */
async function setDefaultServer(serverId) {
  config.defaultServerId = serverId;
  await saveConfig();
  renderServersList();
}

/**
 * Open project modal
 */
function openProjectModal(serverId, projectId = null) {
  editingServerIdForProject = serverId;
  editingProjectId = projectId;

  // Reset form
  elements.projectName.value = '';
  elements.projectPath.value = '';
  elements.projectInteractive.checked = false;
  elements.projectProfile.value = 'standard';
  elements.projectModel.value = 'opus';

  // Populate custom profiles in dropdown
  updateProfileDropdown();

  if (projectId) {
    const server = config.servers.find(s => s.id === serverId);
    const project = server?.projects?.find(p => p.id === projectId);
    if (project) {
      elements.projectModalTitle.textContent = 'Edit Project';
      elements.projectName.value = project.name;
      elements.projectPath.value = project.path;
      elements.projectInteractive.checked = project.interactive || false;
      // Handle legacy profile names
      const profileValue = project.profile || 'standard';
      elements.projectProfile.value = profileValue;
      elements.projectModel.value = project.model || 'opus';
    }
  } else {
    elements.projectModalTitle.textContent = 'Add Project';
  }

  elements.projectModal.classList.remove('hidden');
}

/**
 * Update profile dropdown with custom profiles
 */
function updateProfileDropdown() {
  // Remove existing custom profile options
  const existingCustom = elements.projectProfile.querySelectorAll('option[data-custom]');
  existingCustom.forEach(opt => opt.remove());

  // Add custom profiles after built-in options
  for (const [id, profile] of Object.entries(config.customProfiles)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = profile.name + ' (Custom)';
    option.dataset.custom = 'true';
    elements.projectProfile.appendChild(option);
  }
}

/**
 * Save project
 */
async function saveProject() {
  const name = elements.projectName.value.trim();
  const path = elements.projectPath.value.trim();

  if (!name || !path) {
    alert('Please enter project name and path');
    return;
  }

  const server = config.servers.find(s => s.id === editingServerIdForProject);
  if (!server) return;

  if (!server.projects) server.projects = [];

  const projectData = {
    name,
    path,
    interactive: elements.projectInteractive.checked,
    profile: elements.projectProfile.value,
    model: elements.projectModel.value
  };

  if (editingProjectId) {
    const index = server.projects.findIndex(p => p.id === editingProjectId);
    if (index >= 0) {
      projectData.id = editingProjectId;
      server.projects[index] = projectData;
    }
  } else {
    projectData.id = generateId();
    server.projects.push(projectData);

    // Set as default if it's the first project
    if (server.projects.length === 1) {
      server.defaultProjectId = projectData.id;
    }
  }

  await saveConfig();
  renderServersList();
  elements.projectModal.classList.add('hidden');
}

/**
 * Delete project
 */
async function deleteProject(serverId, projectId) {
  if (!confirm('Delete this project?')) return;

  const server = config.servers.find(s => s.id === serverId);
  if (!server) return;

  server.projects = (server.projects || []).filter(p => p.id !== projectId);

  if (server.defaultProjectId === projectId) {
    server.defaultProjectId = server.projects.length > 0 ? server.projects[0].id : null;
  }

  await saveConfig();
  renderServersList();
}

/**
 * Set default project
 */
async function setDefaultProject(serverId, projectId) {
  const server = config.servers.find(s => s.id === serverId);
  if (!server) return;

  server.defaultProjectId = projectId;
  await saveConfig();
  renderServersList();
}

/**
 * Test SSH connection
 */
async function testConnection() {
  const sshType = document.querySelector('input[name="ssh-type"]:checked').value;
  let sshTarget;

  if (sshType === 'alias') {
    sshTarget = elements.sshAlias.value.trim();
  } else {
    const host = elements.sshHost.value.trim();
    const username = elements.sshUsername.value.trim();
    if (!host || !username) {
      elements.testResult.textContent = 'Enter host and username';
      elements.testResult.className = 'test-result error';
      return;
    }
    sshTarget = `${username}@${host}`;
  }

  if (!sshTarget) {
    elements.testResult.textContent = 'Enter SSH target';
    elements.testResult.className = 'test-result error';
    return;
  }

  elements.testResult.textContent = 'Testing...';
  elements.testResult.className = 'test-result';
  elements.testConnectionBtn.disabled = true;

  try {
    const result = await sendNativeMessage({
      action: 'test_conn',
      ssh_target: sshTarget,
      ssh_port: sshType === 'direct' ? parseInt(elements.sshPort.value) : undefined,
      ssh_key: sshType === 'direct' ? elements.sshKey.value.trim() : undefined
    });

    if (result.status === 'success') {
      elements.testResult.textContent = '✓ ' + result.message;
      elements.testResult.className = 'test-result success';
    } else {
      elements.testResult.textContent = '✗ ' + result.message;
      elements.testResult.className = 'test-result error';
    }
  } catch (e) {
    elements.testResult.textContent = '✗ ' + e.message;
    elements.testResult.className = 'test-result error';
  }

  elements.testConnectionBtn.disabled = false;
}

/**
 * Export settings
 */
function exportSettings() {
  const data = JSON.stringify(config, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'plandrop-config.json';
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Import settings
 */
async function importSettings(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.servers) config.servers = data.servers;
    if (data.defaultServerId) config.defaultServerId = data.defaultServerId;
    if (data.defaultFilename) config.defaultFilename = data.defaultFilename;
    if (typeof data.autoClipboard === 'boolean') config.autoClipboard = data.autoClipboard;
    if (data.defaultViewMode) config.defaultViewMode = data.defaultViewMode;

    await saveConfig();

    // Update UI
    elements.defaultFilename.value = config.defaultFilename;
    elements.autoClipboard.checked = config.autoClipboard;
    elements.defaultView.value = config.defaultViewMode;
    renderServersList();

    alert('Settings imported successfully!');
  } catch (e) {
    alert('Failed to import settings: ' + e.message);
  }

  // Reset file input
  elements.importFile.value = '';
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
 * Generate unique ID
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// Custom Profiles
// ============================================

/**
 * Render custom profiles list
 */
function renderCustomProfilesList() {
  const profiles = Object.entries(config.customProfiles);

  if (profiles.length === 0) {
    elements.customProfilesList.innerHTML = '<div class="empty-state">No custom profiles. Use the built-in profiles or create your own.</div>';
    return;
  }

  elements.customProfilesList.innerHTML = profiles.map(([id, profile]) => `
    <div class="profile-item" data-profile-id="${id}">
      <div class="profile-info">
        <span class="profile-name">${escapeHtml(profile.name)}</span>
        <span class="profile-meta">Based on: ${escapeHtml(profile.base)} | +${profile.additionalAllow?.length || 0} allowed, +${profile.additionalDeny?.length || 0} blocked</span>
      </div>
      <div class="profile-actions">
        <button class="btn btn-small btn-secondary" data-action="edit-profile" data-profile-id="${id}">Edit</button>
        <button class="btn btn-small btn-danger" data-action="delete-profile" data-profile-id="${id}">Delete</button>
      </div>
    </div>
  `).join('');
}

/**
 * Open profile modal
 */
function openProfileModal(profileId = null) {
  editingProfileId = profileId;
  profileAllowList = [];
  profileDenyList = [];

  // Reset form
  elements.profileName.value = '';
  elements.profileBase.value = 'standard';
  elements.profileAllowInput.value = '';
  elements.profileDenyInput.value = '';

  if (profileId && config.customProfiles[profileId]) {
    const profile = config.customProfiles[profileId];
    elements.profileModalTitle.textContent = 'Edit Custom Profile';
    elements.profileName.value = profile.name;
    elements.profileBase.value = profile.base;
    profileAllowList = [...(profile.additionalAllow || [])];
    profileDenyList = [...(profile.additionalDeny || [])];
  } else {
    elements.profileModalTitle.textContent = 'New Custom Profile';
  }

  renderTagLists();
  elements.profileModal.classList.remove('hidden');
}

/**
 * Render tag lists for allow/deny
 */
function renderTagLists() {
  elements.profileAllowList.innerHTML = profileAllowList.map(cmd => `
    <span class="tag">
      ${escapeHtml(cmd)}
      <button class="tag-remove" data-cmd="${escapeHtml(cmd)}" data-list="allow">&times;</button>
    </span>
  `).join('');

  elements.profileDenyList.innerHTML = profileDenyList.map(cmd => `
    <span class="tag deny">
      ${escapeHtml(cmd)}
      <button class="tag-remove" data-cmd="${escapeHtml(cmd)}" data-list="deny">&times;</button>
    </span>
  `).join('');

  // Add remove handlers
  elements.profileAllowList.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      profileAllowList = profileAllowList.filter(c => c !== btn.dataset.cmd);
      renderTagLists();
    });
  });

  elements.profileDenyList.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      profileDenyList = profileDenyList.filter(c => c !== btn.dataset.cmd);
      renderTagLists();
    });
  });
}

/**
 * Add command to allow list
 */
function addAllowTag() {
  const cmd = elements.profileAllowInput.value.trim();
  if (cmd && !profileAllowList.includes(cmd)) {
    profileAllowList.push(cmd);
    elements.profileAllowInput.value = '';
    renderTagLists();
  }
}

/**
 * Add command to deny list
 */
function addDenyTag() {
  const cmd = elements.profileDenyInput.value.trim();
  if (cmd && !profileDenyList.includes(cmd)) {
    profileDenyList.push(cmd);
    elements.profileDenyInput.value = '';
    renderTagLists();
  }
}

/**
 * Save custom profile
 */
async function saveProfile() {
  const name = elements.profileName.value.trim();
  const base = elements.profileBase.value;

  if (!name) {
    alert('Please enter a profile name');
    return;
  }

  const profileId = editingProfileId || generateId();
  const profileData = {
    name,
    base,
    additionalAllow: profileAllowList.map(cmd => `Bash(${cmd}:*)`),
    additionalDeny: profileDenyList.map(cmd => `Bash(${cmd}:*)`)
  };

  config.customProfiles[profileId] = profileData;

  // Save to local storage
  await new Promise(resolve => {
    chrome.storage.local.set({ customProfiles: config.customProfiles }, resolve);
  });

  renderCustomProfilesList();
  elements.profileModal.classList.add('hidden');
}

/**
 * Delete custom profile
 */
async function deleteProfile(profileId) {
  if (!confirm('Delete this custom profile?')) return;

  delete config.customProfiles[profileId];

  await new Promise(resolve => {
    chrome.storage.local.set({ customProfiles: config.customProfiles }, resolve);
  });

  renderCustomProfilesList();
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
