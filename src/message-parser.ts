/**
 * WPS协作消息解析器
 */

/**
 * WPS事件结构（解密后）
 */
export interface WPSEvent {
  chat: {
    id: string;
    type: "p2p" | "group";
  };
  company_id: string;
  message: {
    id: string;
    type: "text" | "image" | "file" | "rich_text" | "card" | "audio" | "video" | "sticker";
    content: any;
    mentions?: Array<{
      id: string;
      identity: {
        id: string;
        name: string;
        type: "app" | "user";
      };
      type: string;
    }>;
  };
  send_time: number;
  sender: {
    id: string;
    type: "user" | "app";
  };
}

/**
 * 解析后的消息
 */
export interface ParsedMessage {
  text: string;
  mediaUrls: string[];
  chatId: string;
  chatType: "p2p" | "group";
  senderId: string;
  messageId: string;
  companyId: string;
  isAtBot?: boolean;
  messageType: string; // 消息类型: text, image, file, rich_text, card, audio, video
  messageData?: any; // 原始消息数据
}

/**
 * 解析WPS消息为Clawdbot格式
 */
export function parseWPSMessage(event: WPSEvent): ParsedMessage {
  // 基本验证
  if (!event || !event.message || !event.chat || !event.sender) {
    throw new Error("无效的事件数据结构");
  }

  const message = event.message;
  const result: ParsedMessage = {
    text: "",
    mediaUrls: [],
    chatId: event.chat.id,
    chatType: event.chat.type,
    senderId: event.sender.id,
    messageId: message.id,
    companyId: event.company_id,
    messageType: message.type,
    messageData: message.content,
  };

  // 检查是否@了机器人
  if (message.mentions && message.mentions.length > 0) {
    result.isAtBot = message.mentions.some(m => m.identity?.type === "app");
  }

  // 根据消息类型解析内容
  switch (message.type) {
    case "text":
      result.text = parseTextMessage(message.content);
      break;

    case "image":
      result.text = "[图片]";
      const imageUrl = parseImageMessage(message.content);
      if (imageUrl) {
        result.mediaUrls.push(imageUrl);
      }
      break;

    case "file":
      const fileInfo = parseFileMessage(message.content);
      result.text = fileInfo.text;
      if (fileInfo.url) {
        result.mediaUrls.push(fileInfo.url);
      }
      break;

    case "rich_text":
      const richTextInfo = parseRichTextMessage(message.content);
      result.text = richTextInfo.text;
      result.mediaUrls.push(...richTextInfo.mediaUrls);
      break;

    case "audio":
      result.text = "[音频]";
      const audioUrl = parseAudioMessage(message.content);
      if (audioUrl) {
        result.mediaUrls.push(audioUrl);
      }
      break;

    case "video":
      result.text = "[视频]";
      const videoUrl = parseVideoMessage(message.content);
      if (videoUrl) {
        result.mediaUrls.push(videoUrl);
      }
      break;

    case "sticker":
      result.text = "[表情包]";
      const stickerUrl = parseStickerMessage(message.content);
      if (stickerUrl) {
        result.mediaUrls.push(stickerUrl);
      }
      break;

    default:
      result.text = `[不支持的消息类型: ${message.type}]`;
  }

  return result;
}

/**
 * 解析文本消息
 */
function parseTextMessage(content: any): string {
  if (content?.text?.content) {
    // 移除@标签，只保留纯文本
    let text = content.text.content;
    text = text.replace(/<at[^>]*>.*?<\/at>/g, "").trim();
    return text;
  }
  return "";
}

/**
 * 解析图片消息
 */
function parseImageMessage(content: any): string {
  if (content?.image?.storage_key) {
    // 返回storage_key，后续可以通过WPS API下载
    return `wps-storage:${content.image.storage_key}`;
  }
  return "";
}

/**
 * 解析文件消息
 */
function parseFileMessage(content: any): { text: string; url?: string } {
  if (content?.file?.type === "local" && content.file.local) {
    const file = content.file.local;
    return {
      text: `[文件: ${file.name || "未知文件"}]`,
      url: file.storage_key ? `wps-storage:${file.storage_key}` : undefined,
    };
  }

  if (content?.file?.type === "cloud" && content.file.cloud) {
    const cloud = content.file.cloud;
    return {
      text: `[云文档: ${cloud.link_url || "未知链接"}]`,
      url: cloud.link_url,
    };
  }

  return { text: "[未知文件]" };
}

/**
 * 解析富文本消息
 */
function parseRichTextMessage(content: any): { text: string; mediaUrls: string[] } {
  const parts: string[] = [];
  const mediaUrls: string[] = [];

  if (!content?.rich_text?.elements) {
    return { text: "", mediaUrls: [] };
  }

  for (const element of content.rich_text.elements) {
    if (!element.elements) continue;

    for (const item of element.elements) {
      if (item.type === "text" && item.text_content?.content) {
        parts.push(item.text_content.content);
      } else if (item.type === "text" && item.style_text_content?.text) {
        parts.push(item.style_text_content.text);
      } else if (item.type === "image" && item.image_content?.storage_key) {
        parts.push("[图片]");
        mediaUrls.push(`wps-storage:${item.image_content.storage_key}`);
      } else if (item.type === "emoji" && item.text_content?.content) {
        parts.push(item.text_content.content);
      }
    }
  }

  return {
    text: parts.join(" "),
    mediaUrls,
  };
}

/**
 * 解析音频消息
 */
function parseAudioMessage(content: any): string {
  if (content?.audio?.storage_key) {
    return `wps-storage:${content.audio.storage_key}`;
  }
  return "";
}

/**
 * 解析视频消息
 */
function parseVideoMessage(content: any): string {
  if (content?.video?.storage_key) {
    return `wps-storage:${content.video.storage_key}`;
  }
  return "";
}

/**
 * 解析表情包消息
 */
function parseStickerMessage(content: any): string {
  if (content?.sticker?.image?.storage_key) {
    return `wps-storage:${content.sticker.image.storage_key}`;
  }
  return "";
}

/**
 * 格式化消息用于日志输出
 */
export function formatMessageForLog(event: WPSEvent): string {
  const parsed = parseWPSMessage(event);
  return `[${event.chat.type}] ${event.sender.id}: ${parsed.text}`;
}
