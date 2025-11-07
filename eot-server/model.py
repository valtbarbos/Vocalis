import io
import os
import logging
from pathlib import Path
from typing import Tuple

import numpy as np
import librosa
import onnxruntime as ort
import aiohttp

logger = logging.getLogger(__name__)


class EOTAudioModel:
    """
    End-of-Turn detection model using the pipecat-ai/smart-turn-v3 ONNX model.
    This model runs on CPU and predicts whether a user has finished their conversational turn.
    """
    
    MODEL_URL = "https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.0.onnx"
    MODEL_FILENAME = "smart-turn-v3.0.onnx"
    TARGET_SAMPLE_RATE = 16000  # Required by pipecat model
    
    def __init__(self, model_dir: str = "."):
        """
        Initialize the EOT model.
        
        Args:
            model_dir: Directory where the model file is stored
        """
        self.model_dir = Path(model_dir)
        self.model_path = self.model_dir / self.MODEL_FILENAME
        self.session = None
        
    async def load(self):
        """
        Load the ONNX model. Downloads it from HuggingFace if not present locally.
        """
        # Download model if not present
        if not self.model_path.exists():
            logger.info(f"Model not found at {self.model_path}, downloading from HuggingFace...")
            await self._download_model()
        else:
            logger.info(f"Model found at {self.model_path}")
        
        # Load the ONNX model with CPU execution
        logger.info("Loading ONNX model with CPU execution provider...")
        self.session = ort.InferenceSession(
            str(self.model_path),
            providers=['CPUExecutionProvider']
        )
        logger.info("ONNX model loaded successfully")
        
    async def _download_model(self):
        """
        Download the model from HuggingFace.
        """
        self.model_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Downloading model from {self.MODEL_URL}...")
        async with aiohttp.ClientSession() as session:
            async with session.get(self.MODEL_URL) as response:
                if response.status != 200:
                    raise RuntimeError(f"Failed to download model: HTTP {response.status}")
                
                # Download in chunks
                with open(self.model_path, 'wb') as f:
                    async for chunk in response.content.iter_chunked(8192):
                        f.write(chunk)
        
        logger.info(f"Model downloaded successfully to {self.model_path}")
    
    def _preprocess_audio(self, audio_bytes: bytes) -> np.ndarray:
        """
        Preprocess audio bytes to the format required by the model.
        
        Args:
            audio_bytes: Raw audio data in WAV format
            
        Returns:
            Preprocessed audio array resampled to 16kHz
        """
        # Load audio from bytes
        audio_io = io.BytesIO(audio_bytes)
        audio, sr = librosa.load(audio_io, sr=None)
        
        # Resample to 16kHz if necessary
        if sr != self.TARGET_SAMPLE_RATE:
            logger.debug(f"Resampling audio from {sr}Hz to {self.TARGET_SAMPLE_RATE}Hz")
            audio = librosa.resample(audio, orig_sr=sr, target_sr=self.TARGET_SAMPLE_RATE)
        
        return audio
    
    def predict(self, audio_bytes: bytes) -> float:
        """
        Predict the probability of End-of-Turn.
        
        Args:
            audio_bytes: Raw audio data in WAV format
            
        Returns:
            Probability that the user has finished their turn (0.0 to 1.0)
        """
        if self.session is None:
            raise RuntimeError("Model not loaded. Call load() first.")
        
        # Preprocess audio
        audio = self._preprocess_audio(audio_bytes)
        
        # Prepare input for ONNX model
        # The model expects a batch dimension
        audio_input = audio.astype(np.float32).reshape(1, -1)
        
        # Run inference
        input_name = self.session.get_inputs()[0].name
        output_name = self.session.get_outputs()[0].name
        
        result = self.session.run([output_name], {input_name: audio_input})
        
        # The pipecat model outputs the probability of CONTINUATION
        # So we need to invert it to get the probability of EOT
        prob_continue = float(result[0][0])
        prob_eot = 1.0 - prob_continue
        
        logger.debug(f"Model prediction: prob_continue={prob_continue:.3f}, prob_eot={prob_eot:.3f}")
        
        return prob_eot
