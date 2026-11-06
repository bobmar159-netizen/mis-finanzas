'use strict';

function splitHttpResponse(raw) {
  const value = String(raw || '');
  const matches = [...value.matchAll(/(?:^|\n)HTTP\/\d(?:\.\d)?\s+(\d{3})[^\n]*(?:\r?\n|$)/g)];
  if (!matches.length) return { public_http_status: null, body: value.trim(), headers_present: false };
  const match = matches[matches.length - 1];
  const headerEnd = value.indexOf('\r\n\r\n', match.index) >= 0
    ? value.indexOf('\r\n\r\n', match.index) + 4
    : value.indexOf('\n\n', match.index) >= 0
      ? value.indexOf('\n\n', match.index) + 2
      : match.index + match[0].length;
  return { public_http_status: Number(match[1]), body: value.slice(headerEnd).trim(), headers_present: true };
}

module.exports = { splitHttpResponse };
