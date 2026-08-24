import { getRedis } from "./redis.js";

const PREFIX = "zoco:";
const memory = new Map();

function key(name) {
  return `${PREFIX}${name}`;
}

export async function cacheGet(name) {
  try {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.get(key(name));
      return raw ? JSON.parse(raw) : null;
    }
  } catch {
    /* fall through to memory */
  }
  const hit = memory.get(name);
  if (!hit) return null;
  if (hit.expires && hit.expires < Date.now()) {
    memory.delete(name);
    return null;
  }
  return hit.value;
}

export async function cacheSet(name, value, ttlSeconds = 30) {
  try {
    const redis = getRedis();
    if (redis) {
      await redis.set(key(name), JSON.stringify(value), "EX", ttlSeconds);
      return;
    }
  } catch {
    /* memory fallback */
  }
  memory.set(name, { value, expires: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDel(...names) {
  try {
    const redis = getRedis();
    if (redis && names.length) {
      await redis.del(...names.map(key));
      return;
    }
  } catch {
    /* memory fallback */
  }
  for (const name of names) memory.delete(name);
}

export async function cacheDelPrefix(prefix) {
  const redis = getRedis();
  if (redis) {
    const keys = await redis.keys(`${PREFIX}${prefix}*`);
    if (keys.length) await redis.del(...keys);
    return;
  }
  for (const name of memory.keys()) {
    if (name.startsWith(prefix)) memory.delete(name);
  }
}
