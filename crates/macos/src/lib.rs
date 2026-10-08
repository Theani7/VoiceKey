#![allow(unexpected_cfgs, deprecated)]

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

use cocoa::base::{id, nil};
use objc::{class, msg_send, sel, sel_impl};

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceCreate(source_state: i32) -> *mut c_void;
    fn CGEventCreateKeyboardEvent(
        source: *mut c_void,
        virtual_key: u16,
        key_down: bool,
    ) -> *mut c_void;
    fn CGEventSetFlags(event: *mut c_void, flags: u64);
    fn CGEventPost(tap: u32, event: *mut c_void);
}

const K_CG_HID_EVENT_TAP: u32 = 0;
const K_CG_SESSION_EVENT_TAP: u32 = 1;
const K_CG_EVENT_FLAG_MASK_COMMAND: u64 = 0x00100000;
const KEY_CODE_V: u16 = 9;

/// Configures and shows an NSWindow without making it key or activating the host app
pub unsafe fn show_window_without_stealing_focus(ns_win: *mut c_void) {
    if ns_win.is_null() {
        return;
    }
    let win = ns_win as id;
    // NSWindowStyleMaskNonactivatingPanel = 128
    let mask: u64 = msg_send![win, styleMask];
    let _: () = msg_send![win, setStyleMask: mask | 128u64];
    let _: () = msg_send![win, setLevel: 25i64];
    let _: () = msg_send![win, setCollectionBehavior: 0x111u64];
    let _: () = msg_send![win, orderFrontRegardless];
}

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

/// Returns the PID of the currently frontmost active application
pub fn get_frontmost_app_pid() -> Option<i32> {
    unsafe {
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace == nil {
            return None;
        }
        let app: id = msg_send![workspace, frontmostApplication];
        if app == nil {
            return None;
        }
        let pid: i32 = msg_send![app, processIdentifier];
        Some(pid)
    }
}

/// Brings the application with the given PID to the front and activates it
pub fn activate_app_by_pid(pid: i32) {
    unsafe {
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace == nil {
            return;
        }
        let running_apps: id = msg_send![workspace, runningApplications];
        if running_apps == nil {
            return;
        }
        let count: usize = msg_send![running_apps, count];
        for i in 0..count {
            let app: id = msg_send![running_apps, objectAtIndex: i];
            let app_pid: i32 = msg_send![app, processIdentifier];
            if app_pid == pid {
                // NSApplicationActivateIgnoringOtherApps = 1 << 0
                let _: bool = msg_send![app, activateWithOptions: 1u64];
                break;
            }
        }
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

/// Synthesizes Cmd+V keystroke for macOS session applications (including sandboxed apps like WhatsApp)
pub fn paste_keystroke(target_pid: Option<i32>) -> Result<(), MacOSError> {
    unsafe {
        if let Some(pid) = target_pid {
            activate_app_by_pid(pid);
            sleep(Duration::from_millis(50));
        }

        // kCGEventSourceStateCombinedSessionState = 0 allows sandboxed apps (like WhatsApp) to receive synthetic events
        let source = CGEventSourceCreate(0);

        let key_down = CGEventCreateKeyboardEvent(source, KEY_CODE_V, true);
        if key_down.is_null() {
            if !source.is_null() {
                CFRelease(source);
            }
            return Err(MacOSError::EventError("Failed to create key down event".into()));
        }
        CGEventSetFlags(key_down, K_CG_EVENT_FLAG_MASK_COMMAND);
        CGEventPost(K_CG_SESSION_EVENT_TAP, key_down);
        CGEventPost(K_CG_HID_EVENT_TAP, key_down);
        CFRelease(key_down);

        sleep(Duration::from_millis(50));

        let key_up = CGEventCreateKeyboardEvent(source, KEY_CODE_V, false);
        if key_up.is_null() {
            if !source.is_null() {
                CFRelease(source);
            }
            return Err(MacOSError::EventError("Failed to create key up event".into()));
        }
        CGEventSetFlags(key_up, K_CG_EVENT_FLAG_MASK_COMMAND);
        CGEventPost(K_CG_SESSION_EVENT_TAP, key_up);
        CGEventPost(K_CG_HID_EVENT_TAP, key_up);
        CFRelease(key_up);

        if !source.is_null() {
            CFRelease(source);
        }

        Ok(())
    }
}

/// Inserts text at the cursor: tries direct AX first, falls back to targeted clipboard paste
pub fn insert_text(text: &str, target_pid: Option<i32>) -> Result<(), MacOSError> {
    if text.is_empty() {
        return Ok(());
    }

    // Try direct AX first (works for native AppKit apps like Notes, TextEdit)
    if let Ok(true) = direct_ax_insert(text) {
        return Ok(());
    }

    // Fallback: clipboard paste (for Catalyst, Electron, WebKit like WhatsApp, Chrome, Slack)
    debug!("Using clipboard fallback for text insertion");
    let mut clipboard = Clipboard::new().map_err(|e| MacOSError::ClipboardError(e.to_string()))?;
    
    // Set new text to clipboard
    clipboard
        .set_text(text)
        .map_err(|e| MacOSError::ClipboardError(e.to_string()))?;

    // Allow clipboard to settle before sending keystroke
    sleep(Duration::from_millis(50));

    // Ensure target app is active if known
    if let Some(pid) = target_pid {
        activate_app_by_pid(pid);
        sleep(Duration::from_millis(40));
    }

    paste_keystroke(target_pid)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diagnose_frontmost() {
        let pid = get_frontmost_app_pid();
        println!("Diagnose: frontmost PID = {:?}", pid);
        let ax = direct_ax_insert("test");
        println!("Diagnose: direct_ax_insert result = {:?}", ax);

        let mut cb = Clipboard::new().unwrap();
        cb.set_text("test_nepali_नमस्ते").unwrap();
        let read = cb.get_text().unwrap();
        assert_eq!(read, "test_nepali_नमस्ते");
        println!("Diagnose: clipboard verified: {:?}", read);
    }
}
