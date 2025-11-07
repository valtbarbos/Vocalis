# EOT (End-of-Turn) Integration - Implementation Summary

## Overview

This integration adds the `pipecat-ai/smart-turn-v3` audio-based End-of-Turn (EOT) detection model to the Vocalis voice assistant. The EOT model analyzes audio to intelligently detect when a user has finished speaking, distinguishing between natural pauses and actual turn endings.

## Architecture

### Key Design Decisions

1. **Backend-Only Integration**: The frontend VAD remains unchanged. The backend adds a "second vote" using the EOT model.

2. **CPU-Only EOT Service**: The EOT service runs on CPU to save GPU VRAM for LLM and TTS services. The smart-turn-v3 model is optimized for CPU inference (~12ms).

3. **Buffering Strategy**: When EOT detects a pause (not a turn ending), the backend buffers the transcription and waits for more audio instead of immediately calling the LLM.

4. **Timeout Safeguard**: If buffered text exceeds a configurable timeout (default 2 seconds), the system forces an EOT to prevent indefinite waiting.

## Components Added

### 1. EOT Server Microservice (`eot-server/`)

A new FastAPI microservice that hosts the pipecat-ai/smart-turn-v3 model:

- **`model.py`**: ONNX model loader with automatic download from HuggingFace
- **`main.py`**: FastAPI server with `/predict` endpoint
- **`Dockerfile`**: CPU-only container configuration
- **`requirements.txt`**: Dependencies (FastAPI, ONNX Runtime, librosa, etc.)

**Endpoints:**
- `GET /health` - Health check
- `POST /predict` - Accepts raw audio bytes, returns EOT prediction

### 2. Backend Modifications

#### `backend/config.py`
Added EOT configuration variables:
- `EOT_API_ENDPOINT` - URL of the EOT service
- `EOT_ENABLED` - Enable/disable EOT detection
- `EOT_THRESHOLD` - Probability threshold for EOT decision (0.0-1.0)
- `EOT_FORCE_AFTER` - Timeout in seconds to force EOT on buffered text

#### `backend/services/eot.py` (New)
Client for communicating with the EOT service:
- Sends audio data as binary HTTP POST
- Returns (probability, is_eot_decision) tuple
- Fail-safe design: on errors, allows conversation to proceed

#### `backend/main.py`
- Imports and initializes `EOTClient`
- Passes EOT client to websocket endpoint

#### `backend/routes/websocket.py`
Major refactoring to support buffering:

**New State Variables:**
- `partial_turn_buffer` - Accumulates transcriptions during incomplete turns
- `last_partial_timestamp` - Tracks when last partial text was received
- `eot_force_after_sec` - Timeout threshold

**Refactored Functions:**
- `_process_speech_segment()` - New logic:
  1. Checks for timeout on buffered text
  2. Sends audio to EOT service
  3. Transcribes audio
  4. If `is_eot=false`: buffers text, sends partial transcription to UI, waits
  5. If `is_eot=true`: processes full buffered text through LLM/TTS

- `_process_final_text()` - Extracted from old `_process_speech_segment()`:
  - Takes final text as input
  - Handles vision context
  - Calls LLM and TTS

**WebSocket Loop:**
- Timeout reduced from 30s to 1s
- On timeout, checks for buffered text that exceeds force-after threshold
- Forces EOT if needed

### 3. Docker Configuration

#### `docker-compose.yml`
Added `eot-server` service:
```yaml
eot-server:
  build:
    context: ./eot-server
    dockerfile: Dockerfile
  container_name: eot-server
  environment:
    - EOT_THRESHOLD=0.5
    - HOST=0.0.0.0
    - PORT=8500
  ports:
    - "8500:8500"
  networks:
    - vocalis-net
  restart: unless-stopped
```

Updated `vocalis-backend`:
- Added `eot-server` to `depends_on`
- Added EOT environment variables

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EOT_API_ENDPOINT` | `http://eot-server:8500/predict` | EOT service URL |
| `EOT_ENABLED` | `true` | Enable/disable EOT detection |
| `EOT_THRESHOLD` | `0.5` | Probability threshold for EOT decision |
| `EOT_FORCE_AFTER` | `2.0` | Force EOT after N seconds of silence |

### Tuning Parameters

1. **EOT_THRESHOLD** (0.0 - 1.0):
   - Lower values (0.3-0.4): More aggressive, detects turns earlier
   - Higher values (0.6-0.7): More conservative, waits longer before deciding

2. **EOT_FORCE_AFTER** (seconds):
   - Lower values (1.0-1.5): Faster responses, less patient
   - Higher values (2.5-3.0): More patient, better for users who speak slowly

## Audio Requirements

The EOT model requires:
- **16kHz sample rate** (automatically resampled by the model)
- **WAV format** (raw bytes)
- **Up to 8 seconds** of audio (model supports this length)

The backend sends the full audio chunk received from the frontend VAD.

## Behavior Flow

### Normal Turn (EOT=true)

1. Frontend VAD detects silence, sends audio to backend
2. Backend sends audio to EOT service → `is_eot=true`
3. Backend transcribes audio → "Hello, how are you?"
4. Backend sends transcription to UI (marked as final)
5. Backend calls LLM → generates response
6. Backend calls TTS → streams audio to frontend

### Partial Turn (EOT=false)

1. Frontend VAD detects silence, sends audio to backend
2. Backend sends audio to EOT service → `is_eot=false` (prob=0.2)
3. Backend transcribes audio → "I can't seem to, um..."
4. Backend buffers text and sends partial transcription to UI
5. Backend waits for more audio (no LLM call)
6. Frontend sends next audio chunk → "find my keys"
7. EOT service → `is_eot=true` (prob=0.8)
8. Backend appends to buffer → "I can't seem to, um... find my keys"
9. Backend processes full text through LLM/TTS

### Timeout Force

1. User says "I need..." and pauses for 3 seconds
2. First chunk: EOT says `is_eot=false`, text is buffered
3. No new audio arrives
4. WebSocket loop detects timeout (> EOT_FORCE_AFTER)
5. Backend forces EOT, processes buffered text "I need..."

## Testing the Integration

### 1. Build and Start Services

```bash
docker-compose down
docker-compose up -d --build
```

### 2. Check Service Health

```bash
# EOT server
curl http://localhost:8500/health

# Backend
curl http://localhost:8000/health
```

### 3. Test Scenarios

**Test incomplete turns:**
- Say: "I can't seem to, um..." (pause mid-sentence)
- Expected: Partial transcription shown, no LLM response yet
- Then say: "find the return label"
- Expected: Full transcription processed, LLM responds

**Test timeout:**
- Say: "I need..." and stop
- Wait 2+ seconds
- Expected: System forces EOT and processes "I need..."

**Test complete turns:**
- Say: "What's the weather today?"
- Expected: Immediate processing, LLM responds

## Monitoring and Debugging

### Logs to Watch

**EOT Service:**
```bash
docker logs -f eot-server
```
Look for:
- Model download progress (first startup)
- Prediction logs with probabilities

**Backend:**
```bash
docker logs -f vocalis-backend
```
Look for:
- "Turn incomplete (prob=X.XXX), buffering"
- "Turn complete (prob=X.XXX), proceeding to LLM"
- "Forcing EOT due to timeout"

### Metadata in Transcription

The transcription messages now include:
```json
{
  "type": "transcription",
  "text": "user text...",
  "metadata": {
    "eot_prob": 0.75,
    "is_partial": false
  }
}
```

## Supported Languages

The smart-turn-v3 model supports 23 languages:
🇸🇦 Arabic, 🇧🇩 Bengali, 🇨🇳 Chinese, 🇩🇰 Danish, 🇳🇱 Dutch, 🇩🇪 German, 🇬🇧🇺🇸 English, 🇫🇮 Finnish, 🇫🇷 French, 🇮🇳 Hindi, 🇮🇩 Indonesian, 🇮🇹 Italian, 🇯🇵 Japanese, 🇰🇷 Korean, 🇮🇳 Marathi, 🇳🇴 Norwegian, 🇵🇱 Polish, 🇵🇹 Portuguese, 🇷🇺 Russian, 🇪🇸 Spanish, 🇹🇷 Turkish, 🇺🇦 Ukrainian, 🇻🇳 Vietnamese

## Performance

### Model Specifications
- **Size**: ~8MB (ONNX, int8 quantized)
- **Inference Time**: ~12ms on CPU
- **Context Window**: Up to 8 seconds of audio
- **Architecture**: Whisper Tiny backbone + linear classifier

### Resource Usage
- **CPU**: Minimal, ~12ms per prediction
- **Memory**: ~50MB for model + runtime
- **Network**: ~5-50KB per audio chunk (varies with audio length)

## Disabling EOT

To disable EOT and revert to simple VAD behavior:

```yaml
# docker-compose.yml
vocalis-backend:
  environment:
    - EOT_ENABLED=false
```

When disabled, the system behaves as before: every audio chunk from frontend VAD triggers immediate transcription and LLM processing.

## Future Enhancements

1. **Text Conditioning**: Condition the model on context (e.g., "user is entering a credit card number")
2. **Adaptive Thresholds**: Automatically adjust EOT_THRESHOLD based on user's speaking patterns
3. **Multi-turn Buffering**: Support longer, multi-sentence turns
4. **Frontend Visualization**: Show EOT probability in real-time
5. **Per-language Tuning**: Different thresholds for different languages

## Troubleshooting

### Issue: EOT service fails to start

**Symptom:** `eot-server` container exits immediately

**Solutions:**
- Check logs: `docker logs eot-server`
- Verify model download (first start takes ~30 seconds)
- Ensure no port conflicts on 8500

### Issue: Always processes immediately (no buffering)

**Symptom:** Every audio chunk triggers LLM, even for incomplete sentences

**Solutions:**
- Check `EOT_ENABLED=true` in docker-compose.yml
- Verify EOT service is reachable: `curl http://localhost:8500/health`
- Check backend logs for EOT client errors
- Try lowering `EOT_THRESHOLD` to 0.3-0.4

### Issue: Never processes (stuck buffering)

**Symptom:** Transcriptions appear but no LLM response

**Solutions:**
- Check `EOT_FORCE_AFTER` is set (default 2.0)
- Verify timeout logic is working (check logs for "Forcing EOT")
- Try raising `EOT_THRESHOLD` to 0.6-0.7
- Restart backend: `docker restart vocalis-backend`

### Issue: High latency

**Symptom:** Slow response times

**Solutions:**
- EOT service runs on CPU, should be ~12ms
- Check EOT service logs for slow predictions
- Monitor network latency between services
- Consider increasing EOT timeout to reduce retries

## References

- [Pipecat Smart Turn GitHub](https://github.com/pipecat-ai/smart-turn)
- [Smart Turn HuggingFace Model](https://huggingface.co/pipecat-ai/smart-turn-v3)
- [Smart Turn v3 Blog Post](https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/)

## Credits

- **Model**: pipecat-ai/smart-turn-v3 by [Pipecat](https://pipecat.ai)
- **License**: BSD 2-Clause License (open source)
- **Integration**: Vocalis team
