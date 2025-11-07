import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from model import EOTAudioModel

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global model instance
eot_model: EOTAudioModel = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for FastAPI app.
    Handles startup and shutdown events.
    """
    global eot_model
    
    # Startup
    logger.info("Starting EOT server...")
    eot_model = EOTAudioModel(model_dir=".")
    await eot_model.load()
    logger.info("EOT server ready")
    
    yield
    
    # Shutdown
    logger.info("Shutting down EOT server...")


# Create FastAPI app
app = FastAPI(
    title="EOT Server",
    description="End-of-Turn detection service using pipecat-ai/smart-turn-v3",
    version="1.0.0",
    lifespan=lifespan
)


@app.get("/health")
async def health_check():
    """
    Health check endpoint.
    """
    return {
        "status": "healthy",
        "service": "eot-server",
        "model": "pipecat-ai/smart-turn-v3",
        "timestamp": datetime.now().isoformat()
    }


@app.post("/predict")
async def predict_eot(request: Request):
    """
    Predict End-of-Turn from audio data.
    
    Expects:
        - Content-Type: application/octet-stream
        - Body: Raw audio bytes (WAV format)
    
    Returns:
        JSON with:
        - eot_prob: Probability of End-of-Turn (0.0 to 1.0)
        - is_eot: Boolean decision based on threshold
        - meta: Additional metadata
    """
    try:
        # Read raw audio bytes
        audio_bytes = await request.body()
        
        if not audio_bytes:
            return JSONResponse(
                status_code=400,
                content={"error": "No audio data received"}
            )
        
        # Get threshold from environment or use default
        threshold = float(os.getenv("EOT_THRESHOLD", "0.5"))
        
        # Run prediction
        eot_prob = eot_model.predict(audio_bytes)
        is_eot = eot_prob >= threshold
        
        logger.info(f"Prediction: eot_prob={eot_prob:.3f}, is_eot={is_eot}, threshold={threshold}")
        
        return {
            "eot_prob": eot_prob,
            "is_eot": is_eot,
            "meta": {
                "threshold": threshold,
                "audio_size_bytes": len(audio_bytes),
                "model": "smart-turn-v3",
                "timestamp": datetime.now().isoformat()
            }
        }
        
    except Exception as e:
        logger.error(f"Error processing prediction: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
        )


if __name__ == "__main__":
    import uvicorn
    
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8500"))
    
    uvicorn.run(app, host=host, port=port)
