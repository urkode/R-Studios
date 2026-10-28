/* Creates a self-contained PDF: photograph on the base layer, ink and text on editable layers. */
function pdfNumber(value) {
  return Number(value.toFixed(3)).toString();
}

function pdfRgb(value) {
  const hex = String(value || '#ffffff').replace('#', '');
  const full = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number)) return [1, 1, 1];
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

function pdfText(value) {
  return String(value || '').split('').map(char => {
    const code = char.charCodeAt(0);
    if (char === '(' || char === ')' || char === '\\') return `\\${char}`;
    if (code >= 32 && code <= 126) return char;
    /* WinAnsi covers Norwegian letters; octal notation keeps the PDF stream ASCII-safe. */
    return `\\${(code <= 255 ? code : 63).toString(8).padStart(3, '0')}`;
  }).join('');
}

function preparedPdfImage(canvas, maxDimension) {
  const largestSide = Math.max(canvas.width, canvas.height);
  if (!maxDimension || largestSide <= maxDimension) return canvas;
  const scale = maxDimension / largestSide;
  const image = document.createElement('canvas');
  image.width = Math.max(1, Math.round(canvas.width * scale));
  image.height = Math.max(1, Math.round(canvas.height * scale));
  image.getContext('2d').drawImage(canvas, 0, 0, image.width, image.height);
  return image;
}

function canvasJpegBytes(canvas, quality = .95) {
  const binary = atob(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pdfBytes(value) {
  return new TextEncoder().encode(value);
}

function exportEditablePdf(options = {}) {
  const pdfImage = preparedPdfImage(photo, options.maxImageDimension);
  const jpeg = canvasJpegBytes(pdfImage, options.quality ?? .95);
  const scale = Math.min(1, 1000 / Math.max(photo.width, photo.height));
  /* Text sizes are shown in screen pixels in the editor. Convert them back to
     photo pixels before writing the PDF, just as the image preview does. */
  const textSourceScale = photo.width / Math.max(1, textLayer.getBoundingClientRect().width);
  const pageWidth = photo.width * scale;
  const pageHeight = photo.height * scale;
  const drawing = [];
  const text = [];

  strokes.forEach(stroke => {
    if (!stroke.points || stroke.points.length < 2) return;
    const [red, green, blue] = pdfRgb(stroke.color);
    drawing.push(`${pdfNumber(red)} ${pdfNumber(green)} ${pdfNumber(blue)} RG ${pdfNumber(stroke.width * scale)} w 1 J 1 j`);
    stroke.points.forEach((point, index) => {
      const x = pdfNumber(point.x * scale);
      const y = pdfNumber(pageHeight - point.y * scale);
      drawing.push(`${x} ${y} ${index ? 'l' : 'm'}`);
    });
    drawing.push('S');
  });

  textLayer.querySelectorAll('.text-entry').forEach(entry => {
    const value = entry.value.trim();
    if (!value) return;
    const [red, green, blue] = pdfRgb(entry.style.getPropertyValue('--text-color'));
    const sourceSize = (Number(entry.dataset.size) || 20) * textSourceScale;
    const size = sourceSize * scale;
    const x = Number(entry.dataset.x) * scale;
    const y = pageHeight - (Number(entry.dataset.y) + sourceSize) * scale;
    text.push(`BT /F1 ${pdfNumber(size)} Tf ${pdfNumber(red)} ${pdfNumber(green)} ${pdfNumber(blue)} rg 1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm (${pdfText(value)}) Tj ET`);
  });

  const stream = [
    'q',
    `${pdfNumber(pageWidth)} 0 0 ${pdfNumber(pageHeight)} 0 0 cm`,
    '/Im0 Do',
    'Q',
    '/OC /Drawing BDC',
    ...drawing,
    'EMC',
    '/OC /Text BDC',
    ...text,
    'EMC'
  ].join('\n');
  const streamBytes = pdfBytes(stream);
  const chunks = [];
  const offsets = [];
  let length = 0;
  const add = value => {
    const bytes = typeof value === 'string' ? pdfBytes(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (number, parts) => {
    offsets[number] = length;
    add(`${number} 0 obj\n`);
    parts.forEach(add);
    add('\nendobj\n');
  };

  add('%PDF-1.5\n%PDF\n');
  object(1, ['<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R 8 0 R] /D << /Order [7 0 R 8 0 R] /ON [7 0 R 8 0 R] >> >> >>']);
  object(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
  object(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(pageWidth)} ${pdfNumber(pageHeight)}] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 5 0 R >> /Properties << /Text 7 0 R /Drawing 8 0 R >> >> /Contents 6 0 R >>`]);
  object(4, [`<< /Type /XObject /Subtype /Image /Width ${pdfImage.width} /Height ${pdfImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
  object(5, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']);
  object(6, [`<< /Length ${streamBytes.length} >>\nstream\n`, streamBytes, '\nendstream']);
  object(7, ['<< /Type /OCG /Name (Tekst) >>']);
  object(8, ['<< /Type /OCG /Name (Tegning) >>']);
  const xref = length;
  add('xref\n0 9\n0000000000 65535 f \n');
  for (let index = 1; index <= 8; index += 1) add(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

function exportEmailPdf() {
  const byteLimit = Math.round(2.6 * 1024 * 1024);
  const variants = [
    { maxImageDimension: 2600, quality: .9 },
    { maxImageDimension: 2100, quality: .86 },
    { maxImageDimension: 1700, quality: .82 },
    { maxImageDimension: 1450, quality: .78 }
  ];
  let candidate = exportEditablePdf();
  if (candidate.size <= byteLimit) return candidate;
  for (const variant of variants) {
    candidate = exportEditablePdf(variant);
    if (candidate.size <= byteLimit) return candidate;
  }
  return candidate;
}
