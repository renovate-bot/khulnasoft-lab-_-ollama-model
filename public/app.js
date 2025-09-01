// ======================================
// Application State & Configuration
// ======================================
const AppState = {
  // Application State
  selectedModels: new Set(),
  currentModels: [],
  currentSort: { field: 'name', direction: 'asc' },
  currentEndpoint: localStorage.getItem('lastEndpoint') || null,
  isConnected: false,
  serverInfo: {
    version: '--',
    apiVersion: '--',
    lastUpdated: null,
  },

  // UI State
  currentView: 'list', // 'list' or 'grid'
  filters: {
    search: '',
    family: '',
    size: '',
    installedOnly: false,
  },

  // Initialize the application state
  init() {
    this.loadTheme();
    this.setupEventListeners();
    this.checkConnection();
  },

  // Theme Management
  loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
      themeIcon.textContent = savedTheme === 'dark' ? '🌞' : '🌙';
    }
  },

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
      themeIcon.textContent = newTheme === 'dark' ? '🌞' : '🌙';
    }
    localStorage.setItem('theme', newTheme);
  },

  // Event Listeners
  setupEventListeners() {
    // Theme toggle
    const themeToggle = document.querySelector('[data-action="toggle-theme"]');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => this.toggleTheme());
    }

    // Search input
    const searchInput = document.getElementById('modelFilter');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filters.search = e.target.value.toLowerCase();
        this.renderModels();
      });
    }

    // Filter dropdowns
    const filterInputs = document.querySelectorAll('[data-filter]');
    filterInputs.forEach((input) => {
      input.addEventListener('change', (e) => {
        this.filters[input.dataset.filter] = e.target.value;
        this.renderModels();
      });
    });

    // Toggle view (list/grid)
    const viewToggles = document.querySelectorAll('[data-view]');
    viewToggles.forEach((toggle) => {
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        this.setView(toggle.dataset.view);
      });
    });
  },

  // View Management
  setView(view) {
    if (['list', 'grid'].includes(view)) {
      this.currentView = view;
      document.querySelectorAll('[data-view]').forEach((el) => {
        el.classList.toggle('active', el.dataset.view === view);
      });
      this.renderModels();
    }
  },

  // Connection Management
  async checkConnection() {
    try {
      const response = await this.apiRequest('/api/health');
      this.isConnected = response.status === 'ok';
      this.updateConnectionStatus();

      if (this.isConnected) {
        await this.loadServerInfo();
        await this.loadEndpoints();
      }
    } catch (error) {
      console.error('Connection check failed:', error);
      this.isConnected = false;
      this.updateConnectionStatus('error', 'Connection failed');
    }
  },

  updateConnectionStatus(status = null, message = '') {
    const statusEl = document.getElementById('connectionStatus');
    const indicatorEl = document.getElementById('connectionIndicator');
    const statusTextEl = document.getElementById('connectionStatusText');

    if (!statusEl || !indicatorEl || !statusTextEl) return;

    if (status === 'connected') {
      statusEl.hidden = false;
      statusEl.className = 'status-bar connected';
      indicatorEl.className = 'status-indicator connected';
      statusTextEl.textContent = 'Connected';
    } else if (status === 'error') {
      statusEl.hidden = false;
      statusEl.className = 'status-bar error';
      indicatorEl.className = 'status-indicator error';
      statusTextEl.textContent = message || 'Connection error';
    } else if (status === 'connecting') {
      statusEl.hidden = false;
      statusEl.className = 'status-bar connecting';
      indicatorEl.className = 'status-indicator connecting';
      statusTextEl.textContent = 'Connecting...';
    } else {
      statusEl.hidden = true;
    }
  },

  // API Request Wrapper
  async apiRequest(endpoint, options = {}) {
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...options,
    };

    if (options.body && typeof options.body === 'object') {
      defaultOptions.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(endpoint, defaultOptions);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Request failed');
      }

      // Handle empty responses
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return { success: true };
      }

      return await response.json();
    } catch (error) {
      console.error(`API request to ${endpoint} failed:`, error);
      throw error;
    }
  },

  // Toast Notifications
  showToast(message, type = 'info', duration = 5000) {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast show ${type}`;
    toast.role = 'alert';
    toast.ariaLive = 'assertive';
    toast.ariaAtomic = 'true';

    const toastBody = document.createElement('div');
    toastBody.className = 'toast-body';
    toastBody.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-close';
    closeBtn.ariaLabel = 'Close';
    closeBtn.onclick = () => toast.remove();

    toastBody.appendChild(closeBtn);
    toast.appendChild(toastBody);
    toastContainer.appendChild(toast);

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    return toast;
  },

  // Format size in bytes to human readable format
  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  // Filter and sort models based on current filters and sort options
  filterModels() {
    let filtered = [...this.currentModels];

    // Apply search filter
    if (this.filters.search) {
      const searchTerm = this.filters.search.toLowerCase();
      filtered = filtered.filter(
        (model) =>
          model.name.toLowerCase().includes(searchTerm) ||
          (model.details?.family || '').toLowerCase().includes(searchTerm) ||
          (model.details?.format || '').toLowerCase().includes(searchTerm),
      );
    }

    // Apply family filter
    if (this.filters.family) {
      filtered = filtered.filter(
        (model) => model.details?.family === this.filters.family,
      );
    }

    // Apply size filter
    if (this.filters.size) {
      const [min, max] = this.filters.size.split('-').map(Number);
      filtered = filtered.filter((model) => {
        const size = model.size || 0;
        return (
          (!min || size >= min * 1024 * 1024) &&
          (!max || size <= max * 1024 * 1024)
        );
      });
    }

    // Apply installed filter
    if (this.filters.installedOnly) {
      filtered = filtered.filter((model) => model.installed);
    }

    // Apply sorting
    const { field, direction } = this.currentSort;
    filtered.sort((a, b) => {
      let aValue = a[field] || (a.details && a.details[field]) || '';
      let bValue = b[field] || (b.details && b.details[field]) || '';

      // Convert to string for case-insensitive comparison
      if (typeof aValue === 'string') aValue = aValue.toLowerCase();
      if (typeof bValue === 'string') bValue = bValue.toLowerCase();

      if (aValue < bValue) return direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  },

  // Render models based on current view and filters
  renderModels() {
    const container = document.getElementById('modelsListContent');
    if (!container) return;

    const filteredModels = this.filterModels();

    if (filteredModels.length === 0) {
      this.showEmptyState('No models found matching your criteria');
      return;
    }

    if (this.currentView === 'grid') {
      container.innerHTML = `
                <div class="models-grid">
                    ${filteredModels.map((model) => this.renderModelCard(model)).join('')}
                </div>
            `;
    } else {
      container.innerHTML = `
                <div class="table-responsive">
                    <table class="models-table">
                        <thead>
                            <tr>
                                <th><input type="checkbox" onchange="AppState.toggleSelectAll(this)"></th>
                                <th onclick="AppState.sortModels('name')">Name ${this.getSortIcon('name')}</th>
                                <th>Version</th>
                                <th>Size</th>
                                <th>Family</th>
                                <th>Format</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filteredModels.map((model) => this.renderModelRow(model)).join('')}
                        </tbody>
                    </table>
                </div>
            `;
    }

    // Update bulk actions
    this.updateBulkActions();
  },

  // Render a single model card for grid view
  renderModelCard(model) {
    return `
            <div class="model-card ${model.installed ? 'installed' : ''}">
                <div class="model-card-header">
                    <h4 class="model-name">${model.name}</h4>
                    <div class="model-actions">
                        ${
                          model.installed
                            ? `
                                <button class="btn btn-sm btn-outline-primary" 
                                        onclick="AppState.runModel('${model.name}')">
                                    Run
                                </button>
                                <button class="btn btn-sm btn-outline-danger" 
                                        onclick="AppState.deleteModel('${model.name}')">
                                    Delete
                                </button>
                            `
                            : `
                                <button class="btn btn-sm btn-primary" 
                                        onclick="AppState.pullModel('${model.name}')">
                                    Pull
                                </button>
                            `
                        }
                    </div>
                </div>
                <div class="model-card-body">
                    <div class="model-meta">
                        <span class="badge bg-info">
                            <i class="bi bi-box-seam"></i> ${this.formatSize(model.size || 0)}
                        </span>
                        ${
                          model.details?.family
                            ? `
                            <span class="badge bg-secondary">
                                <i class="bi bi-diagram-3"></i> ${model.details.family}
                            </span>
                        `
                            : ''
                        }
                    </div>
                    <div class="model-description">
                        ${model.details?.description || 'No description available'}
                    </div>
                </div>
            </div>
        `;
  },

  // Render a single model row for table view
  renderModelRow(model) {
    return `
            <tr class="${model.installed ? 'installed' : ''}">
                <td>
                    <input type="checkbox" 
                           onchange="AppState.toggleModelSelection('${model.name}')"
                           ${this.selectedModels.has(model.name) ? 'checked' : ''}>
                </td>
                <td>${model.name}</td>
                <td>${model.details?.version || 'N/A'}</td>
                <td>${this.formatSize(model.size || 0)}</td>
                <td>${model.details?.family || 'N/A'}</td>
                <td>${model.details?.format || 'N/A'}</td>
                <td class="actions">
                    ${
                      model.installed
                        ? `
                            <button class="btn btn-sm btn-outline-primary" 
                                    onclick="AppState.runModel('${model.name}')">
                                Run
                            </button>
                            <button class="btn btn-sm btn-outline-danger" 
                                    onclick="AppState.deleteModel('${model.name}')">
                                Delete
                            </button>
                        `
                        : `
                            <button class="btn btn-sm btn-primary" 
                                    onclick="AppState.pullModel('${model.name}')">
                                Pull
                            </button>
                        `
                    }
                </td>
            </tr>
        `;
  },

  // Get sort icon for table headers
  getSortIcon(field) {
    if (this.currentSort.field !== field) return '↕';
    return this.currentSort.direction === 'asc' ? '↑' : '↓';
  },

  // Toggle select all models
  toggleSelectAll(checkbox) {
    const checkboxes = document.querySelectorAll(
      '.models-table input[type="checkbox"]',
    );
    checkboxes.forEach((cb) => {
      cb.checked = checkbox.checked;
      const modelName = cb
        .closest('tr')
        .querySelector('td:nth-child(2)').textContent;
      if (checkbox.checked) {
        this.selectedModels.add(modelName);
      } else {
        this.selectedModels.delete(modelName);
      }
    });
    this.updateBulkActions();
  },

  // Toggle selection for a single model
  toggleModelSelection(modelName) {
    if (this.selectedModels.has(modelName)) {
      this.selectedModels.delete(modelName);
    } else {
      this.selectedModels.add(modelName);
    }
    this.updateBulkActions();
  },

  // Update bulk action buttons based on selection
  updateBulkActions() {
    const bulkActions = document.getElementById('bulkActions');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const runSelectedBtn = document.getElementById('runSelectedBtn');

    if (!bulkActions || !deleteSelectedBtn || !runSelectedBtn) return;

    const hasSelection = this.selectedModels.size > 0;
    bulkActions.style.display = hasSelection ? 'block' : 'none';

    // Update button states
    deleteSelectedBtn.disabled = !hasSelection;
    runSelectedBtn.disabled = !hasSelection;

    // Update selected count
    const selectedCount = document.getElementById('selectedCount');
    if (selectedCount) {
      selectedCount.textContent = this.selectedModels.size;
    }
  },

  // Delete selected models
  async deleteSelectedModels() {
    const modelsToDelete = Array.from(this.selectedModels);
    if (modelsToDelete.length === 0) return;

    const confirmed = confirm(
      `Are you sure you want to delete ${modelsToDelete.length} selected model(s)?`,
    );
    if (!confirmed) return;

    try {
      const promises = modelsToDelete.map((modelName) =>
        this.apiRequest(`/api/delete/${encodeURIComponent(modelName)}`, {
          method: 'DELETE',
        }),
      );

      await Promise.all(promises);
      this.showToast(
        `Successfully deleted ${modelsToDelete.length} model(s)`,
        'success',
      );
      this.selectedModels.clear();
      await this.refreshModels();
    } catch (error) {
      console.error('Failed to delete models:', error);
      this.showToast(`Failed to delete models: ${error.message}`, 'error');
    }
  },

  // Run selected models
  async runSelectedModels() {
    const modelsToRun = Array.from(this.selectedModels);
    if (modelsToRun.length === 0) return;

    try {
      const promises = modelsToRun.map((modelName) =>
        this.apiRequest('/api/run', {
          method: 'POST',
          body: { model: modelName },
        }),
      );

      await Promise.all(promises);
      this.showToast(`Started ${modelsToRun.length} model(s)`, 'success');
      await this.fetchRunningModels();
    } catch (error) {
      console.error('Failed to run models:', error);
      this.showToast(`Failed to run models: ${error.message}`, 'error');
    }
  },

  // Run a single model
  async runModel(modelName) {
    try {
      await this.apiRequest('/api/run', {
        method: 'POST',
        body: { model: modelName },
      });
      this.showToast(`Started ${modelName}`, 'success');
      await this.fetchRunningModels();
    } catch (error) {
      console.error(`Failed to run model ${modelName}:`, error);
      this.showToast(`Failed to run model: ${error.message}`, 'error');
    }
  },

  // Delete a single model
  async deleteModel(modelName) {
    if (!confirm(`Are you sure you want to delete ${modelName}?`)) {
      return;
    }

    try {
      await this.apiRequest(`/api/delete/${encodeURIComponent(modelName)}`, {
        method: 'DELETE',
      });
      this.showToast(`Deleted ${modelName}`, 'success');
      this.selectedModels.delete(modelName);
      await this.refreshModels();
    } catch (error) {
      console.error(`Failed to delete model ${modelName}:`, error);
      this.showToast(`Failed to delete model: ${error.message}`, 'error');
    }
  },

  // Sort models by field
  sortModels(field) {
    if (this.currentSort.field === field) {
      // Toggle sort direction if same field
      this.currentSort.direction =
        this.currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      // Default to ascending for new field
      this.currentSort = { field, direction: 'asc' };
    }
    this.renderModels();
  },

  // Load server information
  async loadServerInfo() {
    try {
      const info = await this.apiRequest('/api/version');
      this.serverInfo = {
        version: info.version || '--',
        apiVersion: info.apiVersion || '--',
        lastUpdated: new Date(),
      };

      // Update UI
      const versionEl = document.getElementById('ollamaVersion');
      const apiVersionEl = document.getElementById('apiVersion');
      const lastUpdatedEl = document.getElementById('lastUpdated');

      if (versionEl)
        versionEl.textContent = `Ollama: ${this.serverInfo.version}`;
      if (apiVersionEl)
        apiVersionEl.textContent = `API: ${this.serverInfo.apiVersion}`;
      if (lastUpdatedEl) {
        lastUpdatedEl.textContent =
          this.serverInfo.lastUpdated.toLocaleTimeString();
      }

      return this.serverInfo;
    } catch (error) {
      console.error('Failed to load server info:', error);
      throw error;
    }
  },

  // Load available endpoints
  async loadEndpoints() {
    try {
      const response = await this.apiRequest('/api/endpoints');
      const select = document.getElementById('endpointInput');
      if (!select) return response;

      // Clear existing options
      select.innerHTML = '';

      // Add default option
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Select an endpoint...';
      select.appendChild(defaultOption);

      // Add endpoints
      response.forEach((endpoint) => {
        const option = document.createElement('option');
        option.value = endpoint;
        option.textContent = endpoint;
        option.selected = endpoint === this.currentEndpoint;
        select.appendChild(option);
      });

      // If we have a current endpoint that's not in the list, add it
      if (this.currentEndpoint && !response.includes(this.currentEndpoint)) {
        const option = document.createElement('option');
        option.value = this.currentEndpoint;
        option.textContent = `${this.currentEndpoint} (custom)`;
        option.selected = true;
        select.appendChild(option);
      }

      // If we have a current endpoint, ensure it's selected
      if (this.currentEndpoint) {
        select.value = this.currentEndpoint;
      }

      return response;
    } catch (error) {
      console.error('Failed to load endpoints:', error);
      this.showToast('Failed to load endpoints', 'error');
      throw error;
    }
  },

  // Refresh models list
  async refreshModels() {
    try {
      this.showLoadingState(true);
      const models = await this.apiRequest('/api/models');
      this.currentModels = models;
      this.renderModels();
      this.updateBulkActions();
      return models;
    } catch (error) {
      console.error('Failed to refresh models:', error);
      this.showToast('Failed to load models', 'error');
      this.showEmptyState(
        'Failed to load models. Please check your connection.',
      );
      throw error;
    } finally {
      this.showLoadingState(false);
    }
  },

  // Fetch currently running models
  async fetchRunningModels() {
    try {
      const response = await this.apiRequest('/api/ps');
      this.updateRunningModelsUI(response.models || []);
      return response.models;
    } catch (error) {
      console.error('Failed to fetch running models:', error);
      this.showToast('Failed to load running models', 'error');
      throw error;
    }
  },

  // Update running models UI
  updateRunningModelsUI(models) {
    const container = document.getElementById('runningModelsContent');
    if (!container) return;

    if (!models || models.length === 0) {
      container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">💤</div>
                    <p class="empty-state-text">No models currently running</p>
                </div>
            `;
      return;
    }

    container.innerHTML = `
            <div class="running-models-grid">
                ${models.map((model) => this.renderRunningModelCard(model)).join('')}
            </div>
        `;
  },

  // Render a single running model card
  renderRunningModelCard(model) {
    return `
            <div class="model-card running">
                <div class="model-card-header">
                    <div class="model-name">${model.name}</div>
                    <div class="model-actions">
                        <button class="btn btn-sm btn-outline-danger" 
                                onclick="AppState.stopModel('${model.name}')">
                            Stop
                        </button>
                    </div>
                </div>
                <div class="model-card-body">
                    <div class="model-meta">
                        <span class="badge bg-info">
                            <i class="bi bi-memory"></i> ${this.formatSize(model.size_vram)}
                        </span>
                        <span class="badge bg-secondary">
                            <i class="bi bi-cpu"></i> ${model.details?.parameter_size || 'N/A'}
                        </span>
                    </div>
                    <div class="model-stats">
                        <div class="stat">
                            <span class="stat-label">Format:</span>
                            <span class="stat-value">${model.details?.format || 'N/A'}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Family:</span>
                            <span class="stat-value">${model.details?.family || 'N/A'}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
  },

  // Stop a running model
  async stopModel(modelName) {
    if (!confirm(`Are you sure you want to stop ${modelName}?`)) {
      return;
    }

    try {
      await this.apiRequest('/api/stop', {
        method: 'POST',
        body: { model: modelName },
      });

      this.showToast(`Stopped ${modelName}`, 'success');
      await this.fetchRunningModels();
    } catch (error) {
      console.error('Failed to stop model:', error);
      this.showToast(`Failed to stop model: ${error.message}`, 'error');
    }
  },

  // Show loading state
  showLoadingState(show) {
    const loadingEl = document.getElementById('loadingState');
    const contentEl = document.getElementById('modelsListContent');
    const emptyEl = document.getElementById('emptyState');

    if (loadingEl) loadingEl.style.display = show ? 'block' : 'none';
    if (contentEl) contentEl.style.display = show ? 'none' : 'block';
    if (emptyEl) emptyEl.style.display = 'none';
  },

  // Show empty state
  showEmptyState(message = 'No models found') {
    const emptyEl = document.getElementById('emptyState');
    const contentEl = document.getElementById('modelsListContent');
    const loadingEl = document.getElementById('loadingState');

    if (emptyEl) {
      const messageEl = emptyEl.querySelector('.empty-state-text') || emptyEl;
      if (messageEl) messageEl.textContent = message;
      emptyEl.style.display = 'block';
    }
    if (contentEl) contentEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
  },

  // Pull a model
  async pullModel(modelName) {
    let pullStatus = 'downloading'; // Declare pullStatus here

    if (!modelName) {
      modelName = document.getElementById('modelNameInput')?.value.trim();
      if (!modelName) {
        this.showToast('Please enter a model name', 'warning');
        return;
      }
    }

    const statusElement = document.getElementById('pullStatus');
    const progressElement = document.getElementById('pullProgressText');
    const progressBar = document.getElementById('pullProgressBar');

    try {
      // Show status
      if (statusElement) statusElement.style.display = 'block';
      if (progressElement) progressElement.textContent = 'Initializing...';
      if (progressBar) progressBar.style.width = '0%';

      // Make the pull request
      const response = await fetch('/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to start pull');
      }

      // Handle streaming response
      const reader = response.body.getReader();
      let pullComplete = false;
      let pullStatus = 'downloading';

      while (!pullComplete) {
        const { done, value } = await reader.read();

        if (done) {
          pullComplete = true;
          this.showToast(`Successfully pulled ${modelName}`, 'success');
          await this.refreshModels();
          break;
        }

        // Process the streamed data
        const text = new TextDecoder().decode(value);
        const lines = text.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);

            if (data.status === 'downloading') {
              const percent =
                data.total > 0
                  ? Math.round((data.completed / data.total) * 100)
                  : 0;

              if (progressBar) progressBar.style.width = `${percent}%`;
              if (progressElement) {
                const completed = this.formatSize(data.completed);
                const total = this.formatSize(data.total);
                progressElement.textContent = `Downloading: ${percent}% (${completed} / ${total})`;
              }
            } else if (data.status === 'verifying') {
              pullStatus = 'verifying';
              if (progressElement) {
                progressElement.textContent = 'Verifying checksum...';
              }
            } else if (data.status === 'success') {
              pullStatus = 'success';
              if (progressElement) {
                progressElement.textContent = 'Pull completed successfully';
              }
            }
          } catch (e) {
            console.error('Error processing stream data:', e);
          }
        }
      }
    } catch (error) {
      console.error('Pull failed:', error);
      this.showToast(`Pull failed: ${error.message}`, 'error');

      if (progressElement) {
        progressElement.textContent = `Error: ${error.message}`;
        progressElement.className = 'text-danger';
      }
    } finally {
      // Hide status after delay if not already hidden
      if (pullStatus === 'success') {
        setTimeout(() => {
          if (statusElement) statusElement.style.display = 'none';
        }, 2000);
      }
    }
  },
};

// Initialize the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  AppState.init();
});

// Make AppState available globally for HTML event handlers
window.AppState = AppState;
