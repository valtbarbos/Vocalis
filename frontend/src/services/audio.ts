/**
 * Audio Service
 *
 * Handles audio recording, processing, and playback
 */

import websocketService, {WebSocketService} from './websocket';

// Audio configuration
interface AudioConfig {
  sampleRate: number;
  channelCount: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  bufferSize: number;
}

// Default audio configuration
const DEFAULT_CONFIG: AudioConfig = {
  sampleRate: 16000, // Match sherpa-asr expected sample rate
  channelCount: 1, // Mono
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  bufferSize: 4096
};

// Audio service state
export enum AudioState {
  INACTIVE = 'inactive',
  RECORDING = 'recording',
  PLAYING = 'playing',
  SPEAKING = 'speaking',     // Playing TTS content specifically
  INTERRUPTED = 'interrupted'
}

// Audio service events
export enum AudioEvent {
  RECORDING_START = 'recording_start',
  RECORDING_STOP = 'recording_stop',
  RECORDING_DATA = 'recording_data',
  PLAYBACK_START = 'playback_start',
  PLAYBACK_STOP = 'playback_stop',
  PLAYBACK_END = 'playback_end',
  AUDIO_ERROR = 'audio_error',
  AUDIO_STATE_CHANGE = 'audio_state_change'
}

// Event listener interface
type AudioEventListener = (data: any) => void;

/**
 * Audio Service class
 */
export class AudioService {
  private config: AudioConfig;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private audioState: AudioState = AudioState.INACTIVE;
  private eventListeners: Map<AudioEvent, AudioEventListener[]> = new Map();
  private audioQueue: AudioBuffer[] = [];
  private isPlaying: boolean = false;
  private isSpeaking: boolean = false; // Distinct from isPlaying to track TTS specifically
  private isMuted: boolean = false; // Track microphone mute state
  private currentSource: AudioBufferSourceNode | null = null;

  constructor(config: Partial<AudioConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set processing state from UI (deprecated in Vocalis 2.0)
   * These methods are kept for API compatibility but are no longer used
   * since all processing state is now managed by the backend.
   */
  public setProcessingState(_isProcessing: boolean): void {
    // No-op: Processing state no longer affects frontend audio handling
  }
  
  /**
   * Set greeting state from UI (deprecated in Vocalis 2.0)
   */
  public setGreetingState(_isGreeting: boolean): void {
    // No-op: Greeting state no longer affects frontend audio handling
  }
  
  /**
   * Set vision processing state from UI (deprecated in Vocalis 2.0)
   */
  public setVisionProcessingState(_isVisionProcessing: boolean): void {
    // No-op: Vision processing state no longer affects frontend audio handling
  }
  

  /**
   * Initialize the audio context
   */
  private async initAudioContext(): Promise<void> {
    // If context is null, create a new one
    if (!this.audioContext) {
      console.log('Creating new AudioContext');
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: this.config.sampleRate
        });
      } catch (error) {
        console.error('Failed to create AudioContext', error);
        this.dispatchEvent(AudioEvent.AUDIO_ERROR, { error });
        throw error;
      }
    }
    
    // Always make sure context is running
    if (this.audioContext.state === 'suspended') {
      console.log('Resuming suspended AudioContext');
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.error('Failed to resume AudioContext', error);
        // If resume fails, try creating a new context
        this.audioContext = null;
        return this.initAudioContext();
      }
    } else if (this.audioContext.state === 'closed') {
      console.log('AudioContext was closed, creating new one');
      this.audioContext = null;
      return this.initAudioContext();
    }
    
    console.log(`AudioContext initialized, state: ${this.audioContext.state}`);
  }

  /**
   * Start recording audio
   */
  public async startRecording(): Promise<void> {
    if (this.audioState === AudioState.RECORDING) {
      console.log('Already recording');
      return;
    }

    try {
      await this.initAudioContext();
      
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channelCount,
          echoCancellation: this.config.echoCancellation,
          noiseSuppression: this.config.noiseSuppression,
          autoGainControl: this.config.autoGainControl
        }
      });
      
      // Apply mute state if already set
      if (this.isMuted && this.mediaStream) {
        this.mediaStream.getAudioTracks().forEach(track => {
          track.enabled = !this.isMuted;
        });
      }
      
      // Create media stream source
      if (this.audioContext) {
        this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.mediaStream);
        
        // Create script processor for recording
        this.scriptProcessor = this.audioContext.createScriptProcessor(
          this.config.bufferSize,
          this.config.channelCount,
          this.config.channelCount
        );
        
        // Connect nodes
        this.mediaStreamSource.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.audioContext.destination);
        
        // Handle audio processing
        this.scriptProcessor.onaudioprocess = this.handleAudioProcess.bind(this);
        
        // Set state
        this.audioState = AudioState.RECORDING;
        
        // Dispatch event
        this.dispatchEvent(AudioEvent.RECORDING_START, {});
        
        console.log('Recording started - streaming all audio to sherpa-asr');
      }
    } catch (error) {
      console.error('Error starting recording:', error);
      this.dispatchEvent(AudioEvent.AUDIO_ERROR, { error });
      this.stopRecording();
      throw error;
    }
  }

  /**
   * Stop recording audio
   */
  public stopRecording(): void {
    if (this.audioState !== AudioState.RECORDING) {
      return;
    }

    // Stop and clean up recorder
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Reset state
    this.audioState = AudioState.INACTIVE;

    // Dispatch event
    this.dispatchEvent(AudioEvent.RECORDING_STOP, {});
    
    console.log('Recording stopped');
  }

  /**
   * Handle audio processing - streams all audio to backend (including silence)
   * Sherpa-asr handles its own VAD and end-of-turn detection
   */
  private handleAudioProcess(event: AudioProcessingEvent): void {
    const inputData = event.inputBuffer.getChannelData(0);
    const bufferCopy = new Float32Array(inputData);

    // Convert to WAV and send immediately
    const wavBuffer = this.float32ToWav(bufferCopy, this.config.sampleRate);
    websocketService.sendAudio(wavBuffer);

    // Calculate energy for UI visualization
    let sum = 0;
    for (let i = 0; i < bufferCopy.length; i++) {
      sum += bufferCopy[i] * bufferCopy[i];
    }
    const energy = Math.sqrt(sum / bufferCopy.length);
    
    // Dispatch event for visualization
    this.dispatchEvent(AudioEvent.RECORDING_DATA, { 
      buffer: bufferCopy, 
      energy: energy, 
      isVoice: true // Always true since sherpa-asr does its own VAD
    });
  }

  /**
   * Convert Float32Array audio data to WAV format
   */
  private float32ToWav(buffer: Float32Array, sampleRate: number): ArrayBuffer {
    // Create buffer with WAV header
    const numChannels = 1; // Mono
    const bytesPerSample = 2; // 16-bit PCM
    const dataSize = buffer.length * bytesPerSample;
    const headerSize = 44; // Standard WAV header size
    const totalSize = headerSize + dataSize;
    
    // Create the WAV buffer
    const wavBuffer = new ArrayBuffer(totalSize);
    const wavView = new DataView(wavBuffer);
    
    // Write WAV header
    // "RIFF" chunk descriptor
    this.writeString(wavView, 0, 'RIFF');
    wavView.setUint32(4, totalSize - 8, true); // File size - 8
    this.writeString(wavView, 8, 'WAVE');
    
    // "fmt " sub-chunk
    this.writeString(wavView, 12, 'fmt ');
    wavView.setUint32(16, 16, true); // Sub-chunk size (16 for PCM)
    wavView.setUint16(20, 1, true); // Audio format (1 for PCM)
    wavView.setUint16(22, numChannels, true); // Number of channels
    wavView.setUint32(24, sampleRate, true); // Sample rate
    wavView.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // Byte rate
    wavView.setUint16(32, numChannels * bytesPerSample, true); // Block align
    wavView.setUint16(34, bytesPerSample * 8, true); // Bits per sample
    
    // "data" sub-chunk
    this.writeString(wavView, 36, 'data');
    wavView.setUint32(40, dataSize, true); // Sub-chunk size
    
    // Write audio data
    // Convert from Float32 [-1.0,1.0] to Int16 [-32768,32767]
    const offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      // Clamp the value to [-1.0, 1.0]
      const sample = Math.max(-1.0, Math.min(1.0, buffer[i]));
      // Convert to Int16
      const val = sample < 0 ? sample * 32768 : sample * 32767;
      wavView.setInt16(offset + i * bytesPerSample, val, true);
    }
    
    return wavBuffer;
  }
  
  /**
   * Helper function to write a string to a DataView
   */
  private writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Play audio from base64-encoded data
   * 
   * The backend now sends complete audio files instead of chunks,
   * so we just need to decode and play the entire file at once.
   * 
   * This method is specifically for playing TTS content and will
   * set the state to SPEAKING rather than just PLAYING.
   */
  public async playAudioChunk(base64AudioChunk: string): Promise<void> {
    try {
      await this.initAudioContext();
      
      if (!this.audioContext) {
        throw new Error('AudioContext not initialized');
      }
      
      // Convert base64 to ArrayBuffer
      const audioData = WebSocketService.base64ToArrayBuffer(base64AudioChunk);
      
      console.log(`Received complete audio file (${audioData.byteLength} bytes)`);
      
      // Decode the audio data
      try {
        const audioBuffer = await this.audioContext.decodeAudioData(audioData);
        
        // Add to queue (instead of immediate playback)
        this.audioQueue.push(audioBuffer);
        
        // Start playback if not already playing
        if (!this.isPlaying) {
          this.playNextChunk();
        } else {
          console.log(`Added audio buffer to queue: duration=${audioBuffer.duration.toFixed(2)}s`);
        }
        
      } catch (error) {
        console.error('Error decoding audio data:', error);
        this.dispatchEvent(AudioEvent.AUDIO_ERROR, { error });
      }
    } catch (error) {
      console.error('Error queueing audio chunk:', error);
      this.dispatchEvent(AudioEvent.AUDIO_ERROR, { error });
    }
  }
  
  /**
   * Play next audio chunk from the queue
   */
  private playNextChunk(): void {
    console.log(`>> playNextChunk called. Queue length: ${this.audioQueue.length}, isPlaying: ${this.isPlaying}, isSpeaking: ${this.isSpeaking}`);
    
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      this.isSpeaking = false;
      this.audioState = AudioState.INACTIVE;
      this.dispatchEvent(AudioEvent.PLAYBACK_END, {
        previousState: AudioState.SPEAKING
      });
      console.log('Audio queue empty, playback complete');
      return;
    }
    
    if (!this.audioContext) return;
    
    const buffer = this.audioQueue.shift();
    if (!buffer) return;
    
    // Set playback state - only dispatch PLAYBACK_START on the first buffer
    const wasPlaying = this.isPlaying;
    this.isPlaying = true;
    this.isSpeaking = true;
    this.audioState = AudioState.SPEAKING;
    
    // Create source node
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    
    // Handle when this chunk ends
    source.onended = () => {
      console.log(`Buffer playback ended. Queue length: ${this.audioQueue.length}`);
      // If there are more chunks, play them
      if (this.audioQueue.length > 0) {
        this.playNextChunk();
      } else {
        // No more chunks, end playback
        this.isPlaying = false;
        this.isSpeaking = false;
        this.audioState = AudioState.INACTIVE;
        this.currentSource = null;
        this.dispatchEvent(AudioEvent.PLAYBACK_END, {
          previousState: AudioState.SPEAKING
        });
        console.log('Last audio chunk complete, playback ended');
      }
    };
    
    // Keep track of current source for stopping
    this.currentSource = source;
    
    // Start playback with a small delay
    source.start(this.audioContext.currentTime + 0.05);
    
    console.log(`Playing audio buffer: duration=${buffer.duration.toFixed(2)}s, queue remaining: ${this.audioQueue.length}`);
    
    // Dispatch playback start event only if we weren't already playing
    if (!wasPlaying) {
      console.log('First chunk in sequence - dispatching PLAYBACK_START event');
      this.dispatchEvent(AudioEvent.PLAYBACK_START, {});
    }
  }
  
  /**
   * Check if audio is currently playing speech
   */
  public isCurrentlySpeaking(): boolean {
    return this.isSpeaking;
  }
  
  /**
   * Get the length of the audio queue
   */
  public getAudioQueueLength(): number {
    return this.audioQueue.length;
  }
  
  /**
   * Check if microphone input is muted
   */
  public isMicrophoneMuted(): boolean {
    return this.isMuted;
  }
  
  /**
   * Toggle microphone mute state
   * Returns the new mute state
   */
  public toggleMicrophoneMute(): boolean {
    this.isMuted = !this.isMuted;
    
    // Apply mute state to active audio tracks
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
      console.log(`Microphone ${this.isMuted ? 'muted' : 'unmuted'}`);
    } else {
      console.log('No active microphone to mute/unmute');
    }
    
    // Dispatch event
    this.dispatchEvent(AudioEvent.AUDIO_STATE_CHANGE, {
      type: 'mute_change',
      isMuted: this.isMuted
    });
    
    return this.isMuted;
  }

  /**
   * Stop audio playback
   */
  public stopPlayback(): void {
    if (!this.currentSource) {
      return;
    }
    
    // Store previous state for the event
    const previousState = this.audioState;
    
    try {
      this.currentSource.stop();
      this.currentSource = null;
    } catch (error) {
      console.error('Error stopping playback:', error);
    }
    
    // Clear the queue
    this.audioQueue = [];
    
    // Set state to INTERRUPTED if we were SPEAKING
    if (previousState === AudioState.SPEAKING) {
      this.audioState = AudioState.INTERRUPTED;
    } else {
      this.audioState = AudioState.INACTIVE;
    }
    
    this.isPlaying = false;
    this.isSpeaking = false;
    
    // Dispatch event with previous state info
    this.dispatchEvent(AudioEvent.PLAYBACK_STOP, { 
      interrupted: previousState === AudioState.SPEAKING,
      previousState: previousState
    });
    
    console.log('Playback stopped');
  }

  /**
   * Fully release all hardware access
   * This is more aggressive than just stopRecording() as it also:
   * - Forces all media tracks to stop
   * - Suspends the audio context
   * - Nullifies all resources
   * 
   * Use this when completely ending a call to ensure microphone
   * permissions are fully released at the hardware level.
   */
  public releaseHardware(): void {
    console.log('Releasing all hardware access...');
    
    // First stop any active recording/playback
    this.stopRecording();
    this.stopPlayback();
    
    // Force-stop and disable all tracks to release hardware
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      this.mediaStream = null;
    }
    
    // Ensure script processor is disconnected
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    
    // Ensure media stream source is disconnected
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }
    
    // Suspend the audio context if it's running
    if (this.audioContext?.state === 'running') {
      this.audioContext.suspend().catch(err => {
        console.error('Error suspending audio context:', err);
      });
    }
    
    // Reset all state
    this.audioState = AudioState.INACTIVE;
    this.isPlaying = false;
    this.isSpeaking = false;
    
    console.log('All hardware access released');
  }

  /**
   * Get current audio state
   */
  public getAudioState(): AudioState {
    return this.audioState;
  }

  /**
   * Add event listener
   */
  public addEventListener(event: AudioEvent, callback: AudioEventListener): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    
    this.eventListeners.get(event)?.push(callback);
  }

  /**
   * Remove event listener
   */
  public removeEventListener(event: AudioEvent, callback: AudioEventListener): void {
    if (!this.eventListeners.has(event)) {
      return;
    }
    
    const listeners = this.eventListeners.get(event) || [];
    this.eventListeners.set(
      event,
      listeners.filter(listener => listener !== callback)
    );
  }

  /**
   * Dispatch event
   */
  private dispatchEvent(event: AudioEvent, data: any): void {
    if (!this.eventListeners.has(event)) {
      return;
    }
    
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        console.error(`Error in ${event} listener:`, error);
      }
    });
  }
}

// Create singleton instance
const audioService = new AudioService();
export default audioService;
