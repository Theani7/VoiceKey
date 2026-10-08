// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use tracing::{info, warn};

use voicekey_asr::{KritiBridge, MockSpeechRecognizer, SpeechRecognizer};
use voicekey_audio::AudioRecorder;
use voicekey_core::{
    get_default_models, AppSettings, AppStatus, DownloadProgress, ModelStatus,
    SystemCapabilities, VoiceModel,
};
#[cfg(target_os = "macos")]
use voicekey_macos::{show_window_without_stealing_focus, is_accessibility_enabled, request_accessibility_permission, get_frontmost_app_pid};
use voicekey_platform::get_injector;
use voicekey_text::TextNormalizer;

pub struct AppState {
    status: Mutex<AppStatus>,
    settings: Mutex<AppSettings>,
    models: Mutex<Vec<VoiceModel>>,
    target_pid: Mutex<Option<i32>>,
    recorder: AudioRecorder,
    normalizer: TextNormalizer,
    recognizer: Arc<dyn SpeechRecognizer>,
}

#[tauri::command]
async fn get_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let s = *state.status.lock().await;
    Ok(s)
}

#[tauri::command]
async fn check_permissions() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    { Ok(is_accessibility_enabled()) }
    #[cfg(not(target_os = "macos"))]
    { Ok(true) }
}

#[tauri::command]
async fn request_permissions() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    { Ok(request_accessibility_permission()) }
    #[cfg(not(target_os = "macos"))]
    { Ok(true) }
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let s = state.settings.lock().await.clone();
    Ok(s)
}

#[tauri::command]
async fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    let mut s = state.settings.lock().await;
    *s = settings;
    Ok(())
}

#[tauri::command]
async fn get_models(state: State<'_, AppState>) -> Result<Vec<VoiceModel>, String> {
    let models = state.models.lock().await.clone();
    Ok(models)
}

#[tauri::command]
async fn get_active_model(state: State<'_, AppState>) -> Result<Option<VoiceModel>, String> {
    let models = state.models.lock().await;
    let settings = state.settings.lock().await;
    let found = models.iter().find(|m| m.id == settings.active_model_id).cloned();
    Ok(found)
}

#[tauri::command]
async fn activate_model(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<VoiceModel, String> {
    let mut models = state.models.lock().await;
    let mut found = None;
    for m in models.iter_mut() {
        if m.id == model_id {
            m.status = ModelStatus::Active;
            found = Some(m.clone());
        } else if m.status == ModelStatus::Active {
            m.status = ModelStatus::Installed;
        }
    }
    if let Some(active) = found {
        let mut settings = state.settings.lock().await;
        settings.active_model_id = model_id.clone();
        let _ = app.emit("model-activated", active.clone());
        info!("VoiceKey: Activated model '{}'", model_id);
        Ok(active)
    } else {
        Err(format!("Model '{}' not found", model_id))
    }
}

#[tauri::command]
async fn download_model(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    {
        let mut models = state.models.lock().await;
        let target = models.iter_mut().find(|m| m.id == model_id);
        if let Some(m) = target {
            m.status = ModelStatus::Downloading;
            m.download_progress = Some(DownloadProgress {
                percentage: 0.0,
                downloaded_bytes: 0,
                total_bytes: m.download_size_bytes.unwrap_or(500 * 1024 * 1024),
                speed_bytes_per_sec: 2_400_000,
            });
        } else {
            return Err(format!("Model '{}' not found", model_id));
        }
    }

    let app_handle = app.clone();
    let mid = model_id.clone();
    tauri::async_runtime::spawn(async move {
        for pct in (10..=100).step_by(15) {
            tokio::time::sleep(Duration::from_millis(300)).await;
            if let Some(st) = app_handle.try_state::<AppState>() {
                let mut models = st.models.lock().await;
                if let Some(m) = models.iter_mut().find(|m| m.id == mid) {
                    if m.status != ModelStatus::Downloading {
                        return; // cancelled
                    }
                    let total = m.download_size_bytes.unwrap_or(500 * 1024 * 1024);
                    let downloaded = (total as f32 * (pct as f32 / 100.0)) as u64;
                    m.download_progress = Some(DownloadProgress {
                        percentage: pct as f32,
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        speed_bytes_per_sec: 3_200_000,
                    });
                    let _ = app_handle.emit("download-progress", m.clone());
                }
            }
        }

        // Verification phase
        if let Some(st) = app_handle.try_state::<AppState>() {
            let mut models = st.models.lock().await;
            if let Some(m) = models.iter_mut().find(|m| m.id == mid) {
                m.status = ModelStatus::Verifying;
                let _ = app_handle.emit("download-progress", m.clone());
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Installing phase
        if let Some(st) = app_handle.try_state::<AppState>() {
            let mut models = st.models.lock().await;
            if let Some(m) = models.iter_mut().find(|m| m.id == mid) {
                m.status = ModelStatus::Installing;
                let _ = app_handle.emit("download-progress", m.clone());
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Installed phase
        if let Some(st) = app_handle.try_state::<AppState>() {
            let mut models = st.models.lock().await;
            if let Some(m) = models.iter_mut().find(|m| m.id == mid) {
                m.status = ModelStatus::Installed;
                m.download_progress = None;
                let _ = app_handle.emit("download-completed", m.clone());
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn cancel_download(state: State<'_, AppState>, model_id: String) -> Result<(), String> {
    let mut models = state.models.lock().await;
    if let Some(m) = models.iter_mut().find(|m| m.id == model_id) {
        m.status = ModelStatus::Available;
        m.download_progress = None;
        Ok(())
    } else {
        Err(format!("Model '{}' not found", model_id))
    }
}

#[tauri::command]
async fn remove_model(state: State<'_, AppState>, model_id: String) -> Result<(), String> {
    let mut models = state.models.lock().await;
    if let Some(m) = models.iter_mut().find(|m| m.id == model_id) {
        if m.status == ModelStatus::Active {
            return Err("Cannot remove currently active model. Please select another model first.".into());
        }
        m.status = ModelStatus::Available;
        m.download_progress = None;
        Ok(())
    } else {
        Err(format!("Model '{}' not found", model_id))
    }
}

#[tauri::command]
async fn get_audio_devices() -> Result<Vec<voicekey_audio::AudioDeviceInfo>, String> {
    voicekey_audio::AudioRecorder::list_devices().map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_system_capabilities() -> Result<SystemCapabilities, String> {
    Ok(SystemCapabilities {
        chip_name: "Apple Silicon (M-Series)".to_string(),
        apple_silicon: true,
        total_ram_gb: 16,
        macos_version: "macOS 14+ Sonoma / Sequoia".to_string(),
        offline: true,
    })
}

#[tauri::command]
async fn start_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut status = state.status.lock().await;
    if *status == AppStatus::Recording {
        return Ok(());
    }

    // Capture frontmost app PID before overlay window is shown
    #[cfg(target_os = "macos")]
    let target_pid = {
        let front_pid = get_frontmost_app_pid();
        let current_pid = std::process::id() as i32;
        if let Some(pid) = front_pid {
            if pid != current_pid {
                let mut t = state.target_pid.lock().await;
                *t = Some(pid);
                Some(pid)
            } else {
                *state.target_pid.lock().await
            }
        } else {
            *state.target_pid.lock().await
        }
    };
    #[cfg(not(target_os = "macos"))]
    let target_pid = { *state.target_pid.lock().await };

    let (event_tx, event_rx) = std::sync::mpsc::channel::<voicekey_audio::AudioEvent>();
    state
        .recorder
        .start_with_events(event_tx)
        .map_err(|e| e.to_string())?;

    *status = AppStatus::Recording;
    let _ = app.emit("status-changed", AppStatus::Recording);

    if let Some(overlay) = app.get_webview_window("overlay") {
        #[cfg(target_os = "macos")]
        if let Ok(ns_win) = overlay.ns_window() {
            unsafe {
                show_window_without_stealing_focus(ns_win);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = overlay.show();
            let _ = overlay.set_always_on_top(true);
        }
    }

    // Continuous pause-to-type event loop (like Siri / Gemini Voice Typing)
    let app_clone = app.clone();
    let recognizer = state.recognizer.clone();
    let normalizer = state.normalizer.clone();

    tauri::async_runtime::spawn_blocking(move || {
        while let Ok(event) = event_rx.recv() {
            match event {
                voicekey_audio::AudioEvent::SpeechChunk(samples) => {
                    if samples.is_empty() {
                        continue;
                    }
                    info!(
                        "VoiceKey: Pause detected, transcribing speech chunk ({} samples)...",
                        samples.len()
                    );
                    let _ = app_clone.emit("status-changed", AppStatus::Processing);

                    let rec = recognizer.clone();
                    let norm = normalizer.clone();

                    if let Ok(raw_text) = rec.transcribe_samples(&samples) {
                        let text = norm.normalize(&raw_text);
                        if !text.is_empty() {
                            info!("VoiceKey Auto-Typed Chunk: '{}' to PID {:?}", text, target_pid);
                            let _ = app_clone.emit("status-changed", AppStatus::Writing);
                            let to_type = format!("{} ", text);
                            let injector = get_injector();
                let _ = injector.insert_text(&to_type, target_pid).map_err(|e| format!("Insert error: {}", e));
                            std::thread::sleep(std::time::Duration::from_millis(250));
                        }
                    }

                    // Return HUD to listening state if session is still active
                    if let Some(st) = app_clone.try_state::<AppState>() {
                        let current_s = tauri::async_runtime::block_on(async { *st.status.lock().await });
                        if current_s == AppStatus::Recording {
                            let _ = app_clone.emit("status-changed", AppStatus::Recording);
                        }
                    }
                }
                voicekey_audio::AudioEvent::VoiceActive(is_active) => {
                    let _ = app_clone.emit("voice-active", is_active);
                }
                voicekey_audio::AudioEvent::Level(rms) => {
                    let _ = app_clone.emit("audio-level", rms);
                }
                voicekey_audio::AudioEvent::InactivityTimeout => {
                    info!("VoiceKey: Inactivity timeout (10s), closing dictation session");
                    let app_handle = app_clone.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(st) = app_handle.try_state::<AppState>() {
                            let _ = stop_recording_and_insert(app_handle.clone(), st).await;
                        }
                    });
                    break;
                }
            }
        }
    });

    info!("VoiceKey: Continuous dictation listening started (target_pid: {:?})", target_pid);
    Ok(())
}

#[tauri::command]
async fn cancel_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.recorder.cancel();
    let mut status = state.status.lock().await;
    *status = AppStatus::Idle;
    let _ = app.emit("status-changed", AppStatus::Idle);
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    info!("VoiceKey: Recording cancelled");
    Ok(())
}

#[tauri::command]
async fn stop_recording_and_insert(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    {
        let mut status = state.status.lock().await;
        if *status != AppStatus::Recording && *status != AppStatus::Writing && *status != AppStatus::Processing {
            return Ok(None);
        }
        *status = AppStatus::Processing;
        let _ = app.emit("status-changed", AppStatus::Processing);
    }

    info!("VoiceKey: Stopping dictation session...");
    let samples = match state.recorder.stop() {
        Ok(s) => s,
        Err(e) => {
            warn!("Failed to stop audio recorder: {}", e);
            let mut status = state.status.lock().await;
            *status = AppStatus::Idle;
            let _ = app.emit("status-changed", AppStatus::Idle);
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.hide();
            }
            return Err(e.to_string());
        }
    };

    let recognizer = state.recognizer.clone();
    let normalizer = state.normalizer.clone();
    let mut final_text = None;

    // Transcribe residual speech if samples buffer has audio (>= 250ms at 16kHz)
    let target_pid = { *state.target_pid.lock().await };
    if samples.len() >= 4000 {
        let _ = app.emit("status-changed", AppStatus::Writing);
        let raw_text_result = tokio::task::spawn_blocking(move || recognizer.transcribe_samples(&samples)).await;
        if let Ok(Ok(raw_text)) = raw_text_result {
            let normalized_text = normalizer.normalize(&raw_text);
            if !normalized_text.is_empty() {
                info!("VoiceKey Transcribed Final Chunk: '{}' -> '{}' to PID {:?}", raw_text, normalized_text, target_pid);
                let text_to_insert = format!("{} ", normalized_text);
                let injector = get_injector();
                let _ = injector.insert_text(&text_to_insert, target_pid).map_err(|e| format!("Insert error: {}", e));
                final_text = Some(normalized_text);
            }
        }
    }

    {
        let mut status = state.status.lock().await;
        *status = AppStatus::Done;
        let _ = app.emit("status-changed", AppStatus::Done);
    }

    // Reset to idle after 500ms and hide HUD overlay
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if let Some(state) = app_clone.try_state::<AppState>() {
            let mut s = state.status.lock().await;
            if *s == AppStatus::Done {
                *s = AppStatus::Idle;
                let _ = app_clone.emit("status-changed", AppStatus::Idle);
                if let Some(overlay) = app_clone.get_webview_window("overlay") {
                    let _ = overlay.hide();
                }
            }
        }
    });

    Ok(final_text)
}

fn main() {
    tracing_subscriber::fmt::init();

    let venv_python = std::env::current_dir()
        .map(|d| d.join(".venv/bin/python"))
        .unwrap_or_else(|_| std::path::PathBuf::from("python3"));

    let recognizer: Arc<dyn SpeechRecognizer> = if venv_python.exists() {
        let root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        match KritiBridge::new(&venv_python, &root) {
            Ok(bridge) => {
                info!("Initialized native KritiBridge speech recognizer");
                Arc::new(bridge)
            }
            Err(e) => {
                warn!("KritiBridge not ready ({}), falling back to mock recognizer", e);
                Arc::new(MockSpeechRecognizer::new("नमस्ते, मेरो नाम आदित हो। म आज कलेज जाँदै छु।"))
            }
        }
    } else {
        warn!("Virtualenv not found, using fallback recognizer");
        Arc::new(MockSpeechRecognizer::new("नमस्ते, मेरो नाम आदित हो। म आज कलेज जाँदै छु।"))
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            status: Mutex::new(AppStatus::Idle),
            settings: Mutex::new(AppSettings::default()),
            models: Mutex::new(get_default_models()),
            target_pid: Mutex::new(None),
            recorder: AudioRecorder::new(),
            normalizer: TextNormalizer::new(),
            recognizer,
        })
        .setup(|app| {
            // Register global shortcut ⌥ Space (Option+Space / Alt+Space)
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
            let shortcut: Shortcut = "Alt+Space".parse().unwrap();
            let app_handle = app.handle().clone();
            let _ = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(state) = handle.try_state::<AppState>() {
                            let current_status = { *state.status.lock().await };
                            match current_status {
                                AppStatus::Recording | AppStatus::Writing | AppStatus::Processing => {
                                    let _ = stop_recording_and_insert(handle.clone(), state).await;
                                }
                                AppStatus::Idle | AppStatus::Done | AppStatus::Error => {
                                    let _ = start_recording(handle.clone(), state).await;
                                }
                            }
                        }
                    });
                }
            });
            let item_open = MenuItem::with_id(app, "open", "Open VoiceKey", true, None::<&str>)?;
            let item_status = MenuItem::with_id(app, "status", "⚪ VoiceKey: Idle", false, None::<&str>)?;
            let item_toggle = MenuItem::with_id(app, "toggle", "Start Listening (⌥ Space)", true, None::<&str>)?;
            let item_perms = MenuItem::with_id(app, "perms", "Permissions...", true, None::<&str>)?;
            let item_settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let item_quit = MenuItem::with_id(app, "quit", "Quit VoiceKey", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &item_open,
                    &item_status,
                    &item_toggle,
                    &item_perms,
                    &item_settings,
                    &item_quit,
                ],
            )?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" | "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "toggle" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(state) = app_handle.try_state::<AppState>() {
                                let current_status = { *state.status.lock().await };
                                match current_status {
                                    AppStatus::Recording | AppStatus::Writing | AppStatus::Processing => {
                                        let _ = stop_recording_and_insert(app_handle.clone(), state).await;
                                    }
                                    AppStatus::Idle | AppStatus::Done | AppStatus::Error => {
                                        let _ = start_recording(app_handle.clone(), state).await;
                                    }
                                }
                            }
                        });
                    }
                    "perms" => {
                        #[cfg(target_os = "macos")]
                        { let _ = request_accessibility_permission(); }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Position overlay window at bottom center of screen (like macOS Dictation)
            if let Some(overlay) = app.get_webview_window("overlay") {
                if let Ok(Some(monitor)) = overlay.current_monitor() {
                    let size = monitor.size();
                    let scale = monitor.scale_factor();
                    let mon_width = size.width as f64 / scale;
                    let mon_height = size.height as f64 / scale;
                    let x = (mon_width - 320.0) / 2.0;
                    let y = mon_height - 130.0;
                    let _ = overlay.set_position(tauri::LogicalPosition::new(x, y));
                }
            }

            // Hide main window on close button instead of quitting app
            if let Some(main_win) = app.get_webview_window("main") {
                let w = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            check_permissions,
            request_permissions,
            get_settings,
            save_settings,
            get_models,
            get_active_model,
            activate_model,
            download_model,
            cancel_download,
            remove_model,
            get_audio_devices,
            get_system_capabilities,
            start_recording,
            stop_recording_and_insert,
            cancel_recording,
        ])
        .build(tauri::generate_context!())
        .expect("error while running VoiceKey application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        });
}
