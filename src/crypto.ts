import { createHash, createHmac, createDecipheriv, timingSafeEqual } from "node:crypto";

/**
 * WPS协作加解密工具
 */

export function calculateContentMd5(content: string): string {
  if (!content) {
    return "d41d8cd98f00b204e9800998ecf8427e";
  }
  return createHash("md5").update(content, "utf8").digest("hex");
}

export function md5Hex(content: string): string {
  return createHash("md5").update(content, "utf8").digest("hex");
}

export function getRFC1123Date(): string {
  return new Date().toUTCString();
}

/**
 * 安全的字符串比较（防止时序攻击）
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  try {
    return timingSafeEqual(
      Buffer.from(a, "utf8"),
      Buffer.from(b, "utf8")
    );
  } catch {
    return false;
  }
}

export function calculateKSO1Signature(
  method: string,
  requestURI: string,
  contentType: string,
  ksoDate: string,
  requestBody: string,
  secretKey: string
): string {
  let sha256Hex = "";
  if (requestBody && requestBody.length > 0) {
    sha256Hex = createHash("sha256").update(requestBody, "utf8").digest("hex");
  }

  const signContent = "KSO-1" + method + requestURI + contentType + ksoDate + sha256Hex;
  const signature = createHmac("sha256", secretKey)
    .update(signContent, "utf8")
    .digest("hex");

  return signature;
}

/**
 * 生成完整的 KSO-1 Authorization Header
 */
export function generateKSO1AuthHeader(
  appId: string,
  method: string,
  requestURI: string,
  contentType: string,
  ksoDate: string,
  requestBody: string,
  secretKey: string
): string {
  const signature = calculateKSO1Signature(
    method,
    requestURI,
    contentType,
    ksoDate,
    requestBody,
    secretKey
  );
  
  return `KSO-1 ${appId}:${signature}`;
}

export function verifyKSO1Signature(
  authHeader: string,
  ksoDate: string,
  method: string,
  requestURI: string,
  contentType: string,
  requestBody: string,
  expectedAccessKey: string,
  secretKey: string
): boolean {
  try {
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "KSO-1") {
      return false;
    }

    const [accessKey, providedSignature] = parts[1].split(":");
    if (!accessKey || !providedSignature) {
      return false;
    }

    // 使用安全比较防止时序攻击
    if (!safeCompare(accessKey, expectedAccessKey)) {
      return false;
    }

    const expectedSignature = calculateKSO1Signature(
      method,
      requestURI,
      contentType,
      ksoDate,
      requestBody,
      secretKey
    );

    // 使用安全比较防止时序攻击
    return safeCompare(providedSignature, expectedSignature);
  } catch (error) {
    return false;
  }
}

export function calculateWPS3Signature(
  appId: string,
  secretKey: string,
  contentMd5: string,
  requestUri: string,
  contentType: string,
  date: string
): string {
  const hash = createHash("sha1");
  hash.update(secretKey.toLowerCase());
  hash.update(contentMd5);
  hash.update(requestUri);
  hash.update(contentType);
  hash.update(date);
  
  const signature = hash.digest("hex");
  return `WPS-3:${appId}:${signature}`;
}

export function calculateEventSignature(
  appId: string,
  secretKey: string,
  topic: string,
  nonce: string,
  time: number,
  encryptedData: string
): string {
  const content = `${appId}:${topic}:${nonce}:${time}:${encryptedData}`;
  const hmac = createHmac("sha256", secretKey);
  hmac.update(content, "utf8");
  
  const signature = hmac.digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  return signature;
}

export function verifyEventSignature(
  appId: string,
  secretKey: string,
  topic: string,
  nonce: string,
  time: number,
  encryptedData: string,
  receivedSignature: string
): boolean {
  try {
    // 验证时间戳（防止重放攻击）
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(currentTime - time);
    
    // 允许 5 分钟的时间偏差
    if (timeDiff > 300) {
      console.warn("[crypto] Event timestamp too old or too new:", timeDiff, "seconds");
      return false;
    }

    const expectedSignature = calculateEventSignature(
      appId,
      secretKey,
      topic,
      nonce,
      time,
      encryptedData
    );
    
    // 使用安全比较防止时序攻击
    return safeCompare(expectedSignature, receivedSignature);
  } catch (error) {
    return false;
  }
}

export function decryptEventData(
  secretKey: string,
  encryptedData: string,
  nonce: string
): string {
  // 参数验证
  if (!secretKey || !encryptedData || !nonce) {
    throw new Error("解密参数不完整");
  }

  try {
    // Base64 解码
    const encryptedBuffer = Buffer.from(encryptedData, "base64");

    // 使用 MD5(secretKey) 作为密钥 - 根据 Python 示例，密钥是 MD5 的十六进制字符串（作为 UTF8）
    const cipherHex = md5Hex(secretKey);
    // 注意：根据 Python 示例，cipher 是直接用 UTF8 编码的十六进制字符串，不是解析为二进制
    const keyBuffer = Buffer.from(cipherHex, "utf8");  // 直接使用 UTF8 编码

    // 根据 Python 示例，nonce 也是直接用 UTF8 编码
    const ivBuffer = Buffer.from(nonce, "utf8");

    // 使用 AES-256 还是 AES-128？
    // Python 示例中，cipher 是 32 字节的 UTF8 编码，对应 AES-256
    let decipher;
    if (keyBuffer.length === 32) {
      // 密钥是 32 字节，使用 AES-256
      decipher = createDecipheriv("aes-256-cbc", keyBuffer, ivBuffer);
    } else if (keyBuffer.length === 16) {
      // 密钥是 16 字节，使用 AES-128
      decipher = createDecipheriv("aes-128-cbc", keyBuffer, ivBuffer);
    } else {
      throw new Error(`不支持的密钥长度: ${keyBuffer.length} 字节`);
    }

    decipher.setAutoPadding(true);

    const decrypted = Buffer.concat([
      decipher.update(encryptedBuffer),
      decipher.final()
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    throw new Error(`解密失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}
