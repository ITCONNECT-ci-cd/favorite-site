export type DiscordIconKind = {
  contentType: 'image/png' | 'image/x-icon' | 'image/jpeg' | 'image/gif' | 'image/webp';
  extension: 'png' | 'ico' | 'jpg' | 'gif' | 'webp';
};

/** SVG/HTML을 포함해 고정 magic 외 형식은 모두 거부한다. */
export function sniffDiscordIcon(body: Uint8Array): DiscordIconKind | null {
  if (startsWith(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (startsWith(body, [0x00, 0x00, 0x01, 0x00])) {
    return { contentType: 'image/x-icon', extension: 'ico' };
  }
  if (startsWith(body, [0xff, 0xd8, 0xff])) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (startsWith(body, [0x47, 0x49, 0x46, 0x38])) {
    return { contentType: 'image/gif', extension: 'gif' };
  }
  if (
    startsWith(body, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(body, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}

function startsWith(body: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (body.byteLength < offset + signature.length) return false;
  return signature.every((byte, index) => body[offset + index] === byte);
}
