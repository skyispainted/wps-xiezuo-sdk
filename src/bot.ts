import type { IncomingMessage, ServerResponse } from "node:http";
import { type BotConfig, mergeBotConfig } from "./config.js";
import { WPSClient, type RichTextElement, type WPSResponse } from "./client.js";
import { WebhookServer, createWebhookConfig } from "./webhook-server.js";
import { parseWPSMessage, type WPSEvent, type ParsedMessage } from "./message-parser.js";
import { normalizeAllowFrom, isSenderAllowed, isSenderGroupAllowed } from "./access-control.js";
import { autoFetchCompanyId } from "./auto-config.js";

/**
 * Bot事件类型
 */
export type BotEventType = "message" | "card_callback" | "group_event" | "error";

/**
 * 消息上下文
 */
export interface MessageContext {
  /** 解析后的消息 */
  message: ParsedMessage;
  /** 原始事件数据 */
  rawEvent: WPSEvent;
  /** 发送文本回复 */
  reply: (text: string) => Promise<void>;
  /** 发送媒体回复 */
  replyMedia: (url: string, type: "image" | "file" | "video" | "audio") => Promise<void>;
  /** 发送富文本回复 */
  replyRichText: (elements: RichTextElement[]) => Promise<void>;
  /** WPS客户端实例 */
  client: WPSClient;
  /** 当前配置 */
  config: BotConfig;
}

/**
 * 卡片回调上下文
 */
export interface CardCallbackContext {
  /** 回调数据 */
  callback: {
    callback_name: string;
    value?: any;
    user_id?: string;
    chat_id?: string;
  };
  /** 原始回调数据 */
  rawData: any;
  /** 发送回复 */
  reply: (text: string) => Promise<void>;
  /** WPS客户端实例 */
  client: WPSClient;
  /** 当前配置 */
  config: BotConfig;
}

/**
 * 群事件上下文
 */
export interface GroupEventContext {
  /** 事件数据 */
  event: {
    type: "join" | "leave" | "update";
    group_id: string;
    user_id?: string;
    timestamp: number;
  };
  /** 原始事件数据 */
  rawData: any;
  /** WPS客户端实例 */
  client: WPSClient;
  /** 当前配置 */
  config: BotConfig;
}

/**
 * 错误上下文
 */
export interface ErrorContext {
  /** 错误对象 */
  error: Error;
  /** 错误来源 */
  source: "message" | "callback" | "server" | "unknown";
  /** 原始数据（如果有） */
  rawData?: any;
}

/**
 * 消息处理器
 */
export type MessageHandler = (ctx: MessageContext) => Promise<void> | void;

/**
 * 卡片回调处理器
 */
export type CardCallbackHandler = (ctx: CardCallbackContext) => Promise<void> | void;

/**
 * 群事件处理器
 */
export type GroupEventHandler = (ctx: GroupEventContext) => Promise<void> | void;

/**
 * 错误处理器
 */
export type ErrorHandler = (ctx: ErrorContext) => Promise<void> | void;

/**
 * CompanyId缓存
 */
interface CompanyIdCache {
  companyId: string;
  appId: string;
  fetchedAt: number;
}

/**
 * WPS协作机器人SDK核心类
 */
export class WpsXiezuoBot {
  private config: BotConfig;
  private client: WPSClient;
  private webhookServer: WebhookServer | null = null;
  private messageHandlers: MessageHandler[] = [];
  private cardCallbackHandlers: CardCallbackHandler[] = [];
  private groupEventHandlers: GroupEventHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private companyIdCache: CompanyIdCache | null = null;
  private debug: boolean;

  constructor(config: Partial<BotConfig> & { appId: string; secretKey: string }) {
    // 合并配置
    this.config = mergeBotConfig(config);
    this.debug = this.config.debug || false;

    // 创建客户端
    this.client = new WPSClient(
      this.config.appId,
      this.config.secretKey,
      this.config.apiUrl || "https://openapi.wps.cn"
    );
  }

  /**
   * 注册消息处理器
   */
  on(event: "message", handler: MessageHandler): this;

  /**
   * 注册卡片回调处理器
   */
  on(event: "card_callback", handler: CardCallbackHandler): this;

  /**
   * 注册群事件处理器
   */
  on(event: "group_event", handler: GroupEventHandler): this;

  /**
   * 注册错误处理器
   */
  on(event: "error", handler: ErrorHandler): this;

  on(event: BotEventType, handler: any): this {
    switch (event) {
      case "message":
        this.messageHandlers.push(handler);
        break;
      case "card_callback":
        this.cardCallbackHandlers.push(handler);
        break;
      case "group_event":
        this.groupEventHandlers.push(handler);
        break;
      case "error":
        this.errorHandlers.push(handler);
        break;
    }
    return this;
  }

  /**
   * 移除消息处理器
   */
  off(event: "message", handler: MessageHandler): this;

  /**
   * 移除卡片回调处理器
   */
  off(event: "card_callback", handler: CardCallbackHandler): this;

  /**
   * 移除群事件处理器
   */
  off(event: "group_event", handler: GroupEventHandler): this;

  /**
   * 移除错误处理器
   */
  off(event: "error", handler: ErrorHandler): this;

  off(event: BotEventType, handler: any): this {
    switch (event) {
      case "message":
        this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
        break;
      case "card_callback":
        this.cardCallbackHandlers = this.cardCallbackHandlers.filter((h) => h !== handler);
        break;
      case "group_event":
        this.groupEventHandlers = this.groupEventHandlers.filter((h) => h !== handler);
        break;
      case "error":
        this.errorHandlers = this.errorHandlers.filter((h) => h !== handler);
        break;
    }
    return this;
  }

  /**
   * 启动Bot（启动Webhook服务器）
   */
  async start(port?: number, host?: string): Promise<void> {
    // 更新端口和主机
    if (port !== undefined) {
      this.config.port = port;
    }
    if (host !== undefined) {
      this.config.host = host;
    }

    // 预加载companyId
    if (!this.config.companyId) {
      try {
        const companyId = await autoFetchCompanyId(
          this.config.appId,
          this.config.secretKey,
          this.config.apiUrl || "https://openapi.wps.cn"
        );
        this.companyIdCache = {
          companyId,
          appId: this.config.appId,
          fetchedAt: Date.now(),
        };
        this.log(`预加载companyId: ${companyId}`);
      } catch (error) {
        this.log(`预加载companyId失败: ${error}`);
      }
    }

    // 创建Webhook服务器
    const webhookConfig = createWebhookConfig(this.config);
    this.webhookServer = new WebhookServer(webhookConfig);

    // 设置处理器
    this.webhookServer.setMessageHandler(this.handleMessage.bind(this));
    this.webhookServer.setCallbackHandler(this.handleCallback.bind(this));

    // 启动服务器
    await this.webhookServer.start();
    this.log(`Bot启动成功: ${this.getWebhookUrl()}`);
  }

  /**
   * 停止Bot
   */
  async stop(): Promise<void> {
    if (this.webhookServer) {
      await this.webhookServer.stop();
      this.webhookServer = null;
    }
    this.log("Bot已停止");
  }

  /**
   * 处理HTTP请求（用于自定义服务器）
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.webhookServer) {
      const webhookConfig = createWebhookConfig(this.config);
      this.webhookServer = new WebhookServer(webhookConfig);
      this.webhookServer.setMessageHandler(this.handleMessage.bind(this));
      this.webhookServer.setCallbackHandler(this.handleCallback.bind(this));
    }

    await this.webhookServer.handleRequest(req, res);
  }

  /**
   * 获取Webhook URL
   */
  getWebhookUrl(): string {
    if (this.webhookServer) {
      return this.webhookServer.getWebhookUrl();
    }
    return `http://${this.config.host || "localhost"}:${this.config.port || 3000}${this.config.webhookPath || "/webhook"}`;
  }

  /**
   * 获取WPS客户端
   */
  getClient(): WPSClient {
    return this.client;
  }

  /**
   * 获取配置
   */
  getConfig(): BotConfig {
    return { ...this.config };
  }

  /**
   * 获取companyId
   */
  async getCompanyId(): Promise<string> {
    if (this.config.companyId) {
      return this.config.companyId;
    }

    if (this.companyIdCache && this.companyIdCache.appId === this.config.appId) {
      return this.companyIdCache.companyId;
    }

    const companyId = await autoFetchCompanyId(
      this.config.appId,
      this.config.secretKey,
      this.config.apiUrl || "https://openapi.wps.cn"
    );

    this.companyIdCache = {
      companyId,
      appId: this.config.appId,
      fetchedAt: Date.now(),
    };

    return companyId;
  }

  /**
   * 发送消息（主动发送）
   */
  async sendTextMessage(text: string, chatId: string, chatType: "p2p" | "group"): Promise<WPSResponse> {
    return this.client.sendTextMessage(text, chatId, chatType);
  }

  /**
   * 发送图片消息（主动发送）
   */
  async sendImageMessage(storageKey: string, chatId: string, chatType: "p2p" | "group"): Promise<WPSResponse> {
    return this.client.sendImageMessage(storageKey, chatId, chatType);
  }

  /**
   * 发送文件消息（主动发送）
   */
  async sendFileMessage(storageKey: string, chatId: string, chatType: "p2p" | "group", fileName: string): Promise<WPSResponse> {
    return this.client.sendFileMessage(storageKey, chatId, chatType, fileName);
  }

  // ==================== 内部方法 ====================

  /**
   * 处理消息事件
   */
  private async handleMessage(
    event: WPSEvent,
    rawBody: any,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    try {
      // 解析消息
      const parsed = parseWPSMessage(event);

      // 权限检查（群聊）
      if (parsed.chatType === "group") {
        // 检查是否需要@机器人
        if (this.config.requireMention !== false && !parsed.isAtBot) {
          this.log("群消息未@机器人，忽略");
          return;
        }

        // 检查群白名单
        if (this.config.groupPolicy === "allowlist" && this.config.allowFrom) {
          const normalizedAllowFrom = normalizeAllowFrom(this.config.allowFrom);
          if (!isSenderGroupAllowed({ allow: normalizedAllowFrom, groupId: parsed.chatId })) {
            this.log(`群聊不在白名单: ${parsed.chatId}`);
            return;
          }
        }
      }

      // 权限检查（私聊）
      if (parsed.chatType === "p2p") {
        if (this.config.dmPolicy === "allowlist" && this.config.allowFrom) {
          const normalizedAllowFrom = normalizeAllowFrom(this.config.allowFrom);
          if (!isSenderAllowed({ allow: normalizedAllowFrom, senderId: parsed.senderId })) {
            this.log(`用户不在白名单: ${parsed.senderId}`);
            return;
          }
        }
      }

      // 显示思考中提示
      if (this.config.showThinking) {
        try {
          await this.client.sendTextMessage(
            "🤔 思考中，请稍候...",
            parsed.chatType === "p2p" ? parsed.senderId : parsed.chatId,
            parsed.chatType
          );
        } catch (error) {
          this.log(`发送思考提示失败: ${error}`);
        }
      }

      // 创建上下文
      const ctx: MessageContext = {
        message: parsed,
        rawEvent: event,
        client: this.client,
        config: this.config,
        reply: async (text: string) => {
          const targetId = parsed.chatType === "p2p" ? parsed.senderId : parsed.chatId;
          await this.client.sendTextMessage(text, targetId, parsed.chatType);
        },
        replyMedia: async (url: string, type: "image" | "file" | "video" | "audio") => {
          const targetId = parsed.chatType === "p2p" ? parsed.senderId : parsed.chatId;
          if (type === "image") {
            await this.client.sendImageMessage(url, targetId, parsed.chatType);
          } else {
            await this.client.sendFileMessage(url, targetId, parsed.chatType, url.split("/").pop() || "file");
          }
        },
        replyRichText: async (elements: RichTextElement[]) => {
          const targetId = parsed.chatType === "p2p" ? parsed.senderId : parsed.chatId;
          await this.client.sendRichTextMessage(elements, targetId, parsed.chatType);
        },
      };

      // 调用消息处理器
      for (const handler of this.messageHandlers) {
        try {
          await handler(ctx);
        } catch (error) {
          await this.emitError(error as Error, "message", rawBody);
        }
      }
    } catch (error) {
      await this.emitError(error as Error, "message", rawBody);
    }
  }

  /**
   * 处理回调事件
   */
  private async handleCallback(
    callback: any,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    try {
      // 创建上下文
      const ctx: CardCallbackContext = {
        callback: {
          callback_name: callback.callback_name,
          value: callback.value,
          user_id: callback.user_id,
          chat_id: callback.chat_id,
        },
        rawData: callback,
        client: this.client,
        config: this.config,
        reply: async (text: string) => {
          if (callback.chat_id) {
            await this.client.sendTextMessage(text, callback.chat_id, "group");
          }
        },
      };

      // 调用卡片回调处理器
      for (const handler of this.cardCallbackHandlers) {
        try {
          await handler(ctx);
        } catch (error) {
          await this.emitError(error as Error, "callback", callback);
        }
      }
    } catch (error) {
      await this.emitError(error as Error, "callback", callback);
    }
  }

  /**
   * 触发错误事件
   */
  private async emitError(error: Error, source: ErrorContext["source"], rawData?: any): Promise<void> {
    const ctx: ErrorContext = {
      error,
      source,
      rawData,
    };

    for (const handler of this.errorHandlers) {
      try {
        await handler(ctx);
      } catch (handlerError) {
        console.error(`[WpsXiezuoBot] 错误处理器异常: ${handlerError}`);
      }
    }

    this.logError(`错误: ${error.message}`);
  }

  /**
   * 日志输出
   */
  private log(message: string): void {
    if (this.debug) {
      console.log(`[WpsXiezuoBot] ${message}`);
    }
  }

  /**
   * 错误日志输出
   */
  private logError(message: string): void {
    console.error(`[WpsXiezuoBot] ${message}`);
  }
}

/**
 * 创建Bot实例（便捷方法）
 */
export function createBot(config: Partial<BotConfig> & { appId: string; secretKey: string }): WpsXiezuoBot {
  return new WpsXiezuoBot(config);
}