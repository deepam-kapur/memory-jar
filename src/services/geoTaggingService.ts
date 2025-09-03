import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';
import { getOpenAIService } from './openaiService';

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface LocationInfo extends LocationCoordinates {
  address?: string;
  placeName?: string;
  city?: string;
  country?: string;
  timezone?: string;
  locationConfidence: number;
  extractionMethod: 'whatsapp_location' | 'text_extraction' | 'manual_entry' | 'unknown';
}

export interface GeoTaggedMemory {
  locationInfo: LocationInfo;
  distanceFromHome?: number;
  isKnownPlace?: boolean;
  locationTags: string[];
}

export class GeoTaggingService {
  private openaiService = getOpenAIService();
  
  // Common place types for tagging
  private readonly placeTypes = [
    'home', 'work', 'office', 'school', 'university', 'restaurant', 'cafe', 'shop', 'mall',
    'park', 'beach', 'mountain', 'hotel', 'airport', 'station', 'hospital', 'gym',
    'church', 'library', 'museum', 'theater', 'stadium', 'friend', 'family'
  ];

  /**
   * Extract location from WhatsApp location message
   */
  async extractLocationFromWhatsApp(latitude: string, longitude: string, address?: string): Promise<LocationInfo> {
    try {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (isNaN(lat) || isNaN(lng)) {
        throw new BadRequestError('Invalid latitude/longitude coordinates', ErrorCodes.INVALID_INPUT);
      }

      // Validate coordinate ranges
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new BadRequestError('Coordinates out of valid range', ErrorCodes.INVALID_INPUT);
      }

      logger.info('Extracting location from WhatsApp coordinates', {
        latitude: lat,
        longitude: lng,
        hasAddress: !!address
      });

      // Enhance location information if we have address
      let enhancedAddress = address;
      let placeName: string | undefined;
      let city: string | undefined;
      let country: string | undefined;
      let locationTags: string[] = [];

      if (address) {
        const addressAnalysis = await this.analyzeAddress(address);
        enhancedAddress = addressAnalysis.formattedAddress || address;
        placeName = addressAnalysis.placeName;
        city = addressAnalysis.city;
        country = addressAnalysis.country;
        locationTags = addressAnalysis.tags;
      }

      // Estimate timezone based on coordinates (basic implementation)
      const timezone = this.estimateTimezone(lat, lng);

      const locationInfo: LocationInfo = {
        latitude: lat,
        longitude: lng,
        address: enhancedAddress,
        placeName,
        city,
        country,
        timezone,
        locationConfidence: address ? 0.9 : 0.7, // Higher confidence if we have address
        extractionMethod: 'whatsapp_location'
      };

      logger.info('Location extracted from WhatsApp', {
        coordinates: `${lat}, ${lng}`,
        address: enhancedAddress,
        city,
        country,
        confidence: locationInfo.locationConfidence
      });

      return locationInfo;

    } catch (error) {
      logger.error('Error extracting location from WhatsApp', {
        error: error instanceof Error ? error.message : 'Unknown error',
        latitude,
        longitude,
        address
      });
      throw new BadRequestError(
        `Failed to extract location: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.LOCATION_ERROR
      );
    }
  }

  /**
   * Extract location information from text content
   */
  async extractLocationFromText(content: string): Promise<LocationInfo | null> {
    try {
      if (!content || content.trim().length === 0) {
        return null;
      }

      logger.debug('Attempting to extract location from text', {
        contentLength: content.length,
        contentPreview: content.substring(0, 100)
      });

      // Try OpenAI extraction first
      const aiExtraction = await this.extractLocationWithAI(content);
      if (aiExtraction) {
        return aiExtraction;
      }

      // Fallback to rule-based extraction
      return this.extractLocationWithRules(content);

    } catch (error) {
      logger.error('Error extracting location from text', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contentLength: content.length
      });
      return null; // Don't throw error for text extraction failures
    }
  }

  /**
   * Create geo-tagged memory with location context
   */
  async createGeoTaggedMemory(
    locationInfo: LocationInfo,
    userHomeLocation?: LocationCoordinates
  ): Promise<GeoTaggedMemory> {
    try {
      // Calculate distance from home if provided
      let distanceFromHome: number | undefined;
      if (userHomeLocation) {
        distanceFromHome = this.calculateDistance(
          locationInfo.latitude,
          locationInfo.longitude,
          userHomeLocation.latitude,
          userHomeLocation.longitude
        );
      }

      // Determine if this is a known place
      const isKnownPlace = this.isKnownLocation(locationInfo);

      // Generate location-based tags
      const locationTags = this.generateLocationTags(locationInfo, distanceFromHome);

      const geoTaggedMemory: GeoTaggedMemory = {
        locationInfo,
        distanceFromHome,
        isKnownPlace,
        locationTags
      };

      logger.info('Geo-tagged memory created', {
        coordinates: `${locationInfo.latitude}, ${locationInfo.longitude}`,
        address: locationInfo.address,
        distanceFromHome,
        isKnownPlace,
        tagsCount: locationTags.length
      });

      return geoTaggedMemory;

    } catch (error) {
      logger.error('Error creating geo-tagged memory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        locationInfo
      });
      throw new BadRequestError(
        `Failed to create geo-tagged memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.LOCATION_ERROR
      );
    }
  }

  /**
   * Search memories by location proximity
   */
  async searchMemoriesByLocation(
    centerLat: number,
    centerLng: number,
    radiusKm: number = 1.0
  ): Promise<{
    searchCenter: LocationCoordinates;
    radiusKm: number;
    searchQuery: string;
  }> {
    try {
      // Create search parameters for location-based queries
      const searchCenter: LocationCoordinates = {
        latitude: centerLat,
        longitude: centerLng
      };

      // Generate a search query that can be used with the memory search API
      const searchQuery = `location near ${centerLat.toFixed(6)}, ${centerLng.toFixed(6)} within ${radiusKm}km`;

      logger.info('Location-based memory search requested', {
        center: `${centerLat}, ${centerLng}`,
        radius: radiusKm
      });

      return {
        searchCenter,
        radiusKm,
        searchQuery
      };

    } catch (error) {
      logger.error('Error setting up location search', {
        error: error instanceof Error ? error.message : 'Unknown error',
        centerLat,
        centerLng,
        radiusKm
      });
      throw new BadRequestError(
        `Failed to search by location: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.LOCATION_ERROR
      );
    }
  }

  /**
   * Analyze address text using AI
   */
  private async analyzeAddress(address: string): Promise<{
    formattedAddress?: string;
    placeName?: string;
    city?: string;
    country?: string;
    tags: string[];
  }> {
    try {
      const prompt = `Analyze this address and extract location information:

Address: "${address}"

Return a JSON object with this format:
{
  "formattedAddress": "clean, standardized address",
  "placeName": "name of specific place/business if mentioned",
  "city": "city name",
  "country": "country name",
  "tags": ["relevant", "location", "tags"]
}

Focus on extracting:
- Clean, formatted address
- Business/place names
- Geographic identifiers
- Location type tags (restaurant, park, office, etc.)`;

      const response = await this.openaiService.generateChatCompletion([
        {
          role: 'system',
          content: 'You are a geographic information extraction expert. Analyze addresses and return structured location data.'
        },
        {
          role: 'user',
          content: prompt
        }
      ], {
        temperature: 0.3,
        max_tokens: 200
      });

      if (response) {
        try {
          const analysis = JSON.parse(response.trim());
          return {
            formattedAddress: analysis.formattedAddress,
            placeName: analysis.placeName,
            city: analysis.city,
            country: analysis.country,
            tags: Array.isArray(analysis.tags) ? analysis.tags : []
          };
        } catch (parseError) {
          logger.warn('Failed to parse address analysis', { parseError });
        }
      }

      // Fallback analysis
      return this.simpleAddressAnalysis(address);

    } catch (error) {
      logger.error('Error analyzing address with AI', { error });
      return this.simpleAddressAnalysis(address);
    }
  }

  /**
   * Extract location using OpenAI
   */
  private async extractLocationWithAI(content: string): Promise<LocationInfo | null> {
    try {
      const prompt = `Extract location information from this text if any locations are mentioned:

Text: "${content}"

If you find location information, return a JSON object with this format:
{
  "found": true,
  "placeName": "specific place name if mentioned",
  "address": "address if mentioned",
  "city": "city name if mentioned",
  "country": "country if mentioned",
  "locationTags": ["relevant", "location", "tags"],
  "confidence": 0.0-1.0,
  "coordinates": {
    "latitude": number,
    "longitude": number
  }
}

If no clear location is found, return: {"found": false}

Only include coordinates if you're confident about specific known places.`;

      const response = await this.openaiService.generateChatCompletion([
        {
          role: 'system',
          content: 'You are a location extraction expert. Find and extract location information from text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ], {
        temperature: 0.3,
        max_tokens: 300
      });

      if (response) {
        try {
          const extraction = JSON.parse(response.trim());
          
          if (extraction.found && (extraction.placeName || extraction.address || extraction.city)) {
            return {
              latitude: extraction.coordinates?.latitude || 0,
              longitude: extraction.coordinates?.longitude || 0,
              address: extraction.address,
              placeName: extraction.placeName,
              city: extraction.city,
              country: extraction.country,
              locationConfidence: extraction.confidence || 0.6,
              extractionMethod: 'text_extraction'
            };
          }
        } catch (parseError) {
          logger.warn('Failed to parse AI location extraction', { parseError });
        }
      }

      return null;
    } catch (error) {
      logger.error('Error extracting location with AI', { error });
      return null;
    }
  }

  /**
   * Rule-based location extraction
   */
  private extractLocationWithRules(content: string): LocationInfo | null {
    const lowerContent = content.toLowerCase();
    
    // Look for common location patterns
    const locationPatterns = [
      /at\s+([\w\s]+?)(?:,|\.|\s+(?:with|and|for))/g,
      /in\s+([\w\s]+?)(?:,|\.|\s+(?:with|and|for))/g,
      /visiting\s+([\w\s]+?)(?:,|\.|\s+(?:with|and|for))/g,
      /going\s+to\s+([\w\s]+?)(?:,|\.|\s+(?:with|and|for))/g,
      /([\w\s]+)\s+(restaurant|cafe|park|mall|beach|hotel|airport|station|hospital|gym|church|library|museum)/g
    ];

    for (const pattern of locationPatterns) {
      const matches = [...content.matchAll(pattern)];
      if (matches.length > 0) {
        const placeName = matches[0][1]?.trim();
        if (placeName && placeName.length > 2 && placeName.length < 50) {
          return {
            latitude: 0,
            longitude: 0,
            placeName,
            locationConfidence: 0.5,
            extractionMethod: 'text_extraction'
          };
        }
      }
    }

    return null;
  }

  /**
   * Simple address analysis fallback
   */
  private simpleAddressAnalysis(address: string): {
    formattedAddress?: string;
    placeName?: string;
    city?: string;
    country?: string;
    tags: string[];
  } {
    const tags: string[] = [];
    
    // Extract potential place types
    for (const placeType of this.placeTypes) {
      if (address.toLowerCase().includes(placeType)) {
        tags.push(placeType);
      }
    }

    // Add generic location tag
    tags.push('location');

    return {
      formattedAddress: address,
      tags: [...new Set(tags)] // Remove duplicates
    };
  }

  /**
   * Estimate timezone based on coordinates (basic implementation)
   */
  private estimateTimezone(latitude: number, longitude: number): string {
    // Very basic timezone estimation
    // In production, you'd use a proper timezone API
    const timezoneHour = Math.round(longitude / 15);
    const utcOffset = Math.max(-12, Math.min(12, timezoneHour));
    
    if (utcOffset === 0) return 'UTC';
    if (utcOffset > 0) return `UTC+${utcOffset}`;
    return `UTC${utcOffset}`;
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
              
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return Math.round(distance * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Check if this is a known/common location
   */
  private isKnownLocation(locationInfo: LocationInfo): boolean {
    if (!locationInfo.placeName && !locationInfo.address) {
      return false;
    }

    // Check for common place types
    const knownPlaceTypes = ['home', 'work', 'office', 'school'];
    const locationText = `${locationInfo.placeName || ''} ${locationInfo.address || ''}`.toLowerCase();
    
    return knownPlaceTypes.some(placeType => locationText.includes(placeType));
  }

  /**
   * Generate location-based tags
   */
  private generateLocationTags(locationInfo: LocationInfo, distanceFromHome?: number): string[] {
    const tags: string[] = ['location'];

    // Add extraction method tag
    tags.push(`location_${locationInfo.extractionMethod}`);

    // Add place type tags
    if (locationInfo.placeName) {
      const placeName = locationInfo.placeName.toLowerCase();
      for (const placeType of this.placeTypes) {
        if (placeName.includes(placeType)) {
          tags.push(placeType);
        }
      }
    }

    // Add distance-based tags
    if (distanceFromHome !== undefined) {
      if (distanceFromHome < 1) {
        tags.push('near_home');
      } else if (distanceFromHome < 10) {
        tags.push('local_area');
      } else if (distanceFromHome < 100) {
        tags.push('regional');
      } else {
        tags.push('distant');
      }
    }

    // Add geographic tags
    if (locationInfo.city) {
      tags.push(`city_${locationInfo.city.toLowerCase().replace(/\s+/g, '_')}`);
    }
    
    if (locationInfo.country) {
      tags.push(`country_${locationInfo.country.toLowerCase().replace(/\s+/g, '_')}`);
    }

    // Add confidence level tag
    if (locationInfo.locationConfidence > 0.8) {
      tags.push('high_confidence_location');
    } else if (locationInfo.locationConfidence > 0.6) {
      tags.push('medium_confidence_location');
    } else {
      tags.push('low_confidence_location');
    }

    return [...new Set(tags)]; // Remove duplicates
  }

  /**
   * Health check for geo-tagging service
   */
  async healthCheck(): Promise<{ status: string; details: Record<string, unknown> }> {
    try {
      // Test coordinate parsing
      const testLocation = await this.extractLocationFromWhatsApp('40.7128', '-74.0060', 'New York, NY');
      
      return {
        status: 'healthy',
        details: {
          message: 'Geo-tagging service is operational',
          testLocationLatitude: testLocation.latitude,
          testLocationLongitude: testLocation.longitude,
          testLocationConfidence: testLocation.locationConfidence,
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
let geoTaggingServiceInstance: GeoTaggingService | null = null;

export const getGeoTaggingService = (): GeoTaggingService => {
  if (!geoTaggingServiceInstance) {
    geoTaggingServiceInstance = new GeoTaggingService();
  }
  return geoTaggingServiceInstance;
};
