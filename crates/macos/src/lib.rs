use arboard::Clipboard;
use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use std::ffi::c_void;
use std::thread::sleep;
use std::time::Duration;
use thiserror::Error;
use tracing::{debug, info};

#[derive(Error, Debug)]
pub enum MacOSError {
    #[error("Accessibility permission denied")]
    AccessibilityDenied,
    #[error("Failed to acquire clipboard: {0}")]
    ClipboardError(String),
    #[error("CGEvent error: {0}")]
    EventError(String),
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    fn AXUIElementCreateSystemWide() -> *mut c_void;
    fn AXUIElementCopyAttributeValue(
        element: *mut c_void,
        attribute: *const c_void,
        value: *mut *mut c_void,
    ) -> i32;
    fn AXUIElementSetAttributeValue(
        element: *mut c_void,
        attribute: *const c_void,
        value: *const c_void,
    ) -> i32;
    fn CFRelease(cf: *const c_void);
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreateKeyboardEvent(
        source: *mut c_void,
        virtual_key: u16,
        key_down: bool,
    ) -> *mut c_void;
    fn CGEventSetFlags(event: *mut c_void, flags: u64);
    fn CGEventPost(tap: u32, event: *mut c_void);
}

const K_CG_HID_EVENT_TAP: u32 = 0;
const K_CG_EVENT_FLAG_MASK_COMMAND: u64 = 0x00100000;
const KEY_CODE_V: u16 = 9;

/// Checks if the application has macOS Accessibility permissions
pub fn is_accessibility_enabled() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Prompts the user for Accessibility permission via system dialog
pub fn request_accessibility_permission() -> bool {
    unsafe {
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), CFBoolean::true_value().as_CFType())]);
        AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef() as *const c_void)
    }
}

/// Attempts direct insertion via Accessibility API into currently focused UI element
pub fn direct_ax_insert(text: &str) -> Result<bool, MacOSError> {
    unsafe {
        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() {
            return Ok(false);
        }

        let focused_attr = CFString::new("AXFocusedUIElement");
        let mut focused_elem: *mut c_void = std::ptr::null_mut();

        let err = AXUIElementCopyAttributeValue(
            system_wide,
            focused_attr.as_concrete_TypeRef() as *const c_void,
            &mut focused_elem,
        );
        CFRelease(system_wide);

        if err != 0 || focused_elem.is_null() {
            return Ok(false);
        }

        let selected_text_attr = CFString::new("AXSelectedText");
        let text_cf = CFString::new(text);

        let set_err = AXUIElementSetAttributeValue(
            focused_elem,
            selected_text_attr.as_concrete_TypeRef() as *const c_void,
            text_cf.as_concrete_TypeRef() as *const c_void,
        );

        CFRelease(focused_elem);

        if set_err == 0 {
            info!("Direct AX text insertion succeeded");
            Ok(true)
        } else {
            debug!("Direct AX insertion returned error code: {}", set_err);
            Ok(false)
        }
    }
}

/// Synthesizes Cmd+V keystroke to paste into the active cursor
pub fn paste_keystroke() -> Result<(), MacOSError> {
    unsafe {
        let key_down = CGEventCreateKeyboardEvent(std::ptr::null_mut(), KEY_CODE_V, true);
        if key_down.is_null() {
            return Err(MacOSError::EventError("Failed to create key down event".into()));
        }
        CGEventSetFlags(key_down, K_CG_EVENT_FLAG_MASK_COMMAND);
        CGEventPost(K_CG_HID_EVENT_TAP, key_down);
        CFRelease(key_down);

        sleep(Duration::from_millis(15));

        let key_up = CGEventCreateKeyboardEvent(std::ptr::null_mut(), KEY_CODE_V, false);
        if key_up.is_null() {
            return Err(MacOSError::EventError("Failed to create key up event".into()));
        }
        CGEventSetFlags(key_up, K_CG_EVENT_FLAG_MASK_COMMAND);
        CGEventPost(K_CG_HID_EVENT_TAP, key_up);
        CFRelease(key_up);

        Ok(())
    }
}

/// Inserts text at the cursor: tries direct AX first, falls back to clipboard paste
pub fn insert_text(text: &str) -> Result<(), MacOSError> {
    if text.is_empty() {
        return Ok(());
    }

    // Try direct AX first
    if let Ok(true) = direct_ax_insert(text) {
        return Ok(());
    }

    // Fallback: clipboard paste
    debug!("Using clipboard fallback for text insertion");
    let mut clipboard = Clipboard::new().map_err(|e| MacOSError::ClipboardError(e.to_string()))?;
    
    // Save previous clipboard text if any
    let previous_text = clipboard.get_text().ok();

    // Set new text to clipboard
    clipboard
        .set_text(text)
        .map_err(|e| MacOSError::ClipboardError(e.to_string()))?;

    // Allow clipboard to settle before sending keystroke
    sleep(Duration::from_millis(25));
    paste_keystroke()?;

    // Small delay, then restore previous clipboard in background to not mess up user's clipboard
    if let Some(prev) = previous_text {
        std::thread::spawn(move || {
            sleep(Duration::from_millis(400));
            if let Ok(mut cb) = Clipboard::new() {
                let _ = cb.set_text(prev);
            }
        });
    }

    Ok(())
}
