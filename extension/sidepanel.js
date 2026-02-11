/**
 * PlanDrop Side Panel Script
 * Handles interactive mode with bidirectional communication
 */

// Constants
const POLL_INTERVAL = 3000; // 3 seconds
const HEARTBEAT_TIMEOUT = 10000; // 10 seconds

// Permission profiles (deny-list based)
// Uses Claude Code's native --disallowedTools CLI flag for hard security boundaries
const PROFILE_INFO = {
  plan_only: {
    name: 'Plan Only',
    description: 'Read-only. Claude suggests changes but cannot execute.',
    permissionMode: 'plan',
    disallowedTools: null, // N/A — stays in plan mode
    color: '#4A90D9'
  },
  edit_files: {
    name: 'Edit Files Only',
    description: 'Read and write files. No shell commands.',
    permissionMode: 'bypassPermissions',
    disallowedTools: 'Bash',
    color: '#34A853'
  },
  standard: {
    name: 'Standard',
    description: 'Full access except dangerous system commands.',
    permissionMode: 'bypassPermissions',
    disallowedTools: [
      'Bash(sudo:*)', 'Bash(su:*)', 'Bash(pkexec:*)',
      'Bash(shutdown:*)', 'Bash(reboot:*)', 'Bash(halt:*)', 'Bash(poweroff:*)',
      'Bash(init 0:*)', 'Bash(init 6:*)',
      'Bash(systemctl poweroff:*)', 'Bash(systemctl reboot:*)',
      'Bash(mkfs:*)', 'Bash(dd if=:*)',
      'Bash(chmod -R 777:*)',
      'Bash(killall:*)', 'Bash(crontab:*)',
      'Bash(rm -rf /:*)', 'Bash(rm -rf /*:*)'
    ].join(' '),
    color: '#F5A623'
  },
  full_access: {
    name: 'Full Access',
    description: 'No restrictions. Use only in sandboxed environments.',
    permissionMode: 'bypassPermissions',
    disallowedTools: null,
    color: '#DC3545',
    requiresConfirmation: true
  },
  custom: {
    name: 'Custom',
    description: 'Define your own blocked commands.',
    permissionMode: 'bypassPermissions',
    disallowedTools: null, // loaded from customDenyList
    color: '#888888'
  }
};

// Custom profile templates
const CUSTOM_TEMPLATES = {
  standard: [
    'Bash(sudo:*)', 'Bash(su:*)', 'Bash(pkexec:*)',
    'Bash(shutdown:*)', 'Bash(reboot:*)', 'Bash(halt:*)', 'Bash(poweroff:*)',
    'Bash(init 0:*)', 'Bash(init 6:*)',
    'Bash(systemctl poweroff:*)', 'Bash(systemctl reboot:*)',
    'Bash(mkfs:*)', 'Bash(dd if=:*)',
    'Bash(chmod -R 777:*)',
    'Bash(killall:*)', 'Bash(crontab:*)',
    'Bash(rm -rf /:*)', 'Bash(rm -rf /*:*)'
  ],
  restrictive: [
    'Bash(sudo:*)', 'Bash(su:*)', 'Bash(pkexec:*)',
    'Bash(shutdown:*)', 'Bash(reboot:*)', 'Bash(halt:*)', 'Bash(poweroff:*)',
    'Bash(init 0:*)', 'Bash(init 6:*)',
    'Bash(systemctl poweroff:*)', 'Bash(systemctl reboot:*)',
    'Bash(mkfs:*)', 'Bash(dd if=:*)',
    'Bash(chmod -R 777:*)',
    'Bash(killall:*)', 'Bash(crontab:*)',
    'Bash(rm -rf /:*)', 'Bash(rm -rf /*:*)',
    'Bash(rm -rf:*)',
    'Bash(ssh:*)', 'Bash(scp:*)', 'Bash(rsync:*)',
    'Bash(docker:*)', 'Bash(singularity:*)',
    'Bash(apt:*)', 'Bash(yum:*)', 'Bash(dnf:*)', 'Bash(brew:*)', 'Bash(snap:*)',
    'Bash(pip install:*)', 'Bash(conda install:*)', 'Bash(npm install:*)'
  ],
  minimal: ['Bash'],
  empty: []
};

// Patterns for highlighting destructive commands in plan phase
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[rRf]+\s+|--recursive|--force)/,   // any rm with recursive/force flags
  /\bchmod\s+(-R\s+)?[0-7]{3}/,                // chmod with octal permissions
  /\bchown\s+-R/,                              // recursive chown
  /\bmv\s+.*\s+\/dev\/null/,                   // mv to /dev/null
  /\btruncate\b/,                              // truncate files
  /\b>\s*\//,                                  // redirect overwrite to absolute path
  /\bdrop\s+(database|table)/i,                // SQL drops
  /\bDELETE\s+FROM/i,                          // SQL deletes
  /\bgit\s+(push\s+--force|reset\s+--hard)/,   // destructive git
  /\bformat\b/,                                // disk format
];

// Legacy profile mapping for backwards compatibility
const LEGACY_PROFILE_MAP = {
  'plan-only': 'plan_only',
  'edit-only': 'edit_files',
  'bioinformatics': 'standard',
  'ml-deeplearning': 'standard',
  'webdev': 'standard',
  'full-access': 'full_access'
};

// State
let config = { servers: [] };
let currentServer = null;
let currentProject = null;
let currentProfile = 'standard';
let currentModel = 'opus';
let currentPlanId = null;
let currentPhase = null; // 'plan', 'execute', or null
let sessionId = null;
let pollingTimer = null;
let heartbeatTimer = null;
let dashboardTimer = null;
let lastResponseLength = 0; // Track how much we've already rendered
let approvedTools = []; // Tools approved for re-run
let blockedCommandsData = {}; // Store blocked commands for copy functionality
let lastAppliedProfile = null; // Track which profile was last written to server
let activityHistory = []; // In-memory activity history for persistence
const MAX_ACTIVITY_ITEMS = 50; // Limit activity items per project
let profileHintShown = false; // Track if profile switch hint was shown this session
let heartbeatFailCount = 0; // Track consecutive heartbeat failures
const MAX_HEARTBEAT_FAILS = 3; // Number of failures before showing disconnected
let currentView = 'dashboard'; // 'dashboard' or 'detail'
let interactiveProjects = []; // List of projects with interactive mode enabled
let currentTabId = null; // Current browser tab ID
let heartbeatPending = false; // Prevent duplicate heartbeat calls
let pollPending = false; // Prevent duplicate poll calls
let currentApiSource = null; // Track API key source ('ANTHROPIC_API_KEY', 'oauth', 'none')
let activeTab = 'claudecode'; // 'quickdrop' or 'claudecode'
let customDenyList = null; // Custom profile deny list (space-separated string)
let pendingFullAccessConfirm = false; // Track if Full Access confirmation is pending

// Multi-instance lock state
const LOCK_TIMEOUT = 30000; // 30 seconds - lock expires if not refreshed
const LOCK_REFRESH_INTERVAL = 10000; // Refresh lock every 10 seconds
let instanceId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; // Unique ID for this instance
let lockRefreshTimer = null;

// Quick Drop state
let qdViewMode = 'edit'; // 'edit', 'split', 'preview'
let qdFileExists = false;
let qdOverwriteConfirmed = false;

// Gear menu state
let gearMenuCurrentView = 'main'; // 'main', 'history', 'cost', 'export-history', 'about'
let taskHistory = []; // Array of completed tasks

// Collapsible config state
let configExpanded = true; // Start expanded
let hasUserActed = false; // Track if user has sent a plan or executed

// Task history tracking
let currentTaskRequest = ''; // The original plan text
let currentTaskResponse = ''; // Claude's response text (first 500 chars)
let currentTaskFiles = []; // Files modified
let currentTaskCommands = []; // Commands run

// DOM Elements
const elements = {};

/**
 * Initialize the side panel
 */
async function init() {
  // Cache DOM elements - Dashboard
  elements.dashboardView = document.getElementById('dashboard-view');
  elements.detailView = document.getElementById('detail-view');
  elements.dashboardProjects = document.getElementById('dashboard-projects');
  elements.dashboardSettingsBtn = document.getElementById('dashboard-settings-btn');
  elements.backBtn = document.getElementById('back-btn');

  // Cache DOM elements - Detail View
  elements.serverSelect = document.getElementById('server-select');
  elements.projectSelect = document.getElementById('project-select');
  elements.profileSelect = document.getElementById('profile-select');
  elements.modelSelect = document.getElementById('model-select');
  elements.statusDot = document.getElementById('status-dot');
  elements.statusText = document.getElementById('status-text');
  elements.phaseIndicator = document.getElementById('phase-indicator');
  elements.connectBtn = document.getElementById('connect-btn');
  elements.newPlanContainer = document.getElementById('new-plan-container');
  elements.newPlanBtn = document.getElementById('new-plan-btn');
  elements.continueBtn = document.getElementById('continue-btn');
  elements.activityFeed = document.getElementById('activity-feed');
  elements.actionButtons = document.getElementById('action-buttons');
  elements.executeBtn = document.getElementById('execute-btn');
  elements.reviseBtn = document.getElementById('revise-btn');
  elements.cancelBtn = document.getElementById('cancel-btn');
  elements.blockedCommands = document.getElementById('blocked-commands');
  elements.blockedList = document.getElementById('blocked-list');
  elements.approveRerunBtn = document.getElementById('approve-and-rerun-btn');
  elements.copyAllBlockedBtn = document.getElementById('copy-all-blocked-btn');
  elements.skipBlockedBtn = document.getElementById('skip-blocked-btn');
  elements.watcherSetup = document.getElementById('watcher-setup');
  elements.setupCommands = document.getElementById('setup-commands');
  elements.copySetupBtn = document.getElementById('copy-setup-btn');
  elements.copyQuickBtn = document.getElementById('copy-quick-btn');
  elements.sessionIdDisplay = document.getElementById('session-id-display');
  elements.messageInput = document.getElementById('message-input');
  elements.sendPlanBtn = document.getElementById('send-plan-btn');
  elements.stopBtn = document.getElementById('stop-btn');
  elements.settingsBtn = document.getElementById('settings-btn');
  elements.resetSessionBtn = document.getElementById('reset-session-btn');

  // Cache DOM elements - Tabs
  elements.tabBar = document.getElementById('tab-bar');
  elements.tabQuickdrop = document.getElementById('tab-quickdrop');
  elements.tabClaudecode = document.getElementById('tab-claudecode');

  // Cache DOM elements - Tab-specific controls
  elements.ccConfigBar = document.getElementById('cc-config-bar');
  elements.ccFooter = document.getElementById('cc-footer');
  elements.backBtn = document.getElementById('back-btn');

  // Cache DOM elements - Collapsible config
  elements.configCollapsed = document.getElementById('config-collapsed');
  elements.configExpanded = document.getElementById('config-expanded');
  elements.configDot = document.getElementById('config-dot');
  elements.configStatusShort = document.getElementById('config-status-short');
  elements.configSummary = document.getElementById('config-summary');
  elements.configExpandBtn = document.getElementById('config-expand-btn');
  elements.configCollapseBtn = document.getElementById('config-collapse-btn');

  // Cache DOM elements - Quick Drop
  elements.qdEditorContainer = document.getElementById('qd-editor-container');
  elements.qdEditor = document.getElementById('qd-editor');
  elements.qdPreview = document.getElementById('qd-preview');
  elements.qdFilename = document.getElementById('qd-filename');
  elements.qdSendFileBtn = document.getElementById('qd-send-file-btn');
  elements.qdCollisionWarning = document.getElementById('qd-collision-warning');
  elements.qdCollisionText = document.getElementById('qd-collision-text');
  elements.qdOverwriteBtn = document.getElementById('qd-overwrite-btn');
  elements.qdStatus = document.getElementById('qd-status');
  elements.qdToggleBtns = document.querySelectorAll('#tab-quickdrop .toggle-btn');

  // Cache DOM elements - Gear Menu
  elements.gearMenuOverlay = document.getElementById('gear-menu-overlay');
  elements.gearMenuBack = document.getElementById('gear-menu-back');
  elements.gearMenuClose = document.getElementById('gear-menu-close');
  elements.gearMenuTitle = document.getElementById('gear-menu-title');
  elements.gearMenuMain = document.getElementById('gear-menu-main');
  elements.gearMenuHistory = document.getElementById('gear-menu-history');
  elements.gearMenuCost = document.getElementById('gear-menu-cost');
  elements.gearMenuAbout = document.getElementById('gear-menu-about');
  elements.gearMenuExportHistory = document.getElementById('gear-menu-export-history');
  elements.exportHistorySummaryBtn = document.getElementById('export-history-summary-btn');
  elements.exportHistoryFullBtn = document.getElementById('export-history-full-btn');
  elements.exportHistoryStatus = document.getElementById('export-history-status');
  elements.historyList = document.getElementById('history-list');
  elements.exportHistoryBtn = document.getElementById('export-history-btn');
  elements.clearHistoryBtn = document.getElementById('clear-history-btn');
  elements.importFileInput = document.getElementById('import-file-input');

  // Cache DOM elements - Custom Profile Editor
  elements.customProfileEditor = document.getElementById('custom-profile-editor');
  elements.customTemplateSelect = document.getElementById('custom-template-select');
  elements.customDenyList = document.getElementById('custom-deny-list');

  // Cache DOM elements - Full Access Dialog
  elements.fullAccessDialog = document.getElementById('full-access-dialog');
  elements.fullAccessCancel = document.getElementById('full-access-cancel');
  elements.fullAccessConfirm = document.getElementById('full-access-confirm');

  // Load config
  await loadConfig();

  // Setup event listeners
  setupEventListeners();

  // Check for pending content from context menu
  await checkPendingContent();

  // Get current tab ID
  await getCurrentTabId();

  // Check for tab binding or show dashboard
  await initializeView();
}

/**
 * Check for pending content from context menu
 */
async function checkPendingContent() {
  try {
    const { pendingContent, pendingAction } = await chrome.storage.session.get(['pendingContent', 'pendingAction']);

    if (pendingContent) {
      console.log('[Init] Found pending content from context menu');

      if (pendingAction === 'quickdrop' && elements.qdEditor) {
        // Switch to Quick Drop tab and paste content
        switchTab('quickdrop');
        elements.qdEditor.value = pendingContent;
        qdUpdatePreview();
        qdUpdateSendButton();
        qdSaveDraft();
      }

      // Clear pending content
      await chrome.storage.session.remove(['pendingContent', 'pendingAction']);
    }
  } catch (e) {
    console.log('Error checking pending content:', e);
  }
}

/**
 * Get current tab ID
 */
async function getCurrentTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        currentTabId = tabs[0].id;
      }
      resolve();
    });
  });
}

/**
 * Initialize view based on tab binding or interactive projects
 */
async function initializeView() {
  // Build list of interactive projects
  buildInteractiveProjectsList();

  // Check for tab binding
  if (currentTabId) {
    const bindingKey = `tab_project_${currentTabId}`;
    const data = await chrome.storage.session.get(bindingKey);
    const binding = data[bindingKey];

    if (binding && binding.serverId && binding.projectId) {
      // Found tab binding - go to detail view
      const server = config.servers.find(s => s.id === binding.serverId);
      const project = server?.projects?.find(p => p.id === binding.projectId);

      if (server && project) {
        openDetailView(server, project);
        return;
      }
    }
  }

  // No binding - check if we should skip dashboard
  if (interactiveProjects.length === 0) {
    // No interactive projects - show detail view with normal UI
    showDetailView();
    updateUI();
  } else if (interactiveProjects.length === 1) {
    // Only one interactive project - go directly to it
    const { server, project } = interactiveProjects[0];
    openDetailView(server, project);
  } else {
    // Multiple interactive projects - show dashboard
    showDashboard();
  }
}

/**
 * Build list of projects with interactive mode enabled
 */
function buildInteractiveProjectsList() {
  interactiveProjects = [];
  for (const server of config.servers) {
    if (server.projects) {
      for (const project of server.projects) {
        if (project.interactive) {
          interactiveProjects.push({ server, project });
        }
      }
    }
  }
}

/**
 * Show dashboard view
 */
function showDashboard() {
  currentView = 'dashboard';
  elements.dashboardView.classList.remove('hidden');
  elements.detailView.classList.add('hidden');

  // Stop detail view timers
  stopPolling();
  stopHeartbeatTimer();

  // Render dashboard
  renderDashboard();

  // Start dashboard polling
  startDashboardPolling();
}

/**
 * Show detail view
 */
function showDetailView() {
  currentView = 'detail';
  elements.dashboardView.classList.add('hidden');
  elements.detailView.classList.remove('hidden');

  // Stop dashboard polling
  stopDashboardPolling();
}

/**
 * Open detail view for a specific project
 */
function openDetailView(server, project) {
  showDetailView();

  // First populate the dropdowns (same as updateUI does)
  elements.serverSelect.innerHTML = '<option value="">Select server...</option>';
  config.servers.forEach(s => {
    const option = document.createElement('option');
    option.value = s.id;
    option.textContent = s.name;
    elements.serverSelect.appendChild(option);
  });

  // Select the server and trigger change to populate projects
  elements.serverSelect.value = server.id;
  onServerChange();

  // Select the project
  elements.projectSelect.value = project.id;
  onProjectChange();

  // Bind to current tab
  saveTabBinding(server.id, project.id);
}

/**
 * Save tab binding
 */
async function saveTabBinding(serverId, projectId) {
  if (!currentTabId) return;

  const bindingKey = `tab_project_${currentTabId}`;
  await chrome.storage.session.set({
    [bindingKey]: { serverId, projectId }
  });
}

/**
 * Render dashboard projects
 */
function renderDashboard() {
  if (interactiveProjects.length === 0) {
    elements.dashboardProjects.innerHTML = `
      <div class="empty-state">
        <p>No interactive projects configured.</p>
        <p class="hint">Enable Interactive Mode in project settings.</p>
      </div>
    `;
    return;
  }

  elements.dashboardProjects.innerHTML = '';

  for (const { server, project } of interactiveProjects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.serverId = server.id;
    card.dataset.projectId = project.id;

    // Get cached dashboard data
    const dashboardKey = `dashboard_${server.id}_${project.id}`;
    const cachedData = dashboardCache[dashboardKey] || {};

    const statusClass = cachedData.status || 'offline';
    const statusText = getStatusText(cachedData);
    const lastActivity = cachedData.lastActivity || 'No activity';

    card.innerHTML = `
      <div class="project-status-dot ${statusClass}"></div>
      <div class="project-info">
        <div class="project-name">${escapeHtml(project.name)}</div>
        <div class="project-status-text">${escapeHtml(statusText)}</div>
        <div class="project-last-activity">${escapeHtml(lastActivity)}</div>
      </div>
      <button class="project-open-btn">Open</button>
    `;

    // Add click handler
    card.querySelector('.project-open-btn').addEventListener('click', () => {
      openDetailView(server, project);
    });

    elements.dashboardProjects.appendChild(card);
  }
}

/**
 * Get status text for dashboard
 */
function getStatusText(data) {
  if (!data.status) return 'Checking...';
  switch (data.status) {
    case 'idle': return 'Idle';
    case 'executing': return 'Executing...';
    case 'offline': return 'Watcher off';
    default: return 'Unknown';
  }
}

// Dashboard cache for project statuses
let dashboardCache = {};

/**
 * Start dashboard polling
 */
function startDashboardPolling() {
  if (dashboardTimer) return;

  // Immediate first poll
  pollDashboardHeartbeats();

  // Poll every 10 seconds
  dashboardTimer = setInterval(() => {
    pollDashboardHeartbeats();
  }, 10000);
}

/**
 * Stop dashboard polling
 */
function stopDashboardPolling() {
  if (dashboardTimer) {
    clearInterval(dashboardTimer);
    dashboardTimer = null;
  }
}

/**
 * Poll heartbeats for all interactive projects
 */
async function pollDashboardHeartbeats() {
  for (const { server, project } of interactiveProjects) {
    const dashboardKey = `dashboard_${server.id}_${project.id}`;

    try {
      const sshTarget = server.sshType === 'direct'
        ? `${server.username}@${server.host}`
        : server.sshTarget;

      const result = await queuedSendNativeMessage({
        action: 'read_heartbeat',
        ssh_target: sshTarget,
        remote_path: project.path
      });

      if (result.status === 'ok' && result.timestamp) {
        const heartbeatTime = new Date(result.timestamp);
        const age = Date.now() - heartbeatTime.getTime();

        if (age < HEARTBEAT_TIMEOUT) {
          dashboardCache[dashboardKey] = {
            ...dashboardCache[dashboardKey],
            status: 'idle'
          };
        } else {
          dashboardCache[dashboardKey] = {
            ...dashboardCache[dashboardKey],
            status: 'offline'
          };
        }
      } else {
        dashboardCache[dashboardKey] = {
          ...dashboardCache[dashboardKey],
          status: 'offline'
        };
      }
    } catch (e) {
      dashboardCache[dashboardKey] = {
        ...dashboardCache[dashboardKey],
        status: 'offline'
      };
    }
  }

  // Re-render dashboard if visible
  if (currentView === 'dashboard') {
    renderDashboard();
  }
}

/**
 * Update dashboard cache with activity info
 */
function updateDashboardCache(serverId, projectId, data) {
  const dashboardKey = `dashboard_${serverId}_${projectId}`;
  dashboardCache[dashboardKey] = {
    ...dashboardCache[dashboardKey],
    ...data
  };
}

/**
 * Load configuration from storage
 */
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['servers', 'defaultServerId'], (syncData) => {
      config.servers = syncData.servers || [];
      config.defaultServerId = syncData.defaultServerId || null;

      // Load custom deny list for custom profile
      chrome.storage.local.get(['customDenyList'], (localData) => {
        if (localData.customDenyList) {
          customDenyList = localData.customDenyList;
          // Populate the custom editor textarea if it exists
          if (elements.customDenyList) {
            elements.customDenyList.value = customDenyList.split(' ').join('\n');
          }
        }

        resolve();
      });
    });
  });
}

/**
 * Save custom deny list to storage
 */
function saveCustomDenyList() {
  if (customDenyList) {
    chrome.storage.local.set({ customDenyList });
  } else {
    chrome.storage.local.remove('customDenyList');
  }
}

// ============================================
// TAB SWITCHING
// ============================================

/**
 * Setup tab switching event listeners
 */
function setupTabSwitching() {
  if (!elements.tabBar) return;

  const tabs = elements.tabBar.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      switchTab(tabId);
    });
  });

  // Restore saved tab preference
  chrome.storage.session.get('activeTab', (result) => {
    if (result.activeTab) {
      switchTab(result.activeTab);
    }
  });
}

/**
 * Switch to a specific tab
 */
function switchTab(tabId) {
  if (!elements.tabBar) return;

  activeTab = tabId;

  // Update tab button active states
  const tabs = elements.tabBar.querySelectorAll('.tab');
  tabs.forEach(t => {
    if (t.dataset.tab === tabId) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  // Show/hide tab content
  if (elements.tabQuickdrop) {
    elements.tabQuickdrop.classList.toggle('hidden', tabId !== 'quickdrop');
  }
  if (elements.tabClaudecode) {
    elements.tabClaudecode.classList.toggle('hidden', tabId !== 'claudecode');
  }

  // Show/hide Claude Code specific controls
  // Quick Drop: hide config bar (Profile/Model/Status), footer, back button
  // Claude Code: show config bar, footer, back button
  const isClaudeCode = tabId === 'claudecode';

  if (elements.ccConfigBar) {
    elements.ccConfigBar.classList.toggle('hidden', !isClaudeCode);
  }
  if (elements.ccFooter) {
    elements.ccFooter.classList.toggle('hidden', !isClaudeCode);
  }
  if (elements.backBtn) {
    elements.backBtn.classList.toggle('hidden', !isClaudeCode);
  }

  // Save active tab to storage for persistence
  chrome.storage.session.set({ activeTab: tabId });

  console.log('[Tab] Switched to:', tabId);
}

// ============================================
// COLLAPSIBLE CONFIG PANEL
// ============================================

/**
 * Expand the config panel to show full controls
 */
function expandConfig() {
  configExpanded = true;
  if (elements.configCollapsed) {
    elements.configCollapsed.classList.add('hidden');
  }
  if (elements.configExpanded) {
    elements.configExpanded.classList.remove('hidden');
  }
}

/**
 * Collapse the config panel to one-line summary
 */
function collapseConfig() {
  configExpanded = false;
  if (elements.configCollapsed) {
    elements.configCollapsed.classList.remove('hidden');
  }
  if (elements.configExpanded) {
    elements.configExpanded.classList.add('hidden');
  }
  updateConfigSummary();
}

/**
 * Show the Full Access confirmation dialog
 */
function showFullAccessDialog() {
  if (elements.fullAccessDialog) {
    elements.fullAccessDialog.classList.remove('hidden');
  }
}

/**
 * Hide the Full Access confirmation dialog
 */
function hideFullAccessDialog() {
  if (elements.fullAccessDialog) {
    elements.fullAccessDialog.classList.add('hidden');
  }
}

/**
 * Show the custom profile editor
 */
function showCustomEditor() {
  if (elements.customProfileEditor) {
    elements.customProfileEditor.classList.remove('hidden');
    // Initialize with standard template if empty
    if (!elements.customDenyList.value) {
      elements.customTemplateSelect.value = 'standard';
      elements.customDenyList.value = CUSTOM_TEMPLATES.standard.join('\n');
      customDenyList = CUSTOM_TEMPLATES.standard.join(' ');
    }
  }
}

/**
 * Hide the custom profile editor
 */
function hideCustomEditor() {
  if (elements.customProfileEditor) {
    elements.customProfileEditor.classList.add('hidden');
  }
}

/**
 * Update the collapsed config summary text
 */
function updateConfigSummary() {
  if (!elements.configSummary) return;

  // Get profile name from PROFILE_INFO
  const normalizedProfile = LEGACY_PROFILE_MAP[currentProfile] || currentProfile;
  const profileInfo = PROFILE_INFO[normalizedProfile];
  const profileText = profileInfo?.name || elements.profileSelect?.selectedOptions[0]?.text || 'Standard';
  const modelText = elements.modelSelect?.value === 'sonnet' ? 'Sonnet' : 'Opus';
  elements.configSummary.textContent = `${profileText} · ${modelText}`;
}

/**
 * Sync the collapsed config dot with the main status dot
 */
function updateConfigDot() {
  if (!elements.configDot || !elements.statusDot) return;

  // Copy classes from status-dot to config-dot
  elements.configDot.className = elements.statusDot.className;
}

/**
 * Update the collapsed config status text
 */
function updateConfigStatusShort() {
  if (!elements.configStatusShort || !elements.statusText) return;

  const statusText = elements.statusText.textContent || 'Not connected';
  // Shorten the status text for collapsed view
  if (statusText.includes('Connected')) {
    elements.configStatusShort.textContent = 'Connected';
  } else if (statusText.includes('Stale')) {
    elements.configStatusShort.textContent = 'Stale';
  } else {
    elements.configStatusShort.textContent = 'Disconnected';
  }
}

/**
 * Called after first user action (send plan, execute) to auto-collapse config
 */
function onFirstUserAction() {
  if (!hasUserActed) {
    hasUserActed = true;
    collapseConfig();
    chrome.storage.session.set({ configCollapsed: true });
  }
}

/**
 * Restore config collapsed state from storage
 */
async function restoreConfigState() {
  const data = await new Promise(resolve => {
    chrome.storage.session.get('configCollapsed', resolve);
  });

  if (data.configCollapsed) {
    hasUserActed = true;
    collapseConfig();
  } else {
    expandConfig();
  }
}

/**
 * Update Connect button based on connection status
 * Connected → hide button
 * Stale → show "Restart" button
 * Disconnected → show "Connect" button
 */
function updateConnectButton(status) {
  if (!elements.connectBtn) return;

  if (status === 'connected') {
    elements.connectBtn.classList.add('hidden');
  } else if (status === 'stale') {
    elements.connectBtn.classList.remove('hidden');
    elements.connectBtn.textContent = 'Restart';
  } else {
    elements.connectBtn.classList.remove('hidden');
    elements.connectBtn.textContent = 'Connect';
  }
}

// ============================================
// QUICK DROP EDITOR
// ============================================

/**
 * Setup Quick Drop editor event listeners
 */
function setupQuickDropEditor() {
  if (!elements.qdEditor) return;

  // View mode toggle
  elements.qdToggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      qdSetViewMode(btn.dataset.mode);
    });
  });

  // Editor input - update preview and save draft
  elements.qdEditor.addEventListener('input', () => {
    qdUpdatePreview();
    qdUpdateSendButton();
    qdSaveDraft();
  });

  // Keyboard shortcuts for Quick Drop editor
  elements.qdEditor.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + Enter = Send File
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!elements.qdSendFileBtn.disabled) {
        qdSendFile();
      }
    }
  });

  // Filename change - reset collision state
  elements.qdFilename.addEventListener('input', () => {
    qdFileExists = false;
    qdOverwriteConfirmed = false;
    qdHideCollisionWarning();
    qdUpdateSendButton();
    qdSaveDraft();
  });

  // Send File button
  elements.qdSendFileBtn.addEventListener('click', qdSendFile);

  // Overwrite button in collision warning
  if (elements.qdOverwriteBtn) {
    elements.qdOverwriteBtn.addEventListener('click', () => {
      qdOverwriteConfirmed = true;
      qdHideCollisionWarning();
      qdSendFile(); // Send immediately after confirming overwrite
    });
  }

  // Restore draft on init
  qdRestoreDraft();

  // Configure marked for preview
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
  }
}

/**
 * Set Quick Drop view mode (edit, split, preview)
 */
function qdSetViewMode(mode) {
  qdViewMode = mode;
  if (elements.qdEditorContainer) {
    elements.qdEditorContainer.dataset.mode = mode;
  }

  elements.qdToggleBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  qdUpdatePreview();
}

/**
 * Update Quick Drop markdown preview
 */
function qdUpdatePreview() {
  if (!elements.qdEditor || !elements.qdPreview) return;

  const content = elements.qdEditor.value;

  if (typeof marked !== 'undefined') {
    try {
      elements.qdPreview.innerHTML = marked.parse(content);
    } catch (e) {
      elements.qdPreview.textContent = content;
    }
  } else {
    elements.qdPreview.textContent = content;
  }
}

/**
 * Update Quick Drop send button state
 */
function qdUpdateSendButton() {
  if (!elements.qdSendFileBtn) return;

  const hasServer = !!currentServer;
  const hasProject = !!currentProject;
  const hasContent = elements.qdEditor && elements.qdEditor.value.trim().length > 0;
  const hasFilename = elements.qdFilename && elements.qdFilename.value.trim().length > 0;
  const canSend = hasServer && hasProject && hasContent && hasFilename;

  elements.qdSendFileBtn.disabled = !canSend || (qdFileExists && !qdOverwriteConfirmed);
}

/**
 * Paste from clipboard into Quick Drop editor
 */
/**
 * Save Quick Drop draft to storage
 */
function qdSaveDraft() {
  const draft = {
    content: elements.qdEditor.value,
    filename: elements.qdFilename.value,
    viewMode: qdViewMode,
    lastSaved: new Date().toISOString()
  };
  chrome.storage.local.set({ qdDraft: draft });
}

/**
 * Restore Quick Drop draft from storage
 */
async function qdRestoreDraft() {
  const data = await new Promise(resolve => {
    chrome.storage.local.get(['qdDraft', 'pendingContent'], resolve);
  });

  // Check for pending content from context menu first
  if (data.pendingContent) {
    elements.qdEditor.value = data.pendingContent;
    chrome.storage.local.remove(['pendingContent']);
    qdUpdatePreview();
    qdUpdateSendButton();
    qdSaveDraft();
    return;
  }

  // Restore saved draft
  if (data.qdDraft) {
    if (data.qdDraft.content) {
      elements.qdEditor.value = data.qdDraft.content;
    }
    if (data.qdDraft.filename) {
      elements.qdFilename.value = data.qdDraft.filename;
    }
    if (data.qdDraft.viewMode) {
      qdSetViewMode(data.qdDraft.viewMode);
    }
    qdUpdatePreview();
    qdUpdateSendButton();
  }
}

/**
 * Show Quick Drop collision warning
 */
function qdShowCollisionWarning(info) {
  if (!elements.qdCollisionWarning) return;

  const size = info.size < 1024 ? info.size + ' B' : (info.size / 1024).toFixed(1) + ' KB';
  elements.qdCollisionText.textContent = `"${elements.qdFilename.value}" exists (${size})`;
  elements.qdCollisionWarning.classList.remove('hidden');
}

/**
 * Hide Quick Drop collision warning
 */
function qdHideCollisionWarning() {
  if (elements.qdCollisionWarning) {
    elements.qdCollisionWarning.classList.add('hidden');
  }
}

/**
 * Set Quick Drop status message
 */
function qdSetStatus(message, type = 'info') {
  if (elements.qdStatus) {
    elements.qdStatus.textContent = message;
    elements.qdStatus.className = 'qd-status ' + type;
  }
}

/**
 * Send file via Quick Drop (SCP to project directory)
 */
async function qdSendFile() {
  if (!currentServer || !currentProject) {
    qdSetStatus('Select a server and project first', 'error');
    return;
  }

  const content = elements.qdEditor.value.trim();
  const filename = elements.qdFilename.value.trim();

  if (!content || !filename) {
    qdSetStatus('Content and filename required', 'error');
    return;
  }

  const remotePath = currentProject.path.replace(/\/$/, '') + '/' + filename;
  const sshTarget = getSshTarget();

  try {
    // Step 1: Check if file exists (unless already confirmed overwrite)
    if (!qdOverwriteConfirmed) {
      qdSetStatus('Checking...', 'working');
      elements.qdSendFileBtn.disabled = true;

      const checkResult = await queuedSendNativeMessage({
        action: 'check_file',
        ssh_target: sshTarget,
        remote_path: remotePath,
        ssh_key: currentServer.sshKey || undefined,
        ssh_port: currentServer.sshPort || undefined
      });

      if (checkResult.status === 'error') {
        qdSetStatus('Error: ' + checkResult.message, 'error');
        qdUpdateSendButton();
        return;
      }

      if (checkResult.exists) {
        qdFileExists = true;
        qdShowCollisionWarning(checkResult);
        qdSetStatus('File exists - rename or overwrite', 'warning');
        qdUpdateSendButton();
        return;
      }
    }

    // Step 2: Send the file
    qdSetStatus('Sending...', 'working');
    elements.qdSendFileBtn.disabled = true;

    const sendResult = await queuedSendNativeMessage({
      action: 'send_file',
      ssh_target: sshTarget,
      remote_path: remotePath,
      content: content,
      overwrite: qdOverwriteConfirmed,
      ssh_key: currentServer.sshKey || undefined,
      ssh_port: currentServer.sshPort || undefined
    });

    if (sendResult.status === 'success') {
      qdSetStatus('✓ Sent to ' + currentServer.name, 'success');
      qdFileExists = false;
      qdOverwriteConfirmed = false;
      qdHideCollisionWarning();
      // Clear draft after successful send
      chrome.storage.local.remove(['qdDraft']);
    } else {
      qdSetStatus('Error: ' + sendResult.message, 'error');
    }

  } catch (e) {
    qdSetStatus('Error: ' + (e.message || String(e)), 'error');
  }

  qdUpdateSendButton();
}

// ============================================
// GEAR MENU
// ============================================

/**
 * Setup gear menu event listeners
 */
function setupGearMenu() {
  if (!elements.gearMenuOverlay) return;

  // Settings button opens gear menu
  elements.settingsBtn.addEventListener('click', openGearMenu);
  elements.dashboardSettingsBtn.addEventListener('click', openGearMenu);

  // Close button
  elements.gearMenuClose.addEventListener('click', closeGearMenu);

  // Back button
  elements.gearMenuBack.addEventListener('click', () => {
    showGearMenuView('main');
  });

  // Click outside to close
  elements.gearMenuOverlay.addEventListener('click', (e) => {
    if (e.target === elements.gearMenuOverlay) {
      closeGearMenu();
    }
  });

  // Menu items
  const menuItems = elements.gearMenuMain.querySelectorAll('.gear-menu-item');
  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      handleGearMenuAction(action);
    });
  });

  // History buttons
  elements.exportHistoryBtn.addEventListener('click', exportTaskHistory);
  elements.clearHistoryBtn.addEventListener('click', clearTaskHistory);
  if (elements.exportHistorySummaryBtn) {
    elements.exportHistorySummaryBtn.addEventListener('click', () => exportServerHistory('summary'));
  }
  if (elements.exportHistoryFullBtn) {
    elements.exportHistoryFullBtn.addEventListener('click', () => exportServerHistory('full'));
  }

  // Import file input
  elements.importFileInput.addEventListener('change', handleImportFile);

  // Load task history from storage
  loadTaskHistory();
}

/**
 * Open gear menu
 */
function openGearMenu() {
  elements.gearMenuOverlay.classList.remove('hidden');
  showGearMenuView('main');
}

/**
 * Close gear menu
 */
function closeGearMenu() {
  elements.gearMenuOverlay.classList.add('hidden');
}

/**
 * Show a specific gear menu view
 */
function showGearMenuView(view) {
  gearMenuCurrentView = view;

  // Hide all views
  elements.gearMenuMain.classList.add('hidden');
  elements.gearMenuHistory.classList.add('hidden');
  elements.gearMenuCost.classList.add('hidden');
  elements.gearMenuAbout.classList.add('hidden');
  if (elements.gearMenuExportHistory) {
    elements.gearMenuExportHistory.classList.add('hidden');
  }

  // Show back button for sub-views
  elements.gearMenuBack.classList.toggle('visible', view !== 'main');

  // Show selected view and update title
  switch (view) {
    case 'main':
      elements.gearMenuMain.classList.remove('hidden');
      elements.gearMenuTitle.textContent = 'Settings';
      break;
    case 'history':
      elements.gearMenuHistory.classList.remove('hidden');
      elements.gearMenuTitle.textContent = 'Task History';
      renderTaskHistory();
      break;
    case 'cost':
      elements.gearMenuCost.classList.remove('hidden');
      elements.gearMenuTitle.textContent = 'Cost Summary';
      renderCostSummary();
      break;
    case 'about':
      elements.gearMenuAbout.classList.remove('hidden');
      elements.gearMenuTitle.textContent = 'About';
      break;
    case 'export-history':
      if (elements.gearMenuExportHistory) {
        elements.gearMenuExportHistory.classList.remove('hidden');
      }
      elements.gearMenuTitle.textContent = 'Export History';
      // Clear previous status
      if (elements.exportHistoryStatus) {
        elements.exportHistoryStatus.classList.add('hidden');
      }
      break;
  }
}

/**
 * Handle gear menu action
 */
function handleGearMenuAction(action) {
  switch (action) {
    case 'history':
      showGearMenuView('history');
      break;
    case 'cost':
      showGearMenuView('cost');
      break;
    case 'servers':
    case 'profiles':
      chrome.runtime.openOptionsPage();
      closeGearMenu();
      break;
    case 'export':
      exportSettings();
      break;
    case 'import':
      elements.importFileInput.click();
      break;
    case 'about':
      showGearMenuView('about');
      break;
    case 'export-history':
      showGearMenuView('export-history');
      break;
  }
}

/**
 * Export history from server using plandrop-history
 */
async function exportServerHistory(mode) {
  if (!currentServer || !currentProject) {
    showExportHistoryStatus('error', 'No project selected');
    return;
  }

  const sshTarget = getSshTarget();
  const flag = mode === 'full' ? '--full' : '';

  showExportHistoryStatus('loading', 'Exporting history from server...');

  try {
    // Try plandrop-history first
    let result = await queuedSendNativeMessage({
      action: 'run_command',
      ssh_target: sshTarget,
      remote_path: currentProject.path,
      command: `cd "${currentProject.path}" && plandrop-history ${flag}`,
      ssh_key: currentServer.sshKey || undefined,
      ssh_port: currentServer.sshPort || undefined
    });

    // Fallback: try python3 .plandrop/history.py
    if (result.status === 'error' && result.error?.includes('not found')) {
      result = await queuedSendNativeMessage({
        action: 'run_command',
        ssh_target: sshTarget,
        remote_path: currentProject.path,
        command: `cd "${currentProject.path}" && python3 .plandrop/history.py ${flag}`,
        ssh_key: currentServer.sshKey || undefined,
        ssh_port: currentServer.sshPort || undefined
      });
    }

    if (result.status === 'ok' && result.output) {
      // Download as file
      const filename = `plandrop-history-${currentProject.name}-${Date.now()}.md`;
      downloadAsFile(result.output, filename, 'text/markdown');
      showExportHistoryStatus('success', `Downloaded: ${filename}`);
    } else {
      const errorMsg = result.error || result.message || 'Export failed';
      showExportHistoryStatus('error', errorMsg);
    }
  } catch (e) {
    console.error('Export history error:', e);
    showExportHistoryStatus('error', e.message || 'Export failed');
  }
}

/**
 * Show export history status message
 */
function showExportHistoryStatus(type, message) {
  if (!elements.exportHistoryStatus) return;
  elements.exportHistoryStatus.className = `export-status ${type}`;
  elements.exportHistoryStatus.textContent = message;
  elements.exportHistoryStatus.classList.remove('hidden');
}

/**
 * Download content as a file
 */
function downloadAsFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Load task history from storage
 */
async function loadTaskHistory() {
  const data = await chrome.storage.local.get('taskHistory');
  taskHistory = data.taskHistory || [];
}

/**
 * Save task to history
 */
function saveTaskToHistory(task) {
  taskHistory.unshift(task);
  // Keep last 100 tasks
  if (taskHistory.length > 100) {
    taskHistory = taskHistory.slice(0, 100);
  }
  chrome.storage.local.set({ taskHistory });
}

/**
 * Render task history list
 */
function renderTaskHistory() {
  if (!elements.historyList) return;

  if (taskHistory.length === 0) {
    elements.historyList.innerHTML = `
      <div class="empty-state">
        <p>No task history yet.</p>
        <p class="hint">Tasks will appear here after completion.</p>
      </div>
    `;
    return;
  }

  let html = '';
  for (const task of taskHistory.slice(0, 50)) {
    const time = new Date(task.timestamp).toLocaleString();
    const preview = (task.content || '').substring(0, 60) + (task.content?.length > 60 ? '...' : '');
    const cost = task.cost || 'Free (Max)';
    const duration = task.duration || '?';

    html += `
      <div class="history-item">
        <div class="history-item-header">
          <span class="history-item-time">${time}</span>
          <span class="history-item-status">Complete</span>
        </div>
        <div class="history-item-content">${escapeHtml(preview)}</div>
        <div class="history-item-stats">${cost} | ${duration}</div>
      </div>
    `;
  }

  elements.historyList.innerHTML = html;
}

/**
 * Render cost summary
 */
function renderCostSummary() {
  // Calculate today's stats
  const today = new Date().toDateString();
  const todayTasks = taskHistory.filter(t => new Date(t.timestamp).toDateString() === today);

  // Calculate this week's stats
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekTasks = taskHistory.filter(t => new Date(t.timestamp) > weekAgo);

  // Calculate total duration
  const sumDuration = (tasks) => {
    let total = 0;
    for (const t of tasks) {
      if (t.durationMs) total += t.durationMs;
    }
    return total;
  };

  const formatDuration = (ms) => {
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
    return `${(ms / 60000).toFixed(1)} min`;
  };

  // Update UI
  document.getElementById('cost-today').textContent =
    `Free (Max) | ${todayTasks.length} tasks | ${formatDuration(sumDuration(todayTasks))}`;
  document.getElementById('cost-week').textContent =
    `Free (Max) | ${weekTasks.length} tasks | ${formatDuration(sumDuration(weekTasks))}`;
  document.getElementById('cost-tasks').textContent = taskHistory.length.toString();
  document.getElementById('cost-source').textContent =
    currentApiSource === 'ANTHROPIC_API_KEY' ? 'API Key' : 'Max subscription';
  document.getElementById('cost-model').textContent = currentModel || 'Opus';

  // Per-project breakdown
  const projectCounts = {};
  for (const t of taskHistory) {
    const key = t.project || 'Unknown';
    projectCounts[key] = (projectCounts[key] || 0) + 1;
  }

  const projectList = document.getElementById('cost-project-list');
  if (Object.keys(projectCounts).length === 0) {
    projectList.innerHTML = '<span class="hint">No data yet</span>';
  } else {
    let html = '';
    for (const [project, count] of Object.entries(projectCounts)) {
      html += `<div class="cost-project-row"><span>${escapeHtml(project)}</span><span>${count} tasks</span></div>`;
    }
    projectList.innerHTML = html;
  }
}

/**
 * Export task history as markdown
 */
function exportTaskHistory() {
  if (taskHistory.length === 0) {
    alert('No task history to export.');
    return;
  }

  let md = '# PlanDrop Task History\n\n';
  md += `Exported: ${new Date().toLocaleString()}\n\n`;
  md += `Total tasks: ${taskHistory.length}\n\n`;
  md += '---\n\n';

  for (const task of taskHistory) {
    const time = new Date(task.timestamp).toLocaleString();
    md += `## ${time}\n\n`;
    md += `**Project:** ${task.project || 'Unknown'}\n\n`;
    md += `**Cost:** ${task.cost || 'Free (Max)'} | **Duration:** ${task.duration || '?'}\n\n`;

    md += '### Request\n\n';
    md += '```\n' + (task.request || task.content || '') + '\n```\n\n';

    if (task.responseSummary) {
      md += '### Response Summary\n\n';
      md += task.responseSummary + '\n\n';
    }

    if (task.filesModified && task.filesModified.length > 0) {
      md += '### Files Modified\n\n';
      for (const f of task.filesModified) {
        md += `- ${f}\n`;
      }
      md += '\n';
    }

    if (task.commandsRun && task.commandsRun.length > 0) {
      md += '### Commands Run\n\n';
      for (const c of task.commandsRun) {
        md += `- \`${c.substring(0, 100)}${c.length > 100 ? '...' : ''}\`\n`;
      }
      md += '\n';
    }

    md += '---\n\n';
  }

  // Download file
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `plandrop-history-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Clear task history
 */
async function clearTaskHistory() {
  if (!confirm('Clear all task history? This cannot be undone.')) return;

  taskHistory = [];
  await chrome.storage.local.remove('taskHistory');
  renderTaskHistory();
}

/**
 * Export settings to JSON file
 */
async function exportSettings() {
  const data = await chrome.storage.sync.get(null);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `plandrop-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  closeGearMenu();
}

/**
 * Handle import file selection
 */
async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!confirm('Import settings? This will overwrite your current configuration.')) {
      return;
    }

    await chrome.storage.sync.set(data);
    await loadConfig();
    updateUI();
    alert('Settings imported successfully. Refresh to see changes.');
    closeGearMenu();
  } catch (err) {
    alert('Failed to import settings: ' + err.message);
  }

  // Reset file input
  e.target.value = '';
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Tab switching
  setupTabSwitching();

  // Restore config collapsed state
  restoreConfigState();

  // Quick Drop editor
  setupQuickDropEditor();

  // Gear menu
  setupGearMenu();

  // Dashboard events
  elements.backBtn.addEventListener('click', showDashboard);
  elements.dashboardSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Server selection
  elements.serverSelect.addEventListener('change', onServerChange);

  // Project selection
  elements.projectSelect.addEventListener('change', onProjectChange);

  // Profile selection
  elements.profileSelect.addEventListener('change', () => {
    const newProfile = elements.profileSelect.value;

    // Handle Full Access confirmation
    if (newProfile === 'full_access') {
      pendingFullAccessConfirm = true;
      showFullAccessDialog();
      return; // Don't change profile until confirmed
    }

    // Handle custom profile editor
    if (newProfile === 'custom') {
      showCustomEditor();
    } else {
      hideCustomEditor();
    }

    currentProfile = newProfile;
    updateConfigSummary();
  });

  // Full Access dialog handlers
  if (elements.fullAccessCancel) {
    elements.fullAccessCancel.addEventListener('click', () => {
      hideFullAccessDialog();
      // Revert to previous profile
      elements.profileSelect.value = currentProfile;
      pendingFullAccessConfirm = false;
    });
  }

  if (elements.fullAccessConfirm) {
    elements.fullAccessConfirm.addEventListener('click', () => {
      hideFullAccessDialog();
      currentProfile = 'full_access';
      hideCustomEditor();
      updateConfigSummary();
      pendingFullAccessConfirm = false;
    });
  }

  // Custom profile template selector
  if (elements.customTemplateSelect) {
    elements.customTemplateSelect.addEventListener('change', () => {
      const template = elements.customTemplateSelect.value;
      const denyList = CUSTOM_TEMPLATES[template] || [];
      elements.customDenyList.value = denyList.join('\n');
      customDenyList = denyList.length > 0 ? denyList.join(' ') : null;
    });
  }

  // Custom deny list textarea
  if (elements.customDenyList) {
    elements.customDenyList.addEventListener('input', () => {
      const lines = elements.customDenyList.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      customDenyList = lines.length > 0 ? lines.join(' ') : null;
    });

    // Save to storage on blur
    elements.customDenyList.addEventListener('blur', () => {
      saveCustomDenyList();
    });
  }

  // Model selection
  elements.modelSelect.addEventListener('change', () => {
    currentModel = elements.modelSelect.value;
    updateConfigSummary();
  });

  // Connect button
  elements.connectBtn.addEventListener('click', setupQueue);

  // Collapsible config panel
  if (elements.configCollapsed) {
    elements.configCollapsed.addEventListener('click', expandConfig);
  }
  if (elements.configExpandBtn) {
    elements.configExpandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      expandConfig();
    });
  }
  if (elements.configCollapseBtn) {
    elements.configCollapseBtn.addEventListener('click', collapseConfig);
  }

  // Send plan button
  elements.sendPlanBtn.addEventListener('click', sendPlan);

  // Stop button
  if (elements.stopBtn) {
    elements.stopBtn.addEventListener('click', handleStopClick);
  }

  // Message input
  elements.messageInput.addEventListener('input', updateSendButton);

  // Keyboard shortcuts for Claude Code message input
  elements.messageInput.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + Enter = Send Plan
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!elements.sendPlanBtn.disabled) {
        sendPlan();
      }
    }
  });

  // Action buttons
  elements.executeBtn.addEventListener('click', executePlan);
  elements.reviseBtn.addEventListener('click', showReviseInput);
  elements.cancelBtn.addEventListener('click', cancelPlan);

  // Blocked commands buttons
  elements.approveRerunBtn.addEventListener('click', approveAndRerun);
  elements.copyAllBlockedBtn.addEventListener('click', copyAllBlockedCommands);
  elements.skipBlockedBtn.addEventListener('click', skipBlocked);

  // Copy buttons
  elements.copySetupBtn.addEventListener('click', () => copyToClipboard(getSetupCommands()));
  elements.copyQuickBtn.addEventListener('click', () => copyToClipboard(getQuickStartCommand()));

  // Settings button
  elements.settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Complete action buttons
  elements.newPlanBtn.addEventListener('click', startNewTask);
  elements.continueBtn.addEventListener('click', continueInSession);

  // Reset session button
  elements.resetSessionBtn.addEventListener('click', resetSession);
}

/**
 * Update UI based on config
 */
function updateUI() {
  // Populate server dropdown
  elements.serverSelect.innerHTML = '<option value="">Select server...</option>';
  config.servers.forEach(server => {
    const option = document.createElement('option');
    option.value = server.id;
    option.textContent = server.name;
    elements.serverSelect.appendChild(option);
  });

  // Select default server
  if (config.defaultServerId) {
    elements.serverSelect.value = config.defaultServerId;
    onServerChange();
  }

  updateSendButton();
}

/**
 * Handle server selection change
 */
function onServerChange() {
  const serverId = elements.serverSelect.value;
  currentServer = config.servers.find(s => s.id === serverId) || null;

  // Populate projects
  elements.projectSelect.innerHTML = '<option value="">Select project...</option>';

  if (currentServer && currentServer.projects) {
    elements.projectSelect.disabled = false;
    currentServer.projects.forEach(project => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      elements.projectSelect.appendChild(option);
    });

    // Select default project
    if (currentServer.defaultProjectId) {
      elements.projectSelect.value = currentServer.defaultProjectId;
      onProjectChange();
    }
  } else {
    elements.projectSelect.disabled = true;
    currentProject = null;
  }

  updateSendButton();
  resetState();
}

/**
 * Handle project selection change
 */
async function onProjectChange() {
  // Release lock from previous project
  await releaseProjectLock();

  const projectId = elements.projectSelect.value;
  if (currentServer && currentServer.projects) {
    currentProject = currentServer.projects.find(p => p.id === projectId) || null;
  } else {
    currentProject = null;
  }

  // Load per-project settings
  if (currentProject) {
    if (currentProject.profile) {
      // Handle legacy profile names
      const normalizedProfile = LEGACY_PROFILE_MAP[currentProject.profile] || currentProject.profile;
      elements.profileSelect.value = normalizedProfile;
      currentProfile = normalizedProfile;

      // Show/hide custom editor based on profile
      if (normalizedProfile === 'custom') {
        showCustomEditor();
      } else {
        hideCustomEditor();
      }
    }
    if (currentProject.model) {
      elements.modelSelect.value = currentProject.model;
      currentModel = currentProject.model;
    }

    // Check if project is locked by another instance
    await checkProjectLock();
  }

  updateSendButton();
  qdUpdateSendButton(); // Also update Quick Drop send button
  updateConfigSummary(); // Update collapsed config summary
  resetState();

  // Start checking heartbeat if project selected
  if (currentProject) {
    checkHeartbeat();
    updateSetupCommands();
    startHeartbeatTimer();
    // Load saved activity for this project (async, will update UI when ready)
    loadActivityFromStorage().catch(e => console.log('Could not load activity:', e));
  } else {
    stopHeartbeatTimer();
  }
}

/**
 * Reset state for new project
 */
function resetState() {
  stopPolling();
  currentPlanId = null;
  currentPhase = null;
  sessionId = null;
  lastResponseLength = 0;
  approvedTools = [];
  lastAppliedProfile = null; // Reset so settings are written fresh for new project
  activityHistory = []; // Clear in-memory history (will be loaded from storage for new project)
  profileHintShown = false; // Reset profile hint for new project
  heartbeatFailCount = 0; // Reset heartbeat failure counter

  // Clear activity feed
  elements.activityFeed.innerHTML = `
    <div class="empty-state">
      <p>No activity yet.</p>
      <p class="hint">Select a project and send a plan to get started.</p>
    </div>
  `;

  // Hide action buttons and new plan container
  elements.actionButtons.classList.add('hidden');
  elements.blockedCommands.classList.add('hidden');
  elements.newPlanContainer.classList.add('hidden');

  // Reset phase indicator
  updatePhaseIndicator(null);

  // Update session display
  elements.sessionIdDisplay.textContent = 'No session';
}

// UI State Manager for Send button
// Tracks all conditions that affect button state
const sendButtonState = {
  hasServer: false,
  hasProject: false,
  hasContent: false,
  isConnected: false,
  isPlanInProgress: false,
  isExecuting: false,
  isLocked: false,  // Multi-instance lock

  // Check if button should be enabled
  canSend() {
    // Must have server, project, and content
    if (!this.hasServer || !this.hasProject || !this.hasContent) {
      return false;
    }

    // Cannot send while plan is in progress or executing
    if (this.isPlanInProgress || this.isExecuting) {
      return false;
    }

    // Cannot send if locked by another instance
    if (this.isLocked) {
      return false;
    }

    return true;
  },

  // Get reason why button is disabled (for tooltip)
  getDisabledReason() {
    if (!this.hasServer) return 'Select a server';
    if (!this.hasProject) return 'Select a project';
    if (!this.hasContent) return 'Enter a message';
    if (this.isLocked) return 'Another tab is using this project';
    if (this.isPlanInProgress) return 'Waiting for Claude\'s response...';
    if (this.isExecuting) return 'Execution in progress...';
    return '';
  }
};

/**
 * Update send button state
 */
function updateSendButton() {
  // Update state
  sendButtonState.hasServer = !!currentServer;
  sendButtonState.hasProject = !!currentProject;
  sendButtonState.hasContent = elements.messageInput.value.trim().length > 0;
  sendButtonState.isPlanInProgress = currentPhase === 'plan' && !!currentPlanId;
  sendButtonState.isExecuting = currentPhase === 'execute';

  const isProcessing = sendButtonState.isPlanInProgress || sendButtonState.isExecuting;

  // Show/hide Stop button based on processing state
  if (elements.stopBtn) {
    if (isProcessing) {
      elements.stopBtn.classList.remove('hidden');
      elements.sendPlanBtn.classList.add('hidden');
    } else {
      elements.stopBtn.classList.add('hidden');
      elements.stopBtn.disabled = false;
      elements.stopBtn.textContent = '🛑 Stop';
      elements.sendPlanBtn.classList.remove('hidden');
    }
  }

  // Apply state to send button
  const canSend = sendButtonState.canSend();
  elements.sendPlanBtn.disabled = !canSend;

  // Update tooltip with reason if disabled
  const reason = sendButtonState.getDisabledReason();
  if (reason) {
    elements.sendPlanBtn.title = reason;
  } else {
    elements.sendPlanBtn.title = 'Send plan to Claude (Cmd/Ctrl+Enter)';
  }
}

/**
 * Handle Stop button click - interrupt running task
 */
async function handleStopClick() {
  if (!currentServer || !currentProject) return;

  // Prevent double-click
  if (elements.stopBtn) {
    elements.stopBtn.disabled = true;
    elements.stopBtn.textContent = '⏳ Stopping...';
  }

  try {
    // Send interrupt signal to server
    const result = await queuedSendNativeMessage({
      action: 'interrupt',
      ssh_target: getSshTarget(),
      remote_path: currentProject.path
    });

    if (result.status === 'interrupt_sent') {
      addActivity('system', '⚠️ Interrupt signal sent — waiting for Claude to stop...');
    } else {
      addActivity('system', '❌ Failed to send interrupt: ' + (result.message || 'unknown error'));
      // Re-enable stop button on failure
      if (elements.stopBtn) {
        elements.stopBtn.disabled = false;
        elements.stopBtn.textContent = '🛑 Stop';
      }
    }
  } catch (e) {
    addActivity('system', '❌ Failed to send interrupt: ' + (e.message || String(e)));
    // Re-enable stop button on failure
    if (elements.stopBtn) {
      elements.stopBtn.disabled = false;
      elements.stopBtn.textContent = '🛑 Stop';
    }
  }

  // Don't reset UI state here — wait for the poll to detect the interrupted response
}

// ============================================
// MULTI-INSTANCE LOCK MANAGEMENT
// ============================================

/**
 * Get lock key for current project
 */
function getLockKey() {
  if (!currentServer || !currentProject) return null;
  return `lock_${currentServer.id}_${currentProject.id}`;
}

/**
 * Try to acquire lock for current project
 * Returns true if lock acquired, false if already locked by another instance
 */
async function acquireProjectLock() {
  const lockKey = getLockKey();
  if (!lockKey) return true; // No project selected, no lock needed

  try {
    const result = await chrome.storage.session.get(lockKey);
    const existingLock = result[lockKey];

    // Check if there's an existing lock from another instance
    if (existingLock && existingLock.instanceId !== instanceId) {
      // Check if lock is stale (older than timeout)
      const lockAge = Date.now() - existingLock.timestamp;
      if (lockAge < LOCK_TIMEOUT) {
        // Lock is held by another active instance
        console.log(`[Lock] Project locked by instance ${existingLock.instanceId}, age: ${lockAge}ms`);
        sendButtonState.isLocked = true;
        updateSendButton();
        return false;
      }
      // Lock is stale, we can take it
      console.log(`[Lock] Taking over stale lock from ${existingLock.instanceId}`);
    }

    // Acquire or refresh the lock
    await chrome.storage.session.set({
      [lockKey]: {
        instanceId: instanceId,
        timestamp: Date.now()
      }
    });

    sendButtonState.isLocked = false;
    updateSendButton();

    // Start refresh timer
    startLockRefresh();

    console.log(`[Lock] Acquired lock for ${lockKey}`);
    return true;
  } catch (e) {
    console.error('[Lock] Error acquiring lock:', e);
    return true; // On error, allow operation
  }
}

/**
 * Release lock for current project
 */
async function releaseProjectLock() {
  const lockKey = getLockKey();
  if (!lockKey) return;

  try {
    const result = await chrome.storage.session.get(lockKey);
    const existingLock = result[lockKey];

    // Only release if we own the lock
    if (existingLock && existingLock.instanceId === instanceId) {
      await chrome.storage.session.remove(lockKey);
      console.log(`[Lock] Released lock for ${lockKey}`);
    }
  } catch (e) {
    console.error('[Lock] Error releasing lock:', e);
  }

  // Stop refresh timer
  stopLockRefresh();
}

/**
 * Start periodic lock refresh
 */
function startLockRefresh() {
  stopLockRefresh(); // Clear any existing timer

  lockRefreshTimer = setInterval(async () => {
    const lockKey = getLockKey();
    if (!lockKey) return;

    try {
      const result = await chrome.storage.session.get(lockKey);
      const existingLock = result[lockKey];

      // Only refresh if we own the lock
      if (existingLock && existingLock.instanceId === instanceId) {
        await chrome.storage.session.set({
          [lockKey]: {
            instanceId: instanceId,
            timestamp: Date.now()
          }
        });
      }
    } catch (e) {
      console.error('[Lock] Error refreshing lock:', e);
    }
  }, LOCK_REFRESH_INTERVAL);
}

/**
 * Stop lock refresh timer
 */
function stopLockRefresh() {
  if (lockRefreshTimer) {
    clearInterval(lockRefreshTimer);
    lockRefreshTimer = null;
  }
}

/**
 * Check if current project is locked by another instance
 */
async function checkProjectLock() {
  const lockKey = getLockKey();
  if (!lockKey) {
    sendButtonState.isLocked = false;
    return false;
  }

  try {
    const result = await chrome.storage.session.get(lockKey);
    const existingLock = result[lockKey];

    if (existingLock && existingLock.instanceId !== instanceId) {
      const lockAge = Date.now() - existingLock.timestamp;
      if (lockAge < LOCK_TIMEOUT) {
        sendButtonState.isLocked = true;
        updateSendButton();
        return true;
      }
    }

    sendButtonState.isLocked = false;
    updateSendButton();
    return false;
  } catch (e) {
    console.error('[Lock] Error checking lock:', e);
    return false;
  }
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.log('Could not copy to clipboard:', e);
  }
}

/**
 * Get setup commands for current project
 */
function getSetupCommands() {
  if (!currentProject) return '';
  return `cd ${currentProject.path}
# If using conda:
conda activate myenv
# Start watcher:
tmux new -s plandrop
.plandrop/watch.sh`;
}

/**
 * Get quick start command
 */
function getQuickStartCommand() {
  return 'nohup .plandrop/watch.sh > .plandrop/watch.log 2>&1 &';
}

/**
 * Update setup commands display
 */
function updateSetupCommands() {
  if (currentProject) {
    elements.setupCommands.textContent = getSetupCommands();
  }
}

// ============================================
// QUEUE SETUP
// ============================================

/**
 * Setup queue on server
 */
async function setupQueue() {
  if (!currentServer || !currentProject) return;

  const sshTarget = getSshTarget();
  const remotePath = currentProject.path;

  elements.connectBtn.disabled = true;
  elements.connectBtn.textContent = 'Setting up...';

  try {
    const result = await queuedSendNativeMessage({
      action: 'init_queue',
      ssh_target: sshTarget,
      remote_path: remotePath
    });

    if (result.status === 'success') {
      addActivity('system', 'Queue initialized. Start watch.sh on server to begin.');
      elements.watcherSetup.classList.remove('hidden');
    } else {
      addActivity('system', 'Error: ' + (result.message || 'Unknown error'));
    }
  } catch (e) {
    addActivity('system', 'Error: ' + (e.message || String(e) || 'Unknown error'));
  }

  elements.connectBtn.disabled = false;
  elements.connectBtn.textContent = 'Setup Queue';
}

// ============================================
// POLLING
// ============================================

/**
 * Start polling for responses
 */
function startPolling() {
  if (pollingTimer) return;

  // Poll only responses every 2 seconds during active phases
  // Heartbeat already runs on its own 10-second timer
  pollingTimer = setInterval(async () => {
    await pollResponses();
  }, 2000);

  // First poll after 1 second delay (give watch.sh time to start processing)
  setTimeout(() => {
    pollResponses();
  }, 1000);
}

/**
 * Stop polling
 */
function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

/**
 * Start periodic heartbeat checking (runs independently of response polling)
 */
function startHeartbeatTimer() {
  stopHeartbeatTimer();
  // Check heartbeat every 10 seconds (SSH calls need time, queue serializes them)
  heartbeatTimer = setInterval(() => {
    checkHeartbeat();
  }, 10000);
}

/**
 * Stop heartbeat timer
 */
function stopHeartbeatTimer() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Check heartbeat to verify watch.sh is running
 */
async function checkHeartbeat() {
  if (!currentServer || !currentProject) {
    console.log('[Heartbeat] Skipping - no server or project selected');
    return;
  }

  // Skip if a heartbeat check is already in progress
  if (heartbeatPending) {
    console.log('[Heartbeat] Skipping - previous check still pending');
    return;
  }

  heartbeatPending = true;
  const sshTarget = getSshTarget();
  const remotePath = currentProject.path;
  console.log(`[Heartbeat] Checking ${sshTarget}:${remotePath}/.plandrop/heartbeat`);

  try {
    const result = await queuedSendNativeMessage({
      action: 'read_heartbeat',
      ssh_target: sshTarget,
      remote_path: remotePath
    });

    console.log('[Heartbeat] Response:', JSON.stringify(result));

    if (result.status === 'ok' && result.timestamp) {
      const heartbeatTime = new Date(result.timestamp);
      const now = Date.now();
      const age = now - heartbeatTime.getTime();

      console.log(`[Heartbeat] Timestamp: ${result.timestamp}, Parsed: ${heartbeatTime.toISOString()}, Now: ${new Date(now).toISOString()}, Age: ${age}ms`);

      // Reset failure count on success
      heartbeatFailCount = 0;

      if (age < HEARTBEAT_TIMEOUT) {
        updateStatus('connected', `Connected (${Math.round(age / 1000)}s ago)`);
        elements.watcherSetup.classList.add('hidden');
      } else if (age < 0) {
        // Clock skew - heartbeat is in the future, treat as connected
        console.log('[Heartbeat] Clock skew detected (future timestamp), treating as connected');
        updateStatus('connected', 'Connected');
        elements.watcherSetup.classList.add('hidden');
      } else {
        updateStatus('stale', `Stale (${Math.round(age / 1000)}s ago)`);
      }
    } else if (result.status === 'not_running') {
      heartbeatFailCount++;
      console.log(`[Heartbeat] Watcher not running (fail ${heartbeatFailCount}/${MAX_HEARTBEAT_FAILS})`);
      if (heartbeatFailCount >= MAX_HEARTBEAT_FAILS) {
        updateStatus('disconnected', 'Watcher not running');
        elements.watcherSetup.classList.remove('hidden');
      }
    } else if (result.status === 'error') {
      heartbeatFailCount++;
      console.log(`[Heartbeat] Error (fail ${heartbeatFailCount}/${MAX_HEARTBEAT_FAILS}):`, result.message);
      if (heartbeatFailCount >= MAX_HEARTBEAT_FAILS) {
        updateStatus('disconnected', `Error: ${result.message || 'Unknown'}`);
      }
    } else {
      heartbeatFailCount++;
      console.log(`[Heartbeat] Unexpected response (fail ${heartbeatFailCount}/${MAX_HEARTBEAT_FAILS}):`, result.status);
      if (heartbeatFailCount >= MAX_HEARTBEAT_FAILS) {
        updateStatus('disconnected', 'Watcher not running');
        elements.watcherSetup.classList.remove('hidden');
      }
    }
  } catch (e) {
    heartbeatFailCount++;
    console.error(`[Heartbeat] Exception (fail ${heartbeatFailCount}/${MAX_HEARTBEAT_FAILS}):`, e);
    if (heartbeatFailCount >= MAX_HEARTBEAT_FAILS) {
      updateStatus('disconnected', 'Connection error');
    }
  } finally {
    heartbeatPending = false;
  }
}

/**
 * Poll for new responses
 */
async function pollResponses() {
  if (!currentPlanId || !currentServer || !currentProject) return;

  // Skip if a poll is already in progress
  if (pollPending) {
    console.log('[Poll] Skipping - previous poll still pending');
    return;
  }

  pollPending = true;
  try {
    const result = await queuedSendNativeMessage({
      action: 'poll_responses',
      ssh_target: getSshTarget(),
      remote_path: currentProject.path,
      plan_id: currentPlanId
    });

    if (result.status === 'ok' && result.content) {
      // Only process new content
      const content = result.content;
      if (content.length > lastResponseLength) {
        const newContent = content.substring(lastResponseLength);
        lastResponseLength = content.length;

        // Parse and render new lines
        const lines = newContent.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line);
              console.log('[Event] Received:', event.type, event.subtype || '', event);
              renderEvent(event);
            } catch (e) {
              console.error('[Event] Failed to parse/render:', e.message || e, 'Line:', line.substring(0, 200));
              // Skip malformed lines silently in UI
            }
          }
        }
      }
    }
  } catch (e) {
    console.log('Poll error:', e);
  } finally {
    pollPending = false;
  }
}

/**
 * Update status indicator
 */
function updateStatus(status, text) {
  elements.statusDot.className = 'status-dot ' + status;
  elements.statusText.textContent = text;

  // Sync collapsed config panel
  updateConfigDot();
  updateConfigStatusShort();
  updateConnectButton(status);
}

/**
 * Update phase indicator
 */
function updatePhaseIndicator(phase) {
  if (!phase) {
    elements.phaseIndicator.classList.add('hidden');
    return;
  }

  elements.phaseIndicator.classList.remove('hidden');
  elements.phaseIndicator.classList.remove('planning', 'executing', 'complete');

  switch (phase) {
    case 'plan':
      elements.phaseIndicator.textContent = 'Planning';
      elements.phaseIndicator.classList.add('planning');
      break;
    case 'execute':
      elements.phaseIndicator.textContent = 'Executing';
      elements.phaseIndicator.classList.add('executing');
      break;
    case 'complete':
      elements.phaseIndicator.textContent = 'Complete';
      elements.phaseIndicator.classList.add('complete');
      break;
  }
}

/**
 * Show loading indicator in activity feed
 */
function showLoading(message = 'Processing...') {
  // Remove any existing loading indicator
  hideLoading();

  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'loading-indicator';
  loadingDiv.className = 'loading-indicator';
  loadingDiv.innerHTML = `
    <div class="spinner"></div>
    <span>${message}</span>
  `;
  elements.activityFeed.appendChild(loadingDiv);
  scrollToBottom();
}

/**
 * Hide loading indicator
 */
function hideLoading() {
  const loading = document.getElementById('loading-indicator');
  if (loading) {
    loading.remove();
  }
}

// ============================================
// RENDERING
// ============================================

/**
 * Render a stream-json event
 */
function renderEvent(event) {
  if (!event || !event.type) {
    console.log('[Event] Skipping invalid event:', event);
    return;
  }

  // Hide loading when we start receiving events
  hideLoading();

  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') {
        sessionId = event.session_id || null;
        if (sessionId) {
          elements.sessionIdDisplay.textContent = `Session: ${sessionId.substring(0, 8)}...`;
        }
        const model = event.model || 'unknown';
        const mode = event.permissionMode || 'unknown';
        addActivity('system', `Model: ${model}, Mode: ${mode}`);

        // Track API key source for cost display
        currentApiSource = event.apiKeySource || null;

        // Warn if using API key instead of Max subscription
        if (event.apiKeySource === 'ANTHROPIC_API_KEY') {
          addActivity('system', '⚠️ Using API key (costs money per token). Run "unset ANTHROPIC_API_KEY" on server to use your Max subscription instead.');
        }
      }
      break;

    case 'assistant':
      if (event.message?.content && Array.isArray(event.message.content)) {
        for (const block of event.message.content) {
          if (!block || !block.type) continue;

          if (block.type === 'text' && block.text) {
            addActivity('claude-text', block.text, true);
            // Capture response summary for task history (first 500 chars total)
            if (currentTaskResponse.length < 500) {
              currentTaskResponse += block.text.substring(0, 500 - currentTaskResponse.length);
            }
          } else if (block.type === 'tool_use') {
            renderToolUse(block);
          }
        }
      }
      break;

    case 'user':
      // Tool results
      if (event.message?.content && Array.isArray(event.message.content)) {
        for (const block of event.message.content) {
          if (!block || block.type !== 'tool_result') continue;

          if (block.is_error) {
            const errorContent = typeof block.content === 'string' ? block.content : 'Error';
            addActivity('tool-error', errorContent);
          } else if (typeof block.content === 'string' && block.content.trim()) {
            // Truncate tool output to keep activity feed readable
            const output = block.content.length > 100
              ? block.content.substring(0, 100) + '... (truncated)'
              : block.content;
            addActivity('tool-output', output);
          }
        }
      }
      break;

    case 'result':
      renderResult(event);
      break;

    default:
      console.log('[Event] Unknown event type:', event.type);
  }

  scrollToBottom();

  // Save activity after each event
  saveActivityToStorage();
}

/**
 * Render a tool use event
 */
function renderToolUse(block) {
  if (!block || !block.name) {
    console.log('[Tool] Skipping invalid tool block:', block);
    return;
  }

  const input = block.input || {};
  const name = block.name;

  // Skip internal Claude Code operations (settings, etc.)
  const filePath = input.file_path || input.path || '';
  if (filePath.includes('/.claude/')) {
    return;
  }

  switch (name) {
    case 'Write':
      addActivity('tool-write', `Write: ${input.file_path || 'unknown'}`);
      // Track for task history
      if (input.file_path && !currentTaskFiles.includes(input.file_path)) {
        currentTaskFiles.push(input.file_path);
      }
      break;
    case 'Edit':
      addActivity('tool-edit', `Edit: ${input.file_path || 'unknown'}`);
      // Track for task history
      if (input.file_path && !currentTaskFiles.includes(input.file_path)) {
        currentTaskFiles.push(input.file_path);
      }
      break;
    case 'Read':
      addActivity('tool-read', `Read: ${input.file_path || 'unknown'}`);
      break;
    case 'Bash':
      const cmd = input.command || '';
      const shortCmd = cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
      addActivity('tool-bash', `Run: ${shortCmd || '(empty command)'}`);
      // Track for task history
      if (cmd) {
        currentTaskCommands.push(cmd);
      }
      break;
    case 'Glob':
    case 'Grep':
      addActivity('tool-search', `${name}: ${input.pattern || input.path || ''}`);
      break;
    case 'Task':
      addActivity('tool-other', `Task: ${input.description || 'agent task'}`);
      break;
    default:
      addActivity('tool-other', `${name}`);
  }
}

/**
 * Render a result event
 */
function renderResult(event) {
  // Hide loading indicator
  hideLoading();

  // Handle interrupted task
  if (event.subtype === 'interrupted') {
    addActivity('system', '⚠️ Task interrupted by user');
    addActivity('system', 'Partial work may have been saved. Check the activity feed above for any completed steps.');

    // Reset state
    currentPhase = null;
    currentPlanId = null;
    updatePhaseIndicator(null);
    updateSendButton();

    // Stop polling
    stopPolling();

    // Show completion actions so user can start a new task
    showCompleteActions();
    return;
  }

  // Show "Free (Max)" if using Max subscription, otherwise show actual cost
  const cost = (currentApiSource === 'none' || currentApiSource === 'oauth')
    ? 'Free (Max)'
    : event.total_cost_usd ? `$${event.total_cost_usd.toFixed(4)}` : '?';
  const duration = event.duration_ms
    ? `${(event.duration_ms / 1000).toFixed(1)}s`
    : '?';
  const denials = event.permission_denials || [];

  if (denials.length > 0) {
    addActivity('result-partial', `Completed with ${denials.length} blocked action(s)`);

    // Show each blocked command in the activity feed
    for (const denial of denials) {
      if (denial.tool_name === 'Bash' && denial.tool_input) {
        const cmd = denial.tool_input.command || '';
        const shortCmd = cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
        addActivity('tool-blocked', `Blocked: ${shortCmd}`);
      }
    }

    // Show profile hint once per session for restrictive profiles
    const normalizedProfile = LEGACY_PROFILE_MAP[currentProfile] || currentProfile;
    if (!profileHintShown && (normalizedProfile === 'edit_files' || normalizedProfile === 'plan_only')) {
      const profileInfo = PROFILE_INFO[normalizedProfile];
      const profileName = profileInfo?.name || currentProfile;
      addActivity('system',
        `Tip: Your current profile (${profileName}) doesn't allow running commands. ` +
        `Switch to Standard or Full Access to enable shell commands.`
      );
      profileHintShown = true;
    }

    showBlockedCommands(denials);
  } else {
    addActivity('result-success', 'Complete');
  }

  addActivity('result-stats', `Cost: ${cost} | Duration: ${duration}`);

  // Show appropriate action buttons based on phase
  if (currentPhase === 'plan') {
    showPlanActions();
  } else {
    // Execution complete - show new plan button
    updatePhaseIndicator('complete');
    showCompleteActions();
  }

  // Stop polling - task complete
  stopPolling();

  // Send browser notification if panel not in focus
  notifyTaskComplete(currentPhase, duration);

  // Save to task history with full request/response data
  saveTaskToHistory({
    timestamp: new Date().toISOString(),
    project: currentProject?.name || 'Unknown',
    request: currentTaskRequest, // Full original request
    responseSummary: currentTaskResponse, // First 500 chars of Claude's response
    filesModified: [...currentTaskFiles], // Copy array
    commandsRun: [...currentTaskCommands], // Copy array
    cost: cost,
    duration: duration,
    durationMs: event.duration_ms || 0,
    phase: currentPhase
  });

  // Update dashboard cache for this project
  if (currentServer && currentProject) {
    const timeAgo = getTimeAgo(new Date());
    updateDashboardCache(currentServer.id, currentProject.id, {
      status: 'idle',
      lastActivity: `Complete (${cost}, ${timeAgo})`,
      lastCost: cost,
      lastTimestamp: new Date().toISOString()
    });
  }
}

/**
 * Simple markdown to HTML conversion for common patterns
 */
function simpleMarkdown(text) {
  if (!text) return '';

  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers (## and ###)
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Bold (**text**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic (*text* or _text_)
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Inline code (`code`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Code blocks (```code```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Bullet lists (- item)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> items in <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Numbered lists (1. item)
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Line breaks (preserve paragraph structure)
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[234]>)/g, '$1');
  html = html.replace(/(<\/h[234]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');

  return html;
}

/**
 * Add activity item to feed
 */
function addActivity(type, content, isMarkdown = false) {
  // Remove empty state if present
  const emptyState = elements.activityFeed.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  const item = document.createElement('div');
  item.className = `activity-item ${type}`;

  if (isMarkdown) {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'activity-content';
    try {
      // Try marked.js first, fall back to simple markdown
      if (typeof marked !== 'undefined' && marked.parse) {
        contentDiv.innerHTML = marked.parse(content);
      } else {
        contentDiv.innerHTML = simpleMarkdown(content);
      }
    } catch (e) {
      console.log('Markdown parse error, using simple renderer:', e);
      contentDiv.innerHTML = simpleMarkdown(content);
    }
    item.appendChild(contentDiv);
  } else if ((type === 'tool-output' || type === 'tool-error') && content.length > 150) {
    // Truncate long tool output with expand toggle
    const container = document.createElement('div');

    const contentDiv = document.createElement('div');
    contentDiv.className = 'truncated-content';
    contentDiv.textContent = content;
    container.appendChild(contentDiv);

    const toggle = document.createElement('span');
    toggle.className = 'expand-toggle';
    toggle.textContent = '▶ Show full output';
    toggle.addEventListener('click', () => {
      contentDiv.classList.toggle('expanded');
      toggle.textContent = contentDiv.classList.contains('expanded')
        ? '▼ Collapse'
        : '▶ Show full output';
    });
    container.appendChild(toggle);

    item.appendChild(container);
  } else {
    item.textContent = content;
  }

  elements.activityFeed.appendChild(item);

  // Save to history for persistence
  activityHistory.push({ type, content, isMarkdown, timestamp: Date.now() });
  if (activityHistory.length > MAX_ACTIVITY_ITEMS) {
    activityHistory = activityHistory.slice(-MAX_ACTIVITY_ITEMS);
  }
  saveActivityToStorage();
}

/**
 * Scroll activity feed to bottom
 */
function scrollToBottom() {
  elements.activityFeed.scrollTop = elements.activityFeed.scrollHeight;
}

/**
 * Get storage key for current project's activity
 */
function getActivityStorageKey() {
  if (!currentServer || !currentProject) return null;
  return `activity_${currentServer.id}_${currentProject.id}`;
}

/**
 * Save activity history to chrome.storage.session
 */
function saveActivityToStorage() {
  const key = getActivityStorageKey();
  if (!key) return;

  const data = {
    activity: activityHistory,
    phase: currentPhase,
    sessionId: sessionId,
    planId: currentPlanId
  };

  chrome.storage.session.set({ [key]: data }).catch(() => {
    // Ignore storage errors
  });
}

/**
 * Load activity history from chrome.storage.session
 */
async function loadActivityFromStorage() {
  const key = getActivityStorageKey();
  if (!key) return;

  try {
    const result = await chrome.storage.session.get(key);
    const data = result[key];

    if (data && data.activity && data.activity.length > 0) {
      activityHistory = data.activity;
      currentPhase = data.phase || null;
      sessionId = data.sessionId || null;
      currentPlanId = data.planId || null;

      // Restore the activity feed UI
      elements.activityFeed.innerHTML = '';
      for (const item of activityHistory) {
        renderActivityItem(item.type, item.content, item.isMarkdown);
      }

      // Restore phase indicator
      updatePhaseIndicator(currentPhase);

      // Restore session display
      if (sessionId) {
        elements.sessionIdDisplay.textContent = sessionId.substring(0, 8) + '...';
      }

      // If we were in a phase, resume polling
      if (currentPhase && currentPlanId) {
        startPolling();
      }

      scrollToBottom();
    }
  } catch (e) {
    console.log('Could not load activity from storage:', e);
  }
}

/**
 * Render activity item without saving to history (for restoring from storage)
 */
function renderActivityItem(type, content, isMarkdown = false) {
  const item = document.createElement('div');
  item.className = `activity-item ${type}`;

  if (isMarkdown) {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'activity-content';
    try {
      if (typeof marked !== 'undefined' && marked.parse) {
        contentDiv.innerHTML = marked.parse(content);
      } else {
        contentDiv.innerHTML = simpleMarkdown(content);
      }
    } catch (e) {
      contentDiv.innerHTML = simpleMarkdown(content);
    }

    // Highlight destructive commands in code blocks
    highlightDestructiveCommands(contentDiv);

    item.appendChild(contentDiv);
  } else {
    item.textContent = content;
  }

  elements.activityFeed.appendChild(item);
}

/**
 * Highlight destructive commands in code blocks within an element
 */
function highlightDestructiveCommands(element) {
  // Find all code elements (both inline and block)
  const codeElements = element.querySelectorAll('code, pre');

  codeElements.forEach(codeEl => {
    const text = codeEl.textContent;
    if (isDestructiveCommand(text)) {
      // Add warning class to the code element
      codeEl.classList.add('destructive-command');

      // If it's a pre block, also add class to parent
      if (codeEl.tagName === 'CODE' && codeEl.parentElement?.tagName === 'PRE') {
        codeEl.parentElement.classList.add('destructive-command-block');
      }
    }
  });
}

/**
 * Clear activity from storage
 */
function clearActivityStorage() {
  const key = getActivityStorageKey();
  if (key) {
    chrome.storage.session.remove(key).catch(() => {});
  }
  activityHistory = [];
}

/**
 * Show plan phase action buttons
 */
function showPlanActions() {
  elements.actionButtons.classList.remove('hidden');

  // In Plan Only mode, hide Execute button (users can only view/revise)
  const normalizedProfile = LEGACY_PROFILE_MAP[currentProfile] || currentProfile;
  if (normalizedProfile === 'plan_only') {
    elements.executeBtn.classList.add('hidden');
  } else {
    elements.executeBtn.classList.remove('hidden');
  }

  elements.reviseBtn.classList.remove('hidden');
  elements.cancelBtn.classList.remove('hidden');
}

/**
 * Show complete phase actions
 */
function showCompleteActions() {
  elements.actionButtons.classList.add('hidden');
  elements.newPlanContainer.classList.remove('hidden');
}

/**
 * Continue in the same session (keeps session and context)
 */
function continueInSession() {
  // Keep session, just reset plan state
  currentPlanId = null;
  currentPhase = null;
  lastResponseLength = 0;
  approvedTools = [];

  // Hide completion buttons
  elements.newPlanContainer.classList.add('hidden');
  elements.blockedCommands.classList.add('hidden');

  // Reset phase indicator but keep activity
  updatePhaseIndicator(null);

  // Focus input for next message
  elements.messageInput.focus();
  updateSendButton();

  addActivity('system', 'Continuing in session. You can send follow-up prompts.');
}

/**
 * Start a new task (clears activity but keeps session)
 */
function startNewTask() {
  // Keep session for context memory, clear activity
  currentPlanId = null;
  currentPhase = null;
  lastResponseLength = 0;
  approvedTools = [];

  // Clear activity history and storage
  clearActivityStorage();

  // Clear activity feed
  elements.activityFeed.innerHTML = `
    <div class="empty-state">
      <p>Ready for a new task.</p>
      <p class="hint">Session context is preserved. Enter your prompt below.</p>
    </div>
  `;

  // Hide buttons
  elements.actionButtons.classList.add('hidden');
  elements.blockedCommands.classList.add('hidden');
  elements.newPlanContainer.classList.add('hidden');

  // Reset phase indicator
  updatePhaseIndicator(null);

  // Session is preserved - update display if we have one
  if (sessionId) {
    elements.sessionIdDisplay.textContent = `Session: ${sessionId.substring(0, 8)}...`;
  }

  // Focus input
  elements.messageInput.focus();
  updateSendButton();
}

/**
 * Reset session on server (archive to history and delete session_id file)
 */
async function resetSession() {
  if (!currentServer || !currentProject) return;

  if (!confirm('Reset the Claude Code session? This starts a fresh conversation.')) {
    return;
  }

  showLoading('Resetting session...');

  try {
    const sshTarget = getSshTarget();

    // Step 1: Read current session_id from server
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      const readResult = await queuedSendNativeMessage({
        action: 'read_session',
        ssh_target: sshTarget,
        remote_path: currentProject.path,
        ssh_key: currentServer.sshKey || undefined,
        ssh_port: currentServer.sshPort || undefined
      });

      if (readResult.status === 'ok' && readResult.session_id) {
        currentSessionId = readResult.session_id;
      }
    }

    // Step 2: Archive and delete session on server
    const resetResult = await queuedSendNativeMessage({
      action: 'reset_session',
      ssh_target: sshTarget,
      remote_path: currentProject.path,
      session_id: currentSessionId || '',
      timestamp: new Date().toISOString(),
      ssh_key: currentServer.sshKey || undefined,
      ssh_port: currentServer.sshPort || undefined
    });

    if (resetResult.status === 'error') {
      console.log('Server reset failed:', resetResult.message);
      // Continue with local reset anyway
    }

    // Step 3: Reset local state
    sessionId = null;
    currentPlanId = null;
    currentPhase = null;
    lastResponseLength = 0;

    // Clear activity history and storage
    clearActivityStorage();

    // Clear activity feed
    elements.activityFeed.innerHTML = `
      <div class="empty-state">
        <p>Session reset.</p>
        <p class="hint">Send a new plan to start a fresh conversation.</p>
      </div>
    `;

    // Hide buttons
    elements.actionButtons.classList.add('hidden');
    elements.blockedCommands.classList.add('hidden');
    elements.newPlanContainer.classList.add('hidden');

    // Reset phase indicator
    updatePhaseIndicator(null);

    // Update session display
    elements.sessionIdDisplay.textContent = 'No session';

    addActivity('system', 'Session reset successfully');

  } catch (e) {
    console.error('Reset session error:', e);
    addActivity('system', 'Error: ' + (e.message || String(e) || 'Unknown error'));
  }

  hideLoading();
}

/**
 * Show blocked commands UI
 */
function showBlockedCommands(denials) {
  elements.blockedList.innerHTML = '';
  approvedTools = [];

  const commands = parseBlockedCommands(denials);
  blockedCommandsData = commands; // Store for copy functionality

  // Only show UI if there are actual commands to display
  if (Object.keys(commands).length === 0) {
    elements.blockedCommands.classList.add('hidden');
    return;
  }

  elements.blockedCommands.classList.remove('hidden');

  for (const [prefix, data] of Object.entries(commands)) {
    const item = document.createElement('div');
    item.className = 'blocked-item';

    const instanceCount = data.instances.length;
    const countBadge = instanceCount > 1
      ? `<span class="blocked-item-count">${instanceCount}x</span>`
      : '';

    // Show first command, truncated
    const fullCmd = data.instances[0].full;
    const displayCmd = fullCmd.length > 60 ? fullCmd.substring(0, 60) + '...' : fullCmd;
    const description = data.instances[0].description;

    item.innerHTML = `
      <input type="checkbox" id="approve-${prefix}" checked data-rule="${data.rule}" data-prefix="${prefix}">
      <div class="blocked-item-content">
        <div class="blocked-item-header">
          <span class="blocked-item-prefix">${prefix}</span>
          ${countBadge}
        </div>
        <div class="blocked-item-cmd" title="${escapeHtml(fullCmd)}">${escapeHtml(displayCmd)}</div>
        ${description ? `<div class="blocked-item-desc">${escapeHtml(description)}</div>` : ''}
      </div>
      <div class="blocked-item-actions">
        <button class="btn btn-tiny copy-cmd-btn" data-cmd="${escapeHtml(fullCmd)}" title="Copy command">Copy</button>
      </div>
    `;

    elements.blockedList.appendChild(item);
  }

  // Add click handlers for copy buttons
  elements.blockedList.querySelectorAll('.copy-cmd-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const cmd = e.target.dataset.cmd;
      await copyToClipboard(cmd);
      e.target.textContent = 'Copied!';
      setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
    });
  });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Get time ago string
 */
function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}hr ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Parse blocked commands from permission_denials
 */
function parseBlockedCommands(denials) {
  const commands = {};

  for (const denial of denials) {
    if (denial.tool_name === 'Bash' && denial.tool_input) {
      const fullCommand = denial.tool_input.command || '';
      const prefix = fullCommand.split(/\s+/)[0];
      const shortPrefix = prefix.split('/').pop();

      if (!commands[shortPrefix]) {
        commands[shortPrefix] = {
          prefix: shortPrefix,
          rule: `Bash(${shortPrefix}:*)`,
          instances: []
        };
      }
      commands[shortPrefix].instances.push({
        full: fullCommand,
        description: denial.tool_input.description || ''
      });
    }
  }

  return commands;
}

// ============================================
// SENDING PLANS
// ============================================

/**
 * Send a new plan
 */
async function sendPlan() {
  if (!currentServer || !currentProject) return;

  const content = elements.messageInput.value.trim();
  if (!content) return;

  // Try to acquire lock before sending
  const lockAcquired = await acquireProjectLock();
  if (!lockAcquired) {
    addActivity('system', '⚠️ Another browser tab is already using this project. Please close other PlanDrop tabs or wait.');
    return;
  }

  // Auto-collapse config after first user action
  onFirstUserAction();

  currentPlanId = `plan_${Date.now()}`;
  currentPhase = 'plan';
  lastResponseLength = 0;

  // Reset task history tracking for new task
  currentTaskRequest = content;
  currentTaskResponse = '';
  currentTaskFiles = [];
  currentTaskCommands = [];

  const planData = {
    id: currentPlanId,
    type: 'plan',
    action: 'plan',
    content: content,
    permission_mode: 'plan',
    model: currentModel,
    timestamp: new Date().toISOString()
  };

  elements.sendPlanBtn.disabled = true;
  elements.newPlanContainer.classList.add('hidden');
  updatePhaseIndicator('plan');
  showLoading('Sending plan...');

  try {
    const result = await queuedSendNativeMessage({
      action: 'send_plan',
      ssh_target: getSshTarget(),
      remote_path: currentProject.path,
      plan_data: JSON.stringify(planData)
    });

    hideLoading();

    if (result.status === 'success') {
      addActivity('user-plan', `Sent plan: ${content.substring(0, 100)}...`);
      elements.messageInput.value = '';
      showLoading('Waiting for Claude...');
      startPolling();
    } else {
      addActivity('system', 'Error: ' + (result.message || 'Unknown error'));
      currentPlanId = null;
      currentPhase = null;
      updatePhaseIndicator(null);
    }
  } catch (e) {
    hideLoading();
    addActivity('system', 'Error: ' + (e.message || String(e) || 'Unknown error'));
    currentPlanId = null;
    currentPhase = null;
    updatePhaseIndicator(null);
  }

  updateSendButton();
}

/**
 * Execute the approved plan
 */
async function executePlan() {
  if (!currentServer || !currentProject) return;

  // Ensure we have the lock before executing
  const lockAcquired = await acquireProjectLock();
  if (!lockAcquired) {
    addActivity('system', '⚠️ Another browser tab is already using this project. Please close other PlanDrop tabs or wait.');
    return;
  }

  // Auto-collapse config after first user action
  onFirstUserAction();

  currentPhase = 'execute';
  lastResponseLength = 0;

  elements.actionButtons.classList.add('hidden');
  updatePhaseIndicator('execute');

  // Get permission mode and disallowed tools from profile
  const permissionMode = getPermissionMode(currentProfile);
  const disallowedTools = getDisallowedTools(currentProfile);

  // Build explicit authorization message describing what Claude is authorized to do
  const profileInfo = PROFILE_INFO[LEGACY_PROFILE_MAP[currentProfile] || currentProfile];
  const profileName = profileInfo?.name || 'Standard';
  const authorizationContent = buildAuthorizationMessage(profileName, permissionMode, disallowedTools);

  const execData = {
    id: `exec_${Date.now()}`,
    type: 'execute',
    action: 'execute',
    content: authorizationContent,
    permission_mode: permissionMode,
    model: currentModel,
    timestamp: new Date().toISOString()
  };

  // Add disallowed_tools if any are set
  if (disallowedTools) {
    execData.disallowed_tools = disallowedTools;
  }

  // Update currentPlanId to the new exec plan_id so polling fetches the right response
  currentPlanId = execData.id;
  console.log('[Execute] New plan_id:', currentPlanId);

  showLoading('Starting execution...');

  try {
    const result = await queuedSendNativeMessage({
      action: 'send_plan',
      ssh_target: getSshTarget(),
      remote_path: currentProject.path,
      plan_data: JSON.stringify(execData)
    });

    hideLoading();

    if (result.status === 'success') {
      addActivity('user-action', 'Execute plan');
      showLoading('Executing...');
      startPolling();
    } else {
      addActivity('system', 'Error: ' + (result.message || 'Unknown error'));
      updatePhaseIndicator(null);
    }
  } catch (e) {
    hideLoading();
    addActivity('system', 'Error: ' + (e.message || String(e) || 'Unknown error'));
    updatePhaseIndicator(null);
  }
}

/**
 * Show revise input
 */
function showReviseInput() {
  elements.messageInput.placeholder = 'Enter revision feedback...';
  elements.messageInput.focus();
  elements.sendPlanBtn.textContent = 'Send Revision';
  elements.sendPlanBtn.onclick = sendRevision;
  elements.actionButtons.classList.add('hidden');
}

/**
 * Send revision feedback
 */
async function sendRevision() {
  if (!currentServer || !currentProject) return;

  const feedback = elements.messageInput.value.trim();
  if (!feedback) return;

  lastResponseLength = 0;
  currentPhase = 'plan';

  const reviseData = {
    id: `revise_${Date.now()}`,
    type: 'revise',
    action: 'plan',
    content: `revise the plan: ${feedback}`,
    permission_mode: 'plan',
    model: currentModel,
    timestamp: new Date().toISOString()
  };

  elements.sendPlanBtn.disabled = true;
  updatePhaseIndicator('plan');
  showLoading('Sending revision...');

  try {
    const result = await queuedSendNativeMessage({
      action: 'send_plan',
      ssh_target: getSshTarget(),
      remote_path: currentProject.path,
      plan_data: JSON.stringify(reviseData)
    });

    hideLoading();

    if (result.status === 'success') {
      addActivity('user-action', `Revise: ${feedback}`);
      elements.messageInput.value = '';
      showLoading('Waiting for Claude...');
      startPolling();
    } else {
      addActivity('system', 'Error: ' + (result.message || 'Unknown error'));
    }
  } catch (e) {
    hideLoading();
    addActivity('system', 'Error: ' + (e.message || String(e) || 'Unknown error'));
  }

  // Reset button
  elements.messageInput.placeholder = 'Type a message or paste a plan...';
  elements.sendPlanBtn.textContent = 'Send Plan';
  elements.sendPlanBtn.onclick = sendPlan;
  updateSendButton();
}

/**
 * Cancel current plan
 */
function cancelPlan() {
  stopPolling();
  hideLoading();
  currentPlanId = null;
  currentPhase = null;
  updatePhaseIndicator(null);
  elements.actionButtons.classList.add('hidden');
  elements.newPlanContainer.classList.remove('hidden');
  addActivity('system', 'Plan cancelled');
}

/**
 * Approve blocked commands and re-run
 */
async function approveAndRerun() {
  // Collect checked tools
  approvedTools = [];
  const checkboxes = elements.blockedList.querySelectorAll('input[type="checkbox"]:checked');
  checkboxes.forEach(cb => {
    approvedTools.push({
      prefix: cb.id.replace('approve-', ''),
      rule: cb.dataset.rule
    });
  });

  if (approvedTools.length === 0) {
    skipBlocked();
    return;
  }

  elements.blockedCommands.classList.add('hidden');
  blockedCommandsData = {};
  lastResponseLength = 0;
  showLoading('Updating permissions...');

  // Update settings.json with newly approved tools
  const settings = getProfileSettings(currentProfile) || { permissions: { allow: [], deny: [] } };
  const newAllowList = [...settings.permissions.allow];
  for (const tool of approvedTools) {
    if (!newAllowList.includes(tool.rule)) {
      newAllowList.push(tool.rule);
    }
  }
  settings.permissions.allow = newAllowList;

  // Write updated settings to server
  try {
    await queuedSendNativeMessage({
      action: 'write_settings',
      ssh_target: getSshTarget(),
      remote_path: currentProject.path,
      settings_json: JSON.stringify(settings, null, 2)
    });
  } catch (e) {
    // Continue anyway, watch.sh will also update settings
    console.log('Could not write settings:', e);
  }

  showLoading('Re-running with approved commands...');

  const disallowedTools = getDisallowedTools(currentProfile);

  const approveData = {
    id: `approve_${Date.now()}`,
    type: 'approve',
    action: 'execute',
    content: `continue executing, the user has approved these commands: ${approvedTools.map(t => t.prefix).join(', ')}`,
    permission_mode: getPermissionMode(currentProfile),
    model: currentModel,
    new_allowed_tools: approvedTools.map(t => t.rule),
    timestamp: new Date().toISOString()
  };

  // Add disallowed_tools if any are set
  if (disallowedTools) {
    approveData.disallowed_tools = disallowedTools;
  }

  try {
    const result = await queuedSendNativeMessage({
      action: 'send_plan',
      ssh_target: getSshTarget(),
      remote_path: currentProject.path,
      plan_data: JSON.stringify(approveData)
    });

    hideLoading();

    if (result.status === 'success') {
      addActivity('user-action', `Approved: ${approvedTools.map(t => t.prefix).join(', ')}`);
      showLoading('Continuing execution...');
      startPolling();
    } else {
      addActivity('system', 'Error: ' + (result.message || 'Unknown error'));
    }
  } catch (e) {
    hideLoading();
    addActivity('system', 'Error: ' + (e.message || String(e) || 'Unknown error'));
  }
}

/**
 * Skip blocked commands
 */
function skipBlocked() {
  elements.blockedCommands.classList.add('hidden');
  blockedCommandsData = {};
  addActivity('system', 'Skipped blocked commands');
}

/**
 * Copy all blocked commands to clipboard
 */
async function copyAllBlockedCommands() {
  const allCommands = [];

  for (const [prefix, data] of Object.entries(blockedCommandsData)) {
    for (const instance of data.instances) {
      allCommands.push(instance.full);
    }
  }

  if (allCommands.length === 0) {
    return;
  }

  const text = allCommands.join('\n');
  await copyToClipboard(text);

  // Visual feedback
  const originalText = elements.copyAllBlockedBtn.textContent;
  elements.copyAllBlockedBtn.textContent = 'Copied!';
  setTimeout(() => {
    elements.copyAllBlockedBtn.textContent = originalText;
  }, 1500);
}

// ============================================
// HELPERS
// ============================================

/**
 * Get SSH target for current server
 */
function getSshTarget() {
  if (!currentServer) return '';

  if (currentServer.sshType === 'direct') {
    return `${currentServer.username}@${currentServer.host}`;
  }
  return currentServer.sshTarget;
}

/**
 * Get permission mode for profile
 */
function getPermissionMode(profile) {
  // Handle legacy profile names
  const normalizedProfile = LEGACY_PROFILE_MAP[profile] || profile;
  const info = PROFILE_INFO[normalizedProfile];
  if (info) {
    return info.permissionMode;
  }
  return 'bypassPermissions';
}

/**
 * Get disallowed tools for profile
 */
function getDisallowedTools(profile) {
  // Handle legacy profile names
  const normalizedProfile = LEGACY_PROFILE_MAP[profile] || profile;
  const info = PROFILE_INFO[normalizedProfile];

  if (!info) {
    return null;
  }

  // For custom profile, return the user's custom deny list
  if (normalizedProfile === 'custom') {
    return customDenyList || null;
  }

  return info.disallowedTools || null;
}

/**
 * Check if a command is destructive (for highlighting)
 */
function isDestructiveCommand(command) {
  if (!command) return false;
  return DESTRUCTIVE_PATTERNS.some(pattern => pattern.test(command));
}

/**
 * Build explicit authorization message for execute phase
 * This tells Claude exactly what it's authorized to do
 */
function buildAuthorizationMessage(profileName, permissionMode, disallowedTools) {
  const parts = [];

  parts.push('The user has reviewed your plan and explicitly authorizes you to execute it.');

  // Describe permission level
  if (permissionMode === 'plan') {
    parts.push('Permission level: Plan Only (read-only analysis, no execution).');
  } else if (permissionMode === 'bypassPermissions') {
    if (disallowedTools === 'Bash') {
      parts.push('Permission level: Edit Files Only. You may read, write, and edit files. Shell command execution is NOT authorized.');
    } else if (disallowedTools) {
      parts.push(`Permission level: ${profileName}. You may execute the plan with the following restrictions:`);
      parts.push(`Blocked commands: ${disallowedTools}`);
    } else {
      parts.push(`Permission level: Full Access. You may execute any commands needed to complete the plan.`);
    }
  } else {
    parts.push(`Permission level: ${profileName} (${permissionMode}).`);
  }

  parts.push('Proceed with execution now.');

  return parts.join(' ');
}

/**
 * Get settings JSON for profile (legacy - no longer used for permissions)
 * The new deny-list approach passes disallowed_tools directly in the plan data
 */
function getProfileSettings(profile) {
  // Return empty settings structure for backwards compatibility
  return { permissions: { allow: [], deny: [] } };
}

/**
 * Write settings.json to server (legacy - kept for backwards compatibility)
 * The new deny-list approach passes disallowed_tools directly in the plan data
 */
async function writeSettingsToServer() {
  // No longer needed - permissions are passed via --disallowedTools CLI flag
  return true;
}

/**
 * Send message to native host via background script (internal - use queuedSendNativeMessage)
 */
function sendNativeMessage(payload) {
  console.log('[Native] Sending:', payload.action, payload);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'native', payload }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Native] Chrome error:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      console.log('[Native] Response:', response);
      if (response && response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || 'Unknown error'));
      }
    });
  });
}

// Native messaging request queue - serialize all calls to prevent response mixup
let nativeMessageQueue = [];
let nativeMessageProcessing = false;

/**
 * Queue a native message call - ensures only ONE call is in-flight at a time
 * This prevents responses from getting mixed up between concurrent calls
 */
async function queuedSendNativeMessage(payload) {
  return new Promise((resolve, reject) => {
    nativeMessageQueue.push({ payload, resolve, reject });
    processNativeMessageQueue();
  });
}

async function processNativeMessageQueue() {
  if (nativeMessageProcessing || nativeMessageQueue.length === 0) return;

  nativeMessageProcessing = true;
  const { payload, resolve, reject } = nativeMessageQueue.shift();

  try {
    const result = await sendNativeMessage(payload);
    resolve(result);
  } catch (e) {
    reject(e);
  } finally {
    nativeMessageProcessing = false;
    // Process next item after a small delay to avoid hammering
    if (nativeMessageQueue.length > 0) {
      setTimeout(processNativeMessageQueue, 100);
    }
  }
}

/**
 * Send browser notification when task completes (if panel not in focus)
 */
function notifyTaskComplete(phase, duration) {
  // Only notify if document is hidden (user in another tab/window)
  if (!document.hidden) return;

  try {
    const title = 'PlanDrop — Task complete';
    const message = phase === 'plan'
      ? `Plan ready for review (${duration})`
      : `Execution complete (${duration})`;

    chrome.notifications.create(`plandrop_${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: title,
      message: message,
      priority: 1
    });
  } catch (e) {
    console.log('Could not create notification:', e);
  }
}

/**
 * Listen for tab activation messages from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'tabActivated') {
    // Update current tab ID and reinitialize view
    currentTabId = message.tabId;
    initializeView();
  }
  return false; // No async response needed
});

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

// Cleanup on page unload - release project lock
window.addEventListener('beforeunload', () => {
  // Release lock synchronously (best effort)
  const lockKey = getLockKey();
  if (lockKey) {
    // Use sendBeacon for reliability during unload
    // Since chrome.storage doesn't support sendBeacon, do a sync attempt
    try {
      chrome.storage.session.get(lockKey, (result) => {
        const existingLock = result[lockKey];
        if (existingLock && existingLock.instanceId === instanceId) {
          chrome.storage.session.remove(lockKey);
        }
      });
    } catch (e) {
      // Best effort - lock will expire via timeout anyway
    }
  }
});

// Also release lock when visibility changes (tab hidden for long time)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Tab is hidden - stop refreshing lock (will expire naturally if tab stays hidden)
    stopLockRefresh();
  } else {
    // Tab is visible again - try to re-acquire lock
    if (currentProject) {
      acquireProjectLock();
    }
  }
});
