FROM python:3.11-slim AS base

# System deps (ffmpeg for audio processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Create app dir
WORKDIR /app

# Copy backend code as a package
COPY backend/ /app/backend/

# Install Python deps
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Environment variables (will be overridden by compose)
ENV LLM_API_ENDPOINT=http://llm-server:8080/v1/chat/completions \
    TTS_API_ENDPOINT=http://tts-server:9000/v1/audio/speech \
    WHISPER_MODEL=tiny.en \
    WEBSOCKET_HOST=0.0.0.0 \
    WEBSOCKET_PORT=8000 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

# Run the backend with uvicorn as a module
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
