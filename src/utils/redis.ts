import Redis from 'ioredis';
import { logger } from './logger';

// Only create Redis client if REDIS_URL is provided
const redis = process.env.REDIS_URL 
  ? new Redis(process.env.REDIS_URL)
  : null;

if (redis) {
  redis.on('connect', () => {
    logger.info('✅ Redis connected');
  });

  redis.on('error', (err) => {
    logger.error('❌ Redis error:', err);
  });
} else {
  logger.info('ℹ️  Redis disabled (optional for development)');
}

// Cache utilities
export const cacheService = {
  async get(key: string): Promise<string | null> {
    if (!redis) return null;
    return redis.get(key);
  },

  async set(key: string, value: string, expirySeconds?: number): Promise<void> {
    if (!redis) return;
    if (expirySeconds) {
      await redis.setex(key, expirySeconds, value);
    } else {
      await redis.set(key, value);
    }
  },

  async del(key: string): Promise<void> {
    if (!redis) return;
    await redis.del(key);
  },

  async exists(key: string): Promise<boolean> {
    if (!redis) return false;
    const result = await redis.exists(key);
    return result === 1;
  },

  // Pub/Sub for real-time events
  async publish(channel: string, message: string): Promise<void> {
    if (!redis) return;
    await redis.publish(channel, message);
  },

  subscribe(channel: string, callback: (message: string) => void): void {
    if (!redis) return;
    const subscriber = redis.duplicate();
    subscriber.subscribe(channel);
    subscriber.on('message', (ch, msg) => {
      if (ch === channel) callback(msg);
    });
  },
};

export { redis };
