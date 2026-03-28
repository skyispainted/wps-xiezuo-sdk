/**
 * 消息去重模块
 */

// 存储已处理的消息键（过期时间10分钟）
const processedMessages = new Map<string, number>();
const EXPIRY_MS = 10 * 60 * 1000; // 10分钟

/**
 * 检查消息是否已被处理
 */
export function isMessageProcessed(key: string): boolean {
  const timestamp = processedMessages.get(key);
  if (!timestamp) {
    return false;
  }

  const now = Date.now();
  if (now - timestamp > EXPIRY_MS) {
    processedMessages.delete(key);
    return false;
  }

  return true;
}

/**
 * 标记消息为已处理
 */
export function markMessageProcessed(key: string): void {
  processedMessages.set(key, Date.now());
}

/**
 * 清理过期的去重键
 */
export function cleanupExpiredDedupKeys(): void {
  const now = Date.now();
  for (const [key, timestamp] of processedMessages.entries()) {
    if (now - timestamp > EXPIRY_MS) {
      processedMessages.delete(key);
    }
  }
}