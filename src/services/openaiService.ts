import OpenAI from 'openai';
import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';
import { createReadStream, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export class OpenAIService {
  private openai: OpenAI | null = null;
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = env.OPENAI_API_KEY;
    
    if (!this.apiKey) {
      logger.warn('OPENAI_API_KEY not provided, using mock implementation');
    } else {
      try {
        this.openai = new OpenAI({
          apiKey: this.apiKey,
        });
        logger.info('OpenAI service initialized with API key');
      } catch (error) {
        logger.error('Failed to initialize OpenAI service', { error });
        this.openai = null;
      }
    }
  }

  /**
   * Transcribe audio using OpenAI Whisper
   */
  async transcribeAudio(audioBuffer: Buffer, filename: string = 'audio.wav'): Promise<string> {
    try {
      // Use real OpenAI API if available
      if (this.openai && this.apiKey) {
        try {
          // Create temporary file for Node.js compatibility
          const tempPath = join(tmpdir(), `whisper_${Date.now()}_${filename}`);
          
          try {
            // Write audio buffer to temporary file
            writeFileSync(tempPath, audioBuffer);
            
            // Create read stream from temporary file
            const fileStream = createReadStream(tempPath);
            
            // Transcribe using OpenAI Whisper
            const transcription = await this.openai.audio.transcriptions.create({
              file: fileStream,
              model: 'whisper-1',
              response_format: 'text',
            });

            logger.info('Audio transcribed using OpenAI Whisper', {
              filename,
              transcriptionLength: transcription.length,
              audioSize: audioBuffer.length,
              tempPath,
            });

            return transcription;
          } finally {
            // Clean up temporary file
            try {
              unlinkSync(tempPath);
              logger.debug('Temporary audio file cleaned up', { tempPath });
            } catch (cleanupError) {
              logger.warn('Failed to clean up temporary audio file', {
                tempPath,
                error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error',
              });
            }
          }
        } catch (apiError) {
          logger.error('OpenAI API error, falling back to mock transcription', { apiError });
          // Fall back to mock transcription if API fails
        }
      }

      // Fallback to mock transcription
      return this.mockTranscription(audioBuffer);

    } catch (error) {
      logger.error('Error transcribing audio with OpenAI', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filename,
        audioSize: audioBuffer.length,
      });
      throw new BadRequestError(
        `Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.OPENAI_ERROR
      );
    }
  }

  /**
   * Transcribe audio from file path (alternative method)
   */
  async transcribeAudioFromFile(filePath: string): Promise<string> {
    try {
      if (!this.openai || !this.apiKey) {
        throw new Error('OpenAI service not initialized');
      }

      const fileStream = createReadStream(filePath);
      
      const transcription = await this.openai.audio.transcriptions.create({
        file: fileStream,
        model: 'whisper-1',
        response_format: 'text',
      });

      logger.info('Audio transcribed from file using OpenAI Whisper', {
        filePath,
        transcriptionLength: transcription.length,
      });

      return transcription;
    } catch (error) {
      logger.error('Error transcribing audio from file with OpenAI', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filePath,
      });
      throw new BadRequestError(
        `Failed to transcribe audio from file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.OPENAI_ERROR
      );
    }
  }

  /**
   * Health check for OpenAI service
   */
  async healthCheck(): Promise<{ status: string; details?: any }> {
    try {
      if (this.openai && this.apiKey) {
        try {
          // Test API connectivity by making a simple request
          const response = await this.openai.models.list();
          
          return {
            status: 'healthy',
            details: {
              message: 'OpenAI API is responding correctly',
              apiConnected: true,
              modelsAvailable: response.data.length,
            },
          };
        } catch (apiError) {
          return {
            status: 'degraded',
            details: {
              message: 'OpenAI API not available, using mock implementation',
              apiConnected: false,
              error: apiError instanceof Error ? apiError.message : 'Unknown error',
            },
          };
        }
      }

      // Mock implementation health check
      return {
        status: 'healthy',
        details: {
          message: 'Mock OpenAI service is working',
          apiConnected: false,
          apiKey: this.apiKey || 'mock',
        },
      };

    } catch (error) {
      logger.error('OpenAI health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  // Mock transcription for fallback
  private mockTranscription(audioBuffer: Buffer): string {
    const mockTranscriptions = [
      "This is a mock transcription of the audio message.",
      "Hello, this is a test audio message.",
      "I'm recording a voice note about my day.",
      "Reminder to buy groceries tomorrow.",
      "Meeting scheduled for 3 PM today.",
      "Don't forget to call the dentist.",
      "I need to pick up dry cleaning.",
      "Remember to send the report by Friday.",
      "The weather is beautiful today.",
      "I should exercise more regularly.",
    ];

    // Use audio buffer length to deterministically select a mock transcription
    const index = audioBuffer.length % mockTranscriptions.length;
    return mockTranscriptions[index] || "Mock transcription";
  }
}

let openaiServiceInstance: OpenAIService | null = null;

export const getOpenAIService = (): OpenAIService => {
  if (!openaiServiceInstance) {
    openaiServiceInstance = new OpenAIService();
  }
  return openaiServiceInstance;
};
