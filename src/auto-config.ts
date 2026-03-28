import { WPSClient } from "./client.js";

/**
 * 自动配置助手 - 用于自动获取并填充WPS配置
 */

/**
 * 自动获取companyId并更新配置
 *
 * @param appId WPS应用ID
 * @param secretKey WPS应用密钥
 * @param apiUrl WPS API地址
 * @returns Promise<string> 包含获取到的companyId
 */
export async function autoFetchCompanyId(
  appId: string,
  secretKey: string,
  apiUrl: string = "https://openapi.wps.cn"
): Promise<string> {
  const client = new WPSClient(appId, secretKey, apiUrl);

  try {
    const userInfo = await client.getCurrentUser();
    return userInfo.company_id;
  } catch (error) {
    console.error('自动获取companyId失败:', error);
    throw new Error(`无法自动获取companyId: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 检查并补充配置 - 如果companyId缺失则自动获取
 *
 * @param config 当前配置对象
 * @returns Promise<any> 包含补全配置的对象
 */
export async function ensureConfigComplete(config: any): Promise<any> {
  if (!config.appId || !config.secretKey) {
    throw new Error('缺少必需的应用ID或密钥');
  }

  // 如果没有companyId，尝试自动获取
  if (!config.companyId) {
    console.log('正在自动获取companyId...');
    const companyId = await autoFetchCompanyId(
      config.appId,
      config.secretKey,
      config.apiUrl || "https://openapi.wps.cn"
    );

    console.log(`自动获取到companyId: ${companyId}`);

    // 返回一个新的配置对象，包含获取到的companyId
    return {
      ...config,
      companyId: companyId
    };
  }

  return config;
}