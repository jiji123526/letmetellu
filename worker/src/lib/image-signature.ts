function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length
    && signature.every((value, index) => bytes[index] === value);
}

export function matchesImageSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "image/jpeg") {
    return startsWith(bytes, [0xff, 0xd8, 0xff]);
  }
  if (contentType === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === "image/gif") {
    return startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
      || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12
      && startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
      && bytes[8] === 0x57
      && bytes[9] === 0x45
      && bytes[10] === 0x42
      && bytes[11] === 0x50;
  }
  return false;
}
