use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use tracing::info;

#[derive(Error, Debug)]
pub enum AsrError {
    #[error("Failed to start ASR process: {0}")]
    ProcessStartError(String),
    #[error("ASR worker communication error: {0}")]
    IpcError(String),
    #[error("Transcription failed: {0}")]
    TranscriptionError(String),
    #[error("Model not ready")]
    NotReady,
    #[error("Audio encoding error: {0}")]
    AudioError(String),
}

pub trait SpeechRecognizer: Send + Sync {
    fn transcribe_samples(&self, samples: &[f32]) -> Result<String, AsrError>;
    fn transcribe_file(&self, path: &Path) -> Result<String, AsrError>;
}

#[derive(Serialize, Deserialize)]
struct WorkerRequest {
    command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct WorkerResponse {
    status: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

pub struct KritiBridge {
    stdin: Arc<Mutex<ChildStdin>>,
    reader: Arc<Mutex<BufReader<ChildStdout>>>,
    _child: Arc<Mutex<Child>>,
}

impl KritiBridge {
    pub fn new(python_path: &Path, working_dir: &Path) -> Result<Self, AsrError> {
        info!("Spawning Kriti ASR worker process...");
        let mut child = Command::new(python_path)
            .args(["-m", "ml.inference.server"])
            .current_dir(working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| AsrError::ProcessStartError(e.to_string()))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AsrError::ProcessStartError("Cannot capture child stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AsrError::ProcessStartError("Cannot capture child stdout".into()))?;

        let mut reader = BufReader::new(stdout);

        // Wait for ready event
        let res = read_response(&mut reader)?;

        if res.status != "ready" {
            return Err(AsrError::TranscriptionError(
                res.message.unwrap_or_else(|| "Unknown worker error".into()),
            ));
        }

        info!("Kriti ASR worker ready!");

        Ok(Self {
            stdin: Arc::new(Mutex::new(stdin)),
            reader: Arc::new(Mutex::new(reader)),
            _child: Arc::new(Mutex::new(child)),
        })
    }
}

fn read_response(reader: &mut BufReader<ChildStdout>) -> Result<WorkerResponse, AsrError> {
    let mut line = String::new();
    while reader
        .read_line(&mut line)
        .map_err(|e| AsrError::IpcError(e.to_string()))?
        > 0
    {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            line.clear();
            continue;
        }
        if let Ok(resp) = serde_json::from_str::<WorkerResponse>(trimmed) {
            return Ok(resp);
        } else {
            tracing::debug!("ASR worker non-json line: {}", trimmed);
        }
        line.clear();
    }
    Err(AsrError::IpcError("Unexpected EOF from ASR worker".into()))
}

impl SpeechRecognizer for KritiBridge {
    fn transcribe_file(&self, path: &Path) -> Result<String, AsrError> {
        let req = WorkerRequest {
            command: "transcribe".to_string(),
            path: Some(path.to_string_lossy().to_string()),
        };

        let req_json = serde_json::to_string(&req).map_err(|e| AsrError::IpcError(e.to_string()))?;
        {
            let mut stdin = self.stdin.lock().unwrap();
            writeln!(stdin, "{}", req_json).map_err(|e| AsrError::IpcError(e.to_string()))?;
            stdin.flush().map_err(|e| AsrError::IpcError(e.to_string()))?;
        }

        let resp = {
            let mut reader = self.reader.lock().unwrap();
            read_response(&mut reader)?
        };

        if resp.status == "ok" {
            Ok(resp.text.unwrap_or_default())
        } else {
            Err(AsrError::TranscriptionError(
                resp.message.unwrap_or_else(|| "Worker error".into()),
            ))
        }
    }

    fn transcribe_samples(&self, samples: &[f32]) -> Result<String, AsrError> {
        let temp_dir = std::env::temp_dir();
        let temp_wav = temp_dir.join(format!("voicekey_{}.wav", std::process::id()));

        // Save temporary WAV (16kHz mono)
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let mut writer = hound::WavWriter::create(&temp_wav, spec)
            .map_err(|e| AsrError::AudioError(e.to_string()))?;

        for &sample in samples {
            let clamped = sample.max(-1.0).min(1.0);
            let val = (clamped * i16::MAX as f32) as i16;
            writer
                .write_sample(val)
                .map_err(|e| AsrError::AudioError(e.to_string()))?;
        }
        writer
            .finalize()
            .map_err(|e| AsrError::AudioError(e.to_string()))?;

        let res = self.transcribe_file(&temp_wav);
        let _ = std::fs::remove_file(&temp_wav);
        res
    }
}

/// Mock recognizer for testing and offline development
pub struct MockSpeechRecognizer {
    pub mocked_output: String,
}

impl MockSpeechRecognizer {
    pub fn new(output: impl Into<String>) -> Self {
        Self {
            mocked_output: output.into(),
        }
    }
}

impl SpeechRecognizer for MockSpeechRecognizer {
    fn transcribe_samples(&self, _samples: &[f32]) -> Result<String, AsrError> {
        Ok(self.mocked_output.clone())
    }

    fn transcribe_file(&self, _path: &Path) -> Result<String, AsrError> {
        Ok(self.mocked_output.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mock_recognizer() {
        let recognizer = MockSpeechRecognizer::new("नमस्ते");
        let result = recognizer.transcribe_samples(&[0.0; 16000]).unwrap();
        assert_eq!(result, "नमस्ते");
    }
}
