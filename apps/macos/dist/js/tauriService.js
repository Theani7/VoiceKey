// VoiceKey - Tauri Native IPC Bridge
class TauriService {
  constructor() {
    this.hasTauri = typeof window !== 'undefined' && !!window.__TAURI__;
  }

  get tauriCore() {
    return window.__TAURI__?.core;
  }

  get tauriEvent() {
    return window.__TAURI__?.event;
  }

  async invoke(command, args = {}) {
    if (this.hasTauri && this.tauriCore?.invoke) {
      return await this.tauriCore.invoke(command, args);
    }
    throw new Error(`Tauri not available for invoke("${command}")`);
  }

  async on(eventName, handler) {
    if (this.hasTauri && this.tauriEvent?.listen) {
      return await this.tauriEvent.listen(eventName, handler);
    }
    return () => {};
  }

  async checkPermissions() {
    try {
      return await this.invoke('check_permissions');
    } catch {
      return true; // Mock true for browser testing
    }
  }

  async requestPermissions() {
    try {
      return await this.invoke('request_permissions');
    } catch {
      return true;
    }
  }

  async getSettings() {
    try {
      return await this.invoke('get_settings');
    } catch {
      return {
        global_shortcut: 'Alt+Space',
        push_to_talk: false,
        launch_at_login: false,
        show_menu_bar_icon: true,
        start_on_launch: true,
        auto_punctuation: true,
        normalize_numbers: true,
        smart_whitespace: true,
        audio_device: null,
        save_audio: false,
        save_transcripts: false,
        enable_history: false,
        roman_nepali: false,
        active_model_id: 'kriti-nepali'
      };
    }
  }

  async saveSettings(settings) {
    try {
      return await this.invoke('save_settings', { settings });
    } catch {
      localStorage.setItem('voicekey_settings', JSON.stringify(settings));
    }
  }

  async getAudioDevices() {
    try {
      return await this.invoke('get_audio_devices');
    } catch {
      return [
        { name: 'MacBook Pro Microphone (Built-in)', is_default: true },
        { name: 'AirPods Pro', is_default: false },
        { name: 'Studio Display Microphone', is_default: false }
      ];
    }
  }

  async getSystemCapabilities() {
    try {
      return await this.invoke('get_system_capabilities');
    } catch {
      return {
        chip_name: 'Apple Silicon (M2)',
        apple_silicon: true,
        total_ram_gb: 16,
        macos_version: 'macOS 15.0 Sequoia',
        offline: true
      };
    }
  }

  async getStatus() {
    try {
      return await this.invoke('get_status');
    } catch {
      return 'idle';
    }
  }

  async startListening() {
    try {
      return await this.invoke('start_recording');
    } catch (err) {
      console.warn('Start recording:', err);
    }
  }

  async stopListening() {
    try {
      return await this.invoke('stop_recording_and_insert');
    } catch (err) {
      console.warn('Stop recording:', err);
    }
  }
}

export const tauriService = new TauriService();
