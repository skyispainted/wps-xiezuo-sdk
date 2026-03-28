/**
 * 媒体工具（占位 - WPS协作暂未实现媒体处理）
 */

export function detectMediaTypeFromExtension(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const mediaTypes: Record<string, string> = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "bmp": "image/bmp",
    "webp": "image/webp",
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };

  return mediaTypes[ext] || "application/octet-stream";
}