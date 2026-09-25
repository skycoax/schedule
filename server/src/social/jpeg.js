// Проверка и очистка JPEG без зависимостей (backend.md §5.2): оставляем только то, что нужно для картинки.
// Остаются: SOI, чистый JFIF APP0 без миниатюры, DQT, DHT, DRI, SOF0/1/2, SOS со сжатыми данными, EOI.
// Выбрасываются: APP1–APP15 (EXIF/GPS, XMP, ICC, IPTC, Adobe), COM, JFXX, и ВСЁ после EOI (против «полиглотов»).
// Отказ: не JPEG, обрезан, вложенный SOI, арифметическое/без потерь/иерархическое кодирование, точность не 8 бит,
// CMYK, нулевые размеры, сторона больше предела. Поворот из EXIF теряется — приложение «запекает» его само.

export class JpegError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JpegError';
  }
}

const SOF_ANY = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);
const SOF_OK = new Set([0xC0, 0xC1, 0xC2]);          // baseline, extended, progressive (Huffman)
const KEEP = new Set([0xDB, 0xC4, 0xDD]);            // DQT, DHT, DRI
const JFIF = Buffer.from('JFIF\0', 'latin1');
const CUT = 'Файл обрезан — загрузи фото ещё раз';
const BAD = 'Файл повреждён';
const KIND = 'Этот вид JPEG не поддерживается — сохрани фото заново';

/**
 * @param {Buffer} buf
 * @param {number} maxSide
 * @returns {{ data: Buffer, width: number, height: number, progressive: boolean }}
 */
export function sanitizeJpeg(buf, maxSide = 2048) {
  const fail = (msg) => { throw new JpegError(msg); };
  if (!Buffer.isBuffer(buf) || buf.length < 125) fail('Это не JPEG');
  if (buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) fail('Это не JPEG');

  const out = [buf.subarray(0, 2)];
  let i = 2;
  let sof = null;
  let scans = 0;
  let segments = 0;

  for (;;) {
    if (++segments > 4096) fail(BAD);
    if (i >= buf.length) fail(CUT);
    if (buf[i] !== 0xFF) fail(BAD);
    while (i < buf.length && buf[i] === 0xFF) i++;                 // заполнители
    if (i >= buf.length) fail(CUT);
    const m = buf[i++];

    if (m === 0xD9) {                                               // EOI
      if (!scans) fail('В файле нет изображения');
      out.push(Buffer.from([0xFF, 0xD9]));
      break;                                                        // всё после EOI отбрасываем
    }
    if (m === 0x00 || m === 0x01 || m === 0xD8 || (m >= 0xD0 && m <= 0xD7)) fail(BAD);

    if (i + 2 > buf.length) fail(CUT);
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) fail(CUT);
    const seg = buf.subarray(i - 2, i + len);
    const body = buf.subarray(i + 2, i + len);
    i += len;

    if (m === 0xE0) {                                               // только чистый JFIF без миниатюры
      if (len === 16 && body.subarray(0, 5).equals(JFIF) && body[12] === 0 && body[13] === 0) out.push(seg);
      continue;
    }
    if ((m >= 0xE1 && m <= 0xEF) || m === 0xFE) continue;          // EXIF/GPS, XMP, ICC, IPTC, Adobe, комментарии

    if (SOF_ANY.has(m)) {
      if (!SOF_OK.has(m)) fail(KIND);
      if (sof || body.length < 6) fail(BAD);
      const height = body.readUInt16BE(1);
      const width = body.readUInt16BE(3);
      const comps = body[5];
      if (body[0] !== 8) fail(KIND);
      if (!width || !height) fail(BAD);
      if (width > maxSide || height > maxSide) fail(`Фото больше ${maxSide} точек по стороне — уменьши его`);
      if (comps !== 1 && comps !== 3) fail('Нужна обычная фотография (RGB или ч/б)');
      if (body.length !== 6 + comps * 3) fail(BAD);
      sof = { width, height, progressive: m === 0xC2 };
      out.push(seg);
      continue;
    }

    if (m === 0xDA) {                                               // SOS + сжатые данные
      if (!sof) fail(BAD);
      out.push(seg);
      scans++;
      const start = i;
      for (;;) {
        const ff = buf.indexOf(0xFF, i);
        if (ff === -1 || ff + 1 >= buf.length) fail(CUT);
        const n = buf[ff + 1];
        if (n === 0x00 || (n >= 0xD0 && n <= 0xD7)) { i = ff + 2; continue; }   // FF00, RSTn
        if (n === 0xFF) { i = ff + 1; continue; }                               // заполнитель
        i = ff;                                                                  // настоящий маркер
        break;
      }
      out.push(buf.subarray(start, i));
      continue;
    }

    if (KEEP.has(m)) { out.push(seg); continue; }
    fail(KIND);                                                     // DNL, DHP, EXP, JPGn, SOF55 (JPEG-LS)…
  }

  if (!sof) fail(BAD);
  return { data: Buffer.concat(out), width: sof.width, height: sof.height, progressive: sof.progressive };
}
