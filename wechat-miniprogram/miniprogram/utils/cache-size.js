// UTF-8 JSON payload size, not JS character count or process heap usage.
function bytes(value) {
  try {
    const text = JSON.stringify(value);
    let size = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) size++;
      else if (code < 0x800) size += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) { size += 4; i++; }
      else size += 3;
    }
    return size;
  } catch (_) { return Infinity; }
}
module.exports = { bytes };
