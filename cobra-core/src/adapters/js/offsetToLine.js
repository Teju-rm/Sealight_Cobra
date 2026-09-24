function offsetToLine(source, offset) {
  if (offset <= 0) return 1;
  const clipped = Math.min(offset, source.length);
  let line = 1;
  for (let i = 0; i < clipped; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

module.exports = { offsetToLine };
