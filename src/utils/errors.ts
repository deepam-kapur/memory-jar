// Base application error class
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;
  public readonly timestamp: Date;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = ErrorCodes.INTERNAL_ERROR,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'BaseError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.timestamp = new Date();

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  // Make error serializable
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      code: this.code,
      isOperational: this.isOperational,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

// HTTP 400 - Bad Request
export class BadRequestError extends AppError {
  constructor(message: string = 'Bad Request', code: string = ErrorCodes.BAD_REQUEST) {
    super(message, 400, code);
    this.name = 'BadRequestError';
  }
}

// HTTP 401 - Unauthorized
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', code: string = ErrorCodes.UNAUTHORIZED) {
    super(message, 401, code);
    this.name = 'UnauthorizedError';
  }
}

// HTTP 403 - Forbidden
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', code: string = ErrorCodes.FORBIDDEN) {
    super(message, 403, code);
    this.name = 'ForbiddenError';
  }
}

// HTTP 404 - Not Found
export class NotFoundError extends AppError {
  constructor(message: string = 'Not Found', code: string = ErrorCodes.RESOURCE_NOT_FOUND) {
    super(message, 404, code);
    this.name = 'NotFoundError';
  }
}

// HTTP 409 - Conflict
export class ConflictError extends AppError {
  constructor(message: string = 'Conflict', code: string = ErrorCodes.CONFLICT) {
    super(message, 409, code);
    this.name = 'ConflictError';
  }
}

// HTTP 422 - Unprocessable Entity
export class ValidationError extends AppError {
  public readonly details?: Record<string, string[]>;

  constructor(
    message: string = 'Validation Error',
    details?: Record<string, string[]>,
    code: string = ErrorCodes.VALIDATION_ERROR
  ) {
    super(message, 422, code);
    this.name = 'ValidationError';
    this.details = details || undefined;
  }

  // Override toJSON to include details
  override toJSON() {
    const base = super.toJSON();
    return {
      ...base,
      details: this.details,
    };
  }
}

// HTTP 429 - Too Many Requests
export class RateLimitError extends AppError {
  constructor(message: string = 'Too Many Requests', code: string = ErrorCodes.RATE_LIMIT_EXCEEDED) {
    super(message, 429, code);
    this.name = 'RateLimitError';
  }
}

// HTTP 500 - Internal Server Error
export class InternalServerError extends AppError {
  constructor(message: string = 'Internal Server Error', code: string = ErrorCodes.INTERNAL_ERROR) {
    super(message, 500, code);
    this.name = 'InternalServerError';
  }
}

// HTTP 503 - Service Unavailable
export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service Unavailable', code?: string) {
    super(message, 503, code);
  }
}

// Database errors
export class DatabaseError extends AppError {
  constructor(message: string = 'Database Error', code?: string) {
    super(message, 500, code);
  }
}

// External service errors
export class ExternalServiceError extends AppError {
  constructor(
    service: string,
    message: string = 'External Service Error',
    code?: string
  ) {
    super(`${service}: ${message}`, 502, code);
  }
}

// Error codes enum
export enum ErrorCodes {
  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT = 'INVALID_FORMAT',
  
  // Authentication errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  
  // Resource errors
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',
  
  // HTTP errors
  BAD_REQUEST = 'BAD_REQUEST',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // Database errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  DATABASE_CONNECTION_ERROR = 'DATABASE_CONNECTION_ERROR',
  DATABASE_QUERY_ERROR = 'DATABASE_QUERY_ERROR',
  DATABASE_TRANSACTION_ERROR = 'DATABASE_TRANSACTION_ERROR',
  
  // External service errors
  TWILIO_ERROR = 'TWILIO_ERROR',
  MEM0_ERROR = 'MEM0_ERROR',
  LOCAL_STORAGE_ERROR = 'LOCAL_STORAGE_ERROR',
  OPENAI_ERROR = 'OPENAI_ERROR',
  LOCATION_ERROR = 'LOCATION_ERROR',
  
  // File errors
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  FILE_UPLOAD_ERROR = 'FILE_UPLOAD_ERROR',
  
  // Conversion errors
  CONVERSION_ERROR = 'CONVERSION_ERROR',
  
  // General errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

// Export BaseError as alias for AppError for backward compatibility
export const BaseError = AppError;
