/**
 * WPS协作机器人SDK
 *
 * 用于构建WPS协作企业机器人应用的独立SDK
 *
 * @example
 * ```typescript
 * import { WpsXiezuoBot } from '@skyispainted/wps-xiezuo-sdk';
 *
 * const bot = new WpsXiezuoBot({
 *   appId: 'your-app-id',
 *   secretKey: 'your-secret-key',
 *   encryptKey: 'your-encrypt-key',
 * });
 *
 * bot.on('message', async (ctx) => {
 *   await ctx.reply('你好！');
 * });
 *
 * await bot.start(3000);
 * ```
 */

// 核心类
export { WpsXiezuoBot, createBot } from "./src/bot.js";
export { WPSClient } from "./src/client.js";
export { WebhookServer, createWebhookConfig } from "./src/webhook-server.js";

// 配置
export {
  BotConfigSchema,
  type BotConfig,
  validateBotConfig,
  validateBotConfigPartial,
  DEFAULT_BOT_CONFIG,
  mergeBotConfig,
} from "./src/config.js";

// 消息类型
export {
  type WPSEvent,
  type ParsedMessage,
  parseWPSMessage,
  formatMessageForLog,
} from "./src/message-parser.js";

// 上下文类型
export type {
  MessageContext,
  CardCallbackContext,
  GroupEventContext,
  ErrorContext,
  BotEventType,
  MessageHandler,
  CardCallbackHandler,
  GroupEventHandler,
  ErrorHandler,
} from "./src/bot.js";

// WPS客户端类型
export type {
  WPSResponse,
  Mention,
  RichTextElement,
} from "./src/client.js";

// 富文本辅助函数
export {
  createTextElement,
  createStyledTextElement,
  createMentionElement,
  createImageElement,
  createLinkElement,
  createDocElement,
} from "./src/client.js";

// 访问控制
export {
  normalizeAllowFrom,
  isSenderAllowed,
  isSenderGroupAllowed,
} from "./src/access-control.js";

// 消息去重
export {
  isMessageProcessed,
  markMessageProcessed,
  cleanupExpiredDedupKeys,
} from "./src/dedup.js";

// 自动配置
export {
  autoFetchCompanyId,
  ensureConfigComplete,
} from "./src/auto-config.js";

// 媒体工具
export { detectMediaTypeFromExtension } from "./src/media-utils.js";

// Token管理
export {
  TokenManager,
  tokenManager,
  oauthTokenManager,
  companyTokenManager,
} from "./src/token-manager.js";

// 加密工具（高级用户）
export {
  calculateContentMd5,
  md5Hex,
  getRFC1123Date,
  calculateKSO1Signature,
  generateKSO1AuthHeader,
  verifyKSO1Signature,
  calculateWPS3Signature,
  calculateEventSignature,
  verifyEventSignature,
  decryptEventData,
} from "./src/crypto.js";

/**
 * 处理Webhook请求（用于自定义HTTP服务器）
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { WpsXiezuoBot, handleWebhookRequest } from '@skyispainted/wps-xiezuo-sdk';
 *
 * const app = express();
 * const bot = new WpsXiezuoBot({ ... });
 *
 * app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
 *   await handleWebhookRequest(bot, req, res);
 * });
 *
 * app.listen(3000);
 * ```
 */
export async function handleWebhookRequest(
  bot: import("./src/bot.js").WpsXiezuoBot,
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse
): Promise<void> {
  await bot.handleRequest(req, res);
}