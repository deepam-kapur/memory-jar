import { getOpenAIService } from './openaiService';
import logger from '../config/logger';

export interface IntentClassification {
  intent: 'MEMORY_CREATION' | 'MEMORY_QUERY' | 'LIST_COMMAND' | 'GREETING' | 'UNKNOWN';
  confidence: number;
  reasoning?: string;
  extractedInfo?: {
    memoryType?: 'reminder' | 'note' | 'fact' | 'personal';
    urgency?: 'low' | 'medium' | 'high';
    timeframe?: string;
    keywords?: string[];
  };
}

export class IntentClassificationService {
  private openaiService = getOpenAIService();
  private cache = new Map<string, IntentClassification>();
  
  /**
   * Classify user intent using OpenAI
   */
  async classifyIntent(message: string): Promise<IntentClassification> {
    try {
      // Check cache first
      const cacheKey = message.toLowerCase().trim();
      if (this.cache.has(cacheKey)) {
        logger.debug('Intent classification cache hit', { message: message.substring(0, 50) });
        return this.cache.get(cacheKey)!;
      }

      // Try OpenAI classification first
      const aiClassification = await this.classifyWithOpenAI(message);
      
      if (aiClassification) {
        // Cache the result
        this.cache.set(cacheKey, aiClassification);
        return aiClassification;
      }

      // Fallback to rule-based classification
      logger.warn('OpenAI classification failed, falling back to rules', { message: message.substring(0, 50) });
      return this.classifyWithRules(message);

    } catch (error) {
      logger.error('Error in intent classification', {
        error: error instanceof Error ? error.message : 'Unknown error',
        message: message.substring(0, 50),
      });
      
      // Fallback to rule-based classification
      return this.classifyWithRules(message);
    }
  }

  /**
   * Classify intent using OpenAI
   */
  private async classifyWithOpenAI(message: string): Promise<IntentClassification | null> {
    try {
      const prompt = `
You are an AI assistant that classifies user messages for a WhatsApp memory assistant bot. 

Analyze this message and classify the user's intent:

Message: "${message}"

Classification Rules:
1. MEMORY_CREATION: User wants to save/store/remember something NEW
   - Examples: "Remember to pick up dry cleaning", "Don't forget to call mom", "Note that meeting is at 3pm", "I need to buy groceries"
   - Key: User is providing NEW information they want stored for future reference
   - Pattern: Usually starts with "Remember", "Don't forget", "Note that", or states a fact/task to remember

            2. MEMORY_QUERY: User wants to search/find/recall EXISTING memories
               - Examples: "What did I plan for tomorrow?", "Show me my memories about dry cleaning", "Find my notes about groceries", "What are my tasks for today?", "What did I say about not loving my haircut?"
               - Key: User is asking to retrieve information they previously stored using question words (what, when, where, show, find, did)
               - IMPORTANT: Questions starting with "What did I..." or "What do I need to remember about X?" are QUERIES asking to recall existing memories, NOT memory creation
               - Pattern: Questions asking about past statements or memories are always QUERIES
   
3. LIST_COMMAND: User wants to see all memories
   - Examples: "/list", "list all", "show all memories"
   
4. GREETING: Simple greetings or social messages
   - Examples: "Hi", "Hello", "How are you", "Thanks"
   
5. UNKNOWN: Cannot determine clear intent

Respond with ONLY a JSON object in this exact format:
{
  "intent": "MEMORY_CREATION|MEMORY_QUERY|LIST_COMMAND|GREETING|UNKNOWN",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of why you chose this classification",
  "extractedInfo": {
    "memoryType": "reminder|note|fact|personal",
    "urgency": "low|medium|high",
    "timeframe": "extracted time information if any",
    "keywords": ["key", "words", "from", "message"]
  }
}`;

      const response = await this.openaiService.generateChatCompletion([
        { role: 'system', content: 'You are a precise intent classification system. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ], {
        temperature: 0.1, // Low temperature for consistent classification
        max_tokens: 300
      });

      if (!response) {
        return null;
      }

      // Parse JSON response
      try {
        const classification = JSON.parse(response.trim()) as IntentClassification;
        
        // Validate the response
        if (!this.isValidClassification(classification)) {
          logger.warn('Invalid OpenAI classification response', { response });
          return null;
        }

        logger.info('OpenAI intent classification successful', {
          message: message.substring(0, 50),
          intent: classification.intent,
          confidence: classification.confidence,
        });

        return classification;

      } catch (parseError) {
        logger.error('Failed to parse OpenAI classification response', {
          response,
          error: parseError instanceof Error ? parseError.message : 'Unknown error',
        });
        return null;
      }

    } catch (error) {
      logger.error('OpenAI intent classification failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        message: message.substring(0, 50),
      });
      return null;
    }
  }

  /**
   * Fallback rule-based classification
   */
  private classifyWithRules(message: string): IntentClassification {
    const lowerMessage = message.toLowerCase().trim();
    
    // List command
    if (lowerMessage === '/list' || lowerMessage.includes('list all') || lowerMessage.includes('show all memories')) {
      return {
        intent: 'LIST_COMMAND',
        confidence: 0.95,
        reasoning: 'Explicit list command detected'
      };
    }

    // Greetings
    const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'thanks', 'thank you'];
    if (greetings.some(greeting => lowerMessage === greeting || lowerMessage.startsWith(greeting + ' '))) {
      return {
        intent: 'GREETING',
        confidence: 0.9,
        reasoning: 'Common greeting pattern detected'
      };
    }

    // Question indicators (queries)
    if (lowerMessage.includes('?') || 
        lowerMessage.startsWith('what ') ||
        lowerMessage.startsWith('when ') ||
        lowerMessage.startsWith('where ') ||
        lowerMessage.startsWith('how ') ||
        lowerMessage.startsWith('why ') ||
        lowerMessage.startsWith('who ') ||
        lowerMessage.includes('show me') ||
        lowerMessage.includes('find my') ||
        lowerMessage.includes('tell me')) {
      return {
        intent: 'MEMORY_QUERY',
        confidence: 0.8,
        reasoning: 'Question or search pattern detected'
      };
    }

    // Memory creation indicators
    const memoryPatterns = [
      'remember to', 'remind me to', 'don\'t forget', 'note that', 
      'save this', 'keep in mind', 'i need to', 'i have to',
      'meeting', 'appointment', 'deadline', 'task'
    ];
    
    if (memoryPatterns.some(pattern => lowerMessage.includes(pattern))) {
      return {
        intent: 'MEMORY_CREATION',
        confidence: 0.8,
        reasoning: 'Memory creation pattern detected'
      };
    }

    // Default to memory creation for statements
    if (lowerMessage.length > 5 && !lowerMessage.includes('?')) {
      return {
        intent: 'MEMORY_CREATION',
        confidence: 0.6,
        reasoning: 'Statement without question - assuming memory creation'
      };
    }

    return {
      intent: 'UNKNOWN',
      confidence: 0.3,
      reasoning: 'Unable to determine clear intent'
    };
  }

  /**
   * Validate classification response
   */
  private isValidClassification(classification: any): classification is IntentClassification {
    const validIntents = ['MEMORY_CREATION', 'MEMORY_QUERY', 'LIST_COMMAND', 'GREETING', 'UNKNOWN'];
    
    return (
      classification &&
      typeof classification === 'object' &&
      typeof classification.intent === 'string' &&
      validIntents.includes(classification.intent) &&
      typeof classification.confidence === 'number' &&
      classification.confidence >= 0 &&
      classification.confidence <= 1
    );
  }

  /**
   * Clear the classification cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Intent classification cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()).map(key => key.substring(0, 30) + '...')
    };
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<{ status: string; details?: any }> {
    try {
      // Test with a simple classification
      const testResult = await this.classifyIntent("test message");
      
      return {
        status: 'healthy',
        details: {
          cacheSize: this.cache.size,
          testClassification: testResult.intent,
          openaiAvailable: await this.openaiService.healthCheck()
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

let intentClassificationServiceInstance: IntentClassificationService | null = null;

export const getIntentClassificationService = (): IntentClassificationService => {
  if (!intentClassificationServiceInstance) {
    intentClassificationServiceInstance = new IntentClassificationService();
  }
  return intentClassificationServiceInstance;
};
