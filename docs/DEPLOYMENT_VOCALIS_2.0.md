# Vocalis 2.0 Deployment Guide

## Prerequisites

Before deploying Vocalis 2.0 with sherpa-asr, ensure you have:

1. **Docker & Docker Compose** installed
2. **NVIDIA GPU** with drivers installed
3. **nvidia-docker2** runtime installed
4. **Sherpa-ONNX Models** downloaded and available

## Step 1: Prepare Sherpa-ONNX Models

The sherpa-asr service requires ONNX models to be available at `/mnt/LLM/asr/models/`.

### Required Files:
```
/mnt/LLM/asr/models/
└── sherpa-onnx-streaming-zipformer-en-2023-06-26/
    ├── encoder-epoch-99-avg-1-chunk-16-left-128.onnx
    ├── decoder-epoch-99-avg-1-chunk-16-left-128.onnx
    ├── joiner-epoch-99-avg-1-chunk-16-left-128.onnx
    └── tokens.txt
```

### Download Models

You can download pre-trained models from the [sherpa-onnx releases](https://github.com/k2-fsa/sherpa-onnx/releases).

Example models:
- **English:** `sherpa-onnx-streaming-zipformer-en-*`
- **Multilingual:** `sherpa-onnx-streaming-zipformer-multilingual-*`

```bash
# Example: Download English streaming model
cd /mnt/LLM/asr/models/
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2
tar -xjf sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2
```

### Verify Model Structure:
```bash
ls -lh /mnt/LLM/asr/models/sherpa-onnx-streaming-zipformer-en-2023-06-26/
# Should show:
# encoder-epoch-99-avg-1-chunk-16-left-128.onnx
# decoder-epoch-99-avg-1-chunk-16-left-128.onnx
# joiner-epoch-99-avg-1-chunk-16-left-128.onnx
# tokens.txt
```

## Step 2: Update Docker Compose Configuration

The `docker-compose.yml` has already been updated with the sherpa-asr service. Verify the configuration:

```yaml
sherpa-asr:
  image: ksherpa/sherpa-onnx:latest
  container_name: sherpa-asr
  command: >
    sherpa-onnx-online-websocket-server
    --port=5002
    --encoder=/models/sherpa-onnx-streaming-zipformer-en-2023-06-26/encoder-epoch-99-avg-1-chunk-16-left-128.onnx
    --decoder=/models/sherpa-onnx-streaming-zipformer-en-2023-06-26/decoder-epoch-99-avg-1-chunk-16-left-128.onnx
    --joiner=/models/sherpa-onnx-streaming-zipformer-en-2023-06-26/joiner-epoch-99-avg-1-chunk-16-left-128.onnx
    --tokens=/models/sherpa-onnx-streaming-zipformer-en-2023-06-26/tokens.txt
    --decoding-method=greedy_search
    --max-active-paths=4
  volumes:
    - /mnt/LLM/asr/models:/models:ro  # Mount your model directory here
  ports:
    - "5002:5002"
  deploy:
    resources:
      reservations:
        devices:
          - capabilities: ["gpu"]
  runtime: nvidia
  environment:
    - NVIDIA_VISIBLE_DEVICES=all
  networks:
    - vocalis-net
  restart: unless-stopped
```

**Important:** Adjust the `volumes` path if your models are in a different location.

## Step 3: Build and Deploy

### Stop Existing Services
```bash
cd /home/alvertabbaros/Projects/llms-on-premise/asr/Vocalis
docker-compose down
```

### Build New Images
```bash
docker-compose build
```

### Start All Services
```bash
docker-compose up -d
```

### Verify Services are Running
```bash
docker-compose ps
```

You should see all services running:
- `vocalis-backend`
- `vocalis-frontend`
- `llm-server`
- `tts-server`
- `sherpa-asr` ✨ (new)

## Step 4: Verify Sherpa-ASR

### Check Sherpa-ASR Logs
```bash
docker logs sherpa-asr
```

Expected output should show:
```
Loading model...
Model loaded successfully
WebSocket server listening on port 5002
```

### Test Sherpa-ASR Directly (Optional)
```bash
# From inside the container
docker exec -it sherpa-asr bash

# Or test the endpoint
curl -v http://localhost:5002
```

## Step 5: Verify Backend Connection

### Check Backend Logs
```bash
docker logs vocalis-backend
```

When a client connects, you should see:
```
Connected to ASR service.
Client connected. Active connections: 1
```

### Test End-to-End

1. Open browser: `http://localhost:3000`
2. Click the microphone button
3. Speak something
4. You should see:
   - Partial transcriptions appearing in real-time
   - Final transcription when you stop speaking
   - LLM response generated
   - TTS audio played back

## Troubleshooting

### Sherpa-ASR Container Won't Start

**Problem:** Container exits immediately

**Check:**
```bash
docker logs sherpa-asr
```

**Common Issues:**
1. Models not found at `/mnt/LLM/asr/models/`
   - Verify path in `docker-compose.yml` volumes section
   - Ensure the model directory `sherpa-onnx-streaming-zipformer-en-2023-06-26` exists
   - Verify encoder, decoder, joiner ONNX files and tokens.txt are present

2. GPU not available
   - Verify: `nvidia-smi` works on host
   - Check: `docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi`

### Backend Can't Connect to Sherpa-ASR

**Problem:** Backend logs show "Failed to connect to ASR service"

**Check:**
1. Sherpa-ASR is running: `docker ps | grep sherpa-asr`
2. Network connectivity:
   ```bash
   docker exec -it vocalis-backend ping sherpa-asr
   ```
3. WebSocket port is open:
   ```bash
   docker exec -it vocalis-backend nc -zv sherpa-asr 5002
   ```

### No Audio Transcription

**Problem:** Audio is sent but no transcription appears

**Check:**
1. Browser console for WebSocket errors
2. Backend logs: `docker logs -f vocalis-backend`
3. Sherpa-ASR logs: `docker logs -f sherpa-asr`
4. Network tab in browser DevTools (should show `audio` messages being sent)

### Poor Transcription Quality

**Possible Causes:**
1. **Wrong Model:** Ensure you're using a streaming model, not an offline model
2. **Sample Rate Mismatch:** Verify `--sample-rate=16000` matches your model
3. **Feature Dimension:** Verify `--feature-dim=80` matches your model
4. **Model Quality:** Try a larger model for better accuracy

**Recommended Models:**
- Good: `sherpa-onnx-streaming-zipformer-en-2023-06-26`
- Better: `sherpa-onnx-streaming-zipformer-en-2023-06-21`
- Best: `sherpa-onnx-streaming-zipformer-en-2024-03-18`

## Performance Tuning

### Adjust Sherpa-ASR Parameters

Edit `docker-compose.yml` and modify the sherpa-asr command:

```yaml
command: >
  sherpa-onnx-online-websocket-server
  --port=5002
  --encoder=/models/sherpa-onnx-streaming-zipformer-en-2023-06-26/encoder-epoch-99-avg-1-chunk-16-left-128.onnx
  --decoder=/models/sherpa-onnx-streaming-zipformer-en-2023-06-26/decoder-epoch-99-avg-1-chunk-16-left-128.onnx
  --joiner=/models/sherpa-onnx-streaming-zipformer-en-2023-06-26/joiner-epoch-99-avg-1-chunk-16-left-128.onnx
  --tokens=/models/sherpa-onnx-streaming-zipformer-en-2023-06-26/tokens.txt
  --decoding-method=greedy_search      # Or 'modified_beam_search'
  --max-active-paths=4                 # Number of active paths for beam search
  --max-active-connections=10          # Limit concurrent connections
  --num-threads=4                      # CPU threads for decoding
```

### Monitor GPU Usage

```bash
# Real-time monitoring
watch -n 1 nvidia-smi

# In Docker container
docker exec -it sherpa-asr nvidia-smi
```

## Rollback to Vocalis 1.0 (Whisper)

If you need to rollback:

1. Edit `docker-compose.yml`:
   - Remove the `sherpa-asr` service
   - In `vocalis-backend`:
     - Remove `ASR_API_ENDPOINT`
     - Add back `WHISPER_MODEL: tiny.en`
     - Remove `sherpa-asr` from `depends_on`

2. Restore old code:
   ```bash
   git checkout HEAD~1 backend/
   git checkout HEAD~1 frontend/src/services/audio.ts
   ```

3. Rebuild and restart:
   ```bash
   docker-compose down
   docker-compose build
   docker-compose up -d
   ```

## Monitoring and Logs

### View All Logs
```bash
docker-compose logs -f
```

### View Specific Service
```bash
docker-compose logs -f sherpa-asr
docker-compose logs -f vocalis-backend
```

### Check Resource Usage
```bash
docker stats
```

## Next Steps

Once deployed successfully:

1. Test with various accents and speaking styles
2. Monitor transcription accuracy
3. Adjust model if needed (larger model = better accuracy)
4. Configure nginx for production deployment
5. Set up SSL/TLS certificates
6. Implement rate limiting

## Support

For issues specific to:
- **Sherpa-ONNX:** https://github.com/k2-fsa/sherpa-onnx/issues
- **Vocalis Architecture:** See `VOCALIS_2.0_IMPLEMENTATION.md`
- **Message Format:** See `docs/SHERPA_ASR_MESSAGE_FORMAT.md`

---

**Last Updated:** November 7, 2025  
**Architecture Version:** Vocalis 2.0
