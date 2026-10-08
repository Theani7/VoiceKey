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
use voicekey_core::{AppSettings, AppStatus};
use voicekey_macos::{insert_text, is_accessibility_enabled, request_accessibility_permission};
use voicekey_text::TextNormalizer;

pub struct AppState {
    status: Mutex<AppStatus>,
    settings: Mutex<AppSettings>,
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
    Ok(is_accessibility_enabled())
}

#[tauri::command]
async fn request_permissions() -> Result<bool, String> {
    Ok(request_accessibility_permission())
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let s = state.settings.lock().await.clone();
    Ok(s)
}

#[tauri::command]
async fn start_recording(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut status = state.status.lock().await;
    if *status == AppStatus::Recording {
        return Ok(());
    }

    state.recorder.start().map_err(|e| e.to_string())?;
    *status = AppStatus::Recording;
    let _ = app.emit("status-changed", AppStatus::Recording);
    info!("VoiceKey: Recording started");
    Ok(())
}

#[tauri::command]
async fn stop_recording_and_insert(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    {
        let mut status = state.status.lock().await;
        if *status != AppStatus::Recording {
            return Ok(None);
        }
        *status = AppStatus::Processing;
        let _ = app.emit("status-changed", AppStatus::Processing);
    }

    info!("VoiceKey: Processing audio...");
    let samples = state.recorder.stop().map_err(|e| e.to_string())?;

    if samples.is_empty() {
        let mut status = state.status.lock().await;
        *status = AppStatus::Idle;
        let _ = app.emit("status-changed", AppStatus::Idle);
        return Ok(None);
    }

    let recognizer = state.recognizer.clone();
    let normalizer = state.normalizer.clone();

    // Run ASR on background thread
    let raw_text = tokio::task::spawn_blocking(move || recognizer.transcribe_samples(&samples))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let normalized_text = normalizer.normalize(&raw_text);
    info!("VoiceKey Transcribed: '{}' -> '{}'", raw_text, normalized_text);

    // Insert text into cursor
    if !normalized_text.is_empty() {
        let text_to_insert = normalized_text.clone();
        let _ = tokio::task::spawn_blocking(move || insert_text(&text_to_insert)).await;
    }

    {
        let mut status = state.status.lock().await;
        *status = AppStatus::Done;
        let _ = app.emit("status-changed", AppStatus::Done);
    }

    // Reset to idle after 1 second
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        if let Some(state) = app_clone.try_state::<AppState>() {
            let mut s = state.status.lock().await;
            *s = AppStatus::Idle;
            let _ = app_clone.emit("status-changed", AppStatus::Idle);
        }
    });

    Ok(Some(normalized_text))
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
                            let is_recording = *state.status.lock().await == AppStatus::Recording;
                            if is_recording {
                                let _ = stop_recording_and_insert(handle.clone(), state).await;
                            } else {
                                let _ = start_recording(handle.clone(), state).await;
                            }
                        }
                    });
                }
            });
            let item_status = MenuItem::with_id(app, "status", "⚪ VoiceKey: Idle", false, None::<&str>)?;
            let item_toggle = MenuItem::with_id(app, "toggle", "Start Listening (⌥ Space)", true, None::<&str>)?;
            let item_perms = MenuItem::with_id(app, "perms", "Permissions...", true, None::<&str>)?;
            let item_settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let item_quit = MenuItem::with_id(app, "quit", "Quit VoiceKey", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
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
                    "toggle" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(state) = app_handle.try_state::<AppState>() {
                                let is_recording = *state.status.lock().await == AppStatus::Recording;
                                if is_recording {
                                    let _ = stop_recording_and_insert(app_handle.clone(), state).await;
                                } else {
                                    let _ = start_recording(app_handle.clone(), state).await;
                                }
                            }
                        });
                    }
                    "perms" => {
                        let _ = request_accessibility_permission();
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            check_permissions,
            request_permissions,
            get_settings,
            start_recording,
            stop_recording_and_insert,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VoiceKey application");
}
