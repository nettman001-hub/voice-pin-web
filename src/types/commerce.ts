export type MatchStatus = 'NOT_RECEIVED' | 'MATCHED' | 'MISMATCH' | 'NEEDS_REVIEW';
export type SmsDirection = 'INCOMING' | 'OUTGOING';
export type SmsCategory = 'PURCHASE_INFO' | 'CUSTOMER_INQUIRY' | 'QUESTION' | 'ANSWER' | 'INVOICE' | 'SHIPPING' | 'GENERAL';
export type SmsDeliveryStatus = 'RECEIVED' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
export type InvoiceStatus = 'DRAFT' | 'QUEUED' | 'SENT' | 'PAID' | 'CANCELLED';
export type PaymentMatchStatus = 'UNMATCHED' | 'MATCHED' | 'NEEDS_REVIEW';
export type ShipmentStatus = 'READY' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export interface SmsAttachment {
  id: string;
  mimeType: string;
  dataUrl: string;
  path?: string;
  fileName?: string;
}

export interface SmsMessage {
  id: string;
  sellerId: string;
  externalId?: string;
  phoneNumber: string;
  body: string;
  direction: SmsDirection;
  category: SmsCategory;
  status: SmsDeliveryStatus;
  saleIds: string[];
  attachments: SmsAttachment[];
  createdAt: string;
  receivedAt?: string;
  sentAt?: string;
  error?: string;
}

export interface FieldMatchResult {
  nickname: boolean | null;
  amount: boolean | null;
  capture: boolean | null;
}

export interface CustomerPurchaseClaim {
  id: string;
  messageId: string;
  phoneNumber: string;
  nickname: string;
  address: string;
  productName: string;
  amount: number | null;
  captureImageUrls: string[];
  saleIds: string[];
  matchStatus: MatchStatus;
  fieldMatches: FieldMatchResult;
  sellerNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementInvoice {
  id: string;
  saleIds: string[];
  customerNickname: string;
  phoneNumber: string;
  address: string;
  amount: number;
  bankAccount: string;
  dueDate: string;
  status: InvoiceStatus;
  createdAt: string;
  sentAt?: string;
  smsMessageId?: string;
}

export interface PaymentReceipt {
  id: string;
  sellerId: string;
  externalId?: string;
  payerName: string;
  amount: number;
  paidAt: string;
  memo?: string;
  saleIds: string[];
  invoiceId?: string;
  matchStatus: PaymentMatchStatus;
  createdAt: string;
}

export interface Shipment {
  id: string;
  saleIds: string[];
  recipientName: string;
  phoneNumber: string;
  address: string;
  carrier: string;
  trackingNumber: string;
  status: ShipmentStatus;
  memo: string;
  createdAt: string;
  shippedAt?: string;
  deliveredAt?: string;
  smsMessageId?: string;
}

export interface SmsBridgeConfig {
  baseUrl: string;
  apiKey: string;
  sellerId: string;
}

export interface CommerceState {
  messages: SmsMessage[];
  claims: CustomerPurchaseClaim[];
  invoices: SettlementInvoice[];
  payments: PaymentReceipt[];
  shipments: Shipment[];
  verifiedSaleIds: string[];
}
