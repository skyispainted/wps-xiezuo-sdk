/**
 * 访问控制模块
 */

/**
 * 标准化允许列表（移除前缀）
 */
export function normalizeAllowFrom(allowFrom: string[]): string[] {
  return allowFrom.map(entry =>
    entry.replace(/^(wps|wps-xiezuo|simple-xiezuo):/i, "").trim()
  );
}

/**
 * 检查发送者是否在允许列表中
 */
export function isSenderAllowed(params: {
  allow: string[];
  senderId: string;
}): boolean {
  const { allow, senderId } = params;
  const normalizedSender = senderId.replace(/^(wps|wps-xiezuo|simple-xiezuo):/i, "").trim();
  return allow.includes(normalizedSender);
}

/**
 * 检查群聊是否在允许列表中
 */
export function isSenderGroupAllowed(params: {
  allow: string[];
  groupId: string;
}): boolean {
  const { allow, groupId } = params;
  const normalizedGroup = groupId.replace(/^(wps|wps-xiezuo|simple-xiezuo):/i, "").trim();
  return allow.includes(normalizedGroup);
}