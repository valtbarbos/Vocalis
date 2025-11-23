# Sherpa-ASR WebSocket Message Format

## Overview
This document describes the expected message format from the sherpa-onnx-online-websocket-server.

## Connection
- **Endpoint:** `ws://sherpa-asr:5002` (or `ws://localhost:5002` for local development)
- **Protocol:** WebSocket
- **Audio Format:** Raw audio bytes (WAV format with header)

## Sending Audio to Sherpa-ASR

The backend sends raw audio bytes directly to sherpa-asr:

```python
await self.asr_websocket.send_bytes(audio_data)
```

## Receiving Transcriptions from Sherpa-ASR

Sherpa-ASR sends JSON messages via WebSocket:

### Message Structure

```json
{
  "text": "transcribed text here",
  "is_final": true/false
}
```

### Fields

- **`text`** (string): The transcribed text
  - For partial results: Contains the current recognition
  - For final results: Contains the complete utterance
  - May be empty string for silence or non-speech

- **`is_final`** (boolean): Indicates if this is the final result
  - `false`: Partial/interim result (user is still speaking)
  - `true`: Final result (end of utterance detected)

## Message Flow Example

1. **User starts speaking:**
```json
{"text": "hello", "is_final": false}
{"text": "hello how", "is_final": false}
{"text": "hello how are", "is_final": false}
{"text": "hello how are you", "is_final": false}
```

2. **User stops speaking (EOT detected):**
```json
{"text": "hello how are you", "is_final": true}
```

3. **Backend processes final transcription:**
   - Sends to UI
   - Triggers LLM processing
   - Generates TTS response

## Implementation in Vocalis

### Backend (`backend/routes/websocket.py`)

```python
async def _listen_to_asr(self, client_ws: WebSocket):
    """
    Listens for transcription results from the sherpa-asr service.
    """
    try:
        async for msg in self.asr_websocket:
            if msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)
                text = data.get("text", "")
                is_final = data.get("is_final", False)

                if not text.strip():
                    continue  # Ignore empty messages

                if is_final:
                    logger.info(f"ASR Final: {text}")
                    # Send final transcription to UI
                    await client_ws.send_json({
                        "type": MessageType.TRANSCRIPTION,
                        "text": text,
                        "metadata": {"is_partial": False}
                    })
                    # Trigger LLM/TTS processing
                    await self._process_final_text(client_ws, text, {})
                else:
                    # Send partial transcription to UI
                    await client_ws.send_json({
                        "type": MessageType.TRANSCRIPTION,
                        "text": text,
                        "metadata": {"is_partial": True}
                    })
    except Exception as e:
        if not isinstance(e, asyncio.CancelledError):
            logger.error(f"ASR listener error: {e}")
            await self._send_error(client_ws, "ASR service connection error.")
```

## Error Handling

- Empty text messages are ignored
- Connection errors are logged and reported to the client
- The listener task is cancelled on disconnect

## Configuration

The sherpa-asr service is configured in `docker-compose.yml`:

```yaml
sherpa-asr:
  image: ksherpa/sherpa-onnx:latest
  command: >
    sherpa-onnx-online-websocket-server
    --port=5002
    --nn-model=/models/model.onnx
    --tokens=/models/tokens.txt
    --sample-rate=16000
    --feature-dim=80
```

## Sample Rate Handling

- **Frontend:** Captures at 44100 Hz (native microphone rate)
- **Frontend → Backend:** Sends WAV chunks with 44100 Hz header
- **Backend → Sherpa-ASR:** Forwards raw audio (sherpa handles resampling internally)
- **Sherpa-ASR:** Configured for 16000 Hz model (resamples automatically)

## Notes

1. Sherpa-ASR handles its own internal VAD and EOT detection
2. The backend acts as a pure proxy for audio data
3. Partial results allow for responsive UI updates
4. Final results trigger the full LLM → TTS pipeline

---

**Reference:** [sherpa-onnx documentation](https://k2-fsa.github.io/sherpa/onnx/)
