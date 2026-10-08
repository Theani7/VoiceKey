// VoiceKey - Privacy-First Local History Service
class HistoryService {
  constructor() {
    this.storageKey = 'voicekey_transcription_history';
    this.enabledKey = 'voicekey_history_enabled';
  }

  isEnabled() {
    return localStorage.getItem(this.enabledKey) === 'true';
  }

  setEnabled(enabled) {
    localStorage.setItem(this.enabledKey, enabled ? 'true' : 'false');
    if (!enabled) {
      this.clearAll();
    }
  }

  getEntries() {
    if (!this.isEnabled()) return [];
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  addEntry(text, modelName = 'Kriti', durationSeconds = 3.2) {
    if (!this.isEnabled() || !text || !text.trim()) return;
    const entries = this.getEntries();
    const newEntry = {
      id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      text: text.trim(),
      modelName,
      timestamp: Date.now(),
      durationSeconds: Number(durationSeconds.toFixed(1))
    };
    entries.unshift(newEntry);
    localStorage.setItem(this.storageKey, JSON.stringify(entries.slice(0, 100))); // Keep last 100
    return newEntry;
  }

  deleteEntry(id) {
    const entries = this.getEntries().filter(e => e.id !== id);
    localStorage.setItem(this.storageKey, JSON.stringify(entries));
  }

  clearAll() {
    localStorage.removeItem(this.storageKey);
  }

  getGroupedEntries() {
    const entries = this.getEntries();
    const groups = {};

    const now = new Date();
    const todayStr = now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    for (const entry of entries) {
      const date = new Date(entry.timestamp);
      const dateStr = date.toDateString();
      let label = 'Earlier';
      if (dateStr === todayStr) {
        label = 'Today';
      } else if (dateStr === yesterdayStr) {
        label = 'Yesterday';
      } else {
        label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      }

      if (!groups[label]) groups[label] = [];
      groups[label].push(entry);
    }

    return groups;
  }
}

export const historyService = new HistoryService();
