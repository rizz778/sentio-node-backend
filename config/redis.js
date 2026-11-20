import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisClient = null;
let isConnected = false;
const inMemoryFallback = new Map();

try {
  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 2,
    connectTimeout: 3000,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) {
        console.warn('[Redis] Connection failed after 3 attempts. Falling back to in-memory cache.');
        return null; // Stop retrying and fallback
      }
      return Math.min(times * 1000, 3000);
    },
  });

  redisClient.on('connect', () => {
    isConnected = true;
    console.log('[Redis] Connected successfully.');
  });

  redisClient.on('error', (err) => {
    isConnected = false;
    console.warn(`[Redis] Connection warning: ${err.message}. Using fallback cache.`);
  });

  // Initiate connection
  redisClient.connect().catch((err) => {
    isConnected = false;
    console.warn(`[Redis] Initial connect failed: ${err.message}. Operating in memory fallback mode.`);
  });
} catch (e) {
  console.warn(`[Redis] Initialization error: ${e.message}. Using memory fallback.`);
}

export async function getCache(key) {
  if (isConnected && redisClient) {
    try {
      const data = await redisClient.get(key);
      if (data) return JSON.parse(data);
    } catch (err) {
      console.warn(`[Redis] Get failed for ${key}:`, err.message);
    }
  }
  const entry = inMemoryFallback.get(key);
  if (entry) {
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      inMemoryFallback.delete(key);
      return null;
    }
    return entry.value;
  }
  return null;
}

export async function setCache(key, value, ttlSeconds = 3600) {
  const jsonStr = JSON.stringify(value);
  if (isConnected && redisClient) {
    try {
      if (ttlSeconds > 0) {
        await redisClient.set(key, jsonStr, 'EX', ttlSeconds);
      } else {
        await redisClient.set(key, jsonStr);
      }
      return;
    } catch (err) {
      console.warn(`[Redis] Set failed for ${key}:`, err.message);
    }
  }
  inMemoryFallback.set(key, {
    value,
    expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
  });
}

export async function delCache(key) {
  if (isConnected && redisClient) {
    try {
      await redisClient.del(key);
    } catch (err) {
      console.warn(`[Redis] Del failed for ${key}:`, err.message);
    }
  }
  inMemoryFallback.delete(key);
}

export async function delCachePattern(pattern) {
  if (isConnected && redisClient) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch (err) {
      console.warn(`[Redis] Del pattern failed for ${pattern}:`, err.message);
    }
  }
  for (const k of inMemoryFallback.keys()) {
    if (k.startsWith(pattern.replace('*', ''))) {
      inMemoryFallback.delete(k);
    }
  }
}

export default redisClient;
