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
 * 用户状态类型
 */
export type UserStatus = "active" | "notactive" | "disabled" | "dimission";

/**
 * 用户角色类型
 */
export type UserRole = "super-admin" | "admin" | "normal";

/**
 * 部门信息
 */
export interface DepartmentInfo {
  /** 部门绝对路径 */
  abs_path: string;
  /** 部门ID */
  id: string;
  /** 部门名称 */
  name: string;
}

/**
 * 用户信息（根据邮箱查询返回）
 */
export interface UserInfoByEmail {
  /** 头像 */
  avatar: string;
  /** 创建时间 */
  ctime: number;
  /** 部门信息列表（当with_dept=true时返回） */
  depts?: DepartmentInfo[];
  /** 邮箱 */
  email: string;
  /** 外部身份源ID */
  ex_user_id: string;
  /** 用户ID */
  id: string;
  /** 手机号码 */
  phone: string;
  /** 用户角色 */
  role: UserRole;
  /** 用户状态 */
  status: UserStatus;
  /** 职务信息 */
  title: string;
  /** 用户名称 */
  user_name: string;
}

/**
 * 根据邮箱查询用户请求参数
 */
export interface GetUsersByEmailsRequest {
  /** 用户邮箱列表 */
  emails: string[];
  /** 用户状态列表，必填。active=正常；notactive=未激活；disabled=禁用 */
  status: UserStatus[];
  /** 是否需要返回部门信息，默认为false */
  with_dept?: boolean;
}

/**
 * 根据邮箱查询用户响应
 */
export interface GetUsersByEmailsResponse {
  /** 用户信息列表 */
  items: UserInfoByEmail[];
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
   * 根据邮箱获取用户信息
   *
   * API文档: https://openapi.wps.cn/v7/users/by_emails
   * 方法: POST
   * 权限: kso.contact.readwrite 或 kso.contact.read
   *
   * @param request 请求参数
   * @returns 用户信息列表
   */
  async getUsersByEmails(
    request: GetUsersByEmailsRequest
  ): Promise<GetUsersByEmailsResponse> {
    if (!request.emails || request.emails.length === 0) {
      throw new Error("emails 不能为空");
    }

    if (!request.status || request.status.length === 0) {
      throw new Error("status 不能为空");
    }

    const accessToken = await oauthTokenManager.getAccessToken(
      this.appId,
      this.secretKey,
      this.apiUrl
    );

    const path = `/v7/users/by_emails`;
    const body = {
      emails: request.emails,
      status: request.status,
      with_dept: request.with_dept ?? false,
    };

    const result = await this.sendV7Request("POST", path, body, accessToken);

    if (result.code !== 0) {
      throw new Error(`根据邮箱获取用户失败: ${result.msg || "未知错误"}`);
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

  // ==================== 企业相关API ====================

  /**
   * 查询企业信息
   */
  async getCompanyInfo(): Promise<CompanyInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("GET", "/v7/companies/current", null, accessToken);
    if (result.code !== 0) throw new Error(`获取企业信息失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 部门相关API ====================

  /**
   * 查询子部门列表
   */
  async getSubDepts(request: { dept_id: string; page_size?: number; page_token?: string; with_total?: boolean }): Promise<GetSubDeptsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    if (request.page_size) params.set("page_size", String(request.page_size));
    if (request.page_token) params.set("page_token", request.page_token);
    if (request.with_total) params.set("with_total", String(request.with_total));
    const qs = params.toString();
    const path = `/v7/depts/${request.dept_id}/children${qs ? `?${qs}` : ""}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取子部门列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量查询指定部门信息
   */
  async batchReadDepts(request: BatchReadDeptsRequest): Promise<BatchReadDeptsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/depts/batch_read", request, accessToken);
    if (result.code !== 0) throw new Error(`批量查询部门失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取用户所在部门列表
   */
  async getUserDepts(userId: string): Promise<{ items: DeptInfo[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/users/${userId}/depts`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取用户部门列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 根据外部部门ID获取部门信息
   */
  async getDeptsByExDeptIds(request: GetDeptsByExDeptIdsRequest): Promise<{ items: DeptInfo[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/depts/by_ex_dept_ids", request, accessToken);
    if (result.code !== 0) throw new Error(`获取部门信息失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取根部门
   */
  async getRootDept(): Promise<DeptInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("GET", "/v7/depts/root", null, accessToken);
    if (result.code !== 0) throw new Error(`获取根部门失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 创建部门
   */
  async createDept(request: CreateDeptRequest): Promise<DeptInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/depts/create", request, accessToken);
    if (result.code !== 0) throw new Error(`创建部门失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 更新部门
   */
  async updateDept(request: UpdateDeptRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const { dept_id, ...body } = request;
    const path = `/v7/depts/${dept_id}/update`;
    const result = await this.sendV7Request("POST", path, body, accessToken);
    if (result.code !== 0) throw new Error(`更新部门失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 删除部门
   */
  async deleteDept(deptId: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/depts/${deptId}/delete`;
    const result = await this.sendV7Request("POST", path, null, accessToken);
    if (result.code !== 0) throw new Error(`删除部门失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 将用户加入到部门
   */
  async addDeptMember(deptId: string, userId: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/depts/${deptId}/members/${userId}/create`;
    const result = await this.sendV7Request("POST", path, null, accessToken);
    if (result.code !== 0) throw new Error(`添加部门成员失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 将用户从部门移除
   */
  async removeDeptMember(deptId: string, userId: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/depts/${deptId}/members/${userId}/delete`;
    const result = await this.sendV7Request("POST", path, null, accessToken);
    if (result.code !== 0) throw new Error(`移除部门成员失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 搜索部门（子部门列表，支持分页）
   */
  async searchDepts(request: { dept_id: string; page_size?: number; page_token?: string; with_total?: boolean }): Promise<GetSubDeptsResponse> {
    return this.getSubDepts(request);
  }

  // ==================== 用户相关API ====================

  /**
   * 查询指定用户
   */
  async getUser(userId: string, withDept = false): Promise<UserDetail> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/users/${userId}${withDept ? "?with_dept=true" : ""}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取用户信息失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量查询用户
   */
  async batchReadUsers(request: BatchReadUsersRequest): Promise<BatchReadUsersResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/users/batch_read", request, accessToken);
    if (result.code !== 0) throw new Error(`批量查询用户失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 查询企业下所有用户
   */
  async listAllUsers(request: { status?: string; page_token?: string; page_size?: number } = {}): Promise<ListAllUsersResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    if (request.status) params.set("status", request.status);
    if (request.page_token) params.set("page_token", request.page_token);
    if (request.page_size) params.set("page_size", String(request.page_size));
    const qs = params.toString();
    const path = `/v7/users${qs ? `?${qs}` : ""}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取用户列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 查询部门下用户列表
   */
  async getDeptMembers(request: { dept_id: string; status?: string; page_size?: number; page_token?: string }): Promise<GetDeptMembersResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    if (request.status) params.set("status", request.status);
    if (request.page_size) params.set("page_size", String(request.page_size));
    if (request.page_token) params.set("page_token", request.page_token);
    const qs = params.toString();
    const path = `/v7/depts/${request.dept_id}/members${qs ? `?${qs}` : ""}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取部门成员列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量查询部门下的成员信息
   */
  async batchReadDeptMembers(request: BatchReadDeptMembersRequest): Promise<BatchReadDeptMembersResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const { dept_id, ...body } = request;
    const path = `/v7/depts/${dept_id}/members/batch_read`;
    const result = await this.sendV7Request("POST", path, body, accessToken);
    if (result.code !== 0) throw new Error(`批量查询部门成员失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 根据手机号获取用户
   */
  async getUsersByPhones(request: GetUsersByPhonesRequest): Promise<{ items: UserDetail[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/users/by_phones", request, accessToken);
    if (result.code !== 0) throw new Error(`根据手机号获取用户失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 根据 ex_user_id 获取用户信息
   */
  async getUsersByExUserIds(request: GetUsersByExUserIdsRequest): Promise<{ items: UserDetail[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/users/by_ex_user_ids", request, accessToken);
    if (result.code !== 0) throw new Error(`根据外部用户ID获取用户信息失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 创建用户
   */
  async createUser(request: CreateUserRequest): Promise<UserDetail> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/users/create", request, accessToken);
    if (result.code !== 0) throw new Error(`创建用户失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 更新用户
   */
  async updateUser(userId: string, request: Omit<UpdateUserRequest, "user_id">): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/users/${userId}/update`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`更新用户失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 删除用户
   */
  async deleteUser(userId: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/users/${userId}/delete`;
    const result = await this.sendV7Request("POST", path, null, accessToken);
    if (result.code !== 0) throw new Error(`删除用户失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 批量修改用户在部门中排序值
   */
  async batchUpdateUserOrder(request: BatchUpdateUserOrderRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/users/batch_update_order", request, accessToken);
    if (result.code !== 0) throw new Error(`批量修改用户排序失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 批量更新用户所在部门
   */
  async batchUpdateUserDept(request: BatchUpdateUserDeptRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/users/batch_update_dept", request, accessToken);
    if (result.code !== 0) throw new Error(`批量更新用户部门失败: ${result.msg || "未知错误"}`);
  }

  // ==================== 用户自定义属性API ====================

  /**
   * 批量获取用户的自定义属性值
   */
  async batchReadUserCustomAttrs(request: BatchReadUserCustomAttrsRequest): Promise<BatchReadUserCustomAttrsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/users/custom_attrs/batch_read", request, accessToken);
    if (result.code !== 0) throw new Error(`获取用户自定义属性失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量更新用户的自定义属性值
   */
  async batchUpdateUserCustomAttrs(request: BatchUpdateUserCustomAttrsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/users/custom_attrs/batch_update", request, accessToken);
    if (result.code !== 0) throw new Error(`更新用户自定义属性失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 新增自定义用户属性
   */
  async createUserCustomAttrs(request: CreateUserCustomAttrsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/companies/user_custom_attrs/batch_create", request, accessToken);
    if (result.code !== 0) throw new Error(`新增自定义属性失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 修改自定义用户属性
   */
  async updateUserCustomAttrs(request: UpdateUserCustomAttrsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/companies/user_custom_attrs/batch_update", request, accessToken);
    if (result.code !== 0) throw new Error(`修改自定义属性失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 删除自定义用户属性
   */
  async deleteUserCustomAttrs(request: DeleteUserCustomAttrsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/companies/user_custom_attrs/batch_delete", request, accessToken);
    if (result.code !== 0) throw new Error(`删除自定义属性失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 获取自定义用户属性
   */
  async readUserCustomAttrs(): Promise<ReadUserCustomAttrsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("GET", "/v7/companies/user_custom_attrs/batch_read", null, accessToken);
    if (result.code !== 0) throw new Error(`获取自定义属性失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取通讯录权限范围
   */
  async getContactsPermissionsScope(scopes: string): Promise<{ items: ContactsPermissionsScope[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/contacts/permissions_scope?scopes=${encodeURIComponent(scopes)}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取权限范围失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 用户组API ====================

  /**
   * 获取用户组列表
   */
  async getGroups(request: GetGroupsRequest = {}): Promise<GetGroupsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    if (request.source) params.set("source", request.source);
    if (request.page_size) params.set("page_size", String(request.page_size));
    if (request.user_id) params.set("user_id", request.user_id);
    if (request.status) params.set("status", request.status);
    if (request.with_total) params.set("with_total", String(request.with_total));
    if (request.dept_ids) params.set("dept_ids", request.dept_ids);
    if (request.page_token) params.set("page_token", request.page_token);
    if (request.exclude_dept_ids) params.set("exclude_dept_ids", request.exclude_dept_ids);
    if (request.joined !== undefined) params.set("joined", String(request.joined));
    const qs = params.toString();
    const path = `/v7/groups${qs ? `?${qs}` : ""}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取用户组列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 创建用户组
   */
  async createGroup(request: CreateGroupRequest): Promise<GroupInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/groups/create", request, accessToken);
    if (result.code !== 0) throw new Error(`创建用户组失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取用户组成员列表
   */
  async getGroupMembers(request: { group_id: string; page_size?: number; page_token?: string; item_type?: string; with_user_info?: boolean; with_dept_info?: boolean }): Promise<GetGroupMembersResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    if (request.page_size) params.set("page_size", String(request.page_size));
    if (request.page_token) params.set("page_token", request.page_token);
    if (request.item_type) params.set("item_type", request.item_type);
    if (request.with_user_info) params.set("with_user_info", String(request.with_user_info));
    if (request.with_dept_info) params.set("with_dept_info", String(request.with_dept_info));
    const qs = params.toString();
    const path = `/v7/groups/${request.group_id}/members${qs ? `?${qs}` : ""}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取组成员列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取单个用户组成员
   */
  async getGroupMember(request: GetGroupMemberRequest): Promise<GroupMember> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    params.set("item_id", request.item_id);
    if (request.item_type) params.set("item_type", request.item_type);
    if (request.with_user_info) params.set("with_user_info", String(request.with_user_info));
    if (request.with_dept_info) params.set("with_dept_info", String(request.with_dept_info));
    const path = `/v7/groups/${request.group_id}/members/read?${params.toString()}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取组成员失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 添加用户组成员
   */
  async addGroupMember(groupId: string, itemId: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/groups/${groupId}/members/create`;
    const result = await this.sendV7Request("POST", path, { item_id: itemId }, accessToken);
    if (result.code !== 0) throw new Error(`添加组成员失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 删除用户组成员
   */
  async deleteGroupMember(groupId: string, itemId: string, itemType = "normal"): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/groups/${groupId}/members/delete`;
    const result = await this.sendV7Request("POST", path, { item_id: itemId, item_type: itemType }, accessToken);
    if (result.code !== 0) throw new Error(`删除组成员失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 批量获取用户组成员
   */
  async batchReadGroupMembers(request: BatchReadGroupMembersRequest): Promise<BatchReadGroupMembersResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/groups/${request.group_id}/members/batch_read`;
    const result = await this.sendV7Request("POST", path, { members: request.members }, accessToken);
    if (result.code !== 0) throw new Error(`批量获取组成员失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量添加用户组成员
   */
  async batchCreateGroupMembers(request: BatchCreateGroupMembersRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/groups/${request.group_id}/members/batch_create`;
    const result = await this.sendV7Request("POST", path, { members: request.members }, accessToken);
    if (result.code !== 0) throw new Error(`批量添加组成员失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 批量删除用户组成员
   */
  async batchDeleteGroupMembers(request: BatchDeleteGroupMembersRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/groups/${request.group_id}/members/batch_delete`;
    const result = await this.sendV7Request("POST", path, { members: request.members }, accessToken);
    if (result.code !== 0) throw new Error(`批量删除组成员失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 更新用户组成员角色
   */
  async updateGroupMemberRole(request: UpdateGroupMemberRoleRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/groups/${request.group_id}/members/update_role`;
    const { group_id, ...body } = request;
    const result = await this.sendV7Request("POST", path, body, accessToken);
    if (result.code !== 0) throw new Error(`更新组成员角色失败: ${result.msg || "未知错误"}`);
  }

  // ==================== 应用信息API ====================

  /**
   * 获取应用信息
   */
  async getAppInfo(): Promise<ApplicationInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("GET", "/v7/developer/applications/current", null, accessToken);
    if (result.code !== 0) throw new Error(`获取应用信息失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 授权分配/商城API ====================

  /**
   * 获取商品授权列表
   */
  async getEntitlements(): Promise<{ items: EntitlementInfo[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("GET", "/v7/store/entitlements", null, accessToken);
    if (result.code !== 0) throw new Error(`获取商品授权列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取商品授权分配记录列表
   */
  async getAllocations(entitlementKey: string, entityId?: string): Promise<{ items: AllocationRecord[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    params.set("entitlement_key", entitlementKey);
    if (entityId) params.set("entity_id", entityId);
    const path = `/v7/store/allocations?${params.toString()}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取授权分配记录失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取商城订单列表
   */
  async getStoreOrders(pageSize = 100): Promise<{ items: StoreOrder[]; total?: number }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/store/orders?page_size=${pageSize}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取订单列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取商城订单详情
   */
  async getStoreOrder(orderId: string): Promise<StoreOrder> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/store/orders/${orderId}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取订单详情失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量创建授权分配记录
   */
  async batchCreateAllocations(request: BatchCreateAllocationsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/store/allocations/batch_create", request, accessToken);
    if (result.code !== 0) throw new Error(`批量创建授权分配失败: ${result.msg || "未知错误"}`);
  }

  // ==================== 云文档 - 团队文档库API ====================

  /**
   * 创建团队文档库
   */
  async createDoclib(name: string): Promise<DoclibInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/doclib/create?name=${encodeURIComponent(name)}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`创建团队文档库失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取团队文档库列表
   */
  async listDoclibs(pageSize = 10): Promise<ListDoclibsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/doclibs?page_size=${pageSize}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取文档库列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 云文档 - 云盘API ====================

  /**
   * 新建驱动盘
   */
  async createDrive(request: CreateDriveRequest): Promise<DriveInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/drives/create", request, accessToken);
    if (result.code !== 0) throw new Error(`创建驱动盘失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取盘列表
   */
  async listDrives(request: ListDrivesRequest = {}): Promise<ListDrivesResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    if (request.allotee_type) params.set("allotee_type", request.allotee_type);
    if (request.allotee_id) params.set("allotee_id", request.allotee_id);
    if (request.page_size) params.set("page_size", String(request.page_size));
    if (request.page_token) params.set("page_token", request.page_token);
    const qs = params.toString();
    const path = `/v7/drives${qs ? `?${qs}` : ""}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取盘列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 云文档 - 文件(夹)API ====================

  /**
   * 新建文件（夹）
   */
  async createFileOrFolder(driveId: string, parentId: string, request: CreateFileOrFolderRequest): Promise<FileInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/drives/${driveId}/files/${parentId}/create`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`创建文件(夹)失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取子文件列表
   */
  async listFileChildren(driveId: string, parentId: string, pageSize = 100): Promise<ListFileChildrenResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/drives/${driveId}/files/${parentId}/children?page_size=${pageSize}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取子文件列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 云文档 - 文件传输API ====================

  /**
   * 请求文件上传信息
   */
  async requestUpload(driveId: string, parentId: string, request: RequestUploadRequest): Promise<RequestUploadResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/drives/${driveId}/files/${parentId}/request_upload`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`请求上传信息失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 提交文件上传完成
   */
  async commitUpload(driveId: string, parentId: string, request: CommitUploadRequest): Promise<CommitUploadResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/drives/${driveId}/files/${parentId}/commit_upload`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`提交上传完成失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 云文档 - 文件分享API ====================

  /**
   * 开启文件分享
   */
  async openFileShare(driveId: string, fileId: string, request: OpenFileShareRequest): Promise<OpenFileShareResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/drives/${driveId}/files/${fileId}/open_link`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`开启文件分享失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取分享链接信息
   */
  async getShareLinkMeta(linkId: string): Promise<ShareLinkInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/links/${linkId}/meta`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取分享链接信息失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 消息与会话API ====================

  /**
   * 创建会话（单聊或群聊）
   */
  async createChat(request: CreateChatRequest): Promise<CreateChatResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/chats/create", request, accessToken);
    if (result.code !== 0) throw new Error(`创建会话失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取会话列表
   */
  async listChats(pageSize = 100): Promise<ListChatsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/chats?page_size=${pageSize}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取会话列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量发送消息
   */
  async batchCreateMessages(request: BatchCreateMessagesRequest): Promise<BatchCreateMessagesResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/messages/batch_create", request, accessToken);
    if (result.code !== 0) throw new Error(`批量发送消息失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 待办API ====================

  /**
   * 创建待办分类
   */
  async createTodoCategory(name: string): Promise<TodoCategory> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/todo/categories/create", { name }, accessToken);
    if (result.code !== 0) throw new Error(`创建待办分类失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 删除待办分类
   */
  async deleteTodoCategory(categoryId: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/todo/categories/${categoryId}/delete`;
    const result = await this.sendV7Request("POST", path, null, accessToken);
    if (result.code !== 0) throw new Error(`删除待办分类失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 更新待办分类
   */
  async updateTodoCategory(categoryId: string, name: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/todo/categories/${categoryId}/update`;
    const result = await this.sendV7Request("POST", path, { name }, accessToken);
    if (result.code !== 0) throw new Error(`更新待办分类失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 查询待办分类
   */
  async listTodoCategories(): Promise<{ items: TodoCategory[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("GET", "/v7/todo/categories", null, accessToken);
    if (result.code !== 0) throw new Error(`查询待办分类失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 创建待办任务
   */
  async createTodoTask(request: CreateTodoTaskRequest): Promise<TodoTask> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/todo/tasks", request, accessToken);
    if (result.code !== 0) throw new Error(`创建待办任务失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 更新待办任务
   */
  async updateTodoTask(taskId: string, request: Omit<UpdateTodoTaskRequest, "task_id">): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/todo/tasks/${taskId}/update`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`更新待办任务失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 删除待办任务
   */
  async deleteTodoTasks(ids: string[]): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/todo/tasks/batch_delete", { ids }, accessToken);
    if (result.code !== 0) throw new Error(`删除待办任务失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 查询待办任务
   */
  async getTodoTask(taskId: string): Promise<TodoTask> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/todo/tasks/${taskId}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`查询待办任务失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 日历API ====================

  /**
   * 新建日历
   */
  async createCalendar(request: CreateCalendarRequest): Promise<CalendarInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/calendars/create", request, accessToken);
    if (result.code !== 0) throw new Error(`创建日历失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 查询主日历信息
   */
  async getPrimaryCalendar(): Promise<CalendarInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("GET", "/v7/calendars/primary", null, accessToken);
    if (result.code !== 0) throw new Error(`获取主日历失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 创建日历权限
   */
  async createCalendarPermission(calendarId: string, request: CreateCalendarPermissionRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/permissions/create`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`创建日历权限失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 查询日程
   */
  async getEvent(calendarId: string, eventId: string): Promise<EventInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/${eventId}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取日程失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 查询日程列表
   */
  async listEvents(request: { calendar_id: string; start_time: string; end_time: string; page_size?: number; page_token?: string }): Promise<ListEventsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    params.set("start_time", request.start_time);
    params.set("end_time", request.end_time);
    if (request.page_size) params.set("page_size", String(request.page_size));
    if (request.page_token) params.set("page_token", request.page_token);
    const path = `/v7/calendars/${request.calendar_id}/events?${params.toString()}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取日程列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 新建日程
   */
  async createEvent(calendarId: string, request: CreateEventRequest): Promise<EventInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/create`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`创建日程失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 修改日程
   */
  async updateEvent(calendarId: string, eventId: string, request: Omit<UpdateEventRequest, "event_id">): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/${eventId}/update`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`修改日程失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 删除日程
   */
  async deleteEvent(calendarId: string, eventId: string, body?: { recurrence?: EventRecurrence }): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/${eventId}/delete`;
    const result = await this.sendV7Request("POST", path, body || null, accessToken);
    if (result.code !== 0) throw new Error(`删除日程失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 获取某个日程的参与者
   */
  async getEventAttendees(calendarId: string, eventId: string): Promise<{ items: EventAttendee[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/${eventId}/attendees`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取日程参与者失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量添加某个日程的参与者
   */
  async batchCreateAttendees(calendarId: string, eventId: string, request: BatchCreateAttendeesRequest): Promise<BatchCreateAttendeesResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/${eventId}/attendees/batch_create`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`批量添加日程参与者失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量删除某个日程的参与者
   */
  async batchDeleteAttendees(calendarId: string, eventId: string, request: BatchDeleteAttendeesRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/${eventId}/attendees/batch_delete`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`批量删除日程参与者失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 获取某个日程参与者为用户组的成员
   */
  async getEventAttendeeGroups(calendarId: string, eventId: string, groupId: string): Promise<{ items: GroupMember[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/${eventId}/attendee_groups/${groupId}/members`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取日程参与者用户组成员失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量添加某个日程的会议室
   */
  async batchCreateEventMeetingRooms(calendarId: string, eventId: string, request: BatchCreateMeetingRoomsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/${eventId}/meeting_rooms/batch_create`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`批量添加日程会议室失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 批量删除某个日程的会议室
   */
  async batchDeleteEventMeetingRooms(calendarId: string, eventId: string, request: BatchDeleteMeetingRoomsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/${eventId}/meeting_rooms/batch_delete`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`批量删除日程会议室失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 获取某个日程的会议室列表
   */
  async getEventMeetingRooms(calendarId: string, eventId: string): Promise<{ items: EventMeetingRoom[] }> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/calendars/${calendarId}/events/${eventId}/meeting_rooms`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取日程会议室列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 会议室API ====================

  /**
   * 批量查询会议室设置
   */
  async batchGetMeetingRoomSettings(request: BatchGetMeetingRoomSettingsRequest): Promise<BatchGetMeetingRoomSettingsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/meeting_room_settings/batch_get", request, accessToken);
    if (result.code !== 0) throw new Error(`批量查询会议室设置失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 查询会议室列表
   */
  async listMeetingRooms(request: ListMeetingRoomsRequest = {}): Promise<ListMeetingRoomsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    if (request.page_size) params.set("page_size", String(request.page_size));
    if (request.page_token) params.set("page_token", request.page_token);
    if (request.room_level_id) params.set("room_level_id", request.room_level_id);
    const qs = params.toString();
    const path = `/v7/meeting_rooms${qs ? `?${qs}` : ""}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取会议室列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 查询会议室详情
   */
  async getMeetingRoom(roomId: string): Promise<MeetingRoomInfo> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/meeting_rooms/${roomId}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取会议室详情失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量查询会议室详情
   */
  async batchGetMeetingRooms(request: BatchGetMeetingRoomsRequest): Promise<BatchGetMeetingRoomsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/meeting_rooms/batch_get", request, accessToken);
    if (result.code !== 0) throw new Error(`批量查询会议室详情失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 更新会议室设置
   */
  async updateMeetingRoomSetting(request: UpdateMeetingRoomSettingRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const { room_id, ...body } = request;
    const path = `/v7/meeting_room_settings/${room_id}/update`;
    const result = await this.sendV7Request("POST", path, body, accessToken);
    if (result.code !== 0) throw new Error(`更新会议室设置失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 批量查询会议室预约
   */
  async batchGetMeetingRoomBookings(request: BatchGetMeetingRoomBookingsRequest): Promise<BatchGetMeetingRoomBookingsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/meeting_room_bookings/batch_get", request, accessToken);
    if (result.code !== 0) throw new Error(`批量查询会议室预约失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 更新会议室预约状态
   */
  async updateMeetingRoomBookingStatus(bookingId: string, status?: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/meeting_room_bookings/${bookingId}/update_status`;
    const result = await this.sendV7Request("POST", path, status ? { status } : null, accessToken);
    if (result.code !== 0) throw new Error(`更新会议室预约状态失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 查询会议室层级列表
   */
  async listMeetingRoomLevels(pageSize?: number): Promise<ListMeetingRoomLevelsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    if (pageSize) params.set("page_size", String(pageSize));
    const qs = params.toString();
    const path = `/v7/meeting_room_levels${qs ? `?${qs}` : ""}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取会议室层级列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 批量查询会议室层级详情
   */
  async batchGetMeetingRoomLevels(request: BatchGetMeetingRoomLevelsRequest): Promise<BatchGetMeetingRoomLevelsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/meeting_room_levels/batch_get", request, accessToken);
    if (result.code !== 0) throw new Error(`批量查询会议室层级失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 提前释放会议室
   */
  async releaseMeetingRoom(roomId: string, request: ReleaseMeetingRoomRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/meeting_rooms/${roomId}/release`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`释放会议室失败: ${result.msg || "未知错误"}`);
  }

  // ==================== 会议纪要API ====================

  /**
   * 创建会议纪要
   */
  async createMeetingMinute(request: CreateMeetingMinuteRequest): Promise<MeetingMinute> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const result = await this.sendV7Request("POST", "/v7/minutes/create", request, accessToken);
    if (result.code !== 0) throw new Error(`创建会议纪要失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 获取会议纪要信息
   */
  async getMeetingMinute(minuteId: string): Promise<MeetingMinute> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/minutes/${minuteId}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取会议纪要失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 删除会议纪要
   */
  async deleteMeetingMinute(minuteId: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/minutes/${minuteId}/delete`;
    const result = await this.sendV7Request("POST", path, null, accessToken);
    if (result.code !== 0) throw new Error(`删除会议纪要失败: ${result.msg || "未知错误"}`);
  }

  // ==================== 多维表API ====================

  /**
   * 创建工作表
   */
  async createDBSheet(dbDocId: string, request: CreateDBSheetRequest): Promise<DBSheetSheet> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/create`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`创建工作表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 更新工作表
   */
  async updateDBSheet(dbDocId: string, sheetId: string, name: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/update`;
    const result = await this.sendV7Request("POST", path, { name }, accessToken);
    if (result.code !== 0) throw new Error(`更新工作表失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 删除工作表
   */
  async deleteDBSheet(dbDocId: string, sheetId: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/delete`;
    const result = await this.sendV7Request("POST", path, { name: "" }, accessToken);
    if (result.code !== 0) throw new Error(`删除工作表失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 创建视图
   */
  async createDBSheetView(dbDocId: string, sheetId: string, request: { name: string; type: string }): Promise<DBSheetView> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/views`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`创建视图失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 更新视图
   */
  async updateDBSheetView(dbDocId: string, sheetId: string, viewId: string, name: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/views/${viewId}/update`;
    const result = await this.sendV7Request("POST", path, { name }, accessToken);
    if (result.code !== 0) throw new Error(`更新视图失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 删除视图
   */
  async deleteDBSheetView(dbDocId: string, sheetId: string, viewId: string): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/views/${viewId}/delete`;
    const result = await this.sendV7Request("POST", path, { name: "" }, accessToken);
    if (result.code !== 0) throw new Error(`删除视图失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 创建字段
   */
  async createDBSheetFields(dbDocId: string, sheetId: string, request: CreateDBSheetFieldsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/fields`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`创建字段失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 更新字段
   */
  async updateDBSheetFields(dbDocId: string, sheetId: string, request: UpdateDBSheetFieldsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/fields/update`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`更新字段失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 删除字段
   */
  async deleteDBSheetFields(dbDocId: string, sheetId: string, request: DeleteDBSheetFieldsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/fields/delete`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`删除字段失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 列举记录
   */
  async listDBSheetRecords(dbDocId: string, sheetId: string): Promise<ListDBSheetRecordsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/records`;
    const result = await this.sendV7Request("POST", path, null, accessToken);
    if (result.code !== 0) throw new Error(`列举记录失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 按页列举记录
   */
  async listDBSheetRecordsByPage(dbDocId: string, sheetId: string, request: ListDBSheetRecordsRequest): Promise<ListDBSheetRecordsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/records/list_by_page`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`分页列举记录失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 检索记录
   */
  async getDBSheetRecord(dbDocId: string, sheetId: string, recordId: string): Promise<DBSheetRecord> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/records/${recordId}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`检索记录失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 检索多条记录
   */
  async searchDBSheetRecords(dbDocId: string, sheetId: string, request: SearchDBSheetRecordsRequest): Promise<SearchDBSheetRecordsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/records/search`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`检索多条记录失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 创建记录
   */
  async createDBSheetRecords(dbDocId: string, sheetId: string, request: CreateDBSheetRecordsRequest): Promise<CreateDBSheetRecordsResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/records/create`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`创建记录失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 更新记录
   */
  async updateDBSheetRecords(dbDocId: string, sheetId: string, request: UpdateDBSheetRecordsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/records/update`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`更新记录失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 删除记录
   */
  async deleteDBSheetRecords(dbDocId: string, sheetId: string, request: DeleteDBSheetRecordsRequest): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/sheets/${sheetId}/records/batch_delete`;
    const result = await this.sendV7Request("POST", path, request, accessToken);
    if (result.code !== 0) throw new Error(`删除记录失败: ${result.msg || "未知错误"}`);
  }

  /**
   * 获取多维表Schema
   */
  async getDBSheetSchema(dbDocId: string): Promise<DBSheetSchema> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/coop/dbsheet/${dbDocId}/schema`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取Schema失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== 审批API ====================

  /**
   * 审批实例列表
   */
  async listApprovalInstances(request: ListApprovalInstancesRequest = {}): Promise<ListApprovalInstancesResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const params = new URLSearchParams();
    if (request.approval_define_id) params.set("approval_define_id", request.approval_define_id);
    if (request.promoter) params.set("promoter", request.promoter);
    if (request.offset) params.set("offset", String(request.offset));
    if (request.limit) params.set("limit", String(request.limit));
    const qs = params.toString();
    const path = `/v7/workflow/approval_instances${qs ? `?${qs}` : ""}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取审批实例列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  /**
   * 分页查询用户管理审批定义列表
   */
  async listUserManageApprovalDefines(page = 1): Promise<ListUserManageApprovalDefinesResponse> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/workflow/approval_defines/user_manage?page=${page}`;
    const result = await this.sendV7Request("GET", path, null, accessToken);
    if (result.code !== 0) throw new Error(`获取审批定义列表失败: ${result.msg || "未知错误"}`);
    return result.data;
  }

  // ==================== AIdocs API ====================

  /**
   * 开启/关闭AI团队文档库
   */
  async setAIdocsDoclibSwitch(driveId: string, open: boolean): Promise<void> {
    const accessToken = await oauthTokenManager.getAccessToken(this.appId, this.secretKey, this.apiUrl);
    const path = `/v7/aidocs/doclib/switch?drive_id=${driveId}&open=${open}`;
    const result = await this.sendV7Request("POST", path, null, accessToken);
    if (result.code !== 0) throw new Error(`设置AI团队开关失败: ${result.msg || "未知错误"}`);
  }
}

/**
 * ==================== 通讯录类型定义 ====================
 */

/** 企业信息 */
export interface CompanyInfo {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
  company_type?: string;
  industry?: string;
  scale?: string;
  status?: string;
}

/** 部门信息 */
export interface DeptInfo {
  id: string;
  name: string;
  parent_id: string;
  abs_path?: string;
  order?: number;
  ex_dept_id?: string;
  leaders?: DeptLeader[];
}

/** 部门负责人 */
export interface DeptLeader {
  user_id: string;
  order: number;
}

/** 查询子部门请求参数 */
export interface GetSubDeptsRequest {
  dept_id: string;
  page_size?: number;
  page_token?: string;
  with_total?: boolean;
}

/** 查询子部门响应 */
export interface GetSubDeptsResponse {
  items: DeptInfo[];
  page_token?: string;
  total?: number;
}

/** 批量查询部门请求 */
export interface BatchReadDeptsRequest {
  dept_ids: string[];
}

/** 批量查询部门响应 */
export interface BatchReadDeptsResponse {
  items: DeptInfo[];
}

/** 创建部门请求参数 */
export interface CreateDeptRequest {
  name: string;
  parent_id: string;
  ex_dept_id?: string;
  order?: number;
  leaders?: { user_id: string; order: number }[];
}

/** 更新部门请求参数 */
export interface UpdateDeptRequest {
  dept_id: string;
  name?: string;
  ex_dept_id?: string;
  order?: number;
  leaders?: { user_id: string; order: number }[];
}

/** 添加部门成员请求 */
export interface AddDeptMemberRequest {
  dept_id: string;
  user_id: string;
}

/** 批量修改用户部门排序请求 */
export interface BatchUpdateUserOrderRequest {
  user_order_list: { user_id: string; dept_id: string; order: number }[];
}

/** 批量更新用户所在部门请求 */
export interface BatchUpdateUserDeptRequest {
  user_dept_info_list: { user_id: string; dept_ids: string[] }[];
}

/** 根据外部部门ID获取部门请求 */
export interface GetDeptsByExDeptIdsRequest {
  ex_dept_ids: string[];
}

/** 部门成员信息 */
export interface DeptMember {
  user_id: string;
  user_name?: string;
  avatar?: string;
  status?: string;
  role?: string;
}

/** 获取部门成员请求 */
export interface GetDeptMembersRequest {
  dept_id: string;
  status?: string;
  page_size?: number;
  page_token?: string;
}

/** 获取部门成员响应 */
export interface GetDeptMembersResponse {
  items: DeptMember[];
  page_token?: string;
  total?: number;
}

/** 批量查询部门成员请求 */
export interface BatchReadDeptMembersRequest {
  dept_id: string;
  user_ids?: string[];
  status?: string[];
  with_user_detail?: boolean;
}

/** 批量查询部门成员响应 */
export interface BatchReadDeptMembersResponse {
  items: DeptMember[];
}

/** 用户详细信息 */
export interface UserDetail {
  id: string;
  user_name: string;
  avatar?: string;
  email?: string;
  phone?: string;
  status: UserStatus;
  role: UserRole;
  ex_user_id?: string;
  title?: string;
  work_place?: string;
  city?: string;
  country?: string;
  dept_ids?: string[];
  depts?: DepartmentInfo[];
  leader_id?: string;
  employee_id?: string;
  employer?: string;
  employment_status?: string;
  employment_type?: string;
  login_name?: string;
  telephone?: string;
  gender?: string[];
  ctime?: number;
  mtime?: number;
}

/** 查询用户请求参数 */
export interface GetUserRequest {
  user_id: string;
  with_dept?: boolean;
}

/** 批量查询用户请求 */
export interface BatchReadUsersRequest {
  user_ids: string[];
  status?: UserStatus[];
  with_dept?: boolean;
}

/** 批量查询用户响应 */
export interface BatchReadUsersResponse {
  items: UserDetail[];
}

/** 查询所有用户请求 */
export interface ListAllUsersRequest {
  status?: string;
  page_size?: number;
  page_token?: string;
}

/** 查询所有用户响应 */
export interface ListAllUsersResponse {
  items: UserDetail[];
  page_token?: string;
  total?: number;
}

/** 根据手机号获取用户请求 */
export interface GetUsersByPhonesRequest {
  phones: string[];
  status: UserStatus[];
  with_dept?: boolean;
}

/** 根据ex_user_id获取用户请求 */
export interface GetUsersByExUserIdsRequest {
  ex_user_ids: string[];
  status: UserStatus[];
}

/** 创建用户请求参数 */
export interface CreateUserRequest {
  user_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  work_place?: string;
  city?: string;
  country?: string;
  dept_ids?: string[];
  ex_user_id?: string;
  leader_id?: string;
  employee_id?: string;
  employer?: string;
  employment_status?: string;
  employment_type?: string;
  login_name?: string;
  telephone?: string;
  gender?: string[];
}

/** 更新用户请求参数 */
export interface UpdateUserRequest {
  user_id: string;
  user_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  work_place?: string;
  city?: string;
  country?: string;
  dept_ids?: string[];
  ex_user_id?: string;
  leader_id?: string;
  employee_id?: string;
  employer?: string;
  employment_status?: string;
  employment_type?: string;
  login_name?: string;
  telephone?: string;
  gender?: string[];
}

/** 用户自定义属性 */
export interface UserCustomAttr {
  attr_id: string;
  option?: string;
  relation_depts?: string[];
  relation_user?: string;
  text?: string;
}

/** 批量读取用户自定义属性请求 */
export interface BatchReadUserCustomAttrsRequest {
  user_ids: string[];
}

/** 批量读取用户自定义属性响应 */
export interface BatchReadUserCustomAttrsResponse {
  items: { user_id: string; custom_attrs: UserCustomAttr[] }[];
}

/** 批量更新用户自定义属性请求 */
export interface BatchUpdateUserCustomAttrsRequest {
  users: { user_id: string; custom_attrs: UserCustomAttr[] }[];
}

/** 自定义用户属性定义 */
export interface CustomUserAttrDef {
  id?: string;
  name: string;
  value_type?: string;
  options?: { key: string; name: string }[];
}

/** 新增自定义用户属性请求 */
export interface CreateUserCustomAttrsRequest {
  custom_attrs: { name: string; value_type: string; options?: { key: string; name: string }[] }[];
}

/** 修改自定义用户属性请求 */
export interface UpdateUserCustomAttrsRequest {
  custom_attrs: CustomUserAttrDef[];
}

/** 删除自定义用户属性请求 */
export interface DeleteUserCustomAttrsRequest {
  attr_ids: string[];
}

/** 读取自定义用户属性响应 */
export interface ReadUserCustomAttrsResponse {
  items: CustomUserAttrDef[];
}

/** 通讯录权限范围 */
export interface ContactsPermissionsScope {
  scope: string;
  dept_ids?: string[];
}

/** ==================== 用户组类型定义 ==================== */

/** 用户组信息 */
export interface GroupInfo {
  id: string;
  name: string;
  source?: string;
  type?: string;
  owner_id?: string;
  creator_id?: string;
  status?: string;
  member_count?: number;
}

/** 获取用户组列表请求 */
export interface GetGroupsRequest {
  source?: string;
  user_id?: string;
  page_size?: number;
  page_token?: string;
  status?: string;
  dept_ids?: string;
  with_total?: boolean;
  exclude_dept_ids?: string;
  joined?: boolean;
}

/** 获取用户组列表响应 */
export interface GetGroupsResponse {
  items: GroupInfo[];
  page_token?: string;
  total?: number;
}

/** 创建用户组请求 */
export interface CreateGroupRequest {
  name: string;
  source?: string;
  type?: string;
  owner_id?: string;
  creator_id?: string;
}

/** 用户组成员信息 */
export interface GroupMember {
  item_id: string;
  item_type?: string;
  role?: string;
  user_name?: string;
  avatar?: string;
}

/** 获取用户组成员列表请求 */
export interface GetGroupMembersRequest {
  group_id: string;
  page_size?: number;
  page_token?: string;
  item_type?: string;
  with_user_info?: boolean;
  with_dept_info?: boolean;
}

/** 获取用户组成员列表响应 */
export interface GetGroupMembersResponse {
  items: GroupMember[];
  page_token?: string;
  total?: number;
}

/** 获取单个组成员请求 */
export interface GetGroupMemberRequest {
  group_id: string;
  item_id: string;
  item_type?: string;
  with_user_info?: boolean;
  with_dept_info?: boolean;
}

/** 批量获取组成员请求 */
export interface BatchReadGroupMembersRequest {
  group_id: string;
  members: { item_ids: string[]; item_type?: string }[];
}

/** 批量获取组成员响应 */
export interface BatchReadGroupMembersResponse {
  items: GroupMember[];
}

/** 批量添加组成员请求 */
export interface BatchCreateGroupMembersRequest {
  group_id: string;
  members: { item_ids: string[]; item_type?: string }[];
}

/** 批量删除组成员请求 */
export interface BatchDeleteGroupMembersRequest {
  group_id: string;
  members: { item_ids: string[]; item_type: string }[];
}

/** 更新组成员角色请求 */
export interface UpdateGroupMemberRoleRequest {
  group_id: string;
  item_id: string;
  item_type: string;
  role: string;
}

/** ==================== 应用信息类型定义 ==================== */

/** 应用信息 */
export interface ApplicationInfo {
  app_id: string;
  name: string;
  avatar?: string;
  description?: string;
  status?: string;
}

/** ==================== 授权分配类型定义 ==================== */

/** 商品授权信息 */
export interface EntitlementInfo {
  entitlement_key: string;
  name: string;
  description?: string;
}

/** 授权分配记录 */
export interface AllocationRecord {
  id: string;
  entity_id: string;
  entity_type: string;
  entitlement_key: string;
  created_at?: number;
}

/** 商城订单信息 */
export interface StoreOrder {
  order_id: string;
  status?: string;
  amount?: number;
  created_at?: number;
}

/** 批量创建授权分配请求 */
export interface BatchCreateAllocationsRequest {
  entity_ids: string[];
  entity_type: string;
  entitlement_key: string;
}

/** ==================== 云文档类型定义 ==================== */

/** 团队文档库信息 */
export interface DoclibInfo {
  id: string;
  name: string;
  created_at?: number;
}

/** 创建团队文档库请求 */
export interface CreateDoclibRequest {
  name: string;
}

/** 获取团队文档库列表请求 */
export interface ListDoclibsRequest {
  page_size?: number;
  with_total?: boolean;
}

/** 获取团队文档库列表响应 */
export interface ListDoclibsResponse {
  items: DoclibInfo[];
  total?: number;
}

/** 云盘信息 */
export interface DriveInfo {
  id: string;
  name: string;
  allotee_id?: string;
  allotee_type?: string;
  created_at?: number;
}

/** 创建云盘请求 */
export interface CreateDriveRequest {
  name: string;
  allotee_id: string;
  allotee_type: string;
}

/** 获取云盘列表请求 */
export interface ListDrivesRequest {
  allotee_type?: string;
  allotee_id?: string;
  page_size?: number;
  page_token?: string;
}

/** 获取云盘列表响应 */
export interface ListDrivesResponse {
  items: DriveInfo[];
  page_token?: string;
  total?: number;
}

/** 文件/文件夹信息 */
export interface FileInfo {
  id: string;
  name: string;
  file_type: string;
  drive_id?: string;
  parent_id?: string;
  created_at?: number;
  modified_at?: number;
  size?: number;
}

/** 创建文件/文件夹请求 */
export interface CreateFileOrFolderRequest {
  name: string;
  file_type: string;
}

/** 获取子文件列表请求 */
export interface ListFileChildrenRequest {
  drive_id: string;
  parent_id: string;
  page_size?: number;
  page_token?: string;
}

/** 获取子文件列表响应 */
export interface ListFileChildrenResponse {
  items: FileInfo[];
  page_token?: string;
  total?: number;
}

/** 上传hash信息 */
export interface UploadHash {
  sum: string;
  type: string;
}

/** 请求上传请求 */
export interface RequestUploadRequest {
  name: string;
  size: number;
  hashes?: UploadHash[];
}

/** 请求上传响应 */
export interface RequestUploadResponse {
  upload_url?: string;
  upload_id?: string;
  storage_key?: string;
  need_upload?: boolean;
}

/** 提交上传完成请求 */
export interface CommitUploadRequest {
  upload_id: string;
}

/** 提交上传完成响应 */
export interface CommitUploadResponse {
  storage_key: string;
  file_id?: string;
}

/** 开启文件分享请求 */
export interface OpenFileShareRequest {
  scope: string;
  role_id: string;
}

/** 开启文件分享响应 */
export interface OpenFileShareResponse {
  link_id: string;
  link_url: string;
}

/** 分享链接信息 */
export interface ShareLinkInfo {
  link_id: string;
  link_url: string;
  scope?: string;
  role?: string;
}

/** ==================== 消息与会话类型定义 ==================== */

/** 会话信息 */
export interface ChatInfo {
  id: string;
  name: string;
  type: string;
  avatar?: string;
  owner_id?: string;
  created_at?: number;
}

/** 会话成员账号 */
export interface ChatAccount {
  id: string;
  name: string;
  type: string;
  avatar?: string;
  company_id?: string;
}

/** 创建会话请求 */
export interface CreateChatRequest {
  name?: string;
  type?: string;
  account_id_list: ChatAccount[];
  avatar?: string;
  owner_id?: string;
  is_enable_nickname?: boolean;
  is_join_approve?: boolean;
  is_owner_admin_at_all?: boolean;
  is_owner_admin_modify?: boolean;
}

/** 创建会话响应 */
export interface CreateChatResponse {
  chat_id: string;
}

/** 获取会话列表请求 */
export interface ListChatsRequest {
  page_size?: number;
  page_token?: string;
}

/** 获取会话列表响应 */
export interface ListChatsResponse {
  items: ChatInfo[];
  page_token?: string;
  total?: number;
}

/** 消息receiver */
export interface MessageReceiver {
  receiver_ids: string[];
  type: string;
}

/** 批量发送消息请求 */
export interface BatchCreateMessagesRequest {
  receivers: MessageReceiver[];
  content: any;
  type?: string;
}

/** 批量发送消息响应 */
export interface BatchCreateMessagesResponse {
  items: { message_id: string; receiver_id: string }[];
}

/** ==================== 待办类型定义 ==================== */

/** 待办分类信息 */
export interface TodoCategory {
  id: string;
  name: string;
  created_at?: number;
}

/** 创建待办分类请求 */
export interface CreateTodoCategoryRequest {
  name: string;
}

/** 更新待办分类请求 */
export interface UpdateTodoCategoryRequest {
  category_id: string;
  name: string;
}

/** 待办任务标题 */
export interface TodoTaskTitle {
  prefix?: string;
  subject: string;
}

/** 待办任务信息 */
export interface TodoTask {
  id: string;
  title: TodoTaskTitle;
  is_read?: boolean;
  category_id?: string;
  created_at?: number;
  due_date?: string;
  status?: string;
}

/** 创建待办任务请求 */
export interface CreateTodoTaskRequest {
  title: TodoTaskTitle;
  is_read?: boolean;
  category_id?: string;
  due_date?: string;
  description?: string;
}

/** 更新待办任务请求 */
export interface UpdateTodoTaskRequest {
  task_id: string;
  title?: TodoTaskTitle;
  is_read?: boolean;
  status?: string;
  due_date?: string;
  description?: string;
}

/** 批量删除待办任务请求 */
export interface BatchDeleteTodoTasksRequest {
  ids: string[];
}

/** ==================== 日历类型定义 ==================== */

/** 日历信息 */
export interface CalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
  owner_id?: string;
}

/** 创建日历请求 */
export interface CreateCalendarRequest {
  summary: string;
  description?: string;
}

/** 日历权限角色 */
export type CalendarRole = "free_busy_reader" | "reader" | "writer" | "owner";

/** 创建日历权限请求 */
export interface CreateCalendarPermissionRequest {
  user_id: string;
  role: CalendarRole;
}

/** 时间 */
export interface CalendarTime {
  date?: string;
  date_time?: string;
  time_zone?: string;
}

/** 日程循环规则 */
export interface EventRecurrence {
  freq: string;
  count?: number;
  interval?: number;
  by_day?: string[];
  until?: string;
}

/** 日程信息 */
export interface EventInfo {
  id: string;
  calendar_id: string;
  summary?: string;
  description?: string;
  start_time: CalendarTime;
  end_time: CalendarTime;
  location?: string;
  recurrence?: EventRecurrence;
  created_at?: number;
}

/** 创建日程请求 */
export interface CreateEventRequest {
  summary?: string;
  description?: string;
  start_time: CalendarTime;
  end_time: CalendarTime;
  location?: string;
  recurrence?: EventRecurrence;
  attendees?: { user_id: string; type?: string }[];
}

/** 更新日程请求 */
export interface UpdateEventRequest {
  event_id: string;
  summary?: string;
  description?: string;
  start_time?: CalendarTime;
  end_time?: CalendarTime;
  location?: string;
  recurrence?: EventRecurrence;
}

/** 获取日程列表请求 */
export interface ListEventsRequest {
  calendar_id: string;
  start_time: string;
  end_time: string;
  page_size?: number;
  page_token?: string;
}

/** 获取日程列表响应 */
export interface ListEventsResponse {
  items: EventInfo[];
  page_token?: string;
  total?: number;
}

/** 日程参与者 */
export interface EventAttendee {
  id?: string;
  user_id?: string;
  type: string;
  status?: string;
}

/** 批量添加参与者请求 */
export interface BatchCreateAttendeesRequest {
  attendees: { user_id: string; type: string }[];
  is_notification?: boolean;
}

/** 批量添加参与者响应 */
export interface BatchCreateAttendeesResponse {
  items: EventAttendee[];
}

/** 批量删除参与者请求 */
export interface BatchDeleteAttendeesRequest {
  attendee_ids: string[];
  is_notification?: boolean;
}

/** 会议室信息（日程关联） */
export interface EventMeetingRoom {
  room_id: string;
  room_name?: string;
}

/** 批量添加会议室请求 */
export interface BatchCreateMeetingRoomsRequest {
  room_ids: string[];
}

/** 批量删除会议室请求 */
export interface BatchDeleteMeetingRoomsRequest {
  room_ids: string[];
}

/** ==================== 会议室类型定义 ==================== */

/** 会议室信息 */
export interface MeetingRoomInfo {
  id: string;
  name: string;
  location?: string;
  capacity?: number;
  status?: string;
  room_level_id?: string;
}

/** 获取会议室列表请求 */
export interface ListMeetingRoomsRequest {
  page_size?: number;
  page_token?: string;
  room_level_id?: string;
}

/** 获取会议室列表响应 */
export interface ListMeetingRoomsResponse {
  items: MeetingRoomInfo[];
  page_token?: string;
  total?: number;
}

/** 批量查询会议室请求 */
export interface BatchGetMeetingRoomsRequest {
  room_ids: string[];
}

/** 批量查询会议室响应 */
export interface BatchGetMeetingRoomsResponse {
  items: MeetingRoomInfo[];
}

/** 会议室设置 */
export interface MeetingRoomSetting {
  room_id: string;
  booking_limit_setting?: {
    booking_limit_switch: boolean;
    booking_duration?: number;
    booking_preview?: number;
    booking_time?: string;
  };
}

/** 批量查询会议室设置请求 */
export interface BatchGetMeetingRoomSettingsRequest {
  room_ids: string[];
}

/** 批量查询会议室设置响应 */
export interface BatchGetMeetingRoomSettingsResponse {
  items: MeetingRoomSetting[];
}

/** 更新会议室设置请求 */
export interface UpdateMeetingRoomSettingRequest {
  room_id: string;
  booking_limit_setting?: {
    booking_limit_switch: boolean;
    booking_duration?: number;
    booking_preview?: number;
    booking_time?: string;
  };
}

/** 会议室预约信息 */
export interface MeetingRoomBooking {
  id: string;
  room_id: string;
  event_id?: string;
  start_time?: number;
  end_time?: number;
  status?: string;
}

/** 批量查询会议室预约请求 */
export interface BatchGetMeetingRoomBookingsRequest {
  room_ids: string[];
  room_level_id?: string;
  start_time: number;
  end_time: number;
  include_deleted?: boolean;
}

/** 批量查询会议室预约响应 */
export interface BatchGetMeetingRoomBookingsResponse {
  items: MeetingRoomBooking[];
}

/** 更新会议室预约状态请求 */
export interface UpdateMeetingRoomBookingStatusRequest {
  booking_id: string;
  status?: string;
}

/** 会议室层级信息 */
export interface MeetingRoomLevelInfo {
  id: string;
  name: string;
}

/** 获取会议室层级列表响应 */
export interface ListMeetingRoomLevelsResponse {
  items: MeetingRoomLevelInfo[];
  page_token?: string;
  total?: number;
}

/** 批量查询会议室层级请求 */
export interface BatchGetMeetingRoomLevelsRequest {
  room_level_ids: string[];
}

/** 批量查询会议室层级响应 */
export interface BatchGetMeetingRoomLevelsResponse {
  items: MeetingRoomLevelInfo[];
}

/** 提前释放会议室请求 */
export interface ReleaseMeetingRoomRequest {
  event_id: string;
  release_type?: string;
  which_day_time?: number;
}

/** ==================== 会议纪要类型定义 ==================== */

/** 会议纪要信息 */
export interface MeetingMinute {
  id: string;
  title?: string;
  duration?: number;
  start_time?: number;
  recording_content_url?: string;
  recording_thumbnail_url?: string;
  transcript_content_url?: string;
  ai_enabled?: boolean;
  created_at?: number;
}

/** 创建会议纪要请求 */
export interface CreateMeetingMinuteRequest {
  title?: string;
  duration?: number;
  start_time?: number;
  recording_content_url?: string;
  recording_thumbnail_url?: string;
  transcript_content_url?: string;
  ai_enable?: boolean;
}

/** ==================== 多维表类型定义 ==================== */

/** 多维表字段数据 */
export interface DBSheetFieldData {
  number_format?: string;
  unique_value?: boolean;
  allow_add_item_while_inputting?: boolean;
  items?: { id: string; value: string }[];
  max?: number;
  default_value_type?: string;
  default_value?: string;
  notice_new_contact?: boolean;
  multiple_contacts?: boolean;
  only_upload_by_camera?: boolean;
  address_level?: number;
  detailed_address?: boolean;
  preset_address?: any;
  display_text?: string;
  formula?: string;
  watch_all?: boolean;
}

/** 多维表字段 */
export interface DBSheetField {
  id?: string;
  name: string;
  type: string;
  data?: DBSheetFieldData;
}

/** 多维表视图 */
export interface DBSheetView {
  id?: string;
  name: string;
  type: string;
}

/** 多维表工作表 */
export interface DBSheetSheet {
  id?: string;
  name: string;
  views?: DBSheetView[];
  fields?: DBSheetField[];
}

/** 创建多维表工作表请求 */
export interface CreateDBSheetRequest {
  name: string;
  views?: { name: string; type: string }[];
  fields?: DBSheetField[];
}

/** 更新多维表工作表请求 */
export interface UpdateDBSheetRequest {
  sheet_id: string;
  name?: string;
}

/** 创建多维表视图请求 */
export interface CreateDBSheetViewRequest {
  sheet_id: string;
  name: string;
  type: string;
}

/** 更新多维表视图请求 */
export interface UpdateDBSheetViewRequest {
  sheet_id: string;
  view_id: string;
  name?: string;
}

/** 创建多维表字段请求 */
export interface CreateDBSheetFieldsRequest {
  fields: DBSheetField[];
  prefer_id?: boolean;
}

/** 更新多维表字段请求 */
export interface UpdateDBSheetFieldsRequest {
  fields: DBSheetField[];
  prefer_id?: boolean;
}

/** 删除多维表字段请求 */
export interface DeleteDBSheetFieldsRequest {
  fields: string[];
}

/** 多维表记录 */
export interface DBSheetRecord {
  id?: string;
  fields_value?: string;
}

/** 列举记录请求 */
export interface ListDBSheetRecordsRequest {
  prefer_id?: boolean;
  show_fields_info?: boolean;
  text_value?: string;
  page_size?: number;
  page_num?: number;
}

/** 列举记录响应 */
export interface ListDBSheetRecordsResponse {
  records: DBSheetRecord[];
  fields?: DBSheetField[];
  total?: number;
}

/** 检索多条记录请求 */
export interface SearchDBSheetRecordsRequest {
  records: string[];
  prefer_id?: boolean;
  show_fields_info?: boolean;
  text_value?: string;
}

/** 检索多条记录响应 */
export interface SearchDBSheetRecordsResponse {
  records: DBSheetRecord[];
  fields?: DBSheetField[];
}

/** 创建记录请求 */
export interface CreateDBSheetRecordsRequest {
  records: { fields_value: string }[];
  prefer_id?: boolean;
}

/** 创建记录响应 */
export interface CreateDBSheetRecordsResponse {
  records: { id: string }[];
}

/** 更新记录请求 */
export interface UpdateDBSheetRecordsRequest {
  records: { id: string; fields_value: string }[];
}

/** 删除记录请求 */
export interface DeleteDBSheetRecordsRequest {
  records: string[];
}

/** 多维表Schema */
export interface DBSheetSchema {
  sheets: DBSheetSheet[];
  fields?: DBSheetField[];
}

/** ==================== 审批类型定义 ==================== */

/** 审批实例信息 */
export interface ApprovalInstance {
  id: string;
  approval_define_id?: string;
  promoter?: string;
  status?: string;
  created_at?: number;
  updated_at?: number;
}

/** 获取审批实例列表请求 */
export interface ListApprovalInstancesRequest {
  approval_define_id?: string;
  promoter?: string;
  offset?: number;
  limit?: number;
}

/** 获取审批实例列表响应 */
export interface ListApprovalInstancesResponse {
  items: ApprovalInstance[];
  total?: number;
}

/** 审批定义信息 */
export interface ApprovalDefine {
  id: string;
  name: string;
  status?: string;
}

/** 获取用户管理审批定义列表响应 */
export interface ListUserManageApprovalDefinesResponse {
  items: ApprovalDefine[];
  page?: number;
  total?: number;
}

/** ==================== 富文本消息类型定义 ==================== */

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
