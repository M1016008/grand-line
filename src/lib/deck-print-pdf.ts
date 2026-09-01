import type { SavedDeckDetail, SavedDeckEntry } from "@/lib/saved-decks";
import { deflateSync, inflateSync } from "node:zlib";

const MM_TO_PT = 72 / 25.4;
const PAGE_WIDTH = 210 * MM_TO_PT;
const PAGE_HEIGHT = 297 * MM_TO_PT;
const CARD_WIDTH = 63 * MM_TO_PT;
const CARD_HEIGHT = 88 * MM_TO_PT;
const COLS = 3;
const ROWS = 3;
const CARDS_PER_PAGE = COLS * ROWS;
const GRID_WIDTH = CARD_WIDTH * COLS;
const GRID_HEIGHT = CARD_HEIGHT * ROWS;
const GRID_LEFT = (PAGE_WIDTH - GRID_WIDTH) / 2;
const GRID_BOTTOM = (PAGE_HEIGHT - GRID_HEIGHT) / 2;
const CROP_MARK_LENGTH = 8;
const CROP_MARK_GAP = 3;

interface PrintableCard {
  id: string;
  name: string;
  imageUrlJp: string | null;
  role: "leader" | "main";
}

interface PdfImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  colorSpace: "/DeviceGray" | "/DeviceRGB" | "/DeviceCMYK";
  filter: "/DCTDecode" | "/FlateDecode";
  decode?: string;
}

interface EmbeddedImage {
  name: string;
  objectId: number;
}

export interface DeckPrintPdfOptions {
  includeLeader?: boolean;
}

export async function buildDeckPrintPdf(
  deck: SavedDeckDetail,
  options: DeckPrintPdfOptions = {},
): Promise<Uint8Array> {
  const printableCards = materializePrintableCards(deck, {
    includeLeader: options.includeLeader ?? true,
  });
  const builder = new PdfBuilder();
  const pagesId = builder.reserveObject();
  const fontId = builder.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const imageMap = await embedImages(builder, printableCards);
  const pageIds: number[] = [];

  for (let i = 0; i < printableCards.length; i += CARDS_PER_PAGE) {
    const pageCards = printableCards.slice(i, i + CARDS_PER_PAGE);
    const content = buildPageContent(pageCards, imageMap, i / CARDS_PER_PAGE + 1);
    const contentStream = Buffer.from(content, "ascii");
    const contentId = builder.addStreamObject("", contentStream);
    const xObjects = [...imageMap.values()]
      .map((image) => `/${image.name} ${image.objectId} 0 R`)
      .join(" ");
    const pageId = builder.addObject(
      [
        "<< /Type /Page",
        `/Parent ${pagesId} 0 R`,
        `/MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}]`,
        `/Resources << /Font << /F1 ${fontId} 0 R >> /XObject << ${xObjects} >> >>`,
        `/Contents ${contentId} 0 R`,
        ">>",
      ].join(" "),
    );
    pageIds.push(pageId);
  }

  builder.setObject(
    pagesId,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  );
  const catalogId = builder.addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  return builder.build(catalogId);
}

export const printLayout = {
  page: { widthMm: 210, heightMm: 297 },
  card: { widthMm: 63, heightMm: 88 },
  grid: { cols: COLS, rows: ROWS },
};

function materializePrintableCards(
  deck: SavedDeckDetail,
  options: Required<DeckPrintPdfOptions>,
): PrintableCard[] {
  const cards: PrintableCard[] = [];
  if (options.includeLeader) {
    cards.push({
      id: deck.leader.id,
      name: deck.leader.name,
      imageUrlJp: deck.leader.imageUrlJp,
      role: "leader",
    });
  }

  for (const entry of deck.entries) {
    for (let i = 0; i < entry.count; i++) {
      cards.push(toPrintableCard(entry));
    }
  }

  return cards;
}

function toPrintableCard(entry: SavedDeckEntry): PrintableCard {
  return {
    id: entry.card.id,
    name: entry.card.name,
    imageUrlJp: entry.card.imageUrlJp,
    role: "main",
  };
}

async function embedImages(
  builder: PdfBuilder,
  cards: PrintableCard[],
): Promise<Map<string, EmbeddedImage>> {
  const images = new Map<string, EmbeddedImage>();
  const urls = [
    ...new Set(cards.map((card) => card.imageUrlJp).filter((url): url is string => Boolean(url))),
  ];

  for (const url of urls) {
    const image = await fetchPdfImage(url);
    if (!image) continue;

    const objectId = builder.addStreamObject(
      [
        "/Type /XObject",
        "/Subtype /Image",
        `/Width ${image.width}`,
        `/Height ${image.height}`,
        `/ColorSpace ${image.colorSpace}`,
        "/BitsPerComponent 8",
        `/Filter ${image.filter}`,
        image.decode ?? "",
      ].join(" "),
      Buffer.from(image.bytes),
    );
    images.set(url, { name: `Im${images.size + 1}`, objectId });
  }

  return images;
}

async function fetchPdfImage(url: string): Promise<PdfImage | null> {
  const target = normalizeImageUrl(url);
  try {
    const res = await fetch(target, {
      headers: {
        accept: "image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5",
        referer: "https://www.onepiece-cardgame.com/",
        "user-agent": "Grand Line deck print PDF generator",
      },
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return readJpegImage(bytes) ?? readPngImage(bytes);
  } catch {
    return null;
  }
}

function normalizeImageUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://www.onepiece-cardgame.com${url}`;
  return url;
}

function readJpegImage(bytes: Uint8Array): PdfImage | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;

  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;

    const length = readUint16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;

    if (isSofMarker(marker)) {
      return {
        height: readUint16(bytes, offset + 3),
        width: readUint16(bytes, offset + 5),
        colorSpace: jpegColorSpace(bytes[offset + 7] ?? 3),
        filter: "/DCTDecode",
        decode:
          (bytes[offset + 7] ?? 3) === 4
            ? "/Decode [1 0 1 0 1 0 1 0]"
            : undefined,
        bytes,
      };
    }

    offset += length;
  }

  return null;
}

function jpegColorSpace(components: number): PdfImage["colorSpace"] {
  if (components === 1) return "/DeviceGray";
  if (components === 4) return "/DeviceCMYK";
  return "/DeviceRGB";
}

function readPngImage(bytes: Uint8Array): PdfImage | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return null;

  let offset = signature.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;

  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = ascii(bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return null;
    const data = bytes.slice(dataStart, dataEnd);

    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      transparency = data;
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (
    width <= 0 ||
    height <= 0 ||
    bitDepth !== 8 ||
    interlace !== 0 ||
    idatChunks.length === 0
  ) {
    return null;
  }

  const samples = pngSamplesPerPixel(colorType);
  if (samples === null) return null;

  const compressed = Buffer.concat(idatChunks.map((chunk) => Buffer.from(chunk)));
  const inflated = new Uint8Array(inflateSync(compressed));
  const rowLength = width * samples;
  const rows = unfilterPngRows(inflated, width, height, samples, rowLength);
  if (!rows) return null;

  const rgb = pngRowsToRgb(rows, width, height, samples, colorType, palette, transparency);
  if (!rgb) return null;

  return {
    bytes: deflateSync(rgb),
    width,
    height,
    colorSpace: "/DeviceRGB",
    filter: "/FlateDecode",
  };
}

function pngSamplesPerPixel(colorType: number): number | null {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  return null;
}

function unfilterPngRows(
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
  rowLength: number,
): Uint8Array[] | null {
  const rows: Uint8Array[] = [];
  let offset = 0;

  for (let y = 0; y < height; y++) {
    if (offset + 1 + rowLength > bytes.length) return null;
    const filter = bytes[offset];
    offset += 1;
    const source = bytes.slice(offset, offset + rowLength);
    offset += rowLength;
    const row = new Uint8Array(rowLength);
    const prev = rows[y - 1];

    for (let x = 0; x < rowLength; x++) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0;
      let value: number;

      if (filter === 0) {
        value = source[x];
      } else if (filter === 1) {
        value = source[x] + left;
      } else if (filter === 2) {
        value = source[x] + up;
      } else if (filter === 3) {
        value = source[x] + Math.floor((left + up) / 2);
      } else if (filter === 4) {
        value = source[x] + paeth(left, up, upLeft);
      } else {
        return null;
      }

      row[x] = value & 0xff;
    }

    rows.push(row);
  }

  if (width <= 0) return null;
  return rows;
}

function pngRowsToRgb(
  rows: Uint8Array[],
  width: number,
  height: number,
  samples: number,
  colorType: number,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): Uint8Array | null {
  const out = new Uint8Array(width * height * 3);
  let outOffset = 0;

  for (const row of rows) {
    for (let x = 0; x < width; x++) {
      const offset = x * samples;
      if (colorType === 0) {
        const gray = row[offset];
        out[outOffset++] = gray;
        out[outOffset++] = gray;
        out[outOffset++] = gray;
      } else if (colorType === 2) {
        out[outOffset++] = row[offset];
        out[outOffset++] = row[offset + 1];
        out[outOffset++] = row[offset + 2];
      } else if (colorType === 3) {
        if (!palette) return null;
        const paletteOffset = row[offset] * 3;
        const alpha = transparency?.[row[offset]] ?? 255;
        out[outOffset++] = compositeOverWhite(palette[paletteOffset], alpha);
        out[outOffset++] = compositeOverWhite(palette[paletteOffset + 1], alpha);
        out[outOffset++] = compositeOverWhite(palette[paletteOffset + 2], alpha);
      } else if (colorType === 4) {
        const alpha = row[offset + 1];
        const gray = compositeOverWhite(row[offset], alpha);
        out[outOffset++] = gray;
        out[outOffset++] = gray;
        out[outOffset++] = gray;
      } else if (colorType === 6) {
        const alpha = row[offset + 3];
        out[outOffset++] = compositeOverWhite(row[offset], alpha);
        out[outOffset++] = compositeOverWhite(row[offset + 1], alpha);
        out[outOffset++] = compositeOverWhite(row[offset + 2], alpha);
      } else {
        return null;
      }
    }
  }

  return out;
}

function compositeOverWhite(channel: number, alpha: number): number {
  return Math.round((channel * alpha + 255 * (255 - alpha)) / 255);
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function isSofMarker(marker: number): boolean {
  return (
    marker === 0xc0 ||
    marker === 0xc1 ||
    marker === 0xc2 ||
    marker === 0xc3 ||
    marker === 0xc5 ||
    marker === 0xc6 ||
    marker === 0xc7 ||
    marker === 0xc9 ||
    marker === 0xca ||
    marker === 0xcb ||
    marker === 0xcd ||
    marker === 0xce ||
    marker === 0xcf
  );
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function buildPageContent(
  cards: PrintableCard[],
  imageMap: Map<string, EmbeddedImage>,
  pageNumber: number,
): string {
  const lines: string[] = [];
  lines.push("0 0 0 RG");
  lines.push("0.45 w");
  lines.push(cropMarks());

  cards.forEach((card, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const x = GRID_LEFT + col * CARD_WIDTH;
    const y = PAGE_HEIGHT - GRID_BOTTOM - (row + 1) * CARD_HEIGHT;
    const image = card.imageUrlJp ? imageMap.get(card.imageUrlJp) : undefined;

    if (image) {
      lines.push("q");
      lines.push(`${num(CARD_WIDTH)} 0 0 ${num(CARD_HEIGHT)} ${num(x)} ${num(y)} cm`);
      lines.push(`/${image.name} Do`);
      lines.push("Q");
      lines.push(`0 0 0 RG 0.25 w ${num(x)} ${num(y)} ${num(CARD_WIDTH)} ${num(CARD_HEIGHT)} re S`);
    } else {
      lines.push(placeholder(card, x, y));
    }
  });

  lines.push("BT /F1 7 Tf 0.35 0.35 0.35 rg");
  lines.push(`${num(PAGE_WIDTH - 48)} ${num(16)} Td`);
  lines.push(`(${pdfText(`p.${pageNumber}`)}) Tj`);
  lines.push("ET");

  return `${lines.join("\n")}\n`;
}

function cropMarks(): string {
  const lines: string[] = [];
  const left = GRID_LEFT;
  const right = GRID_LEFT + GRID_WIDTH;
  const bottom = GRID_BOTTOM;
  const top = GRID_BOTTOM + GRID_HEIGHT;

  for (let col = 0; col <= COLS; col++) {
    const x = GRID_LEFT + col * CARD_WIDTH;
    lines.push(
      `${num(x)} ${num(top + CROP_MARK_GAP)} m ${num(x)} ${num(top + CROP_MARK_GAP + CROP_MARK_LENGTH)} l S`,
    );
    lines.push(
      `${num(x)} ${num(bottom - CROP_MARK_GAP)} m ${num(x)} ${num(bottom - CROP_MARK_GAP - CROP_MARK_LENGTH)} l S`,
    );
  }

  for (let row = 0; row <= ROWS; row++) {
    const y = GRID_BOTTOM + row * CARD_HEIGHT;
    lines.push(
      `${num(left - CROP_MARK_GAP)} ${num(y)} m ${num(left - CROP_MARK_GAP - CROP_MARK_LENGTH)} ${num(y)} l S`,
    );
    lines.push(
      `${num(right + CROP_MARK_GAP)} ${num(y)} m ${num(right + CROP_MARK_GAP + CROP_MARK_LENGTH)} ${num(y)} l S`,
    );
  }

  return lines.join("\n");
}

function placeholder(card: PrintableCard, x: number, y: number): string {
  const label = `${card.role === "leader" ? "LEADER " : ""}${card.id}`;
  return [
    "q",
    "0.96 0.95 0.9 rg",
    `${num(x)} ${num(y)} ${num(CARD_WIDTH)} ${num(CARD_HEIGHT)} re f`,
    "0.1 0.1 0.1 RG 0.5 w",
    `${num(x)} ${num(y)} ${num(CARD_WIDTH)} ${num(CARD_HEIGHT)} re S`,
    "BT /F1 11 Tf 0.1 0.1 0.1 rg",
    `${num(x + 10)} ${num(y + CARD_HEIGHT - 24)} Td`,
    `(${pdfText(label)}) Tj`,
    "ET",
    "BT /F1 7 Tf 0.35 0.35 0.35 rg",
    `${num(x + 10)} ${num(y + CARD_HEIGHT - 39)} Td`,
    `(${pdfText(card.name)}) Tj`,
    "ET",
    "Q",
  ].join("\n");
}

function pdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function num(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

class PdfBuilder {
  private objects: Array<Buffer | null> = [];

  reserveObject(): number {
    this.objects.push(null);
    return this.objects.length;
  }

  setObject(id: number, body: string | Buffer): void {
    this.objects[id - 1] = typeof body === "string" ? Buffer.from(body, "ascii") : body;
  }

  addObject(body: string | Buffer): number {
    const id = this.reserveObject();
    this.setObject(id, body);
    return id;
  }

  addStreamObject(dict: string, stream: Buffer): number {
    return this.addObject(
      Buffer.concat([
        Buffer.from(`<< ${dict} /Length ${stream.length} >>\nstream\n`, "ascii"),
        stream,
        Buffer.from("\nendstream", "ascii"),
      ]),
    );
  }

  build(rootId: number): Uint8Array {
    const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xff\xff\xff\xff\n", "binary")];
    const offsets = [0];
    let offset = chunks[0].length;

    this.objects.forEach((body, index) => {
      if (!body) throw new Error(`PDF object ${index + 1} was reserved but not set.`);
      offsets.push(offset);
      const prefix = Buffer.from(`${index + 1} 0 obj\n`, "ascii");
      const suffix = Buffer.from("\nendobj\n", "ascii");
      chunks.push(prefix, body, suffix);
      offset += prefix.length + body.length + suffix.length;
    });

    const xrefOffset = offset;
    const xrefLines = [
      "xref",
      `0 ${this.objects.length + 1}`,
      "0000000000 65535 f ",
      ...offsets
        .slice(1)
        .map((entry) => `${entry.toString().padStart(10, "0")} 00000 n `),
      "trailer",
      `<< /Size ${this.objects.length + 1} /Root ${rootId} 0 R >>`,
      "startxref",
      String(xrefOffset),
      "%%EOF",
      "",
    ];
    chunks.push(Buffer.from(xrefLines.join("\n"), "ascii"));
    return Buffer.concat(chunks);
  }
}
