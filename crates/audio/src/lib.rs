use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use thiserror::Error;

pub const TARGET_SAMPLE_RATE: u32 = 16_000;

#[derive(Error, Debug)]
pub enum AudioError {
    #[error("Audio device unavailable: {0}")]
    DeviceUnavailable(String),
    #[error("Failed to build input stream: {0}")]
    StreamBuildError(String),
    #[error("Stream play error: {0}")]
    StreamPlayError(String),
    #[error("Recording is already in progress")]
    AlreadyRecording,
    #[error("No active recording to stop")]
    NotRecording,
    #[error("IO/Encoding error: {0}")]
    IoError(String),
    #[error("Worker thread channel disconnected")]
    ChannelError,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone)]
pub enum AudioEvent {
    SpeechChunk(Vec<f32>),
    InactivityTimeout,
    Level(f32),
    VoiceActive(bool),
}

enum AudioCmd {
    Start {
        reply: Sender<Result<(), AudioError>>,
        event_tx: Option<Sender<AudioEvent>>,
    },
    Stop(Sender<Result<Vec<f32>, AudioError>>),
    Cancel,
    SetDevice(Option<String>),
}

#[derive(Clone)]
pub struct AudioRecorder {
    recording: Arc<AtomicBool>,
    sender: Sender<AudioCmd>,
}

unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

impl AudioRecorder {
    pub fn new() -> Self {
        let recording = Arc::new(AtomicBool::new(false));
        let (tx, rx) = channel::<AudioCmd>();

        let rec_flag = recording.clone();
        thread::spawn(move || {
            let mut stream: Option<cpal::Stream> = None;
            let mut device_name: Option<String> = None;
            let mut meta: Option<(u32, usize, Arc<Mutex<Vec<f32>>>)> = None;

            while let Ok(cmd) = rx.recv() {
                match cmd {
                    AudioCmd::SetDevice(name) => {
                        device_name = name;
                    }
                    AudioCmd::Start { reply, event_tx } => {
                        if rec_flag.load(Ordering::SeqCst) {
                            stream = None;
                            meta = None;
                            rec_flag.store(false, Ordering::SeqCst);
                        }

                        let res = (|| -> Result<(), AudioError> {
                            let host = cpal::default_host();
                            let device = if let Some(target_name) = &device_name {
                                let devices = host
                                    .input_devices()
                                    .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?;
                                let mut found = None;
                                for dev in devices {
                                    if let Ok(name) = dev.name() {
                                        if &name == target_name {
                                            found = Some(dev);
                                            break;
                                        }
                                    }
                                }
                                found.ok_or_else(|| {
                                    AudioError::DeviceUnavailable(format!(
                                        "Device '{}' not found",
                                        target_name
                                    ))
                                })?
                            } else {
                                host.default_input_device().ok_or_else(|| {
                                    AudioError::DeviceUnavailable("No default device".into())
                                })?
                            };

                            let supported_config = device
                                .default_input_config()
                                .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?;

                            let sample_rate = supported_config.sample_rate().0;
                            let channels = supported_config.channels() as usize;
                            let sample_format = supported_config.sample_format();
                            let config: StreamConfig = supported_config.into();

                            let raw_buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
                            let raw_buf_clone = raw_buffer.clone();

                            let vad_event_tx = event_tx.clone();

                            // VAD state trackers (800ms silence threshold for pause)
                            let is_speaking = Arc::new(AtomicBool::new(false));
                            let silence_samples = Arc::new(Mutex::new(0usize));
                            let speech_samples = Arc::new(Mutex::new(0usize));

                            let is_speaking_clone = is_speaking.clone();
                            let silence_clone = silence_samples.clone();
                            let speech_clone = speech_samples.clone();

                            let pause_limit_samples = (sample_rate as usize * channels * 65) / 100; // 650ms pause
                            let min_speech_samples = (sample_rate as usize * channels * 25) / 100; // 250ms minimum speech
                            let inactivity_limit_samples = sample_rate as usize * channels * 10; // 10s auto-stop

                            let process_chunk = move |chunk: &[f32]| {
                                let sum_sq: f32 = chunk.iter().map(|&s| s * s).sum();
                                let rms = (sum_sq / chunk.len().max(1) as f32).sqrt();

                                const SPEECH_THRESHOLD: f32 = 0.0055;

                                let mut s_samples = speech_clone.lock().unwrap();
                                let mut sil_samples = silence_clone.lock().unwrap();

                                if rms > SPEECH_THRESHOLD {
                                    if !is_speaking_clone.load(Ordering::SeqCst) {
                                        is_speaking_clone.store(true, Ordering::SeqCst);
                                        if let Some(tx) = &vad_event_tx {
                                            let _ = tx.send(AudioEvent::VoiceActive(true));
                                        }
                                    }
                                    *s_samples += chunk.len();
                                    *sil_samples = 0;
                                } else {
                                    *sil_samples += chunk.len();
                                }

                                if let Some(tx) = &vad_event_tx {
                                    // Emit level periodically
                                    let _ = tx.send(AudioEvent::Level(rms));

                                    // Check pause commit
                                    if is_speaking_clone.load(Ordering::SeqCst)
                                        && *sil_samples >= pause_limit_samples
                                    {
                                        is_speaking_clone.store(false, Ordering::SeqCst);
                                        let _ = tx.send(AudioEvent::VoiceActive(false));

                                        if *s_samples >= min_speech_samples {
                                            let mut buf = raw_buf_clone.lock().unwrap();
                                            let captured = buf.clone();
                                            buf.clear();

                                            let mono = downmix_to_mono(&captured, channels);
                                            let resampled = resample_linear(
                                                &mono,
                                                sample_rate,
                                                TARGET_SAMPLE_RATE,
                                            );
                                            let _ = tx.send(AudioEvent::SpeechChunk(resampled));
                                        }

                                        *s_samples = 0;
                                        *sil_samples = 0;
                                    } else if !is_speaking_clone.load(Ordering::SeqCst)
                                        && *sil_samples >= inactivity_limit_samples
                                    {
                                        let _ = tx.send(AudioEvent::InactivityTimeout);
                                        *sil_samples = 0;
                                    }
                                }
                            };

                            let buf_clone = raw_buffer.clone();
                            let s = match sample_format {
                                SampleFormat::F32 => {
                                    let b = buf_clone;
                                    device.build_input_stream(
                                        &config,
                                        move |data: &[f32], _: &_| {
                                            b.lock().unwrap().extend_from_slice(data);
                                            process_chunk(data);
                                        },
                                        |err| tracing::error!("Audio error: {:?}", err),
                                        None,
                                    )
                                }
                                SampleFormat::I16 => {
                                    let b = buf_clone;
                                    device.build_input_stream(
                                        &config,
                                        move |data: &[i16], _: &_| {
                                            let floats: Vec<f32> = data
                                                .iter()
                                                .map(|&s| s as f32 / i16::MAX as f32)
                                                .collect();
                                            b.lock().unwrap().extend_from_slice(&floats);
                                            process_chunk(&floats);
                                        },
                                        |err| tracing::error!("Audio error: {:?}", err),
                                        None,
                                    )
                                }
                                SampleFormat::U16 => {
                                    let b = buf_clone;
                                    device.build_input_stream(
                                        &config,
                                        move |data: &[u16], _: &_| {
                                            let floats: Vec<f32> = data
                                                .iter()
                                                .map(|&s| (s as f32 - 32768.0) / 32768.0)
                                                .collect();
                                            b.lock().unwrap().extend_from_slice(&floats);
                                            process_chunk(&floats);
                                        },
                                        |err| tracing::error!("Audio error: {:?}", err),
                                        None,
                                    )
                                }
                                other => {
                                    return Err(AudioError::StreamBuildError(format!(
                                        "Unsupported sample format: {:?}",
                                        other
                                    )));
                                }
                            }
                            .map_err(|e| AudioError::StreamBuildError(e.to_string()))?;

                            s.play().map_err(|e| AudioError::StreamPlayError(e.to_string()))?;

                            stream = Some(s);
                            meta = Some((sample_rate, channels, raw_buffer));
                            rec_flag.store(true, Ordering::SeqCst);
                            Ok(())
                        })();

                        let _ = reply.send(res);
                    }
                    AudioCmd::Stop(reply) => {
                        if !rec_flag.load(Ordering::SeqCst) {
                            let _ = reply.send(Err(AudioError::NotRecording));
                            continue;
                        }

                        rec_flag.store(false, Ordering::SeqCst);
                        stream = None;

                        if let Some((src_rate, channels, buf_arc)) = meta.take() {
                            let raw = buf_arc.lock().unwrap().clone();
                            let mono = downmix_to_mono(&raw, channels);
                            let resampled = resample_linear(&mono, src_rate, TARGET_SAMPLE_RATE);
                            let _ = reply.send(Ok(resampled));
                        } else {
                            let _ = reply.send(Ok(Vec::new()));
                        }
                    }
                    AudioCmd::Cancel => {
                        rec_flag.store(false, Ordering::SeqCst);
                        stream = None;
                        meta = None;
                    }
                }
            }
        });

        Self {
            recording,
            sender: tx,
        }
    }

    pub fn set_device(&self, name: Option<String>) {
        let _ = self.sender.send(AudioCmd::SetDevice(name));
    }

    pub fn list_devices() -> Result<Vec<AudioDeviceInfo>, AudioError> {
        let host = cpal::default_host();
        let default_device_name = host
            .default_input_device()
            .and_then(|d| d.name().ok());

        let devices = host
            .input_devices()
            .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?;

        let mut list = Vec::new();
        for device in devices {
            if let Ok(name) = device.name() {
                let is_default = default_device_name.as_ref() == Some(&name);
                list.push(AudioDeviceInfo { name, is_default });
            }
        }
        Ok(list)
    }

    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::SeqCst)
    }

    pub fn start(&self) -> Result<(), AudioError> {
        let (tx, rx) = channel();
        self.sender
            .send(AudioCmd::Start { reply: tx, event_tx: None })
            .map_err(|_| AudioError::ChannelError)?;
        rx.recv().map_err(|_| AudioError::ChannelError)?
    }

    pub fn start_with_events(&self, event_tx: Sender<AudioEvent>) -> Result<(), AudioError> {
        let (tx, rx) = channel();
        self.sender
            .send(AudioCmd::Start {
                reply: tx,
                event_tx: Some(event_tx),
            })
            .map_err(|_| AudioError::ChannelError)?;
        rx.recv().map_err(|_| AudioError::ChannelError)?
    }

    pub fn stop(&self) -> Result<Vec<f32>, AudioError> {
        let (tx, rx) = channel();
        self.sender
            .send(AudioCmd::Stop(tx))
            .map_err(|_| AudioError::ChannelError)?;
        rx.recv().map_err(|_| AudioError::ChannelError)?
    }

    pub fn cancel(&self) {
        let _ = self.sender.send(AudioCmd::Cancel);
    }

    pub fn save_wav(path: &Path, samples: &[f32]) -> Result<(), AudioError> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: TARGET_SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let mut writer = hound::WavWriter::create(path, spec)
            .map_err(|e| AudioError::IoError(e.to_string()))?;

        for &sample in samples {
            let clamped = sample.max(-1.0).min(1.0);
            let pcm_val = (clamped * i16::MAX as f32) as i16;
            writer
                .write_sample(pcm_val)
                .map_err(|e| AudioError::IoError(e.to_string()))?;
        }

        writer
            .finalize()
            .map_err(|e| AudioError::IoError(e.to_string()))?;

        Ok(())
    }
}

impl Default for AudioRecorder {
    fn default() -> Self {
        Self::new()
    }
}

fn downmix_to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    let frames = interleaved.len() / channels;
    let mut mono = Vec::with_capacity(frames);
    for i in 0..frames {
        let mut sum = 0.0;
        for c in 0..channels {
            sum += interleaved[i * channels + c];
        }
        mono.push(sum / (channels as f32));
    }
    mono
}

pub fn resample_linear(input: &[f32], in_rate: u32, out_rate: u32) -> Vec<f32> {
    if in_rate == out_rate || input.is_empty() {
        return input.to_vec();
    }

    let ratio = in_rate as f64 / out_rate as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    let mut output = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src_idx = i as f64 * ratio;
        let index_floor = src_idx.floor() as usize;
        let frac = (src_idx - index_floor as f64) as f32;

        if index_floor + 1 < input.len() {
            let sample = input[index_floor] * (1.0 - frac) + input[index_floor + 1] * frac;
            output.push(sample);
        } else if index_floor < input.len() {
            output.push(input[index_floor]);
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample_ratio_down() {
        let input = vec![0.0, 1.0, 0.0, -1.0];
        let resampled = resample_linear(&input, 32_000, 16_000);
        assert_eq!(resampled.len(), 2);
    }

    #[test]
    fn test_downmix_stereo() {
        let stereo = vec![1.0, 0.5, -0.5, -1.0];
        let mono = downmix_to_mono(&stereo, 2);
        assert_eq!(mono.len(), 2);
        assert!((mono[0] - 0.75).abs() < 1e-5);
        assert!((mono[1] - (-0.75)).abs() < 1e-5);
    }
}
