/**
 * PlanDrop Options Page Script
 * Handles server/project configuration
 */

// State
let config = {
  servers: [],
  defaultServerId: null,
  defaultFilename: 'plan.md',
  autoClipboard: true,
  defaultViewMode: 'split'
};

let editingServerId = null;
let editingProjectId = null;
let editingServerIdForProject = null;

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
  elements.saveProjectBtn = document.getElementById('save-project-btn');

  // General settings
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

  // Render servers
  renderServersList();
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

      // Update UI
      elements.defaultFilename.value = config.defaultFilename;
      elements.autoClipboard.checked = config.autoClipboard;
      elements.defaultView.value = config.defaultViewMode;

      resolve();
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

  elements.projectName.value = '';
  elements.projectPath.value = '';

  if (projectId) {
    const server = config.servers.find(s => s.id === serverId);
    const project = server?.projects?.find(p => p.id === projectId);
    if (project) {
      elements.projectModalTitle.textContent = 'Edit Project';
      elements.projectName.value = project.name;
      elements.projectPath.value = project.path;
    }
  } else {
    elements.projectModalTitle.textContent = 'Add Project';
  }

  elements.projectModal.classList.remove('hidden');
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

  const projectData = { name, path };

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

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
