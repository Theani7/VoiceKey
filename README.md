# VoiceKey 🎙️

<p align="center">
  <img src="apps/macos/dist/icons/icon.png" width="128" height="128" alt="VoiceKey Logo" />
</p>

<p align="center">
  <strong>Speak. Type. Done.</strong>
</p>

<p align="center">
  A native, local-first voice typing platform for macOS.<br/>
  Privacy by design, completely open source, and model-agnostic.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Platform-macOS%2014%2B-black.svg?logo=apple" alt="macOS 14+">
  <img src="https://img.shields.io/badge/Architecture-Apple%20Silicon-orange.svg" alt="Apple Silicon">
  <img src="https://img.shields.io/badge/Rust-2021-red.svg?logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB.svg?logo=tauri" alt="Tauri 2">
  <img src="https://img.shields.io/badge/Privacy-100%25%20On--Device-success.svg" alt="100% On-Device">
</p>

---

## 🔒 Privacy Out of the Box: 100% Local-First

VoiceKey was built on a foundational belief: **your voice and keystrokes should never leave your machine**.

- 🛡️ **Zero Cloud Dependencies**: Transcription runs entirely on your local CPU and Apple Silicon Neural Engine / Metal GPU.
- 📴 **Completely Offline**: Functions seamlessly on airplane mode or without an internet connection.
- 🚫 **No Telemetry or Tracking**: No analytics, no network requests for transcription, and no telemetry sent anywhere.
- 🧹 **Ephemeral Memory Processing**: Audio streams reside in volatile RAM only during active dictation and are wiped immediately after transcription. No audio recordings are ever written to disk.

---

## ✨ Features

- **Model-Agnostic Ecosystem**: Not tied to a single speech model. Switch between **Kriti** (high-speed local Nepali ASR), **Whisper** (multilingual), and future regional/global models without reinstalling VoiceKey.
- **Conversational Pause-to-Type**: Speak naturally. When you pause for ~650ms, VoiceKey auto-transcribes and types your words into the active cursor (similar to Siri and Gemini voice typing), then keeps listening for your next phrase.
- **Universal Application Support**: Types seamlessly into:
  - **Messaging**: WhatsApp for Mac (Catalyst / Electron), Telegram, Slack, Discord, Signal, Messages.
  - **Notes & Docs**: Apple Notes, Notion, Obsidian, Google Docs, Microsoft Word.
  - **Code Editors & Terminals**: VS Code, Cursor, Xcode, Terminal, iTerm2, Ghostty.
  - **Browsers**: Safari, Chrome, Arc, Firefox, Brave.
- **Movable Dynamic Island HUD**: A floating, draggable glass pill inspired by macOS design language:
  - **Reactive Waveforms**: Audio frequency bars remain hidden during silence and spring to life only when voice activity is detected.
  - **Draggable Anywhere**: Click and drag the pill anywhere on your screen or across external monitors.
- **System-Wide Global Shortcut**: Press `⌥ Space` (Option + Space) to start or stop dictation instantly from anywhere.
- **Authentic macOS Design**: Follows Apple Human Interface Guidelines with SF Pro typography, native light/dark mode adaptation, and system tray integration.

---

## 🏗️ Architecture

VoiceKey is engineered as a modular Rust workspace powered by Tauri v2 with native macOS Accessibility and CoreGraphics integrations.

```text
┌─────────────────────────────────────────────────────────────┐
│                       macOS System                          │
│  [Global Shortcut: ⌥ Space]  [Focused Application Window]    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     VoiceKey (Tauri v2)                     │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │    Audio Pipeline     │       │   Movable HUD Pill    │  │
│  │ (CPAL / 16kHz VAD)    │       │ (Reactive Waveforms)  │  │
│  └───────────┬───────────┘       └───────────────────────┘  │
└──────────────┼──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Model-Agnostic ASR Engine                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Kriti Nepali ASR (NeMo / PyTorch / Apple Silicon MPS) │  │
│  │ Whisper Multilingual (Local CoreML / CTranslate2)    │  │
│  └───────────────────────────┬───────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  Text Normalization & Insertion             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Deterministic Text Normalizer (Danda ।, ०-९ numerals) │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ Native Insertion:                                     │  │
│  │  1. Direct Accessibility API (AXUIElement)            │  │
│  │  2. Sandboxed Catalyst Session Paste (⌘ V via CGEvent)│  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Modular Crates

| Crate | Purpose |
|---|---|
| [`crates/audio`](crates/audio) | High-performance microphone stream capture (`cpal`), 16kHz mono resampling, energy-based VAD, and voice activity state dispatch. |
| [`crates/asr`](crates/asr) | Model-agnostic speech recognition trait and zero-latency IPC bridge to local ML models. |
| [`crates/text`](crates/text) | Deterministic Nepali text normalization (terminal danda `।`, numeral conversion `०-९`, punctuation spacing, and stutter deduplication). |
| [`crates/macos`](crates/macos) | Native macOS system integrations: Accessibility API (`AXUIElement`), non-activating floating windows (`orderFrontRegardless`), and session keystroke simulation. |
| [`crates/core`](crates/core) | Core domain models, application state, settings definitions, and model ecosystem metadata. |
| [`apps/macos`](apps/macos) | Tauri v2 macOS application, tray icon manager, global shortcut listener, and frontend settings interface. |

---

## 📋 Prerequisites

- **Operating System**: macOS 14.0 (Sonoma) or macOS 15.0+ (Sequoia).
- **Hardware**: Apple Silicon (M1/M2/M3/M4) recommended for optimal local ML performance; Intel Macs supported.
- **Tools**:
  - [Rust](https://www.rust-lang.org/tools/install) (1.75+)
  - [Python](https://www.python.org/) (3.10 or 3.11) with PyTorch
  - macOS Command Line Tools (`xcode-select --install`)

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Theani7/VoiceKey.git
cd VoiceKey
```

### 2. Set Up the Local Python Runtime

```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install PyTorch & NeMo dependencies for local Kriti model
pip install --upgrade pip
pip install torch torchvision torchaudio
pip install nemo_toolkit['asr'] pydub
```

### 3. Run Workspace Tests

Verify that all audio processing, text normalization, and macOS integrations pass:

```bash
cargo test --workspace
```

### 4. Launch VoiceKey

```bash
cargo run --package voicekey-app
```

---

## ⌨️ How to Use

1. **Launch VoiceKey**: The app will appear in your macOS menu bar.
2. **Grant Permissions**:
   - **Microphone**: Needed for capturing voice input.
   - **Accessibility**: Needed for inserting transcribed text at the active cursor.
3. **Start Dictating**:
   - Focus any text field (WhatsApp, Notes, Slack, browser, etc.).
   - Press **`⌥ Space`** (Option + Space).
   - The floating HUD pill will appear at the bottom of the screen.
   - Speak your phrase in Nepali or your selected model's language.
   - Pause for a brief moment (~650ms); VoiceKey automatically transcribes and types the text.
   - Continue speaking or press **`⌥ Space`** (or `ESC`) to end the session.

---

## 🧩 Model Ecosystem

VoiceKey supports interchangeable local speech models:

| Model | Primary Language | Parameters | Size | Runtime |
|---|---|---|---|---|
| **Kriti** *(Default)* | 🇳🇵 Nepali | 119M | ~480 MB | Local NeMo / Apple Silicon |
| **Whisper Small** | 🌐 Multilingual (100+ langs) | 244M | ~960 MB | Local CoreML / PyTorch |
| **Whisper Large v3** | 🌐 High-Accuracy Multilingual | 1.5B | ~3.1 GB | Local CoreML / PyTorch |

*Future community models for Maithili, Newari, Hindi, and Indian English can be integrated by implementing the `SpeechRecognizer` trait in `crates/asr`.*

---

## 🤝 Contributing

VoiceKey is 100% open source under the MIT License. Contributions from developers, designers, and computational linguists are welcome!

1. **Fork the Project**
2. **Create your Feature Branch** (`git checkout -b feature/AmazingFeature`)
3. **Commit your Changes** (`git commit -m 'feat: Add AmazingFeature'`)
4. **Push to the Branch** (`git push origin feature/AmazingFeature`)
5. **Open a Pull Request**

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for full details.

---

<p align="center">
  Built with ❤️ for privacy, multilingual speech, and the open-source community.
</p>
