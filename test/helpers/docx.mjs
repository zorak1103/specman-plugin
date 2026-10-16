// Test helper: builds a minimal but structurally real .docx (ZIP with stored entries) in memory, so
// the extractor is exercised against actual OOXML instead of a mocked tree.

import { crc32 } from 'node:zlib';

export function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

/** `body` is the inner XML of <w:body>; `extra` adds more zip entries (numbering, media, ...). */
export function makeDocx(body, extra = {}, rels = '') {
  return makeZip({
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${body}</w:body></w:document>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0"?><Relationships>${rels}</Relationships>`,
    ...extra,
  });
}

export const para = (text, { style, num, bold } = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${num ? `<w:numPr><w:ilvl w:val="${num.level ?? 0}"/><w:numId w:val="${num.id}"/></w:numPr>` : ''}</w:pPr>` +
  `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

export const cell = (inner, span) => `<w:tc><w:tcPr>${span ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
export const row = (...cells) => `<w:tr>${cells.join('')}</w:tr>`;
export const table = (...rows) => `<w:tbl>${rows.join('')}</w:tbl>`;

export const NUMBERING =
  `<?xml version="1.0"?><w:numbering ${NS}>` +
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';

// 1x1 transparent PNG
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
