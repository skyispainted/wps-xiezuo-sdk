import { createHash } from "node:crypto";
import { calculateWPS3Signature, calculateContentMd5, getRFC1123Date } from "./crypto.js";

/**
 * Token缓存项
 */
interface TokenCacheItem {
  token: string;
  expiresAt: number;
}

/**
 * 生成安全的缓存键（避免密钥泄露）
 */
function generateCacheKey(appId: string, secret: string): string {
  return createHash("sha256").update(`${appId}:${secret}`).digest("hex").slice(0, 32);
}

/**
 * OAuth Access Token管理器
 */
class OAuthTokenManager {
  private cache = new Map<string, TokenCacheItem>();
  private requesting = new Map<string, Promise<string>>();

  async getAccessToken(
    appId: string,
    appSecret: string,
    apiUrl: string
  ): Promise<string> {
    const cacheKey = generateCacheKey(appId, appSecret);

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }

    const existing = this.requesting.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = this.fetchAccessToken(appId, appSecret, apiUrl, cacheKey);
    this.requesting.set(cacheKey, promise);

    try {
      const token = await promise;
      return token;
    } finally {
      this.requesting.delete(cacheKey);
    }
  }

  private async fetchAccessToken(
    appId: string,
    appSecret: string,
    apiUrl: string,
    cacheKey: string
  ): Promise<string> {
    const url = `${apiUrl}/oauth2/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`获取access_token失败 ${response.status}: ${errorText}`);
    }

    const result = await response.json() as any;

    if (!result.access_token) {
      throw new Error("access_token响应无效");
    }

    const expiresIn = result.expires_in || 7200;
    this.cache.set(cacheKey, {
      token: result.access_token,
      expiresAt: Date.now() + (expiresIn - 300) * 1000,
    });

    return result.access_token;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Company Token管理器
 */
class CompanyTokenManager {
  private cache = new Map<string, TokenCacheItem>();

  async getCompanyToken(
    appId: string,
    secretKey: string,
    apiUrl: string
  ): Promise<string> {
    const cacheKey = generateCacheKey(appId, secretKey);
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
      return cached.token;
    }

    const token = await this.fetchCompanyToken(appId, secretKey, apiUrl);

    this.cache.set(cacheKey, {
      token,
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
    });

    return token;
  }

  private async fetchCompanyToken(
    appId: string,
    secretKey: string,
    apiUrl: string
  ): Promise<string> {
    const path = `/oauthapi/v3/inner/company/token?app_id=${appId}`;
    const url = `${apiUrl}${path}`;

    const date = getRFC1123Date();
    const contentType = "application/json";
    const contentMd5 = calculateContentMd5("");

    const signature = calculateWPS3Signature(
      appId,
      secretKey,
      contentMd5,
      path,
      contentType,
      date
    );

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": contentType,
        "Content-MD5": contentMd5,
        "Date": date,
        "X-Auth": signature,
      },
    });

    if (!response.ok) {
      throw new Error(`获取Company Token失败: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as any;

    if (!result.company_token) {
      throw new Error("响应中没有company_token");
    }

    return result.company_token;
  }

  clearCache(appId: string, secretKey: string): void {
    const cacheKey = generateCacheKey(appId, secretKey);
    this.cache.delete(cacheKey);
  }

  clearAllCache(): void {
    this.cache.clear();
  }
}

// 导出单例实例
export const oauthTokenManager = new OAuthTokenManager();
export const companyTokenManager = new CompanyTokenManager();

/**
 * Token管理器（统一接口）
 */
export class TokenManager {
  /**
   * 获取OAuth Access Token
   */
  async getAccessToken(
    appId: string,
    secretKey: string,
    apiUrl: string
  ): Promise<string> {
    return oauthTokenManager.getAccessToken(appId, secretKey, apiUrl);
  }

  /**
   * 获取Company Token
   */
  async getCompanyToken(
    appId: string,
    secretKey: string,
    apiUrl: string
  ): Promise<string> {
    return companyTokenManager.getCompanyToken(appId, secretKey, apiUrl);
  }

  /**
   * 清除所有Token缓存
   */
  clearAll(): void {
    oauthTokenManager.clearCache();
    companyTokenManager.clearAllCache();
  }
}

// 导出默认Token管理器
export const tokenManager = new TokenManager();