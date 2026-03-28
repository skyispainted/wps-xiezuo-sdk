import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { BotConfig } from "./config.js";
import { verifyEventSignature, decryptEventData } from "./crypto.js";
import type { WPSEvent } from "./message-parser.js";
import { isMessageProcessed, markMessageProcessed } from "./dedup.js";

/**
 * Webhook请求处理器
 */
export type WebhookHandler = (
  event: WPSEvent,
  rawBody: any,
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void>;

/**
 * 回调处理器
 */
export type CallbackHandler = (
  callback: any,
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void>;

/**
 * Webhook服务器配置
 */
export interface WebhookServerConfig {
  port: number;
  host: string;
  webhookPath: string;
  appId: string;
  secretKey: string;
  encryptKey?: string;
  apiUrl: string;
  debug?: boolean;
}

/**
 * 常量
 */
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
const REQUEST_TIMEOUT = 30000; // 30秒

/**
 * 读取请求体（带大小限制）
 */
async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error("Request timeout"));
    }, REQUEST_TIMEOUT);

    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;

      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        clearTimeout(timeout);
        reject(new Error("Request body too large"));
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks));
    });

    req.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * 发送JSON响应
 */
function sendJsonResponse(res: ServerResponse, statusCode: number, data: any): void {
  if (res.writableEnded) return;

  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

/**
 * Webhook服务器类
 */
export class WebhookServer {
  private config: WebhookServerConfig;
  private server: HttpServer | null = null;
  private messageHandler: WebhookHandler | null = null;
  private callbackHandler: CallbackHandler | null = null;
  private debug: boolean;

  constructor(config: WebhookServerConfig) {
    this.config = config;
    this.debug = config.debug || false;
  }

  /**
   * 设置消息处理器
   */
  setMessageHandler(handler: WebhookHandler): void {
    this.messageHandler = handler;
  }

  /**
   * 设置回调处理器
   */
  setCallbackHandler(handler: CallbackHandler): void {
    this.callbackHandler = handler;
  }

  /**
   * 处理HTTP请求
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const method = req.method;
      const path = url.pathname;

      this.log(`收到请求: ${method} ${path}`);

      // 验证路径是否匹配webhook路径
      if (!path.startsWith(this.config.webhookPath)) {
        this.log(`路径不匹配: ${path} vs ${this.config.webhookPath}`);
        sendJsonResponse(res, 404, { code: -1, msg: "Not found" });
        return;
      }

      // GET请求：Challenge验证
      if (method === "GET") {
        await this.handleChallenge(req, res, url);
        return;
      }

      // POST请求：消息事件
      if (method === "POST") {
        await this.handlePost(req, res, url);
        return;
      }

      // 其他方法不支持
      res.statusCode = 405;
      res.setHeader("Allow", "GET, POST");
      res.end("Method Not Allowed");
    } catch (error) {
      this.logError(`处理请求错误: ${error}`);
      if (!res.writableEnded) {
        sendJsonResponse(res, 500, { code: -1, msg: "Internal server error" });
      }
    }
  }

  /**
   * 处理Challenge验证
   */
  private async handleChallenge(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): Promise<void> {
    const challenge = url.searchParams.get("challenge");

    if (challenge) {
      this.log(`Challenge验证: ${challenge}`);
      sendJsonResponse(res, 200, { challenge });
      return;
    }

    sendJsonResponse(res, 200, { code: 0, msg: "ok" });
  }

  /**
   * 处理POST请求
   */
  private async handlePost(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): Promise<void> {
    try {
      const rawBody = await readBody(req);
      const bodyString = rawBody.toString("utf8");

      if (!bodyString) {
        sendJsonResponse(res, 400, { code: -1, msg: "Empty body" });
        return;
      }

      // 验证Content-Type
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("application/json")) {
        sendJsonResponse(res, 400, { code: -1, msg: "Content-Type must be application/json" });
        return;
      }

      const body = JSON.parse(bodyString);

      // POST Challenge验证
      if (body.challenge) {
        this.log(`POST Challenge验证: ${body.challenge}`);
        sendJsonResponse(res, 200, { challenge: body.challenge });
        return;
      }

      // 消息事件
      if (body.topic === "kso.app_chat.message") {
        await this.handleMessageEvent(body, req, res);
        return;
      }

      // 回调事件
      if (body.callback_name) {
        await this.handleCallback(body, req, res);
        return;
      }

      // 未知事件
      sendJsonResponse(res, 200, { code: 0, msg: "ok" });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJsonResponse(res, 400, { code: -1, msg: "Invalid JSON" });
      } else if (error instanceof Error && error.message === "Request body too large") {
        sendJsonResponse(res, 413, { code: -1, msg: "Request body too large" });
      } else if (error instanceof Error && error.message === "Request timeout") {
        sendJsonResponse(res, 408, { code: -1, msg: "Request timeout" });
      } else {
        this.logError(`POST处理错误: ${error}`);
        sendJsonResponse(res, 500, { code: -1, msg: "Internal error" });
      }
    }
  }

  /**
   * 处理消息事件
   */
  private async handleMessageEvent(
    eventBody: any,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    // 立即响应
    sendJsonResponse(res, 200, { code: 0, msg: "success" });

    try {
      // 验证签名
      if (eventBody.signature && this.config.appId && this.config.secretKey) {
        const isValid = verifyEventSignature(
          this.config.appId,
          this.config.secretKey,
          eventBody.topic,
          eventBody.nonce,
          eventBody.time,
          eventBody.encrypted_data,
          eventBody.signature
        );

        if (!isValid) {
          this.logError("签名验证失败");
          return;
        }
      }

      // 解密数据
      let eventData: WPSEvent;
      if (eventBody.encrypted_data && this.config.secretKey) {
        const decryptedJson = decryptEventData(
          this.config.secretKey,
          eventBody.encrypted_data,
          eventBody.nonce
        );
        eventData = JSON.parse(decryptedJson);
      } else {
        eventData = eventBody.data || eventBody;
      }

      // 消息去重
      const messageId = eventData.message?.id;
      if (messageId) {
        const dedupKey = `${this.config.appId}:${messageId}`;
        if (isMessageProcessed(dedupKey)) {
          this.log(`跳过重复消息: ${dedupKey}`);
          return;
        }
        markMessageProcessed(dedupKey);
      }

      // 调用消息处理器
      if (this.messageHandler) {
        await this.messageHandler(eventData, eventBody, req, res);
      }
    } catch (error) {
      this.logError(`消息处理错误: ${error}`);
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
    // 立即响应
    sendJsonResponse(res, 200, { code: 0, msg: "success" });

    this.log(`收到回调: ${callback.callback_name}`);

    // 调用回调处理器
    if (this.callbackHandler) {
      await this.callbackHandler(callback, req, res);
    }
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error("服务器已启动");
    }

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        this.logError(`处理请求异常: ${err}`);
        if (!res.writableEnded) {
          sendJsonResponse(res, 500, { code: -1, msg: "Internal server error" });
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.on("error", (err) => {
        reject(err);
      });

      this.server!.listen(this.config.port, this.config.host, () => {
        this.log(`服务器启动: http://${this.config.host}:${this.config.port}${this.config.webhookPath}`);
        resolve();
      });
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          this.log("服务器已停止");
          resolve();
        }
      });
    });
  }

  /**
   * 获取Webhook URL
   */
  getWebhookUrl(): string {
    return `http://${this.config.host}:${this.config.port}${this.config.webhookPath}`;
  }

  /**
   * 日志输出
   */
  private log(message: string): void {
    if (this.debug) {
      console.log(`[WebhookServer] ${message}`);
    }
  }

  /**
   * 错误日志输出
   */
  private logError(message: string): void {
    console.error(`[WebhookServer] ${message}`);
  }
}

/**
 * 从BotConfig创建WebhookServerConfig
 */
export function createWebhookConfig(config: BotConfig): WebhookServerConfig {
  return {
    port: config.port || 3000,
    host: config.host || "localhost",
    webhookPath: config.webhookPath || "/webhook",
    appId: config.appId,
    secretKey: config.secretKey,
    encryptKey: config.encryptKey,
    apiUrl: config.apiUrl || "https://openapi.wps.cn",
    debug: config.debug,
  };
}