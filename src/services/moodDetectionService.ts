import { getOpenAIService } from './openaiService';
import logger from '../config/logger';

export interface MoodDetection {
  mood: 'happy' | 'sad' | 'excited' | 'stressed' | 'anxious' | 'angry' | 'grateful' | 'confused' | 'neutral';
  confidence: number;
  emotionalIndicators: string[];
  intensity: 'low' | 'medium' | 'high';
  sentiment: 'positive' | 'negative' | 'neutral';
  themes: string[];
}

export interface EnhancedMoodDetection extends MoodDetection {
  reasoning: string;
  suggestions?: string[];
  relatedEmotions: string[];
}

export class MoodDetectionService {
  private openaiService = getOpenAIService();
  
  /**
   * Detect mood from text content using OpenAI
   */
  async detectMoodFromText(content: string): Promise<EnhancedMoodDetection> {
    try {
      if (!content || content.trim().length === 0) {
        return this.createNeutralMood('No content provided');
      }

      logger.debug('Starting mood detection analysis', {
        contentLength: content.length,
        contentPreview: content.substring(0, 100) + (content.length > 100 ? '...' : '')
      });

      // Use OpenAI for sophisticated mood analysis
      const analysisPrompt = this.createMoodAnalysisPrompt(content);
      const openaiResponse = await this.openaiService.generateChatCompletion([
        {
          role: 'system',
          content: 'You are an expert emotional intelligence analyst. Analyze text for emotional tone, mood, and psychological indicators with high accuracy.'
        },
        {
          role: 'user',
          content: analysisPrompt
        }
      ], {
        temperature: 0.3,
        max_tokens: 400,
        model: 'gpt-3.5-turbo'
      });

      if (openaiResponse) {
        try {
          const analysis = this.parseOpenAIResponse(openaiResponse);
          if (analysis) {
            logger.info('Mood detection completed via OpenAI', {
              mood: analysis.mood,
              confidence: analysis.confidence,
              sentiment: analysis.sentiment,
              intensity: analysis.intensity
            });
            return analysis;
          }
        } catch (parseError) {
          logger.warn('Failed to parse OpenAI mood analysis, falling back to rule-based', { parseError });
        }
      }

      // Fallback to rule-based analysis
      const fallbackAnalysis = this.performRuleBasedMoodAnalysis(content);
      
      logger.info('Mood detection completed via fallback', {
        mood: fallbackAnalysis.mood,
        confidence: fallbackAnalysis.confidence,
        method: 'rule-based'
      });

      return fallbackAnalysis;

    } catch (error) {
      logger.error('Error in mood detection', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contentLength: content.length
      });
      
      // Return neutral mood on error
      return this.createNeutralMood(`Error in analysis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Detect mood from image analysis results
   */
  async detectMoodFromImage(imageAnalysis: any): Promise<MoodDetection> {
    try {
      const imageContent = [
        imageAnalysis.description || '',
        imageAnalysis.scene || '',
        ...(imageAnalysis.tags || []),
        ...(imageAnalysis.objects || [])
      ].join(' ');

      if (!imageContent.trim()) {
        return this.createBasicNeutralMood('No image analysis data');
      }

      // Create a prompt specifically for image-based mood detection
      const imagePrompt = `Analyze the emotional mood and atmosphere of this image based on the following analysis:
      
Description: ${imageAnalysis.description || 'None'}
Scene: ${imageAnalysis.scene || 'None'}
Objects: ${(imageAnalysis.objects || []).join(', ') || 'None'}
Colors: ${(imageAnalysis.colors || []).join(', ') || 'None'}
Current mood (if detected): ${imageAnalysis.mood || 'None'}

Based on this visual information, determine the emotional mood and provide analysis in this JSON format:
{
  "mood": "happy|sad|excited|stressed|anxious|angry|grateful|confused|neutral",
  "confidence": 0.0-1.0,
  "emotionalIndicators": ["indicator1", "indicator2"],
  "intensity": "low|medium|high",
  "sentiment": "positive|negative|neutral",
  "themes": ["theme1", "theme2"]
}`;

      const openaiResponse = await this.openaiService.generateChatCompletion([
        {
          role: 'system',
          content: 'You are an expert at analyzing emotional content in images. Focus on visual elements that convey mood and atmosphere.'
        },
        {
          role: 'user',
          content: imagePrompt
        }
      ], {
        temperature: 0.3,
        max_tokens: 300
      });

      if (openaiResponse) {
        try {
          const analysis = JSON.parse(openaiResponse.trim());
          return this.validateAndNormalizeMoodDetection(analysis);
        } catch (parseError) {
          logger.warn('Failed to parse image mood analysis', { parseError });
        }
      }

      // Fallback based on existing image analysis
      return this.createMoodFromImageFallback(imageAnalysis);

    } catch (error) {
      logger.error('Error detecting mood from image', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return this.createBasicNeutralMood('Error in image mood analysis');
    }
  }

  /**
   * Detect mood from audio transcription and metadata
   */
  async detectMoodFromAudio(audioAnalysis: any): Promise<MoodDetection> {
    try {
      const transcription = audioAnalysis.transcription || '';
      
      if (!transcription.trim()) {
        return this.createBasicNeutralMood('No transcription available');
      }

      // Combine text analysis with audio-specific indicators
      const textMoodResult = await this.detectMoodFromText(transcription);
      
      // Enhance with audio-specific factors
      let confidence = textMoodResult.confidence;
      let intensity = textMoodResult.intensity;
      
      // Audio duration can indicate intensity
      if (audioAnalysis.duration) {
        if (audioAnalysis.duration > 60) {
          intensity = intensity === 'low' ? 'medium' : 'high';
          confidence += 0.1;
        }
      }

      // Speaking pace and tone indicators (if available in analysis)
      if (audioAnalysis.sentiment) {
        if (audioAnalysis.sentiment === textMoodResult.sentiment) {
          confidence += 0.15; // Consistent sentiment across modalities
        }
      }

      // Audio quality can affect confidence
      if (audioAnalysis.confidence && audioAnalysis.confidence > 0.8) {
        confidence += 0.1;
      }

      return {
        ...textMoodResult,
        confidence: Math.min(confidence, 0.95),
        intensity,
        emotionalIndicators: [
          ...textMoodResult.emotionalIndicators,
          ...(audioAnalysis.keywords || []).slice(0, 3)
        ].slice(0, 8) // Limit to prevent overflow
      };

    } catch (error) {
      logger.error('Error detecting mood from audio', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return this.createBasicNeutralMood('Error in audio mood analysis');
    }
  }

  /**
   * Create comprehensive mood analysis prompt for OpenAI
   */
  private createMoodAnalysisPrompt(content: string): string {
    return `Analyze the emotional mood and psychological tone of this text. Consider word choice, context, implied emotions, and overall sentiment.

Text to analyze: "${content}"

Provide a comprehensive emotional analysis in this exact JSON format:
{
  "mood": "happy|sad|excited|stressed|anxious|angry|grateful|confused|neutral",
  "confidence": 0.0-1.0,
  "emotionalIndicators": ["specific words or phrases that indicate this mood"],
  "intensity": "low|medium|high",
  "sentiment": "positive|negative|neutral",
  "themes": ["major emotional themes present"],
  "reasoning": "brief explanation of the analysis",
  "relatedEmotions": ["other emotions present"],
  "suggestions": ["optional suggestions based on detected mood"]
}

Focus on:
- Primary emotional tone
- Confidence in your assessment (0.0-1.0)
- Specific words/phrases that indicate the mood
- Overall intensity of emotions
- Secondary emotions present
- Constructive insights when appropriate`;
  }

  /**
   * Parse OpenAI response and validate mood detection
   */
  private parseOpenAIResponse(response: string): EnhancedMoodDetection | null {
    try {
      // Extract JSON from response (handle cases where AI adds extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const analysis = JSON.parse(jsonMatch[0]);
      return this.validateAndNormalizeEnhancedMoodDetection(analysis);
    } catch (error) {
      logger.error('Error parsing OpenAI mood response', { error, response });
      return null;
    }
  }

  /**
   * Rule-based mood analysis fallback
   */
  private performRuleBasedMoodAnalysis(content: string): EnhancedMoodDetection {
    const lowerContent = content.toLowerCase();
    
    // Mood indicators with weighted scoring
    const moodIndicators = {
      happy: {
        words: ['happy', 'joy', 'excited', 'great', 'awesome', 'amazing', 'wonderful', 'fantastic', 'love', 'smile', 'laugh', 'fun', 'celebration', 'celebrate'],
        weight: 1.0
      },
      sad: {
        words: ['sad', 'down', 'depressed', 'unhappy', 'miserable', 'terrible', 'awful', 'cry', 'tears', 'lonely', 'grief', 'mourning'],
        weight: 1.0
      },
      excited: {
        words: ['excited', 'pumped', 'thrilled', 'eager', 'can\'t wait', 'amazing', 'incredible', 'wow', 'fantastic'],
        weight: 1.0
      },
      stressed: {
        words: ['stressed', 'pressure', 'overwhelmed', 'busy', 'crazy', 'hectic', 'deadline', 'urgent', 'rush', 'exhausted'],
        weight: 1.0
      },
      anxious: {
        words: ['anxious', 'worried', 'nervous', 'concerned', 'afraid', 'fear', 'uncertain', 'doubt', 'panic'],
        weight: 1.0
      },
      angry: {
        words: ['angry', 'mad', 'furious', 'irritated', 'annoyed', 'frustrated', 'hate', 'disgusted', 'outraged'],
        weight: 1.0
      },
      grateful: {
        words: ['grateful', 'thankful', 'appreciate', 'blessed', 'lucky', 'fortunate', 'thanks'],
        weight: 1.0
      },
      confused: {
        words: ['confused', 'lost', 'unclear', 'don\'t understand', 'puzzled', 'baffled', 'uncertain'],
        weight: 1.0
      }
    };

    // Calculate mood scores
    const moodScores: Record<string, number> = {};
    const indicators: string[] = [];

    for (const [mood, { words, weight }] of Object.entries(moodIndicators)) {
      let score = 0;
      const foundWords: string[] = [];

      for (const word of words) {
        if (lowerContent.includes(word)) {
          score += weight;
          foundWords.push(word);
        }
      }

      if (score > 0) {
        moodScores[mood] = score;
        indicators.push(...foundWords);
      }
    }

    // Determine primary mood
    const sortedMoods = Object.entries(moodScores).sort(([, a], [, b]) => b - a);
    const primaryMood = sortedMoods.length > 0 && sortedMoods[0] ? sortedMoods[0][0] : 'neutral';
    const moodScore = sortedMoods.length > 0 && sortedMoods[0] ? sortedMoods[0][1] : 0;

    // Calculate confidence based on indicator strength
    const confidence = Math.min(0.6 + (moodScore * 0.1), 0.9);

    // Determine intensity
    let intensity: 'low' | 'medium' | 'high' = 'low';
    if (moodScore >= 3) intensity = 'high';
    else if (moodScore >= 1.5) intensity = 'medium';

    // Determine sentiment
    const positiveMoods = ['happy', 'excited', 'grateful'];
    const negativeMoods = ['sad', 'stressed', 'anxious', 'angry', 'confused'];
    let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
    
    if (positiveMoods.includes(primaryMood)) sentiment = 'positive';
    else if (negativeMoods.includes(primaryMood)) sentiment = 'negative';

    // Extract themes
    const themes: string[] = [];
    if (lowerContent.includes('work') || lowerContent.includes('job')) themes.push('work');
    if (lowerContent.includes('family') || lowerContent.includes('friend')) themes.push('relationships');
    if (lowerContent.includes('health') || lowerContent.includes('doctor')) themes.push('health');
    if (lowerContent.includes('money') || lowerContent.includes('finance')) themes.push('financial');

    return {
      mood: primaryMood as EnhancedMoodDetection['mood'],
      confidence,
      emotionalIndicators: indicators.slice(0, 5),
      intensity,
      sentiment,
      themes,
      reasoning: `Rule-based analysis found ${indicators.length} emotional indicators with primary mood scoring ${moodScore.toFixed(1)}`,
      relatedEmotions: sortedMoods.slice(1, 4).map(([mood]) => mood),
      suggestions: this.generateSuggestions(primaryMood as any, sentiment)
    };
  }

  /**
   * Generate mood-based suggestions
   */
  private generateSuggestions(mood: string, _sentiment: string): string[] {
    const suggestions: Record<string, string[]> = {
      stressed: ['Consider taking a break', 'Try deep breathing exercises', 'Break tasks into smaller steps'],
      anxious: ['Focus on what you can control', 'Practice mindfulness', 'Talk to someone you trust'],
      sad: ['Remember this feeling is temporary', 'Reach out to a friend', 'Do something kind for yourself'],
      angry: ['Take time to cool down', 'Express feelings constructively', 'Consider the other perspective'],
      excited: ['Channel this energy productively', 'Share your excitement with others', 'Plan next steps'],
      happy: ['Savor this positive moment', 'Share your joy with others', 'Reflect on what brought this happiness'],
      grateful: ['Consider keeping a gratitude journal', 'Express thanks to those who helped', 'Pay it forward'],
    };

    return suggestions[mood] || [];
  }

  /**
   * Create neutral mood detection result
   */
  private createNeutralMood(reasoning: string): EnhancedMoodDetection {
    return {
      mood: 'neutral',
      confidence: 0.6,
      emotionalIndicators: [],
      intensity: 'low',
      sentiment: 'neutral',
      themes: [],
      reasoning,
      relatedEmotions: [],
      suggestions: []
    };
  }

  /**
   * Create basic neutral mood (for non-enhanced results)
   */
  private createBasicNeutralMood(_reasoning: string): MoodDetection {
    return {
      mood: 'neutral',
      confidence: 0.6,
      emotionalIndicators: [],
      intensity: 'low',
      sentiment: 'neutral',
      themes: []
    };
  }

  /**
   * Create mood from image analysis fallback
   */
  private createMoodFromImageFallback(imageAnalysis: any): MoodDetection {
    let mood: MoodDetection['mood'] = 'neutral';
    let confidence = 0.5;
    const indicators: string[] = [];
    
    // Use existing mood if available
    if (imageAnalysis.mood) {
      const imageMoodMap: Record<string, MoodDetection['mood']> = {
        'happy': 'happy',
        'sad': 'sad',
        'excited': 'excited',
        'calm': 'neutral',
        'energetic': 'excited'
      };
      mood = imageMoodMap[imageAnalysis.mood] || 'neutral';
      confidence = 0.7;
      indicators.push(`visual_${imageAnalysis.mood}`);
    }

    // Analyze colors for mood
    if (imageAnalysis.colors) {
      const colorMoods: Record<string, { mood: MoodDetection['mood'], confidence: number }> = {
        'bright': { mood: 'happy', confidence: 0.6 },
        'dark': { mood: 'sad', confidence: 0.6 },
        'red': { mood: 'excited', confidence: 0.5 },
        'blue': { mood: 'neutral', confidence: 0.4 },
        'yellow': { mood: 'happy', confidence: 0.6 },
        'green': { mood: 'neutral', confidence: 0.4 }
      };

      for (const color of imageAnalysis.colors) {
        if (colorMoods[color.toLowerCase()]) {
          const colorMood = colorMoods[color.toLowerCase()];
          if (colorMood && colorMood.confidence > confidence) {
            mood = colorMood.mood;
            confidence = colorMood.confidence;
            indicators.push(`color_${color}`);
          }
        }
      }
    }

    return {
      mood,
      confidence,
      emotionalIndicators: indicators,
      intensity: confidence > 0.7 ? 'medium' : 'low',
      sentiment: ['happy', 'excited', 'grateful'].includes(mood) ? 'positive' : 
                ['sad', 'angry', 'anxious', 'stressed'].includes(mood) ? 'negative' : 'neutral',
      themes: imageAnalysis.tags?.slice(0, 3) || []
    };
  }

  /**
   * Validate and normalize mood detection results
   */
  private validateAndNormalizeMoodDetection(analysis: any): MoodDetection {
    const validMoods = ['happy', 'sad', 'excited', 'stressed', 'anxious', 'angry', 'grateful', 'confused', 'neutral'];
    const validIntensities = ['low', 'medium', 'high'];
    const validSentiments = ['positive', 'negative', 'neutral'];

    return {
      mood: validMoods.includes(analysis.mood) ? analysis.mood : 'neutral',
      confidence: Math.min(Math.max(Number(analysis.confidence) || 0.5, 0), 1),
      emotionalIndicators: Array.isArray(analysis.emotionalIndicators) ? 
        analysis.emotionalIndicators.slice(0, 8) : [],
      intensity: validIntensities.includes(analysis.intensity) ? analysis.intensity : 'low',
      sentiment: validSentiments.includes(analysis.sentiment) ? analysis.sentiment : 'neutral',
      themes: Array.isArray(analysis.themes) ? analysis.themes.slice(0, 5) : []
    };
  }

  /**
   * Validate and normalize enhanced mood detection results
   */
  private validateAndNormalizeEnhancedMoodDetection(analysis: any): EnhancedMoodDetection {
    const base = this.validateAndNormalizeMoodDetection(analysis);
    
    return {
      ...base,
      reasoning: typeof analysis.reasoning === 'string' ? analysis.reasoning : 'AI analysis completed',
      suggestions: Array.isArray(analysis.suggestions) ? analysis.suggestions.slice(0, 3) : [],
      relatedEmotions: Array.isArray(analysis.relatedEmotions) ? analysis.relatedEmotions.slice(0, 5) : []
    };
  }

  /**
   * Health check for mood detection service
   */
  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      // Test mood detection with a simple phrase
      const testResult = await this.detectMoodFromText('I am feeling great today!');
      
      return {
        status: 'healthy',
        details: {
          message: 'Mood detection service is operational',
          testMood: testResult.mood,
          testConfidence: testResult.confidence,
          openaiAvailable: !!this.openaiService
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }
}

// Export singleton instance
let moodDetectionServiceInstance: MoodDetectionService | null = null;

export const getMoodDetectionService = (): MoodDetectionService => {
  if (!moodDetectionServiceInstance) {
    moodDetectionServiceInstance = new MoodDetectionService();
  }
  return moodDetectionServiceInstance;
};
