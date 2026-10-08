//! Cross‑platform abstraction for text insertion and app focus handling.
//!
//! The `platform` crate defines a `TextInjector` trait that abstracts the operations
//! needed by the VoiceKey Tauri frontend. Concrete implementations live in the
//! platform‑specific sub‑modules (`macos`, `windows`, `linux`). Only the macOS
//! implementation is currently functional; Windows and Linux provide stubs that
//! return an `unimplemented!()` error. Feature flags control which module is
//! compiled.

use thiserror::Error;

#[derive(Error, Debug)]
pub enum PlatformError {
    #[cfg(target_os = "macos")]
    #[error("macOS error: {0}")]
    Mac(#[from] voicekey_macos::MacOSError),
    #[error("operation not implemented on this platform")]
    Unimplemented,
}

/// Trait for inserting text into the active application.
pub trait TextInjector {
    /// Insert `text` at the cursor of the target application.
    ///
    /// `target_pid` is optional; if provided, the implementation may focus that
    /// process before insertion.
    fn insert_text(&self, text: &str, target_pid: Option<i32>) -> Result<(), PlatformError>;
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::{PlatformError, TextInjector};
    use voicekey_macos::insert_text as mac_insert_text;

    pub struct MacInjector;

    impl TextInjector for MacInjector {
        fn insert_text(&self, text: &str, target_pid: Option<i32>) -> Result<(), PlatformError> {
            mac_insert_text(text, target_pid).map_err(PlatformError::Mac)
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{PlatformError, TextInjector};
    pub struct WindowsInjector;
    impl TextInjector for WindowsInjector {
        fn insert_text(&self, _text: &str, _target_pid: Option<i32>) -> Result<(), PlatformError> {
            Err(PlatformError::Unimplemented)
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod linux_impl {
    use super::{PlatformError, TextInjector};
    pub struct LinuxInjector;
    impl TextInjector for LinuxInjector {
        fn insert_text(&self, _text: &str, _target_pid: Option<i32>) -> Result<(), PlatformError> {
            Err(PlatformError::Unimplemented)
        }
    }
}

/// Factory returning a boxed `TextInjector` appropriate for the platform.
pub fn get_injector() -> Box<dyn TextInjector> {
    #[cfg(target_os = "macos")]
    { Box::new(macos_impl::MacInjector) }
    #[cfg(target_os = "windows")]
    { Box::new(windows_impl::WindowsInjector) }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { Box::new(linux_impl::LinuxInjector) }
}
