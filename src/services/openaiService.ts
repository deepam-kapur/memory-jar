import OpenAI from 'openai';
import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  confidence?: number;
}

export class OpenAIService {
  private client: OpenAI;

  constructor() {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for OpenAI integration');
    }

    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    logger.info('OpenAI service initialized');
  }

  /**
   * Transcribe audio using OpenAI Whisper
   */
  async transcribeAudio(audioBuffer: Buffer, filename?: string): Promise<TranscriptionResult> {
    try {
      logger.debug('Starting audio transcription', {
        bufferSize: audioBuffer.length,
        filename,
      });

      // Create a file object from the buffer
      const file = new File([audioBuffer], filename || 'audio.wav', {
        type: 'audio/wav',
      });

      // Transcribe using Whisper
      const transcription = await this.client.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        response_format: 'verbose_json',
        language: 'en', // Default to English, can be made configurable
      });

      const result: TranscriptionResult = {
        text: transcription.text,
        language: transcription.language,
        duration: transcription.duration,
        confidence: transcription.segments?.[0]?.avg_logprob || 0,
      };

      logger.info('Audio transcription completed', {
        textLength: result.text.length,
        language: result.language,
        duration: result.duration,
        confidence: result.confidence,
      });

      return result;
    } catch (error) {
      logger.error('Error transcribing audio', {
        error: error instanceof Error ? error.message : 'Unknown error',
        bufferSize: audioBuffer.length,
        filename,
      });
      throw new BadRequestError(
        `Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.OPENAI_ERROR
      );
    }
  }

  /**
   * Transcribe audio from URL (for Twilio media)
   */
  async transcribeAudioFromUrl(audioUrl: string): Promise<TranscriptionResult> {
    try {
      logger.debug('Starting audio transcription from URL', { audioUrl });

      // Download the audio file
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.statusText}`);
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());

      // Transcribe the downloaded audio
      return await this.transcribeAudio(audioBuffer, 'audio.wav');
    } catch (error) {
      logger.error('Error transcribing audio from URL', {
        error: error instanceof Error ? error.message : 'Unknown error',
        audioUrl,
      });
      throw new BadRequestError(
        `Failed to transcribe audio from URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.OPENAI_ERROR
      );
    }
  }

  /**
   * Health check for OpenAI service
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      // Try to list models to verify API connectivity
      await this.client.models.list();
      
      return {
        status: 'healthy',
        message: 'OpenAI service is operational',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `OpenAI service error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}

// Export singleton instance
let openaiServiceInstance: OpenAIService | null = null;

export const getOpenAIService = (): OpenAIService => {
  if (!openaiServiceInstance) {
    openaiServiceInstance = new OpenAIService();
  }
  return openaiServiceInstance;
};
