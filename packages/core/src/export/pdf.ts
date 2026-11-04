/**
 * Minimal PDF writer: one page per image, each page sized to its layer (1 px = 1 pt) with a
 * JPEG embedded as-is (DCTDecode). Enough for exporting frames as a shareable PDF without a
 * PDF library. Text in these PDFs is not selectable (pages are images).
 */

export interface PdfPage {
  /** Page size in points. */
  width: number;
  height: number;
  /** Baseline JPEG bytes and their pixel size. */
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
}

const enc = new TextEncoder();

export function buildPdf(pages: readonly PdfPage[], title = 'Canvas Studio export'): Uint8Array {
  if (!pages.length) throw new Error('A PDF needs at least one page');
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string | (() => void)) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body();
    push('\nendobj\n');
  };
  const pdfString = (s: string) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?')})`;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  // Objects: 1 catalog, 2 pages, 3 info, then per page: page, content, image.
  const pageObj = (i: number) => 4 + i * 3;
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, `<< /Title ${pdfString(title)} /Producer (Canvas Studio) >>`);
  pages.forEach((p, i) => {
    const w = Math.max(1, Math.round(p.width * 100) / 100);
    const h = Math.max(1, Math.round(p.height * 100) / 100);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    object(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${pageObj(i) + 2} 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`);
    object(pageObj(i) + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(pageObj(i) + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.pixelWidth} /Height ${p.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
    });
  });
  const count = 4 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
