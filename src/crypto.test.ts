import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateContentMd5,
  md5Hex,
  getRFC1123Date,
  calculateKSO1Signature,
  verifyKSO1Signature,
  calculateWPS3Signature,
  calculateEventSignature,
  verifyEventSignature,
  decryptEventData,
  generateKSO1AuthHeader,
} from './crypto';
import { isMessageProcessed, markMessageProcessed, cleanupExpiredDedupKeys } from './dedup';

describe('crypto', () => {
  describe('calculateContentMd5', () => {
    it('should return MD5 hash of content', () => {
      expect(calculateContentMd5('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
    });

    it('should return empty string MD5 for empty content', () => {
      expect(calculateContentMd5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    });
  });

  describe('md5Hex', () => {
    it('should return MD5 hex hash', () => {
      expect(md5Hex('test')).toBe('098f6bcd4621d373cade4e832627b4f6');
    });
  });

  describe('getRFC1123Date', () => {
    it('should return a valid RFC1123 date string', () => {
      const date = getRFC1123Date();
      expect(date).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
    });
  });

  describe('KSO-1 Signature', () => {
    const appId = 'test-app-id';
    const secretKey = 'test-secret-key';
    const method = 'POST';
    const requestURI = '/api/v1/message';
    const contentType = 'application/json';
    const ksoDate = 'Mon, 01 Jan 2024 00:00:00 GMT';
    const requestBody = '{"text":"hello"}';

    it('should calculate KSO-1 signature', () => {
      const signature = calculateKSO1Signature(
        method,
        requestURI,
        contentType,
        ksoDate,
        requestBody,
        secretKey
      );
      expect(signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate KSO-1 auth header', () => {
      const authHeader = generateKSO1AuthHeader(
        appId,
        method,
        requestURI,
        contentType,
        ksoDate,
        requestBody,
        secretKey
      );
      expect(authHeader).toMatch(/^KSO-1 test-app-id:[a-f0-9]{64}$/);
    });

    it('should verify valid KSO-1 signature', () => {
      const authHeader = generateKSO1AuthHeader(
        appId,
        method,
        requestURI,
        contentType,
        ksoDate,
        requestBody,
        secretKey
      );

      const isValid = verifyKSO1Signature(
        authHeader,
        ksoDate,
        method,
        requestURI,
        contentType,
        requestBody,
        appId,
        secretKey
      );
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const isValid = verifyKSO1Signature(
        'KSO-1 wrong-app:wrongsignature',
        ksoDate,
        method,
        requestURI,
        contentType,
        requestBody,
        appId,
        secretKey
      );
      expect(isValid).toBe(false);
    });
  });

  describe('WPS-3 Signature', () => {
    it('should calculate WPS-3 signature', () => {
      const signature = calculateWPS3Signature(
        'app-id',
        'secret-key',
        'd41d8cd98f00b204e9800998ecf8427e',
        '/api/v1/chat',
        'application/json',
        'Mon, 01 Jan 2024 00:00:00 GMT'
      );
      expect(signature).toMatch(/^WPS-3:app-id:[a-f0-9]+$/);
    });
  });

  describe('Event Signature', () => {
    const appId = 'test-app';
    const secretKey = 'test-secret';
    const topic = 'message.receive';
    const nonce = 'abc123';
    const time = Math.floor(Date.now() / 1000);
    const encryptedData = 'encrypted-data-here';

    it('should calculate and verify event signature', () => {
      const signature = calculateEventSignature(
        appId,
        secretKey,
        topic,
        nonce,
        time,
        encryptedData
      );

      const isValid = verifyEventSignature(
        appId,
        secretKey,
        topic,
        nonce,
        time,
        encryptedData,
        signature
      );
      expect(isValid).toBe(true);
    });

    it('should reject signature with wrong secret', () => {
      const signature = calculateEventSignature(
        appId,
        secretKey,
        topic,
        nonce,
        time,
        encryptedData
      );

      const isValid = verifyEventSignature(
        appId,
        'wrong-secret',
        topic,
        nonce,
        time,
        encryptedData,
        signature
      );
      expect(isValid).toBe(false);
    });

    it('should reject signature with old timestamp', () => {
      const oldTime = Math.floor(Date.now() / 1000) - 400; // More than 5 minutes ago
      const signature = calculateEventSignature(
        appId,
        secretKey,
        topic,
        nonce,
        oldTime,
        encryptedData
      );

      const isValid = verifyEventSignature(
        appId,
        secretKey,
        topic,
        nonce,
        oldTime,
        encryptedData,
        signature
      );
      expect(isValid).toBe(false);
    });
  });

  describe('decryptEventData', () => {
    it('should throw error for missing parameters', () => {
      expect(() => decryptEventData('', 'encrypted', 'nonce')).toThrow('解密参数不完整');
      expect(() => decryptEventData('secret', '', 'nonce')).toThrow('解密参数不完整');
      expect(() => decryptEventData('secret', 'encrypted', '')).toThrow('解密参数不完整');
    });
  });
});

describe('dedup', () => {
  beforeEach(() => {
    // Clear processed messages before each test
    vi.useFakeTimers();
    cleanupExpiredDedupKeys();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should track message processing status', () => {
    const key = 'message-1';

    expect(isMessageProcessed(key)).toBe(false);

    markMessageProcessed(key);
    expect(isMessageProcessed(key)).toBe(true);
  });

  it('should handle multiple messages', () => {
    expect(isMessageProcessed('msg-1')).toBe(false);
    expect(isMessageProcessed('msg-2')).toBe(false);

    markMessageProcessed('msg-1');
    expect(isMessageProcessed('msg-1')).toBe(true);
    expect(isMessageProcessed('msg-2')).toBe(false);

    markMessageProcessed('msg-2');
    expect(isMessageProcessed('msg-2')).toBe(true);
  });

  it('should expire old entries after 10 minutes', () => {
    const key = 'expiring-message';

    markMessageProcessed(key);
    expect(isMessageProcessed(key)).toBe(true);

    // Advance 9 minutes - should still be there
    vi.advanceTimersByTime(9 * 60 * 1000);
    expect(isMessageProcessed(key)).toBe(true);

    // Advance to 11 minutes - should be expired
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(isMessageProcessed(key)).toBe(false);
  });
});