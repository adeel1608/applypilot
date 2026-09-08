export function containsPrivateCanary(bytes: Buffer, needle: string): boolean {
  const encoded = Buffer.from(needle, "utf8");
  if (encoded.byteLength >= 7) return bytes.includes(encoded);
  let offset = 0;
  while ((offset = bytes.indexOf(encoded, offset)) >= 0) {
    let start = offset - 1;
    let end = offset + encoded.byteLength;
    while (start >= 0 && bytes[start]! >= 32 && bytes[start]! <= 126) start -= 1;
    while (end < bytes.length && bytes[end]! >= 32 && bytes[end]! <= 126) end += 1;
    // Four-to-six-byte names can occur randomly in opaque compiler databases.
    // Treat them as a canary only when they are embedded in readable artifact text.
    if (end - start - 1 >= 16) return true;
    offset += encoded.byteLength;
  }
  return false;
}
