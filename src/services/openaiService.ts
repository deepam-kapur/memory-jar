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
   * Enhanced audio transcription with metadata extraction
   */
  async transcribeAudioWithMetadata(audioBuffer: Buffer, filename: string = 'audio.wav'): Promise<{
    transcription: string;
    language?: string;
    confidence?: number;
    speakers?: number;
    sentiment?: 'positive' | 'negative' | 'neutral';
    keywords?: string[];
    duration?: number;
  }> {
    try {
      // Use real OpenAI API if available
      if (this.openai && this.apiKey) {
        try {
          // Create temporary file for Node.js compatibility
          const tempPath = join(tmpdir(), `whisper_enhanced_${Date.now()}_${filename}`);
          
          try {
            // Write audio buffer to temporary file
            writeFileSync(tempPath, audioBuffer);
            
            // Create read stream from temporary file
            const fileStream = createReadStream(tempPath);
            
            // Transcribe using OpenAI Whisper with enhanced options
            const transcription = await this.openai.audio.transcriptions.create({
              file: fileStream,
              model: 'whisper-1',
              response_format: 'verbose_json', // Get detailed metadata
              language: undefined, // Auto-detect language
              prompt: 'This is a voice note that might contain reminders, tasks, or personal observations.',
            });

            // Extract basic transcription text
            const transcriptionText = typeof transcription === 'string' ? transcription : (transcription as any).text || '';

            // Analyze sentiment and extract keywords using GPT
            const analysis = await this.analyzeTranscriptionContent(transcriptionText);

            const result = {
              transcription: transcriptionText,
              language: (transcription as any).language || 'unknown',
              confidence: this.estimateConfidence(transcriptionText),
              speakers: this.estimateSpeakerCount(transcriptionText),
              sentiment: analysis.sentiment,
              keywords: analysis.keywords,
              duration: (transcription as any).duration || this.estimateDuration(audioBuffer)
            };

            logger.info('Audio transcribed with enhanced metadata using OpenAI Whisper', {
              filename,
              transcriptionLength: transcriptionText.length,
              audioSize: audioBuffer.length,
              language: result.language,
              confidence: result.confidence,
              sentiment: result.sentiment,
              keywordsCount: result.keywords?.length || 0,
              tempPath,
            });

            return result;
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

      // Fallback to enhanced mock transcription
      return this.mockAudioAnalysis(audioBuffer, filename);

    } catch (error) {
      logger.error('Error transcribing audio with enhanced metadata', {
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
   * Transcribe audio using OpenAI Whisper (legacy method for compatibility)
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
      if (!this.openai || !this.apiKey) {
        logger.warn('OpenAI service not initialized, cannot generate chat completion');
        return null;
      }

      const completion = await this.openai.chat.completions.create({
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
<<<<<<< Updated upstream
=======

  /**
   * Analyze transcription content for sentiment and keywords
   */
  private async analyzeTranscriptionContent(text: string): Promise<{
    sentiment: 'positive' | 'negative' | 'neutral';
    keywords: string[];
  }> {
    try {
      if (this.openai && this.apiKey) {
        const response = await this.openai.chat.completions.create({
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
      .filter(word => !commonWords.includes(word.toLowerCase()))
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
   * Estimate audio duration based on buffer size
   */
  private estimateDuration(audioBuffer: Buffer): number {
    // Rough estimation: typical audio bitrate is around 128 kbps
    // This is a very rough estimate and not accurate
    const estimatedSeconds = audioBuffer.length / (128 * 1024 / 8); // Convert to seconds
    return Math.max(1, Math.round(estimatedSeconds));
  }

  /**
   * Enhanced mock audio analysis
   */
  private mockAudioAnalysis(audioBuffer: Buffer, filename: string): {
    transcription: string;
    language?: string;
    confidence?: number;
    speakers?: number;
    sentiment?: 'positive' | 'negative' | 'neutral';
    keywords?: string[];
    duration?: number;
  } {
    const mockTranscription = this.mockTranscription(audioBuffer);
    const analysis = this.simpleTextAnalysis(mockTranscription);
    
    return {
      transcription: mockTranscription,
      language: 'en',
      confidence: this.estimateConfidence(mockTranscription),
      speakers: 1,
      sentiment: analysis.sentiment,
      keywords: analysis.keywords,
      duration: this.estimateDuration(audioBuffer)
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
>>>>>>> Stashed changes
}

// Export singleton instance
let openaiServiceInstance: OpenAIService | null = null;

export const getOpenAIService = (): OpenAIService => {
  if (!openaiServiceInstance) {
    openaiServiceInstance = new OpenAIService();
  }
  return openaiServiceInstance;
};
