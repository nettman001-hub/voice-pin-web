import { concatBytes } from './marklifeProtocol.ts';
import { LABEL_PAPERS, type LabelPaperSize } from './labelPaper.ts';

/** XP-237BT in TSPL label mode. Stock dimensions come from the selected profile.
 * Gap and bitmap polarity require confirmation on the installed firmware.
 */
export const XP_LABEL = { gapMm: 2, density: 8, speed: 2 };
const ascii = (text: string) => new TextEncoder().encode(text);

export function xprinterPrintJob(bitmap: { rowBytes: number; height: number; data: Uint8Array }, paperSize: LabelPaperSize = '50x30') {
  const paper = LABEL_PAPERS[paperSize];
  if (bitmap.rowBytes < 1 || bitmap.rowBytes > paper.widthPx / 8 || bitmap.height < 1 || bitmap.height > paper.heightPx ||
      bitmap.data.length !== bitmap.rowBytes * bitmap.height)
    throw new Error('XP-237BT 라벨 이미지 크기가 올바르지 않습니다.');
  // TSPL BITMAP: 0 is black, 1 is white. Marklife packing uses the reverse.
  const image = bitmap.data.map((byte) => byte ^ 0xff);
  return concatBytes([
    ascii(`SIZE ${paper.widthMm} mm,${paper.heightMm} mm\r\nGAP ${XP_LABEL.gapMm} mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nOFFSET 0 mm\r\nDENSITY ${XP_LABEL.density}\r\nSPEED ${XP_LABEL.speed}\r\nCLS\r\nBITMAP 0,0,${bitmap.rowBytes},${bitmap.height},0,`),
    image,
    ascii('\r\nPRINT 1,1\r\n'),
  ]);
}

export const xprinterCalibrate = (paperSize: LabelPaperSize = '50x30') => {
  const paper = LABEL_PAPERS[paperSize];
  return ascii(`SIZE ${paper.widthMm} mm,${paper.heightMm} mm\r\nGAP ${XP_LABEL.gapMm} mm,0 mm\r\nGAPDETECT\r\n`);
};
