import { z } from "zod";

/**
 * WPS协作机器人SDK配置Schema
 */
export const BotConfigSchema = z.object({
  // 基本配置
  name: z.string().optional().describe("账号名称（可选显示名称）"),
  enabled: z.boolean().optional().default(true).describe("是否启用"),

  // WPS协作应用配置
  appId: z.string().describe("WPS应用ID (App ID)"),
  secretKey: z.string().describe("WPS应用密钥 (Secret Key) - 用于API签名"),
  encryptKey: z.string().optional().describe("加密密钥 (Encrypt Key) - 用于回调验证和事件解密"),
  apiUrl: z.string().optional().default("https://openapi.wps.cn").describe("WPS API基础地址"),
  webhookPath: z.string().optional().default("/webhook").describe("Webhook回调路径"),

  // HTTP服务器配置
  port: z.number().optional().default(3000).describe("Webhook服务器端口"),
  host: z.string().optional().default("localhost").describe("Webhook服务器主机"),

  // 企业信息
  companyId: z.string().optional().describe("企业ID - 发送单聊消息时需要"),

  // 访问控制策略
  dmPolicy: z.enum(["open", "allowlist"]).optional().default("open").describe("私聊策略：open-开放 / allowlist-白名单"),
  groupPolicy: z.enum(["open", "allowlist"]).optional().default("open").describe("群聊策略：open-开放 / allowlist-白名单"),
  allowFrom: z.array(z.string()).optional().describe("允许的用户/群聊ID列表（白名单模式使用）"),

  // 消息处理选项
  showThinking: z.boolean().optional().default(false).describe("是否显示\"思考中\"提示"),
  requireMention: z.boolean().optional().default(true).describe("群聊是否需要@机器人才响应"),
  groupSystemPrompt: z.string().optional().describe("群聊系统提示词"),

  // 调试选项
  debug: z.boolean().optional().default(false).describe("启用调试日志"),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;

/**
 * 验证配置
 */
export function validateBotConfig(config: unknown): BotConfig {
  return BotConfigSchema.parse(config);
}

/**
 * 验证配置（宽松模式，返回部分结果）
 */
export function validateBotConfigPartial(config: unknown): Partial<BotConfig> {
  return BotConfigSchema.partial().parse(config);
}

/**
 * 默认配置
 */
export const DEFAULT_BOT_CONFIG: Partial<BotConfig> = {
  apiUrl: "https://openapi.wps.cn",
  webhookPath: "/webhook",
  port: 3000,
  host: "localhost",
  dmPolicy: "open",
  groupPolicy: "open",
  showThinking: false,
  requireMention: true,
  debug: false,
  enabled: true,
};

/**
 * 合并配置与默认值
 */
export function mergeBotConfig(config: Partial<BotConfig>): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    ...config,
    appId: config.appId || "",
    secretKey: config.secretKey || "",
  } as BotConfig;
}