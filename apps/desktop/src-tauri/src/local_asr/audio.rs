//! Format-driven audio pipeline: WAV ingest → 16 kHz mono `f32`.
//!
//! The worker (and later the PTT flow) only ever sees normalized little
//! buffers: 16 kHz, mono, `f32` in `[-1, 1]`. Everything else — sample
//! rates, channel counts, PCM widths — is converted here, loudly: formats
//! we cannot convert are rejected with [`AppError::audio_unsupported_format`],
//! never silently resampled or truncated.
//!
//! Supported inputs: RIFF/WAVE with PCM-16 or IEEE-float-32, 1–8 channels,
//! any sane sample rate. Cap: 128 MiB inputs are refused outright.

use crate::error::{AppError, AppResult};

/// Sample rate every engine in this codebase consumes.
pub const TARGET_SAMPLE_RATE: u32 = 16_000;
/// Refuse inputs larger than this (a corrupt length field must not OOM us).
pub const MAX_WAV_BYTES: usize = 128 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct DecodedAudio {
    /// Normalized mono `f32` samples at [`TARGET_SAMPLE_RATE`].
    pub samples: Vec<f32>,
}

impl DecodedAudio {
    pub fn duration_secs(&self) -> f64 {
        self.samples.len() as f64 / f64::from(TARGET_SAMPLE_RATE)
    }
}

/// Decode WAV bytes and normalize to 16 kHz mono `f32`.
pub fn decode_wav(bytes: &[u8]) -> AppResult<DecodedAudio> {
    let raw = parse_wav(bytes)?;
    Ok(DecodedAudio {
        samples: to_mono_16k(&raw.samples, raw.channels, raw.sample_rate),
    })
}

struct RawAudio {
    samples: Vec<f32>,
    channels: u16,
    sample_rate: u32,
}

fn bad_wav(message: impl Into<String>) -> AppError {
    AppError::audio_unsupported_format(message)
}

fn read_u16_le(bytes: &[u8], offset: usize) -> AppResult<u16> {
    bytes
        .get(offset..offset + 2)
        .and_then(|w| <[u8; 2]>::try_from(w).ok())
        .map(u16::from_le_bytes)
        .ok_or_else(|| bad_wav("truncated WAV header"))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> AppResult<u32> {
    bytes
        .get(offset..offset + 4)
        .and_then(|w| <[u8; 4]>::try_from(w).ok())
        .map(u32::from_le_bytes)
        .ok_or_else(|| bad_wav("truncated WAV header"))
}

fn parse_wav(bytes: &[u8]) -> AppResult<RawAudio> {
    if bytes.len() > MAX_WAV_BYTES {
        return Err(bad_wav(format!(
            "WAV input too large ({} bytes)",
            bytes.len()
        )));
    }
    if bytes.len() < 44 {
        return Err(bad_wav("input too short to be a WAV file"));
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(bad_wav("not a RIFF/WAVE file"));
    }
    // Walk chunks: `fmt ` configures decoding, `data` carries samples.
    // Unknown chunks (fact, LIST, ...) are skipped by size.
    let mut channels: Option<u16> = None;
    let mut sample_rate: Option<u32> = None;
    let mut bits_per_sample: Option<u16> = None;
    let mut audio_format: Option<u16> = None;
    let mut data_range: Option<(usize, usize)> = None;
    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let tag = &bytes[offset..offset + 4];
        let size = read_u32_le(bytes, offset + 4)? as usize;
        let body = offset + 8;
        let end = body
            .checked_add(size)
            .ok_or_else(|| bad_wav("WAV chunk overflows"))?;
        if end > bytes.len() {
            return Err(bad_wav("WAV chunk runs past end of input"));
        }
        if tag == b"fmt " {
            if size < 16 {
                return Err(bad_wav("WAV fmt chunk too short"));
            }
            audio_format = Some(read_u16_le(bytes, body)?);
            channels = Some(read_u16_le(bytes, body + 2)?);
            sample_rate = Some(read_u32_le(bytes, body + 4)?);
            bits_per_sample = Some(read_u16_le(bytes, body + 14)?);
        } else if tag == b"data" {
            data_range = Some((body, end));
        }
        // Chunks are word-aligned: odd sizes pad one byte.
        offset = end + (size & 1);
    }
    let (format, channels, sample_rate, bits) =
        match (audio_format, channels, sample_rate, bits_per_sample) {
            (Some(f), Some(c), Some(r), Some(b)) => (f, c, r, b),
            _ => return Err(bad_wav("WAV is missing fmt or data chunk")),
        };
    if channels == 0 || channels > 8 {
        return Err(bad_wav(format!("unsupported channel count: {channels}")));
    }
    if !(8000..=192_000).contains(&sample_rate) {
        return Err(bad_wav(format!("unsupported sample rate: {sample_rate}")));
    }
    let (start, end) = data_range.ok_or_else(|| bad_wav("WAV has no data chunk"))?;
    let data = &bytes[start..end];
    let samples = match (format, bits) {
        // 1 = integer PCM, 3 = IEEE float.
        (1, 16) => decode_pcm16(data, channels)?,
        (3, 32) => decode_f32(data, channels)?,
        _ => {
            return Err(bad_wav(format!(
                "unsupported WAV encoding (format {format}, {bits}-bit); need PCM-16 or float-32"
            )))
        }
    };
    Ok(RawAudio {
        samples,
        channels,
        sample_rate,
    })
}

/// Interleaved i16 LE → planar-agnostic f32 in [-1, 1]. The file is
/// de-interleaved by the caller via channel stride.
fn decode_pcm16(data: &[u8], channels: u16) -> AppResult<Vec<f32>> {
    if !data.len().is_multiple_of(2) {
        return Err(bad_wav("PCM-16 data has an odd byte count"));
    }
    let frames = data.len() / 2;
    if !frames.is_multiple_of(usize::from(channels)) {
        return Err(bad_wav("PCM-16 data is not a whole number of frames"));
    }
    let mut out = Vec::with_capacity(frames);
    for pair in data.chunks(2) {
        // Length was validated even above; the conversion below keeps this
        // panic-free even if that ever changes.
        let [a, b]: [u8; 2] = pair
            .try_into()
            .map_err(|_| bad_wav("PCM-16 data has an odd byte count"))?;
        let sample = i16::from_le_bytes([a, b]) as f32 / 32768.0;
        out.push(sample);
    }
    Ok(out)
}

fn decode_f32(data: &[u8], channels: u16) -> AppResult<Vec<f32>> {
    if !data.len().is_multiple_of(4) {
        return Err(bad_wav("float-32 data is not a whole number of samples"));
    }
    let frames = data.len() / 4;
    if !frames.is_multiple_of(usize::from(channels)) {
        return Err(bad_wav("float-32 data is not a whole number of frames"));
    }
    let mut out = Vec::with_capacity(frames);
    for quad in data.chunks(4) {
        let [a, b, c, d]: [u8; 4] = quad
            .try_into()
            .map_err(|_| bad_wav("float-32 data is not a whole number of samples"))?;
        let sample = f32::from_le_bytes([a, b, c, d]);
        if !sample.is_finite() {
            return Err(bad_wav("float-32 data contains non-finite samples"));
        }
        out.push(sample.clamp(-1.0, 1.0));
    }
    Ok(out)
}

/// Downmix (channel average) + resample (linear) to 16 kHz mono.
pub fn to_mono_16k(interleaved: &[f32], channels: u16, sample_rate: u32) -> Vec<f32> {
    let channels = usize::from(channels.max(1));
    let frames = interleaved.len() / channels;
    let mut mono = Vec::with_capacity(frames);
    for frame in 0..frames {
        let mut acc = 0.0f32;
        for ch in 0..channels {
            acc += interleaved
                .get(frame * channels + ch)
                .copied()
                .unwrap_or(0.0);
        }
        mono.push(acc / channels as f32);
    }
    if sample_rate == TARGET_SAMPLE_RATE {
        return mono;
    }
    resample_linear(&mono, sample_rate, TARGET_SAMPLE_RATE)
}

fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if input.is_empty() || from_rate == to_rate {
        return input.to_vec();
    }
    let ratio = f64::from(from_rate) / f64::from(to_rate);
    let out_len = ((input.len() as f64 / ratio).round() as usize).max(1);
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let lo = pos.floor() as usize;
        let frac = (pos - lo as f64) as f32;
        let a = input.get(lo).copied().unwrap_or(0.0);
        let b = input.get(lo + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}

/// Trim leading/trailing silence: samples whose absolute value stays under
/// `threshold` are cut, at most `max_trim_secs` per side (never trims the
/// whole buffer — at least one sample survives).
pub fn trim_silence(
    samples: &[f32],
    threshold: f32,
    max_trim_secs: f32,
    sample_rate: u32,
) -> &[f32] {
    if samples.is_empty() {
        return samples;
    }
    let max_trim = (max_trim_secs * sample_rate as f32).round() as usize;
    // `start + 1 < len` (not `start < len`): at least one sample survives
    // even when the whole buffer is silence.
    let mut start = 0usize;
    while start + 1 < samples.len() && start < max_trim && samples[start].abs() < threshold {
        start += 1;
    }
    let mut end = samples.len();
    while end > start + 1 && samples.len() - end < max_trim && samples[end - 1].abs() < threshold {
        end -= 1;
    }
    &samples[start..end]
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioChunk {
    /// Offset of the chunk start in the source buffer, in seconds.
    pub start_secs: f64,
    pub samples: Vec<f32>,
}

/// Split samples into fixed windows with overlap. Coverage is exact: the
/// union of chunks spans the whole input, and the last chunk keeps its
/// natural (possibly short) tail instead of padding or dropping audio.
pub fn chunk_samples(
    samples: &[f32],
    sample_rate: u32,
    window_secs: f64,
    overlap_secs: f64,
) -> Result<Vec<AudioChunk>, AppError> {
    if window_secs <= 0.0 || overlap_secs < 0.0 || overlap_secs >= window_secs {
        return Err(AppError::audio_unsupported_format(
            "chunk window must be positive with smaller overlap",
        ));
    }
    if sample_rate == 0 {
        return Err(AppError::audio_unsupported_format(
            "chunk sample rate must not be zero",
        ));
    }
    if samples.is_empty() {
        return Ok(Vec::new());
    }
    let window = (window_secs * f64::from(sample_rate)).round() as usize;
    let step = ((window_secs - overlap_secs) * f64::from(sample_rate)).round() as usize;
    if window == 0 || step == 0 {
        return Err(AppError::audio_unsupported_format(
            "chunk window too small for this sample rate",
        ));
    }
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < samples.len() {
        let end = (start + window).min(samples.len());
        chunks.push(AudioChunk {
            start_secs: start as f64 / f64::from(sample_rate),
            samples: samples[start..end].to_vec(),
        });
        if end == samples.len() {
            break;
        }
        start += step;
    }
    Ok(chunks)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal WAV writer for fixtures: PCM-16 or float-32, N channels.
    fn wav_bytes(
        format: u16,
        channels: u16,
        sample_rate: u32,
        frames: &[[f32; 2]],
        stereo: bool,
    ) -> Vec<u8> {
        let ch: usize = if stereo { 2 } else { 1 };
        let bits: u16 = if format == 1 { 16 } else { 32 };
        let mut data = Vec::new();
        for frame in frames.iter() {
            for s in frame.iter().take(ch) {
                let s = s.clamp(-1.0, 1.0);
                if format == 1 {
                    data.extend_from_slice(&((s * 32767.0) as i16).to_le_bytes());
                } else {
                    data.extend_from_slice(&s.to_le_bytes());
                }
            }
        }
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&((36 + data.len()) as u32).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&format.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&sample_rate.to_le_bytes());
        let block_align = channels * bits / 8;
        out.extend_from_slice(&(sample_rate * u32::from(block_align)).to_le_bytes());
        out.extend_from_slice(&block_align.to_le_bytes());
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        out
    }

    fn sine_440(sample_rate: u32, secs: f32) -> Vec<[f32; 2]> {
        let n = (f64::from(sample_rate) * f64::from(secs)).round() as usize;
        (0..n)
            .map(|i| {
                let s = (2.0 * std::f32::consts::PI * 440.0 * i as f32 / sample_rate as f32).sin();
                [s, s]
            })
            .collect()
    }

    #[test]
    fn decodes_stereo_44100_pcm16_to_mono_16k() {
        let frames = sine_440(44_100, 1.0);
        let wav = wav_bytes(1, 2, 44_100, &frames, true);
        let decoded = decode_wav(&wav).expect("decodes");
        assert_eq!(decoded.samples.len(), TARGET_SAMPLE_RATE as usize);
        // 440 Hz tone survives: peak energy well above silence.
        let peak = decoded
            .samples
            .iter()
            .map(|s| s.abs())
            .fold(0.0f32, f32::max);
        assert!(peak > 0.5, "tone peak {peak}");
        assert!((decoded.duration_secs() - 1.0).abs() < 0.01);
    }

    #[test]
    fn decodes_mono_float32_passthrough() {
        let frames = sine_440(16_000, 0.5);
        let wav = wav_bytes(3, 1, 16_000, &frames, false);
        let decoded = decode_wav(&wav).expect("decodes");
        assert_eq!(decoded.samples.len(), 8000);
        let peak = decoded
            .samples
            .iter()
            .map(|s| s.abs())
            .fold(0.0f32, f32::max);
        assert!(peak > 0.5);
    }

    #[test]
    fn rejects_corrupt_and_unsupported_wav() {
        assert!(decode_wav(b"").is_err());
        assert!(decode_wav(b"RIFF....WAVE").is_err());
        // Truncated data chunk.
        let mut wav = wav_bytes(1, 1, 16_000, &sine_440(16_000, 0.1), false);
        wav.truncate(wav.len() - 100);
        assert!(decode_wav(&wav).is_err());
        // A-law (format 6) is not convertible here.
        let mut alaw = wav_bytes(1, 1, 16_000, &sine_440(16_000, 0.1), false);
        alaw[20] = 6;
        assert!(decode_wav(&alaw).is_err());
        // 24-bit PCM is not convertible here.
        let mut pcm24 = wav_bytes(1, 1, 16_000, &sine_440(16_000, 0.1), false);
        pcm24[34] = 24;
        assert!(decode_wav(&pcm24).is_err());
    }

    #[test]
    fn downmix_averages_channels() {
        // Left = +0.5 DC, right = -0.5 DC -> mono ~0.
        let frames = vec![[0.5, -0.5]; 1600];
        let wav = wav_bytes(1, 2, 16_000, &frames, true);
        let decoded = decode_wav(&wav).expect("decodes");
        assert_eq!(decoded.samples.len(), 1600);
        assert!(decoded.samples.iter().all(|s| s.abs() < 0.01));
    }

    #[test]
    fn trim_silence_obeys_threshold_and_cap() {
        let sr = 16_000u32;
        // Deterministic DC blocks (no sine phase to reason about).
        let mut samples = vec![0.0f32; sr as usize]; // 1 s silence
        samples.extend(vec![0.5f32; sr as usize]); // 1 s tone
        samples.extend(vec![0.0f32; sr as usize]); // 1 s silence
        let trimmed = trim_silence(&samples, 0.01, 0.5, sr);
        // Capped at 0.5 s per side: 0.5 + 1.0 + 0.5.
        assert_eq!(trimmed.len(), (sr as usize * 2));
        let full = trim_silence(&samples, 0.01, 2.0, sr);
        assert_eq!(full.len(), sr as usize);
        // All silence never vanishes entirely.
        let all_quiet = trim_silence(&samples[..sr as usize], 0.01, 5.0, sr);
        assert_eq!(all_quiet.len(), 1);
        // Sub-threshold rumble counts as silence; loud edges survive.
        let mut rumble = vec![0.005f32; 1000];
        rumble.extend(vec![0.9f32; 100]);
        let kept = trim_silence(&rumble, 0.01, 5.0, sr);
        assert_eq!(kept.len(), 101);
    }

    #[test]
    fn chunking_covers_input_exactly() {
        let sr = 16_000u32;
        let samples = vec![0.1f32; sr as usize * 5]; // 5 s
        let chunks = chunk_samples(&samples, sr, 2.0, 0.5).expect("chunks");
        assert_eq!(chunks.len(), 4); // starts at 0, 1.5, 3.0, 4.5
        assert_eq!(chunks[0].start_secs, 0.0);
        assert!((chunks[1].start_secs - 1.5).abs() < 1e-9);
        assert!((chunks[3].start_secs - 4.5).abs() < 1e-9);
        assert_eq!(chunks[3].samples.len(), (0.5 * sr as f64) as usize);
        // Union spans everything with no gaps: last end == input end.
        let total: usize = chunks.iter().map(|c| c.samples.len()).sum();
        assert!(total >= samples.len());
        // Shorter-than-window input yields one natural chunk.
        let short = chunk_samples(&samples[..1000], sr, 2.0, 0.5).expect("short");
        assert_eq!(short.len(), 1);
        assert_eq!(short[0].samples.len(), 1000);
        // Empty input yields no chunks; bad params are errors, not panics.
        assert!(chunk_samples(&[], sr, 2.0, 0.5).expect("empty").is_empty());
        assert!(chunk_samples(&samples, sr, 0.0, 0.0).is_err());
        assert!(chunk_samples(&samples, sr, 1.0, 1.0).is_err());
        assert!(chunk_samples(&samples, 0, 1.0, 0.0).is_err());
    }
}
