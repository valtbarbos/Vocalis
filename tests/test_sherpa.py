import asyncio
import websockets
import json
import wave
import sys
import math
import struct
import os
import requests
import subprocess

def generate_tts_audio(filename, text="Hello, this is a test of the Sherpa speech recognition system."):
    """Generates audio using the local TTS server and converts it to 16kHz WAV."""
    tts_url = "http://localhost:8880/v1/audio/speech"
    raw_audio_file = "tts_raw.wav"
    
    print(f"Generating TTS audio for: '{text}'")
    
    try:
        # 1. Request Audio from TTS Server
        payload = {
            "model": "kokoro", # Or whatever model name the server expects, usually ignored by some servers or specific
            "input": text,
            "voice": "af_sky", # Default voice from docker-compose
            "response_format": "wav"
        }
        response = requests.post(tts_url, json=payload, stream=True)
        
        if response.status_code != 200:
            print(f"TTS Server returned error: {response.status_code} - {response.text}")
            return False
            
        with open(raw_audio_file, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                
        # 2. Convert to 16kHz mono using ffmpeg
        print(f"Converting TTS output to 16kHz WAV: {filename}")
        subprocess.run([
            "ffmpeg", "-y", "-i", raw_audio_file,
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            filename
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        # Cleanup
        if os.path.exists(raw_audio_file):
            os.remove(raw_audio_file)
            
        return True
        
    except requests.exceptions.ConnectionError:
        print("Could not connect to TTS server at http://localhost:8880. Is it running?")
        return False
    except subprocess.CalledProcessError:
        print("Error running ffmpeg. Is it installed?")
        return False
    except Exception as e:
        print(f"Error generating TTS audio: {e}")
        return False

def create_test_wav(filename):
    """Generates a 3-second sine wave audio file at 16kHz (Fallback)."""
    print(f"Creating dummy 16kHz WAV file (Sine Wave): {filename}")
    sample_rate = 16000
    duration = 3.0 # seconds
    frequency = 440.0 # Hz
    
    with wave.open(filename, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2) # 16-bit
        wf.setframerate(sample_rate)
        
        # Generate a sine wave
        for i in range(int(duration * sample_rate)):
            value = int(32767.0 * 0.5 * math.sin(2.0 * math.pi * frequency * i / sample_rate))
            data = struct.pack('<h', value)
            wf.writeframes(data)

async def test_sherpa(uri, wav_file):
    # Generate file if it doesn't exist
    if not os.path.exists(wav_file):
        # Try to generate real speech first
        if not generate_tts_audio(wav_file):
            # Fallback to sine wave if TTS fails
            print("Falling back to sine wave generation...")
            create_test_wav(wav_file)

    print(f"Sending {wav_file} to {uri}...")
    
    try:
        async with websockets.connect(uri) as websocket:
            print(f"Connected to {uri}")
            
            with wave.open(wav_file, "rb") as wf:
                if wf.getframerate() != 16000:
                    print(f"Error: WAV file must be 16kHz. Current: {wf.getframerate()}")
                    return
                
                buffer_size = 4096 # Send larger chunks (approx 0.25s)
                data = wf.readframes(buffer_size)
                
                while len(data) > 0:
                    # Convert int16 to float32
                    # Sherpa-onnx often expects float32 samples (4 bytes)
                    count = len(data) // 2
                    shorts = struct.unpack(f"<{count}h", data)
                    floats = [s / 32768.0 for s in shorts]
                    float_bytes = struct.pack(f"<{count}f", *floats)
                    
                    await websocket.send(float_bytes)
                    
                    # Simulate real-time streaming (approximate)
                    # 4096 samples / 16000 Hz = 0.256 seconds
                    await asyncio.sleep(0.25) 
                    
                    try:
                        # Check for partial results without blocking too long
                        result = await asyncio.wait_for(websocket.recv(), timeout=0.01)
                        response = json.loads(result)
                        if response.get("text"):
                            print(f"Partial: {response['text']}")
                        else:
                            print(".", end="", flush=True)
                    except asyncio.TimeoutError:
                        print(".", end="", flush=True)
                    
                    data = wf.readframes(buffer_size)
                
                print("\nSending 'Done'...")
                # Signal end of stream
                await websocket.send("Done")
                
                # Wait for final result
                result = await websocket.recv()
                print(f"\nFinal Result Raw: {result}")
                
    except ConnectionRefusedError:
        print(f"Error: Could not connect to {uri}.")
        print("Make sure the 'sherpa-asr' container is running and port 5002 is mapped.")
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    # Default to localhost for testing from host machine
    uri = "ws://localhost:5002"
    
    # Get the directory where the script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    wav_file = os.path.join(script_dir, "test_audio.wav")
    
    # Allow overriding via arguments
    if len(sys.argv) > 1:
        wav_file = sys.argv[1]
        
    asyncio.run(test_sherpa(uri, wav_file))
