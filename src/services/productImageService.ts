const PRODUCT_IMAGE_SIZE = 720;

export function createNumberProductImage(productCode: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = PRODUCT_IMAGE_SIZE;
  canvas.height = PRODUCT_IMAGE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return '';

  const gradient = context.createLinearGradient(0, 0, PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_SIZE);
  gradient.addColorStop(0, '#eef2ff');
  gradient.addColorStop(1, '#dbeafe');
  context.fillStyle = gradient;
  context.fillRect(0, 0, PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_SIZE);

  context.fillStyle = '#1e293b';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 34px sans-serif';
  context.fillText('VoiceCAP 임시 상품', PRODUCT_IMAGE_SIZE / 2, 230);

  const code = productCode || '000000';
  const codeFontSize = Math.max(58, Math.min(150, Math.floor(660 / Math.max(code.length, 4)) * 1.25));
  context.font = `900 ${codeFontSize}px monospace`;
  context.fillStyle = '#2563eb';
  context.fillText(code, PRODUCT_IMAGE_SIZE / 2, 370);

  context.font = '600 26px sans-serif';
  context.fillStyle = '#64748b';
  context.fillText('상품 사진이 없어 자동 생성된 이미지입니다', PRODUCT_IMAGE_SIZE / 2, 515);

  return canvas.toDataURL('image/jpeg', 0.86);
}

export async function uploadProductImageDataUrl(uploadUrl: string, dataUrl: string): Promise<void> {
  if (!uploadUrl) throw new Error('상품 이미지 업로드 주소가 없습니다.');
  if (!dataUrl) throw new Error('업로드할 상품 이미지가 없습니다.');

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('상품 이미지 형식이 올바르지 않습니다.');
  if (blob.size > 4 * 1024 * 1024) throw new Error('상품 이미지는 4MB 이하여야 합니다.');

  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'image/jpeg',
      'Cache-Control': 'max-age=3600',
      'x-upsert': 'false',
    },
    body: await blob.arrayBuffer(),
  });

  if (!upload.ok) {
    const detail = await upload.text().catch(() => '');
    throw new Error(`상품 이미지 업로드 실패 (${upload.status})${detail ? `: ${detail}` : ''}`);
  }
}

