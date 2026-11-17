/** Image facts KVMFlow derives without decoding pixels. */
import { createHash } from 'node:crypto';

export interface ImageFacts {
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

/**
 * Read JPEG dimensions from the SOF marker.
 * @param data - JPEG bytes.
 * @returns the intrinsic dimensions.
 */
export function jpegSize(data: Uint8Array): { width: number; height: number } {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    throw new Error('not a JPEG image');
  }
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = data[offset + 1];
    offset += 2;
    while (marker === 0xff && offset < data.length) {
      marker = data[offset];
      offset += 1;
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) break;
    const length = (data[offset] << 8) | data[offset + 1];
    if (length < 2 || offset + length > data.length) break;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 7 > data.length) break;
      const height = (data[offset + 3] << 8) | data[offset + 4];
      const width = (data[offset + 5] << 8) | data[offset + 6];
      return { width, height };
    }
    offset += length;
  }
  throw new Error('JPEG frame header not found');
}

/** Compute the content hash used by change detection and reference checks. */
export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Describe one JPEG frame. */
export function imageFacts(data: Uint8Array): ImageFacts {
  const { width, height } = jpegSize(data);
  return { width, height, bytes: data.length, sha256: sha256(data) };
}

/** Encode bytes for a browser `data:` URL. */
export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}
