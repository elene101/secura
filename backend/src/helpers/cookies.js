// cookie-ების უსაფრთხო წაკითხვა (ბიბლიოთეკის გარეშე)
exports.parseCookies = header => {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 1) continue;
    const k = part.slice(0, i).trim(); let v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch {}
    out[k] = v;
  }
  return out;
};
