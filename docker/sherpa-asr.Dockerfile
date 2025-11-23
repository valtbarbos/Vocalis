# Dockerfile for Sherpa-ONNX WebSocket Server
FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    wget \
    bzip2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Download and install sherpa-onnx
WORKDIR /opt
RUN wget -q https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.15/sherpa-onnx-v1.12.15-cuda-12.x-cudnn-9.x-linux-x64-gpu.tar.bz2 && \
    tar -xjf sherpa-onnx-v1.12.15-cuda-12.x-cudnn-9.x-linux-x64-gpu.tar.bz2 && \
    rm sherpa-onnx-v1.12.15-cuda-12.x-cudnn-9.x-linux-x64-gpu.tar.bz2 && \
    mv sherpa-onnx-v1.12.15-cuda-12.x-cudnn-9.x-linux-x64-gpu sherpa-onnx

# Add sherpa-onnx to PATH
ENV PATH="/opt/sherpa-onnx/bin:${PATH}"
ENV LD_LIBRARY_PATH="/opt/sherpa-onnx/lib:${LD_LIBRARY_PATH}"

# Create models directory
RUN mkdir -p /models

WORKDIR /opt/sherpa-onnx

# Expose WebSocket port
EXPOSE 5002

# Default command (will be overridden by docker-compose)
CMD ["sherpa-onnx-online-websocket-server", "--help"]
