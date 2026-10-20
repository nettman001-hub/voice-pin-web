import type { ProductSalesSettings } from '../types/productSales';

export const DEFAULT_PRODUCT_SALES_SETTINGS: ProductSalesSettings = {
  revision: 1,
  productRegistrationEnabled: true,
  captureProductImageEnabled: true,
  productNameInputEnabled: true,
  voicePreviewMs: 2500,
  voiceCommands: {
    registerProduct: ['상품등록'],
    captureProduct: ['상품캡처'],
    setProductName: ['상품번호', '상품명'],
    setPrice: ['금액', '가격'],
    confirmSale: ['판매완료', '구매확정'],
    setBuyer: ['닉네임'],
  },
};
