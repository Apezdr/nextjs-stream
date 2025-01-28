import { createClient } from 'redis';

let redisClient = null;

/**
 * Initializes and returns the Redis client if Redis is configured.
 * Implements a singleton pattern to ensure only one client exists.
 * @returns {RedisClient | null} - The Redis client or null if not configured.
 */
export async function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } = process.env;

  // Check if Redis configuration is provided
  if (!REDIS_HOST || !REDIS_PORT) {
    console.warn('Redis is not configured. Caching is disabled.');
    return null;
  }

  try {
    // Create a new Redis client
    redisClient = createClient({
      socket: {
        host: REDIS_HOST,
        port: Number(REDIS_PORT),
        // Optional: Add TLS/SSL options if needed
      },
      password: REDIS_PASSWORD || undefined,
    });

    // Handle Redis client errors
    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
      // Optionally, set redisClient to null to allow retrying connection
      redisClient = null;
    });

    // Connect to Redis
    await redisClient.connect();
    console.log('Connected to Redis successfully.');

    return redisClient;
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    redisClient = null;
    return null;
  }
}
