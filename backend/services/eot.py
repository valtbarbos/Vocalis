"""
End-of-Turn (EOT) Client

This module provides a client for communicating with the EOT microservice,
which uses the pipecat-ai/smart-turn model to detect conversational turn endings.
"""

import logging
import asyncio
from typing import Tuple

import aiohttp

logger = logging.getLogger(__name__)


class EOTClient:
    """
    Client for the End-of-Turn detection service.
    
    This client sends audio data to the EOT microservice and receives
    predictions about whether the user has finished their conversational turn.
    """
    
    def __init__(
        self,
        api_endpoint: str,
        threshold: float = 0.5,
        enabled: bool = True,
        timeout: float = 5.0
    ):
        """
        Initialize the EOT client.
        
        Args:
            api_endpoint: URL of the EOT prediction endpoint
            threshold: Threshold for EOT decision (0.0 to 1.0)
            enabled: Whether EOT detection is enabled
            timeout: Request timeout in seconds
        """
        self.api_endpoint = api_endpoint
        self.threshold = threshold
        self.enabled = enabled
        self.timeout = timeout
        
        logger.info(f"EOTClient initialized: endpoint={api_endpoint}, threshold={threshold}, enabled={enabled}")
    
    async def is_eot(self, audio_data: bytes) -> Tuple[float, bool]:
        """
        Check if the audio represents an end-of-turn.
        
        Args:
            audio_data: Raw audio bytes in WAV format
            
        Returns:
            Tuple of (eot_probability, is_eot_decision)
            - eot_probability: Float between 0.0 and 1.0
            - is_eot_decision: Boolean decision based on threshold
        """
        # If EOT is disabled, always return True (allow turn to proceed)
        if not self.enabled:
            logger.debug("EOT disabled, defaulting to is_eot=True")
            return 1.0, True
        
        try:
            # Send audio to EOT service
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.api_endpoint,
                    data=audio_data,
                    headers={'Content-Type': 'application/octet-stream'},
                    timeout=aiohttp.ClientTimeout(total=self.timeout)
                ) as response:
                    if response.status != 200:
                        logger.error(f"EOT service error: HTTP {response.status}")
                        # Fail-safe: allow turn to proceed
                        return 1.0, True
                    
                    data = await response.json()
                    eot_prob = data.get("eot_prob", 0.0)
                    is_eot = data.get("is_eot", False)
                    
                    logger.debug(f"EOT prediction: prob={eot_prob:.3f}, is_eot={is_eot}")
                    
                    return eot_prob, is_eot
        
        except asyncio.TimeoutError:
            logger.error(f"EOT service timeout after {self.timeout}s")
            # Fail-safe: allow turn to proceed
            return 1.0, True
        
        except aiohttp.ClientError as e:
            logger.error(f"EOT service connection error: {e}")
            # Fail-safe: allow turn to proceed
            return 1.0, True
        
        except Exception as e:
            logger.error(f"Unexpected error in EOT client: {e}", exc_info=True)
            # Fail-safe: allow turn to proceed
            return 1.0, True
