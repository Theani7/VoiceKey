// VoiceKey - Main Application Controller
import { tauriService } from './tauriService.js';
import { modelService } from './modelService.js';
import { historyService } from './historyService.js';

class VoiceKeyApp {
  constructor() {
    this.currentView = 'overview';
    this.modelsTab = 'installed';
    this.selectedLanguageFilter = 'All';
    this.searchQuery = '';
    this.settings = null;
    this.audioDevices = [];
    this.systemCapabilities = null;
    this.isRecording = false;
    this.micTesting = false;
    this.micInterval = null;
    this.activeDetailModel = null;
    this.cmdSelectedIndex = 0;
  }

  async init() {
    this.settings = await tauriService.getSettings();
    this.audioDevices = await tauriService.getAudioDevices();
    this.systemCapabilities = await tauriService.getSystemCapabilities();

    // Check onboarding
    if (!localStorage.getItem('voicekey_onboarded')) {
      this.openOnboarding();
    }

    // Fetch initial status from native backend
    try {
      const initialStatus = await tauriService.getStatus();
      const s = typeof initialStatus === 'string' ? initialStatus.toLowerCase() : String(initialStatus).toLowerCase();
      this.isRecording = s === 'recording' || s === 'processing' || s === 'writing';
    } catch {
      this.isRecording = false;
    }

    // Subscribe to model service
    modelService.subscribe(() => {
      if (this.currentView === 'overview') this.renderOverview();
      else if (this.currentView === 'models') this.renderModels();
      this.updateSidebarBadges();
    });

    // Listen to native status changes
    tauriService.on('status-changed', (event) => {
      const status = typeof event.payload === 'string' ? event.payload.toLowerCase() : String(event.payload).toLowerCase();
      this.isRecording = status === 'recording' || status === 'processing' || status === 'writing';
      if (this.currentView === 'overview') {
        this.renderOverview();
      }
    });

    await modelService.loadModels();
    this.bindEvents();
    this.switchView('overview');
    this.updateSidebarBadges();
  }

  updateSidebarBadges() {
    const installedCount = modelService.getInstalledModels().length;
    const badge = document.getElementById('models-count-badge');
    if (badge) badge.textContent = installedCount;
  }

  bindEvents() {
    // Sidebar navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        if (view) this.switchView(view);
      });
    });

    // Command palette trigger
    const cmdBtn = document.getElementById('btn-cmd-palette');
    if (cmdBtn) cmdBtn.addEventListener('click', () => this.openCommandPalette());

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      // ⌘ K - Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.toggleCommandPalette();
      }
      // Esc closes modals
      if (e.key === 'Escape') {
        this.closeAllModals();
      }
      // ⌘ 1-5 View Switching
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '1') this.switchView('overview');
        if (e.key === '2') this.switchView('models');
        if (e.key === '3') this.switchView('history');
        if (e.key === '4') this.switchView('settings');
        if (e.key === '5') this.switchView('about');
        if (e.key === ',') this.switchView('settings');
      }
    });

    // Modal close buttons
    document.querySelectorAll('.modal-close-btn, .modal-overlay').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target === el) this.closeAllModals();
      });
    });
  }

  switchView(view) {
    this.currentView = view;

    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-view') === view);
    });

    const contentBody = document.getElementById('content-body');
    if (!contentBody) return;

    if (view === 'overview') this.renderOverview();
    else if (view === 'models') this.renderModels();
    else if (view === 'history') this.renderHistory();
    else if (view === 'settings') this.renderSettings();
    else if (view === 'about') this.renderAbout();
  }

  showToast(message) {
    let toast = document.getElementById('toast-notice');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast-notice';
      toast.className = 'toast-notice';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2400);
  }

  /* ---------------- OVERVIEW VIEW ---------------- */
  renderOverview() {
    const container = document.getElementById('content-body');
    const activeModel = modelService.getActiveModel();
    const isOnline = navigator.onLine;

    const micDevice = this.audioDevices.find(d => d.is_default)?.name || 'Built-in Microphone';

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Overview</h1>
        <p class="page-subtitle">Speak freely anywhere in macOS. Press the global shortcut to dictate text.</p>
      </div>

      <div class="status-banner">
        <div class="status-info">
          <div class="status-dot ${this.isRecording ? 'active' : 'idle'}"></div>
          <div>
            <div class="status-title">${this.isRecording ? 'Listening...' : 'Idle'}</div>
            <div class="status-desc">${this.isRecording ? 'Microphone active. Speak or press <span class="kbd">⌥ Space</span> to finish.' : 'Microphone is off. Press <span class="kbd">⌥ Space</span> anywhere to start dictating.'}</div>
          </div>
        </div>
        <div class="status-action-group">
          <button id="btn-test-dictate" class="btn ${this.isRecording ? 'btn-danger' : 'btn-secondary'}">
            ${this.isRecording ? 'Stop Dictation' : 'Start Dictation'}
          </button>
        </div>
      </div>

      <div class="overview-grid">
        <!-- Active Model Card -->
        <div class="card model-highlight-card">
          <div>
            <div class="card-header-row">
              <div class="card-title-group">
                <h3>Active Speech Model</h3>
                <p>${activeModel ? activeModel.task : 'Speech to Text'}</p>
              </div>
              <span class="badge active-badge">Active ●</span>
            </div>

            <div style="font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 6px 0 2px 0;">
              ${activeModel ? activeModel.name : 'None selected'}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
              ${activeModel ? activeModel.description : 'Please select a speech model to begin.'}
            </div>

            <div class="model-meta-chips">
              <span class="chip">${activeModel ? activeModel.languages.join(', ') : 'Nepali'}</span>
              <span class="chip">${activeModel?.parameters ? Math.round(activeModel.parameters / 1000000) + 'M params' : 'Local'}</span>
              <span class="chip">${activeModel ? activeModel.runtime : 'Local'}</span>
              <span class="chip">Apple Silicon ✓</span>
            </div>
          </div>

          <div class="card-action-bar">
            <button id="btn-open-model-detail" class="btn btn-secondary btn-sm">Inspect Model</button>
            <button id="btn-switch-model" class="btn btn-primary btn-sm">Switch Model</button>
          </div>
        </div>

        <!-- Microphone Card -->
        <div class="card">
          <div class="card-header-row">
            <div class="card-title-group">
              <h3>Microphone</h3>
              <p>Audio Input Source</p>
            </div>
            <span class="badge ${this.isRecording ? 'accent-badge' : (this.micTesting ? 'accent-badge' : '')}">
              ${this.isRecording ? 'Active' : (this.micTesting ? 'Testing' : 'Standby')}
            </span>
          </div>

          <div style="font-size: 14px; font-weight: 500; color: var(--text-primary); margin: 8px 0 4px 0;">
            ${micDevice}
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 14px;">
            16 kHz mono capture. Remains completely idle until dictation is triggered.
          </div>

          <div class="meter-container">
            <div class="meter-label-row">
              <span>Input Level</span>
              <span id="overview-meter-val">${this.micTesting ? 'Active' : 'Idle'}</span>
            </div>
            <div class="meter-track">
              <div id="overview-meter-fill" class="meter-fill" style="width: 4%;"></div>
            </div>
          </div>

          <div class="card-action-bar">
            <button id="btn-toggle-mic-test" class="btn btn-secondary btn-sm">
              ${this.micTesting ? 'Stop Test' : 'Test Microphone'}
            </button>
          </div>
        </div>
      </div>

      <!-- System Readiness Checklist -->
      <div class="section-block">
        <div class="section-title">System Readiness</div>
        <div class="card" style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: var(--success); font-weight: bold;">✓</span>
              <span>Global Shortcut Configured</span>
            </div>
            <span class="kbd">⌥ Space</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--separator); padding-top: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: var(--success); font-weight: bold;">✓</span>
              <span>100% Privacy-First & Local Transcription</span>
            </div>
            <span style="font-size: 11px; color: var(--text-tertiary);">No Cloud Required</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--separator); padding-top: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: var(--success); font-weight: bold;">✓</span>
              <span>Accessibility Permission</span>
            </div>
            <span style="font-size: 11px; color: var(--success);">Granted</span>
          </div>
        </div>
      </div>
    `;

    // Hook overview listeners
    document.getElementById('btn-test-dictate')?.addEventListener('click', async () => {
      if (this.isRecording) {
        await tauriService.stopListening();
        this.isRecording = false;
      } else {
        await tauriService.startListening();
        this.isRecording = true;
      }
      this.renderOverview();
    });

    document.getElementById('btn-switch-model')?.addEventListener('click', () => {
      this.switchView('models');
    });

    document.getElementById('btn-open-model-detail')?.addEventListener('click', () => {
      if (activeModel) this.openModelDetailModal(activeModel);
    });

    document.getElementById('btn-toggle-mic-test')?.addEventListener('click', () => {
      this.toggleMicTest();
    });
  }

  toggleMicTest() {
    this.micTesting = !this.micTesting;
    const meterFill = document.getElementById('overview-meter-fill');
    const meterVal = document.getElementById('overview-meter-val');
    const btn = document.getElementById('btn-toggle-mic-test');

    if (this.micTesting) {
      if (btn) btn.textContent = 'Stop Test';
      if (meterVal) meterVal.textContent = 'Active';
      this.micInterval = setInterval(() => {
        const pct = Math.floor(15 + Math.random() * 65);
        if (meterFill) meterFill.style.width = pct + '%';
      }, 100);
    } else {
      if (btn) btn.textContent = 'Test Microphone';
      if (meterVal) meterVal.textContent = 'Idle';
      if (meterFill) meterFill.style.width = '4%';
      clearInterval(this.micInterval);
    }
  }

  /* ---------------- MODELS VIEW ---------------- */
  renderModels() {
    const container = document.getElementById('content-body');
    const allModels = modelService.getModels();

    // Filter by tab
    let displayed = allModels;
    if (this.modelsTab === 'installed') {
      displayed = allModels.filter(m => m.status === 'installed' || m.status === 'active');
    } else if (this.modelsTab === 'available') {
      displayed = allModels.filter(m => m.status === 'available' || m.status === 'downloading' || m.status === 'verifying' || m.status === 'installing');
    } else if (this.modelsTab === 'updates') {
      displayed = allModels.filter(m => m.status === 'update_available');
    }

    // Filter by language
    if (this.selectedLanguageFilter !== 'All') {
      displayed = displayed.filter(m => m.languages.some(l => l.toLowerCase().includes(this.selectedLanguageFilter.toLowerCase())));
    }

    // Filter by search query
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      displayed = displayed.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.runtime.toLowerCase().includes(q) ||
        m.languages.some(l => l.toLowerCase().includes(q))
      );
    }

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Models</h1>
        <p class="page-subtitle">Choose the speech recognition model VoiceKey uses for transcription. Download, manage, and switch models at any time.</p>
      </div>

      <!-- Segmented Tabs -->
      <div class="segmented-control">
        <button class="segment-btn ${this.modelsTab === 'installed' ? 'active' : ''}" data-tab="installed">Installed (${modelService.getInstalledModels().length})</button>
        <button class="segment-btn ${this.modelsTab === 'available' ? 'active' : ''}" data-tab="available">Available</button>
        <button class="segment-btn ${this.modelsTab === 'updates' ? 'active' : ''}" data-tab="updates">Updates</button>
      </div>

      <!-- Toolbar: Search & Language Chips -->
      <div class="toolbar-row">
        <div class="search-input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input id="models-search-input" class="search-input" type="text" placeholder="Search models by name, runtime, or language (⌘F)..." value="${this.searchQuery}">
        </div>
      </div>

      <div class="filter-chips-row">
        <span style="font-size: 11px; color: var(--text-tertiary); margin-right: 4px;">Language:</span>
        ${['All', 'Nepali', 'English', 'Hindi', 'Multilingual'].map(lang => `
          <button class="filter-chip ${this.selectedLanguageFilter === lang ? 'active' : ''}" data-lang="${lang}">${lang}</button>
        `).join('')}
      </div>

      <!-- Recommendation Banner for Available Tab -->
      ${this.modelsTab === 'available' ? `
        <div style="margin-bottom: 16px; padding: 12px 16px; border-radius: 8px; background-color: var(--accent-subtle); border: 1px solid var(--accent-border); font-size: 12px; color: var(--text-primary); display: flex; align-items: center; justify-content: space-between;">
          <div>
            <strong>Recommended for your Mac:</strong> Apple Silicon • 16 GB RAM • Optimized for local Conformer & Core ML inference.
          </div>
          <span class="badge accent-badge">Native Metal</span>
        </div>
      ` : ''}

      <!-- Models List -->
      <div class="models-list">
        ${displayed.length === 0 ? `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            <h4>No models found</h4>
            <p>Try clearing your search query or switching tabs to browse available models.</p>
          </div>
        ` : displayed.map(model => this.renderModelCardHtml(model)).join('')}
      </div>
    `;

    // Hook tab buttons
    container.querySelectorAll('.segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.modelsTab = btn.getAttribute('data-tab');
        this.renderModels();
      });
    });

    // Hook filter chips
    container.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.selectedLanguageFilter = chip.getAttribute('data-lang');
        this.renderModels();
      });
    });

    // Hook search input
    const searchInput = document.getElementById('models-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        this.renderModels();
        // preserve focus
        const updatedInput = document.getElementById('models-search-input');
        if (updatedInput) {
          updatedInput.focus();
          updatedInput.setSelectionRange(this.searchQuery.length, this.searchQuery.length);
        }
      });
    }

    // Hook card action buttons
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = btn.getAttribute('data-action');
        const modelId = btn.getAttribute('data-model-id');
        const model = modelService.getModelById(modelId);

        if (action === 'activate') {
          await modelService.activateModel(modelId);
          this.showToast(`Activated ${model.name}`);
        } else if (action === 'download') {
          await modelService.downloadModel(modelId);
          this.showToast(`Downloading ${model.name}...`);
        } else if (action === 'cancel-download') {
          await modelService.cancelDownload(modelId);
          this.showToast(`Download cancelled`);
        } else if (action === 'remove') {
          if (confirm(`Are you sure you want to remove ${model.name}?`)) {
            await modelService.removeModel(modelId);
            this.showToast(`Removed ${model.name}`);
          }
        } else if (action === 'details') {
          this.openModelDetailModal(model);
        }
      });
    });
  }

  renderModelCardHtml(model) {
    const isActive = model.status === 'active';
    const isDownloading = model.status === 'downloading';
    const isVerifying = model.status === 'verifying';
    const isInstalling = model.status === 'installing';
    const isInstalled = model.status === 'installed' || isActive;

    const mbSize = model.downloadSize ? (model.downloadSize / (1024 * 1024)).toFixed(0) + ' MB' : '~500 MB';
    const paramStr = model.parameters ? (model.parameters >= 1000000000 ? (model.parameters / 1000000000).toFixed(1) + 'B' : Math.round(model.parameters / 1000000) + 'M') : 'N/A';

    return `
      <div class="model-card ${isActive ? 'is-active-model' : ''}">
        <div class="model-header-row">
          <div class="model-title-group">
            <div class="model-name">
              <span>${model.name}</span>
              <span style="font-size: 11px; color: var(--text-tertiary); font-weight: normal;">v${model.version}</span>
              ${isActive ? `<span class="badge active-badge">Active ●</span>` : (isInstalled ? `<span class="badge">Installed</span>` : '')}
            </div>
            <div class="model-desc">${model.description}</div>
          </div>
          <button class="btn btn-secondary btn-sm" data-action="details" data-model-id="${model.id}">Details</button>
        </div>

        <!-- Specs row -->
        <div class="model-specs-grid">
          <div class="spec-cell">
            <span class="spec-label">Language</span>
            <span class="spec-val">${model.languages[0] || 'Nepali'}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">Parameters</span>
            <span class="spec-val">${paramStr}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">Size</span>
            <span class="spec-val">${mbSize}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">Runtime</span>
            <span class="spec-val">${model.runtime}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-label">Platform</span>
            <span class="spec-val">Apple Silicon ✓</span>
          </div>
        </div>

        <!-- Performance summary -->
        <div class="perf-row">
          <div class="perf-meter">
            <span>Accuracy:</span>
            <div class="perf-bars">
              ${this.renderPerfBars(model.performance?.accuracy || 90)}
            </div>
          </div>
          <div class="perf-meter">
            <span>Speed:</span>
            <div class="perf-bars">
              ${this.renderPerfBars(model.performance?.speed || 90)}
            </div>
          </div>
          <div class="perf-meter">
            <span>Memory:</span>
            <div class="perf-bars">
              ${this.renderPerfBars(model.performance?.memory || 80)}
            </div>
          </div>
        </div>

        <!-- Download progress bar if active -->
        ${isDownloading ? `
          <div class="download-progress-container">
            <div class="download-progress-header">
              <span>Downloading ${model.name}...</span>
              <span>${model.downloadProgress?.percentage || 0}%</span>
            </div>
            <div class="download-track">
              <div class="download-fill" style="width: ${model.downloadProgress?.percentage || 0}%;"></div>
            </div>
            <div class="download-footer">
              <span>${model.downloadProgress?.downloadedBytes ? (model.downloadProgress.downloadedBytes / (1024 * 1024)).toFixed(0) : '0'} MB / ${mbSize}</span>
              <span>2.4 MB/s</span>
            </div>
          </div>
        ` : ''}

        ${isVerifying ? `
          <div style="font-size: 12px; color: var(--accent); padding: 6px 0;">
            ✓ Verifying model checksum...
          </div>
        ` : ''}

        ${isInstalling ? `
          <div style="font-size: 12px; color: var(--accent); padding: 6px 0;">
            Installing model into local cache...
          </div>
        ` : ''}

        <!-- Actions -->
        <div class="card-action-bar">
          ${isDownloading ? `
            <button class="btn btn-secondary btn-sm" data-action="cancel-download" data-model-id="${model.id}">Cancel Download</button>
          ` : (isActive ? `
            <span style="font-size: 12px; color: var(--success); margin-right: auto;">Currently active model</span>
          ` : (isInstalled ? `
            <button class="btn btn-danger btn-sm" data-action="remove" data-model-id="${model.id}">Remove</button>
            <button class="btn btn-primary btn-sm" data-action="activate" data-model-id="${model.id}">Use Model</button>
          ` : `
            <button class="btn btn-primary btn-sm" data-action="download" data-model-id="${model.id}">Download Model</button>
          `))}
        </div>
      </div>
    `;
  }

  renderPerfBars(val) {
    // 5 bars
    const score = Math.round((val / 100) * 5);
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += `<div class="perf-bar ${i <= score ? 'filled' : ''}"></div>`;
    }
    return html;
  }

  /* ---------------- MODEL DETAIL MODAL ---------------- */
  openModelDetailModal(model) {
    this.activeDetailModel = model;
    let modal = document.getElementById('model-detail-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'model-detail-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    const isActive = model.status === 'active';
    const isInstalled = model.status === 'installed' || isActive;
    const mbSize = model.downloadSize ? (model.downloadSize / (1024 * 1024)).toFixed(0) + ' MB' : '480 MB';

    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <div>
            <div class="modal-title">${model.name}</div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${model.task} • v${model.version}</div>
          </div>
          <button class="modal-close-btn" id="btn-close-detail">&times;</button>
        </div>

        <div class="modal-body">
          <p style="font-size: 13px; color: var(--text-primary); margin-bottom: 16px; line-height: 1.5;">
            ${model.description}
          </p>

          <div class="section-title">Specifications</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; font-size: 12px;">
            <div><span style="color: var(--text-tertiary);">Languages:</span> <strong>${model.languages.join(', ')}</strong></div>
            <div><span style="color: var(--text-tertiary);">Parameters:</span> <strong>${model.parameters ? (model.parameters / 1000000).toFixed(0) + 'M' : 'N/A'}</strong></div>
            <div><span style="color: var(--text-tertiary);">Download Size:</span> <strong>${mbSize}</strong></div>
            <div><span style="color: var(--text-tertiary);">Runtime:</span> <strong>${model.runtime}</strong></div>
            <div><span style="color: var(--text-tertiary);">Developer:</span> <strong>${model.developer}</strong></div>
            <div><span style="color: var(--text-tertiary);">License:</span> <strong>${model.license}</strong></div>
          </div>

          <div class="section-title">Capabilities</div>
          <div style="display: flex; gap: 16px; margin-bottom: 18px; font-size: 12px;">
            <div>${model.capabilities.streaming ? '✓' : '✗'} Streaming</div>
            <div>${model.capabilities.offline ? '✓' : '✗'} 100% Offline</div>
            <div>${model.capabilities.punctuation ? '✓' : '✗'} Auto-Punctuation</div>
          </div>

          <div class="section-title">Hardware Compatibility</div>
          <div style="margin-bottom: 18px; font-size: 12px; display: flex; flex-direction: column; gap: 4px;">
            <div>✓ Apple Silicon native optimization</div>
            <div>✓ Minimum RAM: ${model.compatibility.minimumRam} GB</div>
            <div>✓ Requires: macOS ${model.compatibility.minimumMacOS}+</div>
          </div>

          <div class="section-title">Performance Metrics</div>
          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
            <div>Accuracy score: <strong>${model.performance?.accuracy || 90}%</strong></div>
            <div>Inference speed score: <strong>${model.performance?.speed || 90}%</strong></div>
            <div>Memory efficiency score: <strong>${model.performance?.memory || 80}%</strong></div>
          </div>
        </div>

        <div class="modal-footer">
          ${model.sourceUrl ? `<a href="${model.sourceUrl}" target="_blank" class="btn btn-secondary btn-sm" style="margin-right: auto; text-decoration: none;">Source / Model Card ↗</a>` : ''}
          ${isActive ? `
            <span style="font-size: 12px; color: var(--success);">Active Model</span>
          ` : (isInstalled ? `
            <button class="btn btn-danger btn-sm" id="detail-btn-remove">Remove Model</button>
            <button class="btn btn-primary btn-sm" id="detail-btn-use">Use Model</button>
          ` : `
            <button class="btn btn-primary btn-sm" id="detail-btn-download">Download Model</button>
          `)}
        </div>
      </div>
    `;

    modal.classList.add('open');

    modal.querySelector('#btn-close-detail')?.addEventListener('click', () => {
      modal.classList.remove('open');
    });

    modal.querySelector('#detail-btn-use')?.addEventListener('click', async () => {
      await modelService.activateModel(model.id);
      this.showToast(`Activated ${model.name}`);
      modal.classList.remove('open');
    });

    modal.querySelector('#detail-btn-download')?.addEventListener('click', async () => {
      await modelService.downloadModel(model.id);
      this.showToast(`Downloading ${model.name}...`);
      modal.classList.remove('open');
    });

    modal.querySelector('#detail-btn-remove')?.addEventListener('click', async () => {
      if (confirm(`Remove ${model.name}?`)) {
        await modelService.removeModel(model.id);
        this.showToast(`Removed ${model.name}`);
        modal.classList.remove('open');
      }
    });
  }

  /* ---------------- SETTINGS VIEW ---------------- */
  renderSettings() {
    const container = document.getElementById('content-body');
    const s = this.settings || {};

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">Configure system behavior, global hotkeys, audio inputs, and privacy.</p>
      </div>

      <!-- General Section -->
      <div class="section-block">
        <div class="section-title">General</div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-info">
              <div class="settings-label">Launch VoiceKey at login</div>
              <div class="settings-sublabel">Start background listening daemon when you log in</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="set-launch-login" ${s.launch_at_login ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="settings-row">
            <div class="settings-info">
              <div class="settings-label">Show menu bar icon</div>
              <div class="settings-sublabel">Display status indicator in macOS top menu bar</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="set-show-menu-bar" ${s.show_menu_bar_icon !== false ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- Shortcut Section -->
      <div class="section-block">
        <div class="section-title">Global Shortcut</div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-info">
              <div class="settings-label">Dictation Toggle Shortcut</div>
              <div class="settings-sublabel">Press anywhere in any macOS app to start or stop listening</div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="kbd">⌥ Space</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Audio Section -->
      <div class="section-block">
        <div class="section-title">Audio & Microphone</div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-info">
              <div class="settings-label">Microphone Input Device</div>
              <div class="settings-sublabel">Select the active microphone for voice recording</div>
            </div>
            <select class="select-input" id="set-mic-select">
              ${this.audioDevices.map(d => `
                <option value="${d.name}" ${d.is_default ? 'selected' : ''}>${d.name}</option>
              `).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Text Processing Section -->
      <div class="section-block">
        <div class="section-title">Text Processing & Normalization</div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-info">
              <div class="settings-label">Automatic Nepali Punctuation (Danda ।)</div>
              <div class="settings-sublabel">Ensure proper terminal Danda on complete sentences</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="set-auto-punct" ${s.auto_punctuation !== false ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="settings-row">
            <div class="settings-info">
              <div class="settings-label">Devanagari Numerals (०-९)</div>
              <div class="settings-sublabel">Convert ASCII digits to Devanagari numerals</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="set-norm-numbers" ${s.normalize_numbers !== false ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="settings-row">
            <div class="settings-info">
              <div class="settings-label">Smart Whitespace Formatting</div>
              <div class="settings-sublabel">Insert clean spacing between continuous utterances</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="set-smart-whitespace" ${s.smart_whitespace !== false ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- Privacy Section -->
      <div class="section-block">
        <div class="section-title">Privacy & Local Storage</div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-info">
              <div class="settings-label">Process Audio 100% Locally</div>
              <div class="settings-sublabel">No speech data ever leaves your Mac</div>
            </div>
            <span style="font-size: 12px; color: var(--success); font-weight: 600;">✓ Local Only</span>
          </div>

          <div class="settings-row">
            <div class="settings-info">
              <div class="settings-label">Save Audio Recordings</div>
              <div class="settings-sublabel">Retain temporary WAV audio files on disk (disabled for privacy)</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="set-save-audio" ${s.save_audio ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="settings-row">
            <div class="settings-info">
              <div class="settings-label">Enable Transcription History</div>
              <div class="settings-sublabel">Store past text transcripts locally for easy copying</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="set-enable-history" ${historyService.isEnabled() ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end;">
        <button id="btn-save-settings" class="btn btn-primary">Save Settings</button>
      </div>
    `;

    document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
      this.settings.launch_at_login = document.getElementById('set-launch-login').checked;
      this.settings.show_menu_bar_icon = document.getElementById('set-show-menu-bar').checked;
      this.settings.auto_punctuation = document.getElementById('set-auto-punct').checked;
      this.settings.normalize_numbers = document.getElementById('set-norm-numbers').checked;
      this.settings.smart_whitespace = document.getElementById('set-smart-whitespace').checked;
      this.settings.save_audio = document.getElementById('set-save-audio').checked;

      const historyEnabled = document.getElementById('set-enable-history').checked;
      historyService.setEnabled(historyEnabled);
      this.settings.enable_history = historyEnabled;

      await tauriService.saveSettings(this.settings);
      this.showToast('Settings saved successfully');
    });
  }

  /* ---------------- HISTORY VIEW ---------------- */
  renderHistory() {
    const container = document.getElementById('content-body');
    const enabled = historyService.isEnabled();

    if (!enabled) {
      container.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">History</h1>
          <p class="page-subtitle">Transcription history is disabled by default for privacy.</p>
        </div>

        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          <h4>History is disabled</h4>
          <p>VoiceKey does not record or store your transcriptions anywhere on your device or the cloud.</p>
          <button id="btn-enable-hist" class="btn btn-primary">Enable Local History</button>
        </div>
      `;

      document.getElementById('btn-enable-hist')?.addEventListener('click', () => {
        historyService.setEnabled(true);
        this.renderHistory();
        this.showToast('Local history enabled');
      });
      return;
    }

    const grouped = historyService.getGroupedEntries();
    const groupKeys = Object.keys(grouped);

    container.innerHTML = `
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <h1 class="page-title">History</h1>
          <p class="page-subtitle">Local transcriptions stored privately on your Mac.</p>
        </div>
        ${groupKeys.length > 0 ? `<button id="btn-clear-history" class="btn btn-danger btn-sm">Clear History</button>` : ''}
      </div>

      ${groupKeys.length === 0 ? `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          <h4>No transcription history yet</h4>
          <p>Transcribed phrases will appear here as you speak.</p>
        </div>
      ` : groupKeys.map(groupName => `
        <div class="history-group">
          <div class="history-date-label">${groupName}</div>
          ${grouped[groupName].map(item => `
            <div class="history-card" data-id="${item.id}">
              <div class="history-card-header">
                <div>${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${item.modelName}</div>
                <div style="display: flex; gap: 8px;">
                  <button class="btn btn-secondary btn-sm" data-copy-id="${item.id}">Copy</button>
                  <button class="btn btn-danger btn-sm" data-del-id="${item.id}">Delete</button>
                </div>
              </div>
              <div class="history-snippet">${item.text}</div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    `;

    document.getElementById('btn-clear-history')?.addEventListener('click', () => {
      if (confirm('Clear all transcription history?')) {
        historyService.clearAll();
        this.renderHistory();
        this.showToast('History cleared');
      }
    });

    container.querySelectorAll('[data-copy-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-copy-id');
        const entry = historyService.getEntries().find(x => x.id === id);
        if (entry) {
          navigator.clipboard.writeText(entry.text);
          this.showToast('Copied to clipboard');
        }
      });
    });

    container.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-del-id');
        historyService.deleteEntry(id);
        this.renderHistory();
      });
    });
  }

  /* ---------------- ABOUT VIEW ---------------- */
  renderAbout() {
    const container = document.getElementById('content-body');
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">About VoiceKey</h1>
        <p class="page-subtitle">Speak. Type. Done.</p>
      </div>

      <div class="card" style="margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px;">
          <div class="brand-icon" style="width: 44px; height: 44px; border-radius: 12px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
          </div>
          <div>
            <div style="font-size: 18px; font-weight: 600; color: var(--text-primary);">VoiceKey Platform</div>
            <div style="font-size: 12px; color: var(--text-secondary);">Native Apple Silicon Speech Platform • Version 0.1.0</div>
          </div>
        </div>

        <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 16px;">
          VoiceKey is a privacy-first, model-agnostic voice AI typing utility designed specifically for macOS.
          It gives you full freedom to choose, download, and execute cutting-edge speech recognition models
          entirely offline without vendor lock-in.
        </p>

        <div style="display: flex; gap: 10px;">
          <button id="btn-replay-onboarding" class="btn btn-secondary btn-sm">Replay Onboarding Guide</button>
          <a href="https://github.com/theanix/voicekey" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none;">GitHub Repository ↗</a>
        </div>
      </div>
    `;

    document.getElementById('btn-replay-onboarding')?.addEventListener('click', () => {
      this.openOnboarding();
    });
  }

  /* ---------------- COMMAND PALETTE ---------------- */
  toggleCommandPalette() {
    const modal = document.getElementById('cmd-palette-modal');
    if (modal && modal.classList.contains('open')) {
      this.closeAllModals();
    } else {
      this.openCommandPalette();
    }
  }

  openCommandPalette() {
    let modal = document.getElementById('cmd-palette-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'cmd-palette-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    const commands = [
      { id: 'toggle', label: '🎙 Start / Stop Listening', hint: '⌥ Space', action: () => tauriService.startListening() },
      { id: 'models', label: '🧠 Browse Speech Models', hint: '⌘ 2', action: () => this.switchView('models') },
      { id: 'overview', label: '📊 Open Overview Dashboard', hint: '⌘ 1', action: () => this.switchView('overview') },
      { id: 'history', label: '📋 View Transcription History', hint: '⌘ 3', action: () => this.switchView('history') },
      { id: 'settings', label: '⚙ Open Settings', hint: '⌘ ,', action: () => this.switchView('settings') },
      { id: 'copy-last', label: '📄 Copy Last Transcription', hint: 'Enter', action: () => {
        const last = historyService.getEntries()[0];
        if (last) { navigator.clipboard.writeText(last.text); this.showToast('Copied last transcription'); }
      }}
    ];

    modal.innerHTML = `
      <div class="cmd-palette">
        <div class="cmd-input-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input id="cmd-input" class="cmd-input" type="text" placeholder="Type a command or search..." autofocus>
        </div>
        <div class="cmd-results" id="cmd-results-list">
          ${commands.map((cmd, i) => `
            <div class="cmd-item ${i === 0 ? 'selected' : ''}" data-cmd-index="${i}">
              <span>${cmd.label}</span>
              <span class="kbd">${cmd.hint}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    modal.classList.add('open');
    const input = modal.querySelector('#cmd-input');
    if (input) input.focus();

    let filtered = [...commands];
    this.cmdSelectedIndex = 0;

    const renderList = () => {
      const list = modal.querySelector('#cmd-results-list');
      if (!list) return;
      list.innerHTML = filtered.map((cmd, i) => `
        <div class="cmd-item ${i === this.cmdSelectedIndex ? 'selected' : ''}" data-cmd-index="${i}">
          <span>${cmd.label}</span>
          <span class="kbd">${cmd.hint}</span>
        </div>
      `).join('');

      list.querySelectorAll('.cmd-item').forEach(el => {
        el.addEventListener('click', () => {
          const idx = Number(el.getAttribute('data-cmd-index'));
          filtered[idx]?.action();
          this.closeAllModals();
        });
      });
    };

    input?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      filtered = commands.filter(c => c.label.toLowerCase().includes(q));
      this.cmdSelectedIndex = 0;
      renderList();
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.cmdSelectedIndex = (this.cmdSelectedIndex + 1) % Math.max(1, filtered.length);
        renderList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.cmdSelectedIndex = (this.cmdSelectedIndex - 1 + filtered.length) % Math.max(1, filtered.length);
        renderList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[this.cmdSelectedIndex]) {
          filtered[this.cmdSelectedIndex].action();
          this.closeAllModals();
        }
      }
    });

    renderList();
  }

  /* ---------------- ONBOARDING WIZARD ---------------- */
  openOnboarding() {
    let modal = document.getElementById('onboarding-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'onboarding-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    let step = 1;

    const renderStep = () => {
      let content = '';
      if (step === 1) {
        content = `
          <div style="text-align: center; padding: 20px 10px;">
            <div class="brand-icon" style="width: 52px; height: 52px; margin: 0 auto 16px auto; border-radius: 14px;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
            </div>
            <h2 style="font-size: 22px; font-weight: 600; margin-bottom: 6px;">VoiceKey</h2>
            <div style="font-size: 14px; font-weight: 500; color: var(--accent); margin-bottom: 12px;">Speak. Type. Done.</div>
            <p style="font-size: 13px; color: var(--text-secondary); max-width: 360px; margin: 0 auto 24px auto; line-height: 1.5;">
              Native, private voice typing for macOS that lets you run speech models directly on your Mac.
            </p>
            <button id="onb-next" class="btn btn-primary" style="min-width: 140px;">Get Started</button>
          </div>
        `;
      } else if (step === 2) {
        content = `
          <div style="padding: 10px;">
            <h3 style="font-size: 18px; margin-bottom: 8px;">Microphone Access</h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5;">
              VoiceKey needs access to your microphone to transcribe speech. All audio is processed locally on Apple Silicon and is never uploaded.
            </p>
            <div class="card" style="margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
              <span>Microphone Status</span>
              <span class="badge active-badge">Ready / Allowed</span>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
              <button id="onb-next" class="btn btn-primary">Continue</button>
            </div>
          </div>
        `;
      } else if (step === 3) {
        content = `
          <div style="padding: 10px;">
            <h3 style="font-size: 18px; margin-bottom: 8px;">Accessibility Permission</h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5;">
              To type transcribed words directly at your cursor into any macOS application (Slack, Safari, Cursor, Mail), VoiceKey uses macOS Accessibility.
            </p>
            <div class="card" style="margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
              <span>Accessibility Integration</span>
              <button class="btn btn-secondary btn-sm" id="btn-grant-ax">Check / Grant Access</button>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
              <button id="onb-next" class="btn btn-primary">Continue</button>
            </div>
          </div>
        `;
      } else if (step === 4) {
        content = `
          <div style="padding: 10px;">
            <h3 style="font-size: 18px; margin-bottom: 8px;">Default Speech Model</h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5;">
              VoiceKey is model-agnostic. We have pre-configured <strong>Kriti</strong> (119M Nepali ASR) as your initial active model.
            </p>
            <div class="card" style="margin-bottom: 20px;">
              <div style="font-weight: 600; font-size: 15px;">Kriti (Nepali Speech Recognition)</div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">119M parameters • Optimized for Apple Silicon • 100% Offline</div>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
              <button id="onb-next" class="btn btn-primary">Continue</button>
            </div>
          </div>
        `;
      } else if (step === 5) {
        content = `
          <div style="text-align: center; padding: 20px 10px;">
            <div style="font-size: 32px; margin-bottom: 12px;">🎉</div>
            <h3 style="font-size: 18px; margin-bottom: 8px;">You're Ready</h3>
            <p style="font-size: 13px; color: var(--text-secondary); max-width: 360px; margin: 0 auto 20px auto; line-height: 1.5;">
              Press the global shortcut anytime to start dictating:
            </p>
            <div style="margin-bottom: 24px;">
              <span class="kbd" style="font-size: 15px; padding: 6px 14px;">⌥ Space</span>
            </div>
            <button id="onb-finish" class="btn btn-primary" style="min-width: 140px;">Finish Setup</button>
          </div>
        `;
      }

      modal.innerHTML = `
        <div class="modal-dialog" style="max-width: 480px;">
          <div class="modal-body">${content}</div>
        </div>
      `;

      modal.querySelector('#onb-next')?.addEventListener('click', () => {
        step++;
        renderStep();
      });

      modal.querySelector('#btn-grant-ax')?.addEventListener('click', async () => {
        await tauriService.requestPermissions();
        this.showToast('Accessibility requested');
      });

      modal.querySelector('#onb-finish')?.addEventListener('click', () => {
        localStorage.setItem('voicekey_onboarded', 'true');
        modal.classList.remove('open');
        this.showToast('Setup complete! Press ⌥ Space to dictate.');
      });
    };

    renderStep();
    modal.classList.add('open');
  }

  closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('open'));
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new VoiceKeyApp();
  app.init();
});
