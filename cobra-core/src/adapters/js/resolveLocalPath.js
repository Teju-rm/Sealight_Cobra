const path = require("path");

function resolveLocalPath({ url, layer, projectRoot, publicDir = "public", siteOrigin }) {
  if (!url) return null;

  if (layer === "backend") {
    let filePath = url.startsWith("file://") ? url.slice(7) : url;
    if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
    const absolute = path.resolve(filePath);
    const relative = path.relative(projectRoot, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join("/");
  }

  if (layer === "frontend") {
    try {
      const parsed = new URL(url);
      if (siteOrigin && parsed.origin !== new URL(siteOrigin).origin) return null;
      const pathname = parsed.pathname.replace(/^\/+/, "");
      if (!pathname) return null;
      return `${publicDir}/${pathname}`;
    } catch {
      return null;
    }
  }

  return null;
}

module.exports = { resolveLocalPath };
