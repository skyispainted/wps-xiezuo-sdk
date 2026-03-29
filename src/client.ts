import { oauthTokenManager } from "./token-manager.js";
import { getRFC1123Date, generateKSO1AuthHeader } from "./crypto.js";

/**
 * @用户配置的Mention信息，用于构建消息中的@提及功能。
 * 在调用sendTextMessage时传入此结构，会在消息中@指定用户或全体成员。
 */
export interface Mention {
  /** @标记的索引ID，对应消息内容中的 <at id={index}> */
  id: string;
  /** @类型: user=特定用户, all=全体成员 */
  type: "user" | "all";
  /** 用户ID（当type="user"时必填） */
  userId?: string;
  /** 用户名称（当type="user"时必填） */
  userName?: string;
  /** 企业ID（可选，当跨企业时需要） */
  companyId?: string;
}

/**
 * 构建mentions数组，用于发送消息时@用户或@全体成员。
 *
 * @param mentions @用户配置数组，每个元素包含要@的用户或全体成员信息。
 * @returns WPS API格式的mentions数组，或undefined（如果没有mentions）。
 */
function buildMentions(mentions?: Mention[]): any[] | undefined {
  if (!mentions || mentions.length === 0) {
    return undefined;
  }

  return mentions.map(m => {
    if (m.type === "all") {
      // @所有人，只需要id和type
      return {
        id: m.id,
        type: "all",
      };
    }

    // @特定用户，需要完整的identity信息
    return {
      id: m.id,
      identity: {
        id: m.userId,
        name: m.userName,
        type: "user" as const,
        ...(m.companyId ? { company_id: m.companyId } : {}),
      },
      type: "user" as const,
    };
  });
}

/**
 * 用户邮箱信息
 */
export interface UserMailbox {
  /** 邮箱地址 */
  email_address: string;
  /** 邮箱类型: user=用户邮箱 */
  email_type: "user";
  /** 是否为主邮箱 */
  is_primary: boolean;
}

/**
 * 用户ID类型
 */
export type UserIdType = "internal" | "external";

export interface WPSResponse {
  result: number;
  msg?: string;
  message_id?: string;
}

export class WPSClient {
  private readonly appId: string;
  private readonly secretKey: string;
  private readonly apiUrl: string;
  private readonly timeout: number = 10000; // 10秒超时

  constructor(appId: string, secretKey: string, apiUrl: string) {
    this.appId = appId;
    this.secretKey = secretKey;
    this.apiUrl = apiUrl;
  }

  /**
   * 获取会话消息文件下载地址
   *
   * API文档: https://openapi.wps.cn/v7/chats/{chat_id}/messages/{message_id}/resources/{storage_key}/download
   * 方法: GET
   * 权限: kso.chat_message.readwrite
   *
   * @param chatId 会话ID
   * @param messageId 消息ID
   * @param storageKey 文件的storage_key
   * @param fileName 可选，下载的文件名称
   * @returns 临时下载链接
   */
  async getDownloadUrl(
    chatId: string,
    messageId: string,
    storageKey: string,
    fileName?: string
  ): Promise<string> {
    const accessToken = await oauthTokenManager.getAccessToken(
      this.appId,
      this.secretKey,
      this.apiUrl
    );

    // 构造API路径
    const path = `/v7/chats/${chatId}/messages/${messageId}/resources/${storageKey}/download`;

    // 查询参数
    const queryParams = new URLSearchParams();
    if (fileName) {
      queryParams.set("file_name", fileName);
    }

    const fullPath = queryParams.toString()
      ? `${path}?${queryParams.toString()}`
      : path;

    console.log(`[DEBUG] 调用文件下载API: GET ${fullPath}`);

    try {
      const result = await this.sendV7Request("GET", fullPath, null, accessToken);

      console.log(`[DEBUG] 文件下载API响应:`, JSON.stringify(result));

      // 响应格式: { "data": { "url": "string" }, "code": 0, "msg": "string" }
      if (result.code === 0 && result.data?.url) {
        console.log(`[DEBUG] 成功获取下载链接`);
        return result.data.url;
      }

      throw new Error(`API返回错误: ${result.msg || "未知错误"}`);
    } catch (error) {
      console.error(`[ERROR] 获取文件下载链接失败:`, error);
      throw error;
    }
  }

  /**
   * 发送V7请求（支持GET/POST等方法）
   */
  private async sendV7Request(
    method: string,
    path: string,
    body: any,
    accessToken: string
  ): Promise<any> {
    return this.sendV7RequestWithHeaders(method, path, body, accessToken, {});
  }

  /**
   * 发送V7请求（支持自定义headers）
   */
  private async sendV7RequestWithHeaders(
    method: string,
    path: string,
    body: any,
    accessToken: string,
    extraHeaders: Record<string, string>
  ): Promise<any> {
    const url = `${this.apiUrl}${path}`;
    const contentType = body ? "application/json" : undefined;
    const ksoDate = getRFC1123Date();
    const bodyString = body ? JSON.stringify(body) : "";

    const ksoSignature = generateKSO1AuthHeader(
      this.appId,
      method,
      path,
      contentType || "",
      ksoDate,
      bodyString,
      this.secretKey
    );

    // 使用 AbortController 实现超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          "X-Kso-Date": ksoDate,
          "X-Kso-Authorization": ksoSignature,
          "Authorization": `Bearer ${accessToken}`,
          ...extraHeaders,
        },
        signal: controller.signal,
      };

      // 只有POST/PUT等方法才设置body和Content-Type
      if (method !== "GET" && method !== "HEAD" && body) {
        (fetchOptions.headers as Record<string, string>)["Content-Type"] = contentType!;
        fetchOptions.body = bodyString;
      }

      const response = await fetch(url, fetchOptions);

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`WPS API请求失败 ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("WPS API请求超时");
      }

      throw error;
    }
  }

  /**
   * 下载文件到Buffer
   */
  async downloadFile(chatId: string, messageId: string, storageKey: string): Promise<Buffer> {
    const downloadUrl = await this.getDownloadUrl(chatId, messageId, storageKey);
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      throw new Error(`文件下载失败 ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * 判定receiver的type类型。
   *
   * @param chatType 会话类型，来自ParsedMessage.chatType（"p2p"或"group"）。
   * @param isEnterprisePartner 是否是关联组织的成员（用于区分"user"和"enterprise_partner_user"）。
   * @returns receiver.type的值："user"、"enterprise_partner_user" 或 "chat"。
   */
  private getReceiverType(chatType: string, isEnterprisePartner: boolean = false): string {
    if (chatType === "p2p") {
      // 私聊消息，如果是关联组织成员则用"enterprise_partner_user"，否则用"user"
      return isEnterprisePartner ? "enterprise_partner_user" : "user";
    }
    // 群聊消息用"chat"
    return "chat";
  }

  /**
   * 构造receiver对象。
   *
   * @param chatId 会话ID，私聊时为对方用户ID，群聊时为群聊ID。
   * @param chatType 会话类型（"p2p"或"group"）。
   * @param isEnterprisePartner 是否是关联组织的成员。
   * @returns receiver对象。
   */
  private buildReceiver(chatId: string, chatType: string, isEnterprisePartner: boolean = false): any {
    return {
      receiver_id: chatId,
      type: this.getReceiverType(chatType, isEnterprisePartner),
    };
  }

  /**
   * ==================== 消息发送功能 ====================
   */

  /**
   * 发送文本消息（支持@用户和@全体成员）
   *
   * @param text 消息内容（支持Markdown格式，可以在内容中使用 &lt;at id="1"&gt;@某人&lt;/at&gt; 格式）
   * @param chatId 会话ID（私聊时为对方用户ID，群聊时为群聊ID）
   * @param chatType 会话类型："p2p"=私聊，"group"=群聊（从ParsedMessage.chatType获取）
   * @param mentions 可选，@用户或@全体成员配置数组。当type="user"时，userId和userName必填。
   * @param type 消息内容类型："plain" | "markdown"（默认为 "markdown"）
   * @returns 消息发送结果，包含message_id等信息。
   */
  async sendTextMessage(
    text: string,
    chatId: string,
    chatType: string,
    mentions?: Mention[],
    type: "plain" | "markdown" = "markdown"
  ): Promise<WPSResponse> {
    if (!text || text.trim().length === 0) {
      throw new Error("消息内容不能为空");
    }

    if (!chatId) {
      throw new Error("chatId 不能为空");
    }

    const accessToken = await oauthTokenManager.getAccessToken(
      this.appId,
      this.secretKey,
      this.apiUrl
    );

    // 构造receiver
    const receiver = this.buildReceiver(chatId, chatType);

    // 构造消息体，添加mentions字段（如果有）
    const message: any = {
      type: "text",
      receiver: receiver,
      content: {
        text: {
          content: text.trim(),
          type: type,
        },
      },
    };

    // 如果有mentions，添加到消息体中（仅对群聊有效）
    if (mentions && mentions.length > 0) {
      message.content.text.mentions = buildMentions(mentions);
    }

    const path = `/v7/messages/create`;
    const result = await this.sendV7Request("POST", path, message, accessToken);

    if (result.code !== 0) {
      throw new Error(`发送消息失败: ${result.msg || "未知错误"}`);
    }

    return { result: result.code, msg: result.msg, message_id: result.data?.message_id };
  }

  /**
   * 发送富文本消息
   *
   * @param elements 富文本元素数组
   * @param chatId 会话ID（私聊时为对方用户ID，群聊时为群聊ID）
   * @param chatType 会话类型："p2p"=私聊，"group"=群聊
   * @returns 消息发送结果
   */
  async sendRichTextMessage(
    elements: RichTextElement[],
    chatId: string,
    chatType: string
  ): Promise<WPSResponse> {
    if (!elements || elements.length === 0) {
      throw new Error("富文本内容不能为空");
    }

    if (!chatId) {
      throw new Error("chatId 不能为空");
    }

    const accessToken = await oauthTokenManager.getAccessToken(
      this.appId,
      this.secretKey,
      this.apiUrl
    );

    // 构造receiver
    const receiver = this.buildReceiver(chatId, chatType);

    const message = {
      type: "rich_text",
      receiver: receiver,
      content: {
        rich_text: {
          elements: elements,
        },
      },
    };

    const path = `/v7/messages/create`;
    const result = await this.sendV7Request("POST", path, message, accessToken);

    if (result.code !== 0) {
      throw new Error(`发送富文本消息失败: ${result.msg || "未知错误"}`);
    }

    return { result: result.code, msg: result.msg, message_id: result.data?.message_id };
  }

  /**
   * 发送图片消息
   *
   * @param storageKey 图片存储key
   * @param chatId 会话ID（私聊时为对方用户ID，群聊时为群聊ID）
   * @param chatType 会话类型："p2p"=私聊，"group"=群聊
   * @param options 可选参数
   * @returns 消息发送结果
   */
  async sendImageMessage(
    storageKey: string,
    chatId: string,
    chatType: string,
    options?: {
      type?: "image/png" | "image/jpg" | "image/gif" | "image/webp";
      name?: string;
      size?: number;
      width?: number;
      height?: number;
      thumbnailStorageKey?: string;
      thumbnailType?: "image/png" | "image/jpg" | "image/gif" | "image/webp";
    }
  ): Promise<WPSResponse> {
    if (!storageKey) {
      throw new Error("storageKey 不能为空");
    }

    if (!chatId) {
      throw new Error("chatId 不能为空");
    }

    const accessToken = await oauthTokenManager.getAccessToken(
      this.appId,
      this.secretKey,
      this.apiUrl
    );

    // 构造receiver
    const receiver = this.buildReceiver(chatId, chatType);

    const imageContent: any = {
      storage_key: storageKey,
      type: options?.type || "image/jpeg",
      name: options?.name,
      size: options?.size,
      width: options?.width,
      height: options?.height,
    };

    if (options?.thumbnailStorageKey) {
      imageContent.thumbnail_storage_key = options.thumbnailStorageKey;
      imageContent.thumbnail_type = options.thumbnailType || options.type || "image/jpeg";
    }

    const message = {
      type: "image",
      receiver: receiver,
      content: {
        image: imageContent,
      },
    };

    const path = `/v7/messages/create`;
    const result = await this.sendV7Request("POST", path, message, accessToken);

    if (result.code !== 0) {
      throw new Error(`发送图片消息失败: ${result.msg || "未知错误"}`);
    }

    return { result: result.code, msg: result.msg, message_id: result.data?.message_id };
  }

  /**
   * 发送文件消息（本地文件）
   *
   * @param storageKey 文件存储key
   * @param chatId 会话ID（私聊时为对方用户ID，群聊时为群聊ID）
   * @param chatType 会话类型："p2p"=私聊，"group"=群聊
   * @param name 文件名称
   * @param size 文件大小（可选）
   * @returns 消息发送结果
   */
  async sendFileMessage(
    storageKey: string,
    chatId: string,
    chatType: string,
    name: string,
    size?: number
  ): Promise<WPSResponse> {
    if (!storageKey) {
      throw new Error("storageKey 不能为空");
    }

    if (!chatId) {
      throw new Error("chatId 不能为空");
    }

    if (!name) {
      throw new Error("文件名称不能为空");
    }

    const accessToken = await oauthTokenManager.getAccessToken(
      this.appId,
      this.secretKey,
      this.apiUrl
    );

    // 构造receiver
    const receiver = this.buildReceiver(chatId, chatType);

    const message = {
      type: "file",
      receiver: receiver,
      content: {
        file: {
          type: "local",
          local: {
            storage_key: storageKey,
            name: name,
            size: size,
          },
        },
      },
    };

    const path = `/v7/messages/create`;
    const result = await this.sendV7Request("POST", path, message, accessToken);

    if (result.code !== 0) {
      throw new Error(`发送文件消息失败: ${result.msg || "未知错误"}`);
    }

    return { result: result.code, msg: result.msg, message_id: result.data?.message_id };
  }

  /**
   * 发送音频消息
   *
   * @param storageKey 音频存储key
   * @param chatId 会话ID（私聊时为对方用户ID，群聊时为群聊ID）
   * @param chatType 会话类型："p2p"=私聊，"group"=群聊
   * @param options 音频信息
   * @returns 消息发送结果
   */
  async sendAudioMessage(
    storageKey: string,
    chatId: string,
    chatType: string,
    options: {
      duration: number;
      format?: "wav" | "amr";
      codec?: "amr";
      sampleRate?: number;
      sampleBits?: number;
      channels?: number;
      size?: number;
    }
  ): Promise<WPSResponse> {
    if (!storageKey) {
      throw new Error("storageKey 不能为空");
    }

    if (!chatId) {
      throw new Error("chatId 不能为空");
    }

    const accessToken = await oauthTokenManager.getAccessToken(
      this.appId,
      this.secretKey,
      this.apiUrl
    );

    // 构造receiver
    const receiver = this.buildReceiver(chatId, chatType);

    const audioContent = {
      storage_key: storageKey,
      media: {
        duration: options.duration,
        format: options.format || "wav",
        codec: options.codec,
        sample_rate: options.sampleRate,
        sample_bits: options.sampleBits,
        channels: options.channels,
        size: options.size,
      },
    };

    const message = {
      type: "audio",
      receiver: receiver,
      content: {
        audio: audioContent,
      },
    };

    const path = `/v7/messages/create`;
    const result = await this.sendV7Request("POST", path, message, accessToken);

    if (result.code !== 0) {
      throw new Error(`发送音频消息失败: ${result.msg || "未知错误"}`);
    }

    return { result: result.code, msg: result.msg, message_id: result.data?.message_id };
  }

  /**
   * 发送视频消息
   *
   * @param storageKey 视频存储key
   * @param chatId 会话ID（私聊时为对方用户ID，群聊时为群聊ID）
   * @param chatType 会话类型："p2p"=私聊，"group"=群聊
   * @param options 视频信息
   * @returns 消息发送结果
   */
  async sendVideoMessage(
    storageKey: string,
    chatId: string,
    chatType: string,
    options: {
      duration: number;
      format?: "mp4";
      codec?: "h.264";
      width?: number;
      height?: number;
      size?: number;
      coverStorageKey?: string;
    }
  ): Promise<WPSResponse> {
    if (!storageKey) {
      throw new Error("storageKey 不能为空");
    }

    if (!chatId) {
      throw new Error("chatId 不能为空");
    }

    const accessToken = await oauthTokenManager.getAccessToken(
      this.appId,
      this.secretKey,
      this.apiUrl
    );

    // 构造receiver
    const receiver = this.buildReceiver(chatId, chatType);

    const videoContent: any = {
      storage_key: storageKey,
      media: {
        duration: options.duration,
        format: options.format || "mp4",
        codec: options.codec || "h.264",
        width: options.width,
        height: options.height,
        size: options.size,
      },
    };

    if (options.coverStorageKey) {
      videoContent.media.cover_storage_key = options.coverStorageKey;
    }

    const message = {
      type: "video",
      receiver: receiver,
      content: {
        video: videoContent,
      },
    };

    const path = `/v7/messages/create`;
    const result = await this.sendV7Request("POST", path, message, accessToken);

    if (result.code !== 0) {
      throw new Error(`发送视频消息失败: ${result.msg || "未知错误"}`);
    }

    return { result: result.code, msg: result.msg, message_id: result.data?.message_id };
  }

  /**
   * 根据用户ID获取用户邮箱信息
   *
   * API文档: https://openapi.wps.cn/v7/user_mailboxes/{user_id}
   * 方法: GET
   * 权限: kso.user_mailbox.read 或 kso.user_mailbox.readwrite
   *
   * @param userId 用户ID，支持user_id或ex_user_id
   * @param idType 用户ID类型，"internal"=内部user_id，"external"=外部ex_user_id，默认为internal
   * @returns 用户邮箱信息
   */
  async getUserMailbox(
    userId: string,
    idType: UserIdType = "internal"
  ): Promise<UserMailbox> {
    if (!userId) {
      throw new Error("userId 不能为空");
    }

    const accessToken = await oauthTokenManager.getAccessToken(
      this.appId,
      this.secretKey,
      this.apiUrl
    );

    const path = `/v7/user_mailboxes/${userId}`;

    // 构造请求，添加X-Kso-Id-Type header
    const result = await this.sendV7RequestWithHeaders(
      "GET",
      path,
      null,
      accessToken,
      { "X-Kso-Id-Type": idType }
    );

    if (result.code !== 0) {
      throw new Error(`获取用户邮箱失败: ${result.msg || "未知错误"}`);
    }

    return result.data;
  }

  /**
   * 获取当前用户信息
   */
  async getCurrentUser(): Promise<{
    id: string;
    user_name: string;
    company_id: string;
    avatar: string;
  }> {
    const accessToken = await oauthTokenManager.getAccessToken(
      this.appId,
      this.secretKey,
      this.apiUrl
    );

    const path = `/v7/users/current`;
    const result = await this.sendV7Request("GET", path, null, accessToken);

    if (result.code !== 0) {
      throw new Error(`获取用户信息失败: ${result.msg || "未知错误"}`);
    }

    return result.data;
  }

  /**
   * 测试连接（用于probe）
   */
  async testConnection(): Promise<boolean> {
    try {
      await oauthTokenManager.getAccessToken(
        this.appId,
        this.secretKey,
        this.apiUrl
      );
      return true;
    } catch (error) {
      throw new Error(`连接测试失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * ==================== 富文本消息类型定义 ====================
 */

/**
 * 富文本元素基础类型
 */
export interface RichTextElement {
  type: string;
  alt_text: string;
  indent: number;
  index: number;
  elements?: RichTextElement[];
  text_content?: {
    content: string;
    type?: "plain" | "markdown";
  };
  style_text_content?: {
    style: {
      bold?: boolean;
      color?: string;
      italic?: boolean;
    };
    text: string;
  };
  mention_content?: {
    identity?: {
      avatar?: string;
      company_id?: string;
      id: string;
      name: string;
      type: "user" | "sp";
    };
    text: string;
    type?: string;
  };
  image_content?: {
    size?: number;
    height?: number;
    width?: number;
    name?: string;
    type?: "image/png" | "image/jpg" | "image/jpeg" | "image/gif" | "image/webp";
    storage_key: string;
    thumbnail_type?: "image/png" | "image/jpg" | "image/jpeg" | "image/gif" | "image/webp";
    thumbnail_storage_key?: string;
  };
  link_content?: {
    text: string;
    url: string;
  };
  doc_content?: {
    text: string;
    file: {
      id: string;
      link_url: string;
      link_id: string;
    };
  };
}

/**
 * 创建纯文本元素
 */
export function createTextElement(
  content: string,
  index: number,
  type: "plain" | "markdown" = "plain"
): RichTextElement {
  return {
    type: "text",
    alt_text: content,
    indent: 0,
    index: index,
    elements: [
      {
        type: "text",
        alt_text: content,
        indent: 0,
        index: 0,
        text_content: {
          content: content,
          type: type,
        },
      },
    ],
  };
}

/**
 * 创建有样式的文本元素
 */
export function createStyledTextElement(
  text: string,
  index: number,
  style?: { bold?: boolean; color?: string; italic?: boolean }
): RichTextElement {
  return {
    type: "text",
    alt_text: text,
    indent: 0,
    index: index,
    elements: [
      {
        type: "text",
        alt_text: text,
        indent: 0,
        index: 0,
        style_text_content: {
          style: style || {},
          text: text,
        },
      },
    ],
  };
}

/**
 * 创建@人元素
 */
export function createMentionElement(
  userId: string,
  userName: string,
  index: number,
  companyId?: string
): RichTextElement {
  return {
    type: "mention",
    alt_text: `@${userName}`,
    indent: 0,
    index: index,
    elements: [
      {
        type: "mention",
        alt_text: `@${userName}`,
        indent: 0,
        index: 0,
        mention_content: {
          identity: {
            id: userId,
            name: userName,
            type: "user",
            company_id: companyId,
          },
          text: `@${userName}`,
        },
      },
    ],
  };
}

/**
 * 创建图片元素
 */
export function createImageElement(
  storageKey: string,
  index: number,
  options?: {
    name?: string;
    type?: "image/png" | "image/jpg" | "image/gif" | "image/webp";
    size?: number;
    width?: number;
    height?: number;
    thumbnailStorageKey?: string;
    thumbnailType?: "image/png" | "image/jpg" | "image/gif" | "image/webp";
  }
): RichTextElement {
  return {
    type: "image",
    alt_text: "[图片]",
    indent: 0,
    index: index,
    elements: [
      {
        type: "image",
        alt_text: "[图片]",
        indent: 0,
        index: 0,
        image_content: {
          storage_key: storageKey,
          name: options?.name,
          type: options?.type || "image/jpeg",
          size: options?.size,
          width: options?.width,
          height: options?.height,
          thumbnail_storage_key: options?.thumbnailStorageKey,
          thumbnail_type: options?.thumbnailType || options?.type || "image/jpeg",
        },
      },
    ],
  };
}

/**
 * 创建链接元素
 */
export function createLinkElement(
  text: string,
  url: string,
  index: number
): RichTextElement {
  return {
    type: "link",
    alt_text: text,
    indent: 0,
    index: index,
    elements: [
      {
        type: "link",
        alt_text: text,
        indent: 0,
        index: 0,
        link_content: {
          text: text,
          url: url,
        },
      },
    ],
  };
}

/**
 * 创建内嵌文档元素
 */
export function createDocElement(
  text: string,
  fileId: string,
  linkUrl: string,
  linkId: string,
  index: number
): RichTextElement {
  return {
    type: "doc",
    alt_text: text,
    indent: 0,
    index: index,
    elements: [
      {
        type: "doc",
        alt_text: text,
        indent: 0,
        index: 0,
        doc_content: {
          text: text,
          file: {
            id: fileId,
            link_url: linkUrl,
            link_id: linkId,
          },
        },
      },
    ],
  };
}
