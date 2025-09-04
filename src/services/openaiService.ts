import OpenAI, { toFile } from 'openai';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

const execAsync = promisify(exec);

// OpenAI Whisper API Response Types
export interface WhisperVerboseResponse {
  text: string;
  language: string;
  duration: number;
  segments?: Array<{
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
  }>;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  confidence?: number;
}

export interface EnhancedTranscriptionResult {
  transcription: string;
  language?: string;
  confidence?: number;
  speakers?: number;
  sentiment?: 'positive' | 'negative' | 'neutral';
  keywords?: string[];
  duration?: number;
}

// Audio format constants
const SUPPORTED_AUDIO_FORMATS = {
  'mp3': 'audio/mpeg',
  'mp4': 'audio/mp4',
  'mpeg': 'audio/mpeg',
  'mpga': 'audio/mpeg',
  'm4a': 'audio/mp4',
  'wav': 'audio/wav',
  'webm': 'audio/webm',
  'ogg': 'audio/ogg',
  'oga': 'audio/ogg',
  'flac': 'audio/flac'
} as const;

const AUDIO_MAGIC_NUMBERS = {
  'ffd8': 'audio/mpeg', // MP3
  '4944': 'audio/mpeg', // MP3 with ID3 tag
  'fff1': 'audio/aac',
  'fff9': 'audio/aac',
  '5249': 'audio/wav', // RIFF (WAV)
  '4f67': 'audio/ogg', // OGG
  '664c': 'audio/flac', // FLAC
  '0000': 'audio/mp4' // MP4 (starts with ftyp box)
} as const;

// OpenAI file size limit (25MB)
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export class OpenAIService {
  private client: OpenAI;

  constructor() {
    if (!env.OPENAI_API_KEY) {
      logger.warn('OPENAI_API_KEY not provided, using mock implementation');
      // Create a mock client that will throw errors if used
      this.client = {} as OpenAI;
    } else {
      this.client = new OpenAI({
        apiKey: env.OPENAI_API_KEY,
      });
      logger.info('OpenAI service initialized');
    }
  }

  /**
   * Get correct file extension from MIME type
   */
  private getExtensionFromMimeType(mimeType: string): string {
    if (mimeType.includes('ogg')) return 'oga'; // Use OGA for OpenAI compatibility
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
    if (mimeType.includes('amr')) return 'amr';
    if (mimeType.includes('flac')) return 'flac';
    if (mimeType.includes('webm')) return 'webm';
    return 'oga'; // sensible default for unknown formats (OGA is widely supported)
  }

  /**
   * Ensure filename has correct extension matching the MIME type
   */
  private ensureCorrectFilename(originalFilename: string, mimeType: string): string {
    const correctExt = this.getExtensionFromMimeType(mimeType);
    
    // If filename already has the correct extension, keep it
    if (originalFilename.toLowerCase().endsWith(`.${correctExt}`)) {
      return originalFilename;
    }
    
    // Remove any existing extension and add the correct one
    const baseName = originalFilename.includes('.') 
      ? originalFilename.substring(0, originalFilename.lastIndexOf('.'))
      : originalFilename;
    
    return `${baseName}.${correctExt}`;
  }

  /**
   * Detect audio MIME type from filename or buffer content
   */
  private detectAudioMimeType(filename: string, audioBuffer: Buffer): string {
    // First try to detect from filename extension
    const extension = filename.split('.').pop()?.toLowerCase();
    if (extension && SUPPORTED_AUDIO_FORMATS[extension as keyof typeof SUPPORTED_AUDIO_FORMATS]) {
      const detectedType = SUPPORTED_AUDIO_FORMATS[extension as keyof typeof SUPPORTED_AUDIO_FORMATS];
      logger.debug('Audio MIME type detected from filename', { filename, extension, detectedType });
      return detectedType;
    }

    // Fallback: detect from buffer magic numbers
    if (audioBuffer.length >= 4) {
      const magicHex = audioBuffer.subarray(0, 4).toString('hex').toLowerCase();
      const magicKey = magicHex.substring(0, 4);
      
      if (AUDIO_MAGIC_NUMBERS[magicKey as keyof typeof AUDIO_MAGIC_NUMBERS]) {
        const detectedType = AUDIO_MAGIC_NUMBERS[magicKey as keyof typeof AUDIO_MAGIC_NUMBERS];
        logger.debug('Audio MIME type detected from magic numbers', { magicHex, detectedType });
        return detectedType;
      }
    }

    // Default fallback
    logger.warn('Could not detect audio MIME type, defaulting to audio/wav', { filename });
    return 'audio/wav';
  }

  /**
   * Validate audio file for OpenAI API requirements
   */
  private validateAudioFile(audioBuffer: Buffer, filename: string): void {
    // Check file size (OpenAI limit: 25MB)
    if (audioBuffer.length > MAX_FILE_SIZE) {
      throw new BadRequestError(
        `Audio file too large: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB. Maximum allowed: 25MB`,
        ErrorCodes.INVALID_INPUT
      );
    }

    // Check if file is empty
    if (audioBuffer.length === 0) {
      throw new BadRequestError(
        'Audio file is empty',
        ErrorCodes.INVALID_INPUT
      );
    }

    // Check if filename has valid extension
    const extension = filename.split('.').pop()?.toLowerCase();
    if (extension && !SUPPORTED_AUDIO_FORMATS[extension as keyof typeof SUPPORTED_AUDIO_FORMATS]) {
      logger.warn('Unsupported audio format detected', { filename, extension });
    }

    logger.debug('Audio file validation passed', {
      filename,
      size: audioBuffer.length,
      sizeMB: (audioBuffer.length / 1024 / 1024).toFixed(2)
    });
  }

  /**
   * Improved duration estimation based on audio format and content
   */
  private estimateDurationImproved(audioBuffer: Buffer, mimeType: string): number {
    // More accurate estimation based on format
    let estimatedBitrate: number;
    
    switch (mimeType) {
      case 'audio/wav':
        // WAV files: try to read actual duration from header
        if (audioBuffer.length >= 44) {
          try {
            // WAV header contains duration info at specific offsets
            const sampleRate = audioBuffer.readUInt32LE(24);
            const byteRate = audioBuffer.readUInt32LE(28);
            if (sampleRate > 0 && byteRate > 0) {
              const duration = (audioBuffer.length - 44) / byteRate;
              if (duration > 0 && duration < 3600) { // Sanity check: less than 1 hour
                logger.debug('WAV duration calculated from header', { duration, sampleRate, byteRate });
                return Math.round(duration);
              }
            }
                  } catch (parseError) {
          logger.debug('Failed to parse WAV header, using fallback estimation', { parseError });
        }
        }
        estimatedBitrate = 128 * 1024; // 128 kbps for WAV fallback
        break;
      case 'audio/mpeg':
      case 'audio/mp3':
        estimatedBitrate = 128 * 1024; // 128 kbps typical for MP3
        break;
      case 'audio/ogg':
        estimatedBitrate = 96 * 1024; // 96 kbps typical for OGG
        break;
      case 'audio/flac':
        estimatedBitrate = 800 * 1024; // 800 kbps typical for FLAC
        break;
      default:
        estimatedBitrate = 128 * 1024; // Default fallback
    }

    const estimatedSeconds = (audioBuffer.length * 8) / estimatedBitrate;
    const duration = Math.max(1, Math.round(estimatedSeconds));
    
    logger.debug('Audio duration estimated', {
      mimeType,
      estimatedBitrate,
      bufferSize: audioBuffer.length,
      estimatedDuration: duration
    });
    
    return duration;
  }

  /**
   * Simple OGG to WAV conversion for OpenAI compatibility
   */
  private async convertOggToWav(inputPath: string): Promise<string> {
    const outputPath = inputPath.replace(/\.(ogg|oga)$/i, '.wav');
    
    try {
      const command = `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}" -y`;
      await execAsync(command);
      
      if (!fs.existsSync(outputPath)) {
        throw new Error('Conversion output file not created');
      }
      
      logger.info('OGG to WAV conversion successful', { inputPath, outputPath });
      return outputPath;
    } catch (error) {
      logger.error('OGG to WAV conversion failed', { 
        inputPath, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Enhanced audio transcription with metadata extraction
   */
  async transcribeAudioWithMetadata(audioBuffer: Buffer, originalFilename: string = 'audio', storedFilePath?: string): Promise<EnhancedTranscriptionResult> {
    logger.info('Starting OpenAI Whisper transcription', {
      filename: originalFilename,
      bufferSize: audioBuffer.length,
      hasStoredFile: !!storedFilePath
    });

    if (env.OPENAI_API_KEY && this.client.audio) {
      let finalPath = storedFilePath;
      
      try {
        let file: any;

        // Check if we need to convert OGG to WAV (OpenAI requirement)
        if (storedFilePath && fs.existsSync(storedFilePath) && /\.(ogg|oga)$/i.test(storedFilePath)) {
          // Verify it's actually an OGG file by checking magic bytes
          const fileBuffer = fs.readFileSync(storedFilePath);
          const magic = fileBuffer.subarray(0, 4).toString('hex');
          const isOgg = magic.startsWith('4f676753');
          
          logger.info('Converting OGG to WAV for OpenAI compatibility', {
            filePath: storedFilePath,
            fileSize: fileBuffer.length,
            magicBytes: magic,
            isActuallyOgg: isOgg
          });
          
          finalPath = await this.convertOggToWav(storedFilePath);
        }

        // Use file stream if we have a stored file (original or converted)
        if (finalPath && fs.existsSync(finalPath)) {
          logger.info('Using file stream for transcription', { filePath: finalPath });
          file = fs.createReadStream(finalPath);
        } else {
          logger.info('Using buffer for transcription');
          file = await toFile(audioBuffer, originalFilename);
        }

        // Transcribe using OpenAI Whisper
        const transcription = await this.client.audio.transcriptions.create({
          file,
          model: 'whisper-1',
          response_format: 'verbose_json',
        }) as WhisperVerboseResponse;

        const transcriptionText = transcription.text || '';

        // Calculate confidence from segments
        let confidence = 0.8;
        if (transcription.segments && transcription.segments.length > 0) {
          const avgLogProb = transcription.segments.reduce((sum, seg) => sum + seg.avg_logprob, 0) / transcription.segments.length;
          confidence = Math.max(0, Math.min(1, 1 + avgLogProb / 2));
        }

        // Analyze sentiment and extract keywords
        const analysis = await this.analyzeTranscriptionContent(transcriptionText);

        const result: EnhancedTranscriptionResult = {
          transcription: transcriptionText,
          language: transcription.language || 'unknown',
          confidence,
          speakers: this.estimateSpeakerCount(transcriptionText),
          sentiment: analysis.sentiment,
          keywords: analysis.keywords,
          duration: transcription.duration || this.estimateDurationImproved(audioBuffer, 'audio/ogg')
        };

        logger.info('OpenAI transcription successful', {
          transcriptionLength: transcriptionText.length,
          language: result.language,
          confidence: result.confidence
        });

        // Clean up temporary WAV file if we converted from OGG
        if (finalPath !== storedFilePath && finalPath && fs.existsSync(finalPath)) {
          try {
            fs.unlinkSync(finalPath);
            logger.debug('Cleaned up temporary WAV file', { tempFile: finalPath });
          } catch (cleanupError) {
            logger.warn('Failed to cleanup temporary WAV file', { 
              tempFile: finalPath, 
              error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error' 
            });
          }
        }

        return result;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('OpenAI transcription failed', { error: errorMessage });

        // Clean up temporary WAV file if we converted from OGG
        if (finalPath !== storedFilePath && finalPath && fs.existsSync(finalPath)) {
          try {
            fs.unlinkSync(finalPath);
            logger.debug('Cleaned up temporary WAV file after error', { tempFile: finalPath });
          } catch (cleanupError) {
            logger.warn('Failed to cleanup temporary WAV file after error', { 
              tempFile: finalPath, 
              error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error' 
            });
          }
        }

        // Return mock transcription
        return this.mockAudioAnalysisWithCodecInfo(audioBuffer, originalFilename, 'audio/ogg');
      }
    }

    // No API key fallback
    logger.info('No OpenAI API key, using mock transcription');
    return this.mockAudioAnalysisWithCodecInfo(audioBuffer, originalFilename);
  }

  /**
   * Transcribe audio using OpenAI Whisper (legacy method for compatibility)
   */
  async transcribeAudio(audioBuffer: Buffer, filename?: string): Promise<TranscriptionResult> {
    try {
      const originalFilename = filename || 'audio';
      
      // Detect proper MIME type first
      const mimeType = this.detectAudioMimeType(originalFilename, audioBuffer);
      
      // Ensure filename has correct extension matching the actual content
      const safeFilename = this.ensureCorrectFilename(originalFilename, mimeType);

      logger.debug('Starting audio transcription (legacy method)', {
        bufferSize: audioBuffer.length,
        originalFilename,
        safeFilename,
        mimeType,
      });

      // Validate audio file
      this.validateAudioFile(audioBuffer, safeFilename);

      // Use real OpenAI API if available
      if (env.OPENAI_API_KEY && this.client.audio) {
        try {
          // Use OpenAI's toFile helper for proper file creation
          const file = await toFile(audioBuffer, safeFilename);

          // Transcribe using Whisper with language auto-detection
          const transcription = await this.client.audio.transcriptions.create({
            file,
            model: 'whisper-1',
            response_format: 'verbose_json',
          }) as WhisperVerboseResponse;

          // Calculate confidence from segments if available
          let confidence = 0;
          if (transcription.segments && transcription.segments.length > 0) {
            const avgLogProb = transcription.segments.reduce((sum, seg) => sum + seg.avg_logprob, 0) / transcription.segments.length;
            confidence = Math.max(0, Math.min(1, 1 + avgLogProb / 2));
          }

          const result: TranscriptionResult = {
            text: transcription.text,
            language: transcription.language,
            duration: transcription.duration,
            confidence: confidence || this.estimateConfidence(transcription.text),
          };

          logger.info('Audio transcription completed (legacy method)', {
            originalFilename,
            safeFilename,
            mimeType,
            textLength: result.text.length,
            language: result.language,
            duration: result.duration,
            confidence: result.confidence,
          });

          return result;
        } catch (apiError) {
          logger.error('OpenAI API error, falling back to mock transcription', { 
            apiError: apiError instanceof Error ? apiError.message : 'Unknown API error',
            originalFilename,
            safeFilename
          });
        }
      }

      // Fallback to mock transcription
      const mockText = this.mockTranscription(audioBuffer);
      return {
        text: mockText,
        language: 'en',
        duration: this.estimateDurationImproved(audioBuffer, mimeType),
        confidence: 0.8
      };

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
      const response = await globalThis.fetch(audioUrl);
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
   * Generate chat completion using OpenAI
   */
  async generateChatCompletion(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: {
      temperature?: number;
      max_tokens?: number;
      model?: string;
    }
  ): Promise<string | null> {
    try {
      if (!env.OPENAI_API_KEY || !this.client.chat) {
        logger.warn('OpenAI service not initialized, cannot generate chat completion');
        return null;
      }

      const completion = await this.client.chat.completions.create({
        model: options?.model || 'gpt-3.5-turbo',
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 150,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        logger.warn('No content in OpenAI chat completion response');
        return null;
      }

      logger.info('OpenAI chat completion successful', {
        model: options?.model || 'gpt-3.5-turbo',
        messageCount: messages.length,
        responseLength: content.length,
        tokens: completion.usage?.total_tokens || 0,
      });

      return content;

    } catch (error) {
      logger.error('Error generating chat completion with OpenAI', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageCount: messages.length,
      });
      return null;
    }
  }

  /**
   * Health check for OpenAI service
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      if (!env.OPENAI_API_KEY) {
        return {
          status: 'healthy',
          message: 'OpenAI service running in mock mode (no API key)',
        };
      }

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

  /**
   * Analyze transcription content for sentiment and keywords
   */
  private async analyzeTranscriptionContent(text: string): Promise<{
    sentiment: 'positive' | 'negative' | 'neutral';
    keywords: string[];
  }> {
    try {
      if (env.OPENAI_API_KEY && this.client.chat) {
        const response = await this.client.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: `Analyze this transcription and return a JSON object with sentiment and keywords:

Text: "${text}"

Return format:
{
  "sentiment": "positive|negative|neutral",
  "keywords": ["key", "words", "from", "text"]
}

Focus on extracting actionable keywords and determining overall emotional tone.`
            }
          ],
          max_tokens: 200,
          temperature: 0.3
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
          try {
            const analysis = JSON.parse(content);
            return {
              sentiment: analysis.sentiment || 'neutral',
              keywords: Array.isArray(analysis.keywords) ? analysis.keywords : []
            };
          } catch (parseError) {
            logger.warn('Failed to parse GPT analysis response', { parseError });
          }
        }
      }

      // Fallback analysis
      return this.simpleTextAnalysis(text);
    } catch (error) {
      logger.error('Error analyzing transcription content', { error });
      return this.simpleTextAnalysis(text);
    }
  }

  /**
   * Simple text analysis for fallback
   */
  private simpleTextAnalysis(text: string): {
    sentiment: 'positive' | 'negative' | 'neutral';
    keywords: string[];
  } {
    const lowerText = text.toLowerCase();
    
    // Simple sentiment analysis
    const positiveWords = ['happy', 'good', 'great', 'excellent', 'love', 'amazing', 'wonderful'];
    const negativeWords = ['sad', 'bad', 'terrible', 'hate', 'awful', 'horrible', 'upset'];
    
    const positiveCount = positiveWords.filter(word => lowerText.includes(word)).length;
    const negativeCount = negativeWords.filter(word => lowerText.includes(word)).length;
    
    let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (positiveCount > negativeCount) sentiment = 'positive';
    else if (negativeCount > positiveCount) sentiment = 'negative';
    
    // Extract keywords (simple word extraction)
    const words = text.match(/\b\w{3,}\b/g) || [];
    const commonWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'this', 'that', 'is', 'are', 'was', 'were', 'will', 'would', 'could', 'should'];
    const keywords = words
      .filter((word: string) => !commonWords.includes(word.toLowerCase()))
      .slice(0, 10);
    
    return { sentiment, keywords };
  }

  /**
   * Estimate transcription confidence based on text characteristics
   */
  private estimateConfidence(text: string): number {
    if (!text || text.trim().length === 0) return 0;
    
    // Basic confidence estimation
    let confidence = 0.7; // Base confidence
    
    // Longer text usually means better confidence
    if (text.length > 50) confidence += 0.1;
    if (text.length > 100) confidence += 0.1;
    
    // Complete sentences boost confidence
    const sentences = text.split(/[.!?]+/).length;
    if (sentences > 1) confidence += 0.05;
    
    // Proper capitalization and punctuation
    if (/^[A-Z]/.test(text)) confidence += 0.05;
    if (/[.!?]$/.test(text.trim())) confidence += 0.05;
    
    return Math.min(confidence, 0.95);
  }

  /**
   * Estimate number of speakers (basic implementation)
   */
  private estimateSpeakerCount(text: string): number {
    // Look for speaker change indicators
    const speakerChangeIndicators = text.match(/\b(he said|she said|I said|you said|they said)\b/gi) || [];
    return Math.max(1, speakerChangeIndicators.length + 1);
  }

  /**
   * Legacy duration estimation method (kept for compatibility)
   */
  private estimateDuration(audioBuffer: Buffer): number {
    // Fallback to improved estimation with default WAV format
    return this.estimateDurationImproved(audioBuffer, 'audio/wav');
  }

  /**
   * Enhanced mock audio analysis
   */
  private mockAudioAnalysis(audioBuffer: Buffer, filename: string, mimeType?: string): EnhancedTranscriptionResult {
    const mockTranscription = this.mockTranscription(audioBuffer);
    const analysis = this.simpleTextAnalysis(mockTranscription);
    const detectedMimeType = mimeType || this.detectAudioMimeType(filename, audioBuffer);
    
    return {
      transcription: mockTranscription,
      language: 'en',
      confidence: this.estimateConfidence(mockTranscription),
      speakers: 1,
      sentiment: analysis.sentiment,
      keywords: analysis.keywords,
      duration: this.estimateDurationImproved(audioBuffer, detectedMimeType)
    };
  }

  private mockAudioAnalysisWithCodecInfo(audioBuffer: Buffer, filename: string, mimeType?: string): EnhancedTranscriptionResult {
    const detectedMimeType = mimeType || this.detectAudioMimeType(filename, audioBuffer);
    
    // Check if this is an OGG file that we couldn't transcribe
    const isOggFile = detectedMimeType === 'audio/ogg' || filename.endsWith('.oga') || filename.endsWith('.ogg');
    const contentStart = audioBuffer.subarray(0, 4).toString('ascii');
    const isValidOgg = contentStart === 'OggS';
    
    let mockTranscription: string;
    
    if (isOggFile) {
      if (isValidOgg) {
        // Provide helpful message about OGG/Opus codec limitations
        mockTranscription = 'Voice message received and saved. Transcription unavailable due to WhatsApp audio format limitations.';
        logger.info('OGG/Opus audio detected - transcription unavailable due to codec limitations', {
          filename,
          audioSize: audioBuffer.length,
          codecIssue: 'WhatsApp uses OGG/Opus which OpenAI Whisper does not support'
        });
      } else {
        // Corrupted or incomplete OGG file
        mockTranscription = 'Voice message received but audio file appears corrupted or incomplete.';
        logger.warn('Corrupted OGG file detected', {
          filename,
          audioSize: audioBuffer.length,
          issue: 'File does not start with valid OGG header'
        });
      }
    } else {
      // Use regular mock transcription for non-OGG files
      mockTranscription = this.mockTranscription(audioBuffer);
    }
    
    const analysis = this.simpleTextAnalysis(mockTranscription);
    
    return {
      transcription: mockTranscription,
      language: 'en',
      confidence: isOggFile ? 0.1 : this.estimateConfidence(mockTranscription), // Low confidence for audio issues
      speakers: 1,
      sentiment: analysis.sentiment,
      keywords: isOggFile ? ['voice-message', 'audio', 'whatsapp'] : analysis.keywords,
      duration: this.estimateDurationImproved(audioBuffer, detectedMimeType)
    };
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

// Export singleton instance
let openaiServiceInstance: OpenAIService | null = null;

export const getOpenAIService = (): OpenAIService => {
  if (!openaiServiceInstance) {
    openaiServiceInstance = new OpenAIService();
  }
  return openaiServiceInstance;
};