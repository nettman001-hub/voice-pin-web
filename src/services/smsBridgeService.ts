import { PaymentReceipt, SmsBridgeConfig, SmsCategory, SmsMessage } from '../types/commerce';

const CONFIG_KEY = 'voicecap_sms_bridge_config';

const withTimeout = async (url: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
};

const request = async <T>(config: SmsBridgeConfig, path: string, init?: RequestInit): Promise<T> => {
  const response = await withTimeout(`${config.baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-VoiceCAP-Key': config.apiKey,
      ...(init?.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `연동 서버 오류 (${response.status})`);
  }
  return response.json() as Promise<T>;
};

export const smsBridgeService = {
  getConfig(defaultSellerId = 'u-seller-1'): SmsBridgeConfig {
    try {
      const stored = localStorage.getItem(CONFIG_KEY);
      if (stored) {
        return { baseUrl: 'http://127.0.0.1:2137', apiKey: '', sellerId: defaultSellerId, ...JSON.parse(stored) };
      }
    } catch { /* 기본 설정 사용 */ }
    return { baseUrl: 'http://127.0.0.1:2137', apiKey: '', sellerId: defaultSellerId };
  },

  saveConfig(config: SmsBridgeConfig) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  },

  async getStatus(config: SmsBridgeConfig) {
    return request<{ ok: boolean; service: string; queuedMessages: number }>(config, '/api/bridge/status');
  },

  async getMessages(config: SmsBridgeConfig): Promise<SmsMessage[]> {
    const result = await request<{ messages: SmsMessage[] }>(
      config,
      `/api/sms/messages?sellerId=${encodeURIComponent(config.sellerId)}&limit=1000`
    );
    return result.messages || [];
  },

  async queueMessage(
    config: SmsBridgeConfig,
    payload: { phoneNumber: string; body: string; category: SmsCategory; saleIds: string[] }
  ): Promise<SmsMessage> {
    const result = await request<{ message: SmsMessage }>(config, '/api/sms/outbox', {
      method: 'POST',
      body: JSON.stringify({ ...payload, sellerId: config.sellerId })
    });
    return result.message;
  },

  async getPayments(config: SmsBridgeConfig): Promise<PaymentReceipt[]> {
    const result = await request<{ payments: PaymentReceipt[] }>(
      config,
      `/api/payments?sellerId=${encodeURIComponent(config.sellerId)}&limit=1000`
    );
    return result.payments || [];
  }
};

