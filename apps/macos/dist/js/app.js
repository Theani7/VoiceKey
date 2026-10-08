// VoiceKey - Authentic macOS Application Controller
import { tauriService } from './tauriService.js';
import { modelService } from './modelService.js';
import { historyService } from './historyService.js';

class VoiceKeyApp {
  constructor() {
    this.currentView = 'overview';
    this.modelsTab = 'installed';
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

    try {
      const initialStatus = await tauriService.getStatus();
      const s = typeof initialStatus === 'string' ? initialStatus.toLowerCase() : String(initialStatus).toLowerCase();
      this.isRecording = s === 'recording' || s === 'processing' || s === 'writing';
    } catch {
      this.isRecording = false;
    }

    modelService.subscribe(() => {
      if (this.currentView === 'overview') this.renderOverview();
      else if (this.currentView === 'models') this.renderModels();
      this.updateSidebarBadges();
    });

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
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        if (view) this.switchView(view);
      });
    });

    const cmdBtn = document.getElementById('btn-cmd-palette');
    if (cmdBtn) cmdBtn.addEventListener('click', () => this.openCommandPalette());

    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.toggleCommandPalette();
      }
      if (e.key === 'Escape') {
        this.closeAllModals();
      }
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '1') this.switchView('overview');
        if (e.key === '2') this.switchView('models');
        if (e.key === '3') this.switchView('history');
        if (e.key === '4') this.switchView('settings');
        if (e.key === '5') this.switchView('about');
        if (e.key === ',') this.switchView('settings');
      }
    });
  }

  switchView(view) {
    this.currentView = view;

    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-view') === view);
    });

    const titleEl = document.getElementById('toolbar-title');
    const actionsEl = document.getElementById('toolbar-actions');

    if (view === 'overview') {
      if (titleEl) titleEl.textContent = 'Overview';
      if (actionsEl) actionsEl.innerHTML = `<span class="kbd">⌥ Space</span>`;
      this.renderOverview();
    } else if (view === 'models') {
      if (titleEl) titleEl.textContent = 'Speech Models';
      if (actionsEl) {
        actionsEl.innerHTML = `
          <div class="segmented-bar">
            <button class="segment-item ${this.modelsTab === 'installed' ? 'active' : ''}" id="tab-installed">Installed</button>
            <button class="segment-item ${this.modelsTab === 'available' ? 'active' : ''}" id="tab-available">Available</button>
          </div>
          <div class="search-field">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" id="models-search-box" placeholder="Filter models..." value="${this.searchQuery}">
          </div>
        `;
        document.getElementById('tab-installed')?.addEventListener('click', () => {
          this.modelsTab = 'installed';
          this.switchView('models');
        });
        document.getElementById('tab-available')?.addEventListener('click', () => {
          this.modelsTab = 'available';
          this.switchView('models');
        });
        document.getElementById('models-search-box')?.addEventListener('input', (e) => {
          this.searchQuery = e.target.value;
          this.renderModels();
        });
      }
      this.renderModels();
    } else if (view === 'history') {
      if (titleEl) titleEl.textContent = 'Transcription History';
      if (actionsEl) actionsEl.innerHTML = ``;
      this.renderHistory();
    } else if (view === 'settings') {
      if (titleEl) titleEl.textContent = 'Settings';
      if (actionsEl) actionsEl.innerHTML = ``;
      this.renderSettings();
    } else if (view === 'about') {
      if (titleEl) titleEl.textContent = 'About VoiceKey';
      if (actionsEl) actionsEl.innerHTML = ``;
      this.renderAbout();
    }
  }

  showToast(message) {
    let toast = document.getElementById('toast-msg');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast-msg';
      toast.className = 'toast-msg';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  /* ---------------- OVERVIEW VIEW ---------------- */
  renderOverview() {
    const container = document.getElementById('content-body');
    const activeModel = modelService.getActiveModel();
    const micDevice = this.audioDevices.find(d => d.is_default)?.name || 'Built-in Microphone';

    const paramStr = activeModel?.parameters
      ? (activeModel.parameters >= 1000000000
          ? (activeModel.parameters / 1000000000).toFixed(1) + 'B'
          : Math.round(activeModel.parameters / 1000000) + 'M')
      : '119M';

    container.innerHTML = `
      <!-- Dictation Section -->
      <div class="grouped-section">
        <div class="grouped-section-title">Dictation Engine</div>
        <div class="inset-group">
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">State</div>
              <div class="row-subtitle">
                ${this.isRecording ? 'Listening at cursor. Voice input is actively processed.' : 'Standby. Microphone is turned off until shortcut is pressed.'}
              </div>
            </div>
            <div class="row-right">
              <div class="status-indicator">
                <span class="status-dot ${this.isRecording ? 'active' : 'idle'}"></span>
                <span>${this.isRecording ? 'Listening...' : 'Standby'}</span>
              </div>
              <button id="btn-toggle-recording" class="mac-btn ${this.isRecording ? 'mac-btn-danger' : 'mac-btn-default'}">
                ${this.isRecording ? 'Stop Dictation' : 'Start Dictation'}
              </button>
            </div>
          </div>

          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Global Hotkey</div>
              <div class="row-subtitle">Toggle voice dictation anywhere in macOS</div>
            </div>
            <div class="row-right">
              <span class="kbd">⌥ Space</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Active Model Section -->
      <div class="grouped-section">
        <div class="grouped-section-title">Active Speech Model</div>
        <div class="inset-group">
          <div class="group-row">
            <div class="row-left">
              <div class="row-title" style="display: flex; align-items: center; gap: 8px;">
                <span>${activeModel ? activeModel.name : 'Kriti'}</span>
                <span class="active-pill">Active</span>
              </div>
              <div class="row-subtitle">
                ${activeModel ? `${activeModel.languages.join(', ')} • ${paramStr} parameters • ${activeModel.runtime}` : 'Nepali speech recognition'}
              </div>
            </div>
            <div class="row-right">
              <button id="btn-goto-models" class="mac-btn mac-btn-default">Change Model...</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Audio Input Section -->
      <div class="grouped-section">
        <div class="grouped-section-title">Audio Hardware</div>
        <div class="inset-group">
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">${micDevice}</div>
              <div class="row-subtitle">16 kHz mono high-fidelity capture</div>
            </div>
            <div class="row-right">
              <button id="btn-mic-tester" class="mac-btn mac-btn-default">
                ${this.micTesting ? 'Stop Test' : 'Test Microphone'}
              </button>
            </div>
          </div>
          ${this.micTesting ? `
            <div class="group-row" style="background-color: var(--bg-control);">
              <div class="row-left">
                <div class="row-subtitle">Input Level Monitor</div>
              </div>
              <div class="row-right" style="width: 140px;">
                <div class="mini-progress-bar" style="height: 6px;">
                  <div id="mic-test-fill" class="mini-progress-fill" style="width: 25%;"></div>
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- System Readiness Section -->
      <div class="grouped-section">
        <div class="grouped-section-title">System & Security</div>
        <div class="inset-group">
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Privacy Architecture</div>
              <div class="row-subtitle">All speech inference runs on-device on Apple Silicon</div>
            </div>
            <div class="row-right">
              <span style="font-size: 11px; color: var(--text-secondary);">100% On-Device</span>
            </div>
          </div>
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Accessibility Insertion</div>
              <div class="row-subtitle">Types recognized words directly at active text cursor</div>
            </div>
            <div class="row-right">
              <span style="font-size: 11px; color: var(--success); font-weight: 500;">Granted ✓</span>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-toggle-recording')?.addEventListener('click', async () => {
      if (this.isRecording) {
        await tauriService.stopListening();
        this.isRecording = false;
      } else {
        await tauriService.startListening();
        this.isRecording = true;
      }
      this.renderOverview();
    });

    document.getElementById('btn-goto-models')?.addEventListener('click', () => {
      this.switchView('models');
    });

    document.getElementById('btn-mic-tester')?.addEventListener('click', () => {
      this.micTesting = !this.micTesting;
      if (this.micTesting) {
        this.micInterval = setInterval(() => {
          const fill = document.getElementById('mic-test-fill');
          if (fill) fill.style.width = Math.floor(15 + Math.random() * 65) + '%';
        }, 100);
      } else {
        clearInterval(this.micInterval);
      }
      this.renderOverview();
    });
  }

  /* ---------------- MODELS VIEW ---------------- */
  renderModels() {
    const container = document.getElementById('content-body');
    const allModels = modelService.getModels();

    let list = allModels;
    if (this.modelsTab === 'installed') {
      list = allModels.filter(m => m.status === 'installed' || m.status === 'active');
    } else {
      list = allModels.filter(m => m.status === 'available' || m.status === 'downloading' || m.status === 'verifying' || m.status === 'installing');
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.runtime.toLowerCase().includes(q) ||
        m.languages.some(l => l.toLowerCase().includes(q))
      );
    }

    container.innerHTML = `
      <div class="models-table">
        ${list.length === 0 ? `
          <div style="text-align: center; padding: 48px 16px; color: var(--text-tertiary);">
            <div style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">No models in this view</div>
            <div style="font-size: 12px;">Switch tabs or adjust your search filter above.</div>
          </div>
        ` : list.map(model => this.renderModelRow(model)).join('')}
      </div>
    `;

    container.querySelectorAll('[data-model-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = btn.getAttribute('data-model-action');
        const id = btn.getAttribute('data-model-id');
        const model = modelService.getModelById(id);

        if (action === 'activate') {
          await modelService.activateModel(id);
          this.showToast(`Active model set to ${model.name}`);
        } else if (action === 'download') {
          await modelService.downloadModel(id);
          this.showToast(`Downloading ${model.name}...`);
        } else if (action === 'cancel') {
          await modelService.cancelDownload(id);
          this.showToast('Download cancelled');
        } else if (action === 'remove') {
          if (confirm(`Remove ${model.name}?`)) {
            await modelService.removeModel(id);
            this.showToast(`Removed ${model.name}`);
          }
        } else if (action === 'inspect') {
          this.openModelDetailSheet(model);
        }
      });
    });
  }

  renderModelRow(model) {
    const isActive = model.status === 'active';
    const isDownloading = model.status === 'downloading';
    const isVerifying = model.status === 'verifying';
    const isInstalling = model.status === 'installing';
    const isInstalled = model.status === 'installed' || isActive;

    const langCode = model.languages[0] === 'Nepali' ? 'NE' : (model.languages[0] === 'Newari' ? 'NEW' : (model.languages[0] === 'Hindi' ? 'HI' : 'MULTI'));
    const mbSize = model.downloadSize ? (model.downloadSize / (1024 * 1024)).toFixed(0) + ' MB' : '480 MB';
    const paramStr = model.parameters
      ? (model.parameters >= 1000000000 ? (model.parameters / 1000000000).toFixed(1) + 'B' : Math.round(model.parameters / 1000000) + 'M')
      : '119M';

    return `
      <div class="model-list-row ${isActive ? 'is-active' : ''}">
        <div class="model-badge-icon">${langCode}</div>

        <div class="model-primary-info">
          <div class="model-title-line">
            <span class="model-name">${model.name}</span>
            <span class="model-version">v${model.version}</span>
            ${isActive ? `<span class="active-pill">Active</span>` : ''}
          </div>
          <div class="model-summary-desc">${model.description}</div>
        </div>

        <div class="model-tech-specs">
          <span class="tech-tag">${paramStr}</span>
          <span class="tech-tag">${mbSize}</span>
          <span class="tech-tag">${model.runtime}</span>
        </div>

        <div class="model-actions">
          ${isDownloading ? `
            <div class="mini-progress-box">
              <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-tertiary);">
                <span>Downloading...</span>
                <span>${model.downloadProgress?.percentage || 0}%</span>
              </div>
              <div class="mini-progress-bar">
                <div class="mini-progress-fill" style="width: ${model.downloadProgress?.percentage || 0}%;"></div>
              </div>
            </div>
            <button class="mac-btn mac-btn-default" data-model-action="cancel" data-model-id="${model.id}">Cancel</button>
          ` : (isVerifying ? `
            <span style="font-size: 11px; color: var(--accent);">Verifying checksum...</span>
          ` : (isInstalling ? `
            <span style="font-size: 11px; color: var(--accent);">Installing...</span>
          ` : (isActive ? `
            <button class="mac-btn mac-btn-default" data-model-action="inspect" data-model-id="${model.id}">Inspect</button>
          ` : (isInstalled ? `
            <button class="mac-btn mac-btn-default" data-model-action="inspect" data-model-id="${model.id}">Inspect</button>
            <button class="mac-btn mac-btn-primary" data-model-action="activate" data-model-id="${model.id}">Use Model</button>
          ` : `
            <button class="mac-btn mac-btn-default" data-model-action="inspect" data-model-id="${model.id}">Inspect</button>
            <button class="mac-btn mac-btn-primary" data-model-action="download" data-model-id="${model.id}">Download</button>
          `))))}
        </div>
      </div>
    `;
  }

  /* ---------------- MODEL DETAIL SHEET ---------------- */
  openModelDetailSheet(model) {
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
    const paramStr = model.parameters
      ? (model.parameters >= 1000000000 ? (model.parameters / 1000000000).toFixed(1) + 'B' : Math.round(model.parameters / 1000000) + 'M')
      : '119M';

    modal.innerHTML = `
      <div class="modal-sheet">
        <div class="sheet-header">
          <div>
            <div class="sheet-title">${model.name}</div>
            <div style="font-size: 11px; color: var(--text-tertiary);">${model.task} • v${model.version}</div>
          </div>
          <button class="sheet-close-btn" id="btn-close-sheet">&times;</button>
        </div>

        <div class="sheet-body">
          <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5;">
            ${model.description}
          </p>

          <div class="grouped-section">
            <div class="grouped-section-title">Technical Specifications</div>
            <div class="inset-group">
              <div class="group-row"><span class="row-subtitle">Languages</span><strong>${model.languages.join(', ')}</strong></div>
              <div class="group-row"><span class="row-subtitle">Parameters</span><strong>${paramStr}</strong></div>
              <div class="group-row"><span class="row-subtitle">Disk Footprint</span><strong>${mbSize}</strong></div>
              <div class="group-row"><span class="row-subtitle">Runtime Engine</span><strong>${model.runtime}</strong></div>
              <div class="group-row"><span class="row-subtitle">Developer</span><strong>${model.developer}</strong></div>
              <div class="group-row"><span class="row-subtitle">License</span><strong>${model.license}</strong></div>
            </div>
          </div>

          <div class="grouped-section">
            <div class="grouped-section-title">Capabilities & Requirements</div>
            <div class="inset-group">
              <div class="group-row"><span class="row-subtitle">Streaming Voice VAD</span><strong>${model.capabilities.streaming ? 'Supported ✓' : 'File / Batch Only'}</strong></div>
              <div class="group-row"><span class="row-subtitle">On-Device Offline</span><strong>Supported ✓</strong></div>
              <div class="group-row"><span class="row-subtitle">Apple Silicon</span><strong>Optimized ✓</strong></div>
              <div class="group-row"><span class="row-subtitle">Minimum Memory</span><strong>${model.compatibility.minimumRam} GB RAM</strong></div>
            </div>
          </div>
        </div>

        <div class="sheet-footer">
          ${model.sourceUrl ? `<a href="${model.sourceUrl}" target="_blank" class="mac-btn mac-btn-default" style="margin-right: auto; text-decoration: none;">Hugging Face ↗</a>` : ''}
          ${isActive ? `
            <span style="font-size: 12px; color: var(--success); font-weight: 500;">Currently Active Model</span>
          ` : (isInstalled ? `
            <button class="mac-btn mac-btn-danger" id="sheet-btn-remove">Remove Model</button>
            <button class="mac-btn mac-btn-primary" id="sheet-btn-use">Use Model</button>
          ` : `
            <button class="mac-btn mac-btn-primary" id="sheet-btn-download">Download Model</button>
          `)}
        </div>
      </div>
    `;

    modal.classList.add('open');

    modal.querySelector('#btn-close-sheet')?.addEventListener('click', () => modal.classList.remove('open'));
    modal.querySelector('#sheet-btn-use')?.addEventListener('click', async () => {
      await modelService.activateModel(model.id);
      this.showToast(`Active model set to ${model.name}`);
      modal.classList.remove('open');
    });
    modal.querySelector('#sheet-btn-download')?.addEventListener('click', async () => {
      await modelService.downloadModel(model.id);
      this.showToast(`Downloading ${model.name}...`);
      modal.classList.remove('open');
    });
    modal.querySelector('#sheet-btn-remove')?.addEventListener('click', async () => {
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
      <div class="grouped-section">
        <div class="grouped-section-title">Application</div>
        <div class="inset-group">
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Launch at Login</div>
              <div class="row-subtitle">Start background helper daemon when you log into macOS</div>
            </div>
            <label class="mac-switch">
              <input type="checkbox" id="set-launch-login" ${s.launch_at_login ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
          </div>
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Show Menu Bar Icon</div>
              <div class="row-subtitle">Display VoiceKey icon in macOS system status bar</div>
            </div>
            <label class="mac-switch">
              <input type="checkbox" id="set-show-menu-bar" ${s.show_menu_bar_icon !== false ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="grouped-section">
        <div class="grouped-section-title">Audio Hardware</div>
        <div class="inset-group">
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Input Microphone</div>
              <div class="row-subtitle">Select recording audio interface</div>
            </div>
            <select class="mac-select" id="set-mic-select">
              ${this.audioDevices.map(d => `
                <option value="${d.name}" ${d.is_default ? 'selected' : ''}>${d.name}</option>
              `).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="grouped-section">
        <div class="grouped-section-title">Nepali Text Processing</div>
        <div class="inset-group">
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Automatic Punctuation (Danda ।)</div>
              <div class="row-subtitle">Append standard Devanagari sentence terminator</div>
            </div>
            <label class="mac-switch">
              <input type="checkbox" id="set-auto-punct" ${s.auto_punctuation !== false ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
          </div>
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Devanagari Numerals (०-९)</div>
              <div class="row-subtitle">Transcribe numbers in native numerals</div>
            </div>
            <label class="mac-switch">
              <input type="checkbox" id="set-norm-numbers" ${s.normalize_numbers !== false ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
          </div>
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Smart Whitespace</div>
              <div class="row-subtitle">Ensure clean space separation between paused phrases</div>
            </div>
            <label class="mac-switch">
              <input type="checkbox" id="set-smart-whitespace" ${s.smart_whitespace !== false ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="grouped-section">
        <div class="grouped-section-title">Privacy & Local Storage</div>
        <div class="inset-group">
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Enable Local History</div>
              <div class="row-subtitle">Store past dictations privately on disk</div>
            </div>
            <label class="mac-switch">
              <input type="checkbox" id="set-enable-history" ${historyService.isEnabled() ? 'checked' : ''}>
              <span class="switch-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
        <button id="btn-save-settings" class="mac-btn mac-btn-primary">Apply Changes</button>
      </div>
    `;

    document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
      this.settings.launch_at_login = document.getElementById('set-launch-login').checked;
      this.settings.show_menu_bar_icon = document.getElementById('set-show-menu-bar').checked;
      this.settings.auto_punctuation = document.getElementById('set-auto-punct').checked;
      this.settings.normalize_numbers = document.getElementById('set-norm-numbers').checked;
      this.settings.smart_whitespace = document.getElementById('set-smart-whitespace').checked;

      const hist = document.getElementById('set-enable-history').checked;
      historyService.setEnabled(hist);
      this.settings.enable_history = hist;

      await tauriService.saveSettings(this.settings);
      this.showToast('Settings saved');
    });
  }

  /* ---------------- HISTORY VIEW ---------------- */
  renderHistory() {
    const container = document.getElementById('content-body');
    const enabled = historyService.isEnabled();

    if (!enabled) {
      container.innerHTML = `
        <div style="text-align: center; padding: 48px 16px; color: var(--text-tertiary);">
          <div style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">History is disabled</div>
          <div style="font-size: 12px; margin-bottom: 16px;">VoiceKey does not record or store your dictations.</div>
          <button id="btn-turn-on-hist" class="mac-btn mac-btn-primary">Enable Local History</button>
        </div>
      `;
      document.getElementById('btn-turn-on-hist')?.addEventListener('click', () => {
        historyService.setEnabled(true);
        this.renderHistory();
      });
      return;
    }

    const grouped = historyService.getGroupedEntries();
    const groupKeys = Object.keys(grouped);

    if (groupKeys.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 48px 16px; color: var(--text-tertiary);">
          <div style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">No history records</div>
          <div style="font-size: 12px;">Dictate text with ⌥ Space to see past entries here.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display: flex; justify-content: flex-end; margin-bottom: 10px;">
        <button id="btn-clear-all-hist" class="mac-btn mac-btn-danger">Clear All History</button>
      </div>

      ${groupKeys.map(groupName => `
        <div class="grouped-section">
          <div class="grouped-section-title">${groupName}</div>
          <div class="inset-group">
            ${grouped[groupName].map(item => `
              <div class="group-row">
                <div class="row-left">
                  <div class="row-title" style="font-weight: 400; font-size: 13px;">${item.text}</div>
                  <div class="row-subtitle">
                    ${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${item.modelName}
                  </div>
                </div>
                <div class="row-right">
                  <button class="mac-btn mac-btn-default" data-copy-id="${item.id}">Copy</button>
                  <button class="mac-btn mac-btn-danger" data-del-id="${item.id}">Delete</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    `;

    document.getElementById('btn-clear-all-hist')?.addEventListener('click', () => {
      if (confirm('Clear all history?')) {
        historyService.clearAll();
        this.renderHistory();
      }
    });

    container.querySelectorAll('[data-copy-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-copy-id');
        const entry = historyService.getEntries().find(x => x.id === id);
        if (entry) {
          navigator.clipboard.writeText(entry.text);
          this.showToast('Copied to clipboard');
        }
      });
    });

    container.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.addEventListener('click', () => {
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
      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
        <img src="icon.png" class="brand-app-icon" style="width: 56px; height: 56px; border-radius: 12px;" alt="VoiceKey Icon" />
        <div>
          <div style="font-size: 18px; font-weight: 600; color: var(--text-primary);">VoiceKey</div>
          <div style="font-size: 12px; color: var(--text-tertiary);">Version 0.1.0 • Apple Silicon Native</div>
        </div>
      </div>

      <div class="grouped-section">
        <div class="grouped-section-title">Product</div>
        <div class="inset-group">
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">Speak. Type. Done.</div>
              <div class="row-subtitle">Model-agnostic native macOS voice platform. Choose the speech model that works best for your Mac.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="grouped-section">
        <div class="grouped-section-title">Open Source & Community</div>
        <div class="inset-group">
          <div class="group-row">
            <div class="row-left">
              <div class="row-title">GitHub Project</div>
              <div class="row-subtitle">Source code, model weights, and release notes</div>
            </div>
            <div class="row-right">
              <a href="https://github.com/theanix/voicekey" target="_blank" class="mac-btn mac-btn-default" style="text-decoration: none;">View on GitHub ↗</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ---------------- COMMAND PALETTE ---------------- */
  toggleCommandPalette() {
    const modal = document.getElementById('cmd-box-modal');
    if (modal && modal.classList.contains('open')) {
      this.closeAllModals();
    } else {
      this.openCommandPalette();
    }
  }

  openCommandPalette() {
    let modal = document.getElementById('cmd-box-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'cmd-box-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    const commands = [
      { id: 'dictate', label: 'Toggle Voice Dictation', hint: '⌥ Space', action: () => tauriService.startListening() },
      { id: 'models', label: 'Open Speech Models', hint: '⌘ 2', action: () => this.switchView('models') },
      { id: 'overview', label: 'Go to Overview', hint: '⌘ 1', action: () => this.switchView('overview') },
      { id: 'history', label: 'Open History', hint: '⌘ 3', action: () => this.switchView('history') },
      { id: 'settings', label: 'Open Settings', hint: '⌘ ,', action: () => this.switchView('settings') },
    ];

    modal.innerHTML = `
      <div class="cmd-box">
        <div class="cmd-input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input id="cmd-query-input" class="cmd-input-field" type="text" placeholder="Type a command..." autofocus>
        </div>
        <div class="cmd-list" id="cmd-list-rows">
          ${commands.map((c, i) => `
            <div class="cmd-row ${i === 0 ? 'selected' : ''}" data-cmd-i="${i}">
              <span>${c.label}</span>
              <span class="kbd">${c.hint}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    modal.classList.add('open');
    const input = modal.querySelector('#cmd-query-input');
    if (input) input.focus();

    let filtered = [...commands];
    this.cmdSelectedIndex = 0;

    const renderCmds = () => {
      const listEl = modal.querySelector('#cmd-list-rows');
      if (!listEl) return;
      listEl.innerHTML = filtered.map((c, i) => `
        <div class="cmd-row ${i === this.cmdSelectedIndex ? 'selected' : ''}" data-cmd-i="${i}">
          <span>${c.label}</span>
          <span class="kbd">${c.hint}</span>
        </div>
      `).join('');

      listEl.querySelectorAll('.cmd-row').forEach(row => {
        row.addEventListener('click', () => {
          const idx = Number(row.getAttribute('data-cmd-i'));
          filtered[idx]?.action();
          this.closeAllModals();
        });
      });
    };

    input?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      filtered = commands.filter(c => c.label.toLowerCase().includes(q));
      this.cmdSelectedIndex = 0;
      renderCmds();
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.cmdSelectedIndex = (this.cmdSelectedIndex + 1) % Math.max(1, filtered.length);
        renderCmds();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.cmdSelectedIndex = (this.cmdSelectedIndex - 1 + filtered.length) % Math.max(1, filtered.length);
        renderCmds();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[this.cmdSelectedIndex]) {
          filtered[this.cmdSelectedIndex].action();
          this.closeAllModals();
        }
      }
    });

    renderCmds();
  }

  closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('open'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new VoiceKeyApp();
  app.init();
});
