# Vocalis Docker Setup Guide

This guide covers running Vocalis with Docker, including GPU-accelerated LLM and TTS services.

## Architecture

The Docker setup consists of four services:

1. **vocalis-backend** (FastAPI) - Handles WebSocket connections, Whisper ASR, and orchestrates LLM/TTS
2. **vocalis-frontend** (React/Nginx) - Serves the UI and proxies WebSocket/API requests
3. **llm-server** (llama.cpp) - GPU-accelerated language model inference
4. **tts-server** (Kokoro-FastAPI) - GPU-accelerated text-to-speech synthesis with 67 voice packs

All services communicate over a Docker network (`vocalis-net`).

## Prerequisites

### 1. NVIDIA GPU Support

Ensure NVIDIA Container Toolkit is installed:

```bash
# Arch Linux
sudo pacman -S nvidia-container-toolkit

# Configure Docker runtime
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### 2. Verify GPU Access

Test GPU visibility in Docker:

```bash
docker run --rm --gpus all nvidia/cuda:12.6.2-base-ubuntu22.04 nvidia-smi
```

You should see your RTX 4090 listed.

### 3. Model Files

Ensure your models are available at `/mnt/LLM/`:

```
/mnt/LLM/
├── gguf/
│   └── blobs/
│       └── sha256-6a0746a1ec1aef3e7ec53868f220ff6e389f6f8ef87a01d77c96807de94ca2aa
│           (Llama 3.1 8B Instruct Q5_K_M)
└── cache/
    └── (Hugging Face model cache, including Kokoro TTS)
```

## Quick Start

### 1. Build the Images

```bash
cd /home/alvertabbaros/Projects/llms-on-premise/asr/Vocalis
docker compose build
```

### 2. Start All Services

```bash
docker compose up -d
```

### 3. Verify Services

Check that all containers are running:

```bash
docker compose ps
```

Expected output:
```
NAME                IMAGE                                         STATUS
vocalis-backend     vocalis-vocalis-backend                       Up
vocalis-frontend    vocalis-vocalis-frontend                      Up
llm-server          ghcr.io/ggerganov/llama.cpp:server-cuda       Up
tts-server          ghcr.io/remsky/kokoro-fastapi-gpu:v0.2.4     Up
```

### 4. Access Vocalis

- **Frontend UI**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **LLM Server**: http://localhost:8080
- **TTS Server**: http://localhost:8880

### 5. Test GPU Usage

Verify GPU is being used by the services:

```bash
# Check LLM server
docker exec -it llm-server nvidia-smi

# Check TTS server
docker exec -it tts-server nvidia-smi
```

## Configuration

### Environment Variables

The main configuration is in `docker-compose.yml`. You can override values using a `.env` file:

```bash
cp .env.docker .env
# Edit .env with your preferences
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_API_ENDPOINT` | `http://llm-server:8080/v1/chat/completions` | LLM service URL |
| `TTS_API_ENDPOINT` | `http://tts-server:8880/v1/audio/speech` | TTS service URL |
| `TTS_VOICE` | `af_sky` | TTS voice (see Available Voices below) |
| `WHISPER_MODEL` | `tiny.en` | Whisper model size |
| `WEBSOCKET_PORT` | `8000` | Backend WebSocket port |

### Model Selection

#### Whisper Models

Edit `docker-compose.yml` to change the Whisper model:

```yaml
environment:
  WHISPER_MODEL: base.en  # Options: tiny.en, base.en, small.en, medium.en, large-v2, large-v3
```

**Trade-off**: Larger models are more accurate but slower. For real-time conversation, `tiny.en` or `base.en` are recommended.

#### LLM Model

Update the model path in `docker-compose.yml`:

```yaml
llm-server:
  command: >
    --model /models/blobs/YOUR-MODEL-BLOB-HASH
    --host 0.0.0.0
    --port 8080
    --ctx-size 4096
    --n-gpu-layers 33
  volumes:
    - /mnt/LLM/gguf:/models:ro
```

**Note**: If using LMStudio's blob-based storage, use the full blob hash path instead of symlinks.

#### TTS Voice

Kokoro-FastAPI supports 67 voices across multiple languages. Edit `docker-compose.yml` to change the voice:

```yaml
environment:
  TTS_VOICE: af_sky  # Change to any available voice
```

**Available Voices**:
- **American Female (af_)**: `af_alloy`, `af_aoede`, `af_bella`, `af_heart`, `af_jadzia`, `af_jessica`, `af_kore`, `af_nicole`, `af_nova`, `af_river`, `af_sarah`, `af_sky`, `af_v0`, `af_v0bella`, `af_v0irulan`, `af_v0nicole`, `af_v0sarah`, `af_v0sky`
- **American Male (am_)**: `am_adam`, `am_echo`, `am_eric`, `am_fenrir`, `am_liam`, `am_michael`, `am_onyx`, `am_puck`, `am_santa`, `am_v0adam`, `am_v0gurney`, `am_v0michael`
- **British Female (bf_)**: `bf_alice`, `bf_emma`, `bf_lily`, `bf_v0emma`, `bf_v0isabella`
- **British Male (bm_)**: `bm_daniel`, `bm_fable`, `bm_george`, `bm_lewis`, `bm_v0george`, `bm_v0lewis`
- **Other Languages**: Spanish (ef_, em_), French (ff_), Hindi (hf_, hm_), Italian (if_, im_), Japanese (jf_, jm_), Portuguese (pf_, pm_), Chinese (zf_, zm_)

Popular choices:
- `af_sky` - Clear American female voice
- `af_nova` - Warm American female voice
- `am_adam` - Deep American male voice
- `bf_emma` - British female voice

### Port Mapping

If ports 3000, 8000, 8080, or 8880 are in use, modify the port mappings in `docker-compose.yml`:

```yaml
services:
  vocalis-frontend:
    ports:
      - "3001:80"  # Change 3000 to 3001 (or any free port)
  
  tts-server:
    ports:
      - "8881:8880"  # Change 8880 to 8881 (or any free port)
```

**Important**: If you change the TTS server port, also update `TTS_API_ENDPOINT` in the backend environment to match.

## Troubleshooting

### Backend Can't Connect to LLM/TTS

Check service names resolve correctly:

```bash
docker exec vocalis-backend ping llm-server
docker exec vocalis-backend ping tts-server
```

### GPU Not Available

1. Verify NVIDIA drivers are installed:
   ```bash
   nvidia-smi
   ```

2. Check Docker daemon configuration (`/etc/docker/daemon.json`):
   ```json
   {
     "default-runtime": "nvidia",
     "runtimes": {
       "nvidia": {
         "path": "nvidia-container-runtime",
         "runtimeArgs": []
       }
     }
   }
   ```

3. Restart Docker:
   ```bash
   sudo systemctl restart docker
   ```

### WebSocket Connection Failed

If the frontend can't connect to the backend WebSocket:

1. Check backend logs:
   ```bash
   docker logs vocalis-backend
   ```

2. Verify nginx proxy config is correct in `docker/nginx.conf`

3. Test WebSocket directly:
   ```bash
   curl --include \
        --no-buffer \
        --header "Connection: Upgrade" \
        --header "Upgrade: websocket" \
        --header "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
        --header "Sec-WebSocket-Version: 13" \
        http://localhost:8000/ws
   ```

### High VRAM Usage

If you encounter VRAM issues on the 4090:

1. Reduce LLM context size:
   ```yaml
   llm-server:
     command: >
       --ctx-size 2048  # Reduce from 4096
   ```

2. Reduce GPU layers:
   ```yaml
   --n-gpu-layers 24  # Reduce from 33
   ```

3. Use a smaller quantized model (e.g., Q4_0 instead of Q5_K_M)

## Development Mode

For development with hot-reload:

### Backend Dev

```bash
# Run backend with volume mount for live code changes
docker run --rm -it \
  --network vocalis_vocalis-net \
  -v $(pwd)/backend:/app/backend \
  -p 8000:8000 \
  -e LLM_API_ENDPOINT=http://llm-server:8080/v1/chat/completions \
  -e TTS_API_ENDPOINT=http://tts-server:8880/v1/audio/speech \
  -e TTS_VOICE=af_sky \
  vocalis-vocalis-backend \
  python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Dev

```bash
# Run frontend dev server locally (not containerized)
cd frontend
npm install
npm run dev
```

The Vite dev server will proxy to the containerized backend.

## Production Considerations

### 1. Reverse Proxy

In production, put nginx/Caddy in front of the stack:

```nginx
# /etc/nginx/sites-available/vocalis
server {
    listen 443 ssl http2;
    server_name vocalis.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 2. Resource Limits

Add resource constraints to prevent runaway containers:

```yaml
services:
  vocalis-backend:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G
```

### 3. Health Checks

Add health checks for automatic recovery:

```yaml
services:
  vocalis-backend:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### 4. Logging

Configure log rotation:

```yaml
services:
  vocalis-backend:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## Stopping Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (clears Whisper cache)
docker compose down -v
```

## Updating

To update to the latest images:

```bash
# Rebuild custom images
docker compose build --no-cache

# Pull latest base images
docker compose pull

# Restart
docker compose up -d
```

## Advanced: Multi-Container ASR

If you want to use Sherpa-ONNX instead of Faster-Whisper, add this service:

```yaml
services:
  sherpa-asr:
    image: ksherpa/sherpa-onnx:latest
    container_name: sherpa-asr
    command: >
      sherpa-onnx-online-websocket-server
      --port=5002
      --nn-model=/models/model.onnx
      --tokens=/models/tokens.txt
      --sample-rate=16000
      --feature-dim=80
    volumes:
      - /mnt/LLM/asr/models:/models:ro
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
```

Then update the backend to use the external ASR service instead of built-in Whisper.

## Support

For issues specific to:
- **Vocalis application**: Check the main [README.md](../README.md)
- **Docker setup**: Open an issue with logs from `docker compose logs`
- **GPU/CUDA issues**: Verify with `nvidia-smi` and check NVIDIA Container Toolkit docs

---

**Note**: This Docker setup is optimized for Arch Linux + RTX 4090 + `/mnt/LLM` model storage. Adjust paths and configurations as needed for your environment.
