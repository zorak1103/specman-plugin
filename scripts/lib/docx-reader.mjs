// docx-reader.mjs — dependency-free reader for the parts of a .docx the SUC migration needs: a
// minimal ZIP reader (central directory + stored/deflate), a small tolerant XML parser, and the
// extraction of document.xml into a flat, id-addressed block tree (paragraphs, tables, images).
//
// Decisions fixed by the migration brief, implemented here:
//   * Tracked changes: the *final* state is extracted — `w:ins`/`w:moveTo` content is kept,
//     `w:del`/`w:moveFrom` content and rows whose `w:trPr` carries `w:del` are dropped.
//   * Comments are ignored (only counted in `stats.comments`).
//   * Nothing is ever written to disk by entry name: images are handed to a caller-supplied sink
//     under a generated file name, so a hostile archive cannot escape the output directory.
//
// Everything that cannot be represented faithfully ends up in `warnings` instead of being dropped
// silently — the migration promise is that no logic gets lost without somebody being told.

import { inflateRawSync } from 'node:zlib';

// ============================================================
// ZIP
// ============================================================

const MAX_INFLATED_BYTES = 256 * 1024 * 1024;

export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('docx: kein gültiges ZIP (End-of-Central-Directory nicht gefunden).');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('docx: ZIP64 wird nicht unterstützt.');

  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('docx: Central-Directory beschädigt.');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    entries.set(buf.toString('utf8', p + 46, p + 46 + nameLen), { method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    has: (name) => entries.has(name),
    names: () => [...entries.keys()],
    get(name) {
      const e = entries.get(name);
      if (!e) return undefined;
      if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error(`docx: lokaler Header von '${name}' beschädigt.`);
      const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
      const raw = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return Buffer.from(raw);
      if (e.method === 8) return inflateRawSync(raw, { maxOutputLength: MAX_INFLATED_BYTES });
      throw new Error(`docx: Kompressionsmethode ${e.method} von '${name}' wird nicht unterstützt.`);
    },
  };
}

// ============================================================
// XML
// ============================================================

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const TOKEN_RE = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR_RE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Returns the document element: `{ name, attrs, children }`; text nodes are `{ text }`. */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(xml)) !== null) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.children.push({ text: m[1] }); continue; }
    if (m[2] !== undefined) {
      if (stack.length === 1 || top.name !== m[2]) throw new Error(`xml: unerwartetes End-Tag </${m[2]}>`);
      stack.pop();
      continue;
    }
    if (m[3] !== undefined) {
      const attrs = {};
      let a;
      ATTR_RE.lastIndex = 0;
      while ((a = ATTR_RE.exec(m[4])) !== null) attrs[a[1]] = decodeEntities(a[2] ?? a[3]);
      const node = { name: m[3], attrs, children: [] };
      top.children.push(node);
      if (m[5] !== '/') stack.push(node);
      continue;
    }
    if (m[6] !== undefined) top.children.push({ text: decodeEntities(m[6]) });
  }
  if (stack.length !== 1) throw new Error(`xml: Element <${stack[stack.length - 1].name}> nicht geschlossen.`);
  return root.children.find((c) => c.name);
}

const kids = (node, name) => (node ? node.children.filter((c) => c.name === name) : []);
const kid = (node, name) => kids(node, name)[0];
const val = (node) => (node ? node.attrs['w:val'] : undefined);
const isOn = (node) => node !== undefined && !['0', 'false', 'off', 'none'].includes(val(node) ?? 'true');
const textOf = (node) => node.children.map((c) => (c.text !== undefined ? c.text : textOf(c))).join('');

function* descendants(node) {
  for (const c of node.children) {
    if (c.name) { yield c; yield* descendants(c); }
  }
}

// ============================================================
// Numbering / relationships
// ============================================================

function readNumbering(zip) {
  const orderedByNumLevel = new Map();
  if (!zip.has('word/numbering.xml')) return () => false;
  const root = parseXml(zip.get('word/numbering.xml').toString('utf8'));
  const abstractFormats = new Map();
  for (const abs of kids(root, 'w:abstractNum')) {
    const levels = new Map();
    for (const lvl of kids(abs, 'w:lvl')) levels.set(lvl.attrs['w:ilvl'], val(kid(lvl, 'w:numFmt')));
    abstractFormats.set(abs.attrs['w:abstractNumId'], levels);
  }
  for (const num of kids(root, 'w:num')) {
    const levels = abstractFormats.get(val(kid(num, 'w:abstractNumId')));
    if (levels) orderedByNumLevel.set(num.attrs['w:numId'], levels);
  }
  return (numId, ilvl) => {
    const fmt = orderedByNumLevel.get(numId)?.get(String(ilvl));
    return fmt !== undefined && fmt !== 'bullet' && fmt !== 'none';
  };
}

function readRelationships(zip) {
  const rels = new Map();
  const name = 'word/_rels/document.xml.rels';
  if (!zip.has(name)) return rels;
  for (const rel of kids(parseXml(zip.get(name).toString('utf8')), 'Relationship')) {
    rels.set(rel.attrs.Id, rel.attrs.Target);
  }
  return rels;
}

// ============================================================
// Document
// ============================================================

const EMU_PER_PIXEL = 9525;
const TRANSPARENT_INLINE = new Set(['w:ins', 'w:moveTo', 'w:hyperlink', 'w:smartTag', 'w:fldSimple', 'w:customXml', 'w:sdt', 'w:sdtContent']);
const DROPPED_INLINE = new Set(['w:del', 'w:moveFrom']);

function mediaExtension(target) {
  const m = /\.([A-Za-z0-9]+)$/.exec(target);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Extracts `word/document.xml`. `imageSink(fileName, buffer)` (optional) persists image bytes and
 * returns the path to record; without it images are only listed.
 */
export function extractDocx(buffer, { imageSink } = {}) {
  const zip = readZip(buffer);
  if (!zip.has('word/document.xml')) throw new Error("docx: 'word/document.xml' fehlt.");
  const doc = parseXml(zip.get('word/document.xml').toString('utf8'));
  const rels = readRelationships(zip);
  const isOrdered = readNumbering(zip);

  const ctx = {
    counters: { p: 0, t: 0, i: 0 },
    images: [],
    stats: { paragraphs: 0, tables: 0, images: 0, insertions: 0, deletions: 0, comments: 0 },
    warnings: new Set(),
  };

  function parseImage(blip, extent) {
    const relId = blip.attrs['r:embed'] ?? blip.attrs['r:id'];
    const target = rels.get(relId);
    const id = `i${++ctx.counters.i}`;
    const image = { id, relId, target, ext: target ? mediaExtension(target) : '' };
    if (extent) {
      image.widthPx = Math.round(Number(extent.attrs.cx) / EMU_PER_PIXEL);
      image.heightPx = Math.round(Number(extent.attrs.cy) / EMU_PER_PIXEL);
    }
    const bytes = target && zip.get(`word/${target}`.replace(/\/\.\//g, '/'));
    if (!bytes) {
      ctx.warnings.add(`Bild ${id}: Datei zu Relationship '${relId}' nicht im Archiv gefunden.`);
    } else {
      image.bytes = bytes.length;
      if (imageSink) image.file = imageSink(`${id}.${image.ext || 'bin'}`, bytes);
      if (image.ext !== 'png') ctx.warnings.add(`Bild ${id} ist '${image.ext}', nicht PNG — vor dem Einfügen nach PNG konvertieren.`);
    }
    ctx.images.push(image);
    ctx.stats.images++;
    return id;
  }

  function parseRun(r, runs, imageIds) {
    const rPr = kid(r, 'w:rPr');
    const fmt = {
      b: isOn(kid(rPr, 'w:b')),
      i: isOn(kid(rPr, 'w:i')),
      u: isOn(kid(rPr, 'w:u')),
      strike: isOn(kid(rPr, 'w:strike')) || isOn(kid(rPr, 'w:dstrike')),
      hl: isOn(kid(rPr, 'w:highlight')),
      sup: val(kid(rPr, 'w:vertAlign')) === 'superscript',
      sub: val(kid(rPr, 'w:vertAlign')) === 'subscript',
    };
    const push = (text) => runs.push({ text, ...fmt });
    const visit = (node) => {
      for (const c of node.children) {
        if (!c.name) continue;
        if (c.name === 'w:t') push(textOf(c));
        else if (c.name === 'w:tab') push('\t');
        else if (c.name === 'w:br' || c.name === 'w:cr') { if (c.attrs['w:type'] !== 'page') push('\n'); }
        else if (c.name === 'w:noBreakHyphen') push('-');
        else if (c.name === 'w:commentReference') ctx.stats.comments++;
        else if (c.name === 'w:footnoteReference' || c.name === 'w:endnoteReference') {
          ctx.warnings.add('Fuß-/Endnoten vorhanden — ihr Text wird nicht extrahiert und muss manuell geprüft werden.');
        } else if (c.name === 'w:object') {
          ctx.warnings.add('Eingebettetes OLE-Objekt vorhanden — nicht migrierbar, manuell prüfen.');
        } else if (c.name === 'w:drawing') {
          const blips = [...descendants(c)].filter((d) => d.name === 'a:blip');
          const extent = [...descendants(c)].find((d) => d.name === 'wp:extent');
          for (const blip of blips) imageIds.push(parseImage(blip, extent));
          const box = [...descendants(c)].find((d) => d.name === 'w:txbxContent');
          if (box) {
            ctx.warnings.add('Textfeld vorhanden — sein Text wurde in den umgebenden Absatz übernommen.');
            push(textOf(box));
          }
        } else if (c.name === 'w:pict') {
          for (const d of descendants(c)) if (d.name === 'v:imagedata') imageIds.push(parseImage(d, undefined));
        } else if (c.name === 'mc:AlternateContent') {
          const choice = kid(c, 'mc:Choice') ?? kid(c, 'mc:Fallback');
          if (choice) visit(choice);
        }
      }
    };
    visit(r);
  }

  function walkInline(node, runs, imageIds) {
    for (const c of node.children) {
      if (!c.name) continue;
      if (c.name === 'w:r') parseRun(c, runs, imageIds);
      else if (DROPPED_INLINE.has(c.name)) ctx.stats.deletions++;
      else if (TRANSPARENT_INLINE.has(c.name)) {
        if (c.name === 'w:ins' || c.name === 'w:moveTo') ctx.stats.insertions++;
        walkInline(c, runs, imageIds);
      } else if (c.name === 'mc:AlternateContent') {
        const choice = kid(c, 'mc:Choice') ?? kid(c, 'mc:Fallback');
        if (choice) walkInline(choice, runs, imageIds);
      }
    }
  }

  function parseParagraph(p) {
    const id = `p${++ctx.counters.p}`;
    const pPr = kid(p, 'w:pPr');
    const numPr = kid(pPr, 'w:numPr');
    const numId = val(kid(numPr, 'w:numId'));
    const level = Number(val(kid(numPr, 'w:ilvl')) ?? 0);
    const runs = [];
    const imageIds = [];
    walkInline(p, runs, imageIds);
    const text = runs.map((r) => r.text).join('');
    if (text.trim() !== '') ctx.stats.paragraphs++;
    const block = { type: 'p', id, style: val(kid(pPr, 'w:pStyle')) ?? null, runs, text, images: imageIds };
    block.list = numId !== undefined && numId !== '0' ? { numId, level, ordered: isOrdered(numId, level) } : null;
    return block;
  }

  function parseTable(tbl) {
    const id = `t${++ctx.counters.t}`;
    ctx.stats.tables++;
    const rows = [];
    for (const tr of kids(tbl, 'w:tr')) {
      if (kid(kid(tr, 'w:trPr'), 'w:del')) { ctx.stats.deletions++; continue; }
      const cells = kids(tr, 'w:tc').map((tc) => {
        const tcPr = kid(tc, 'w:tcPr');
        const vMerge = kid(tcPr, 'w:vMerge');
        return {
          gridSpan: Number(val(kid(tcPr, 'w:gridSpan')) ?? 1),
          vMerge: vMerge ? (val(vMerge) === 'restart' ? 'restart' : 'continue') : null,
          blocks: parseBlocks(tc),
        };
      });
      rows.push({ cells });
    }
    return { type: 'table', id, rows };
  }

  function parseBlocks(container) {
    const blocks = [];
    for (const c of container.children) {
      if (!c.name) continue;
      if (c.name === 'w:p') blocks.push(parseParagraph(c));
      else if (c.name === 'w:tbl') blocks.push(parseTable(c));
      else if (c.name === 'w:sdt') blocks.push(...parseBlocks(kid(c, 'w:sdtContent') ?? { children: [] }));
      else if (c.name === 'w:ins' || c.name === 'w:moveTo') blocks.push(...parseBlocks(c));
      else if (DROPPED_INLINE.has(c.name)) ctx.stats.deletions++;
    }
    return blocks;
  }

  const blocks = parseBlocks(kid(doc, 'w:body'));
  const history = findHistory(blocks);
  return {
    blocks,
    images: ctx.images,
    history,
    stats: ctx.stats,
    warnings: [...ctx.warnings],
  };
}

// ============================================================
// Helpers on the extracted tree
// ============================================================

export function collectParagraphs(block, out = []) {
  if (block.type === 'p') out.push(block);
  else for (const row of block.rows) for (const cell of row.cells) for (const b of cell.blocks) collectParagraphs(b, out);
  return out;
}

export function allParagraphs(blocks) {
  return blocks.flatMap((b) => collectParagraphs(b));
}

function cellText(cell) {
  return allParagraphs(cell.blocks).map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
}

function findHistory(blocks) {
  for (const block of blocks) {
    if (block.type !== 'table' || block.rows.length === 0) continue;
    const header = block.rows[0].cells.map(cellText).join('|');
    if (!(/Aktivit/.test(header) && /Autor/.test(header) && /Datum/.test(header))) continue;
    const columnCount = block.rows[0].cells.length;
    const rows = block.rows.slice(1).map((row) => {
      const cells = row.cells.map(cellText);
      while (cells.length < columnCount) cells.push('');
      return cells;
    });
    const headerParagraphIds = block.rows[0].cells.flatMap((c) => allParagraphs(c.blocks)).map((p) => p.id);
    return { tableId: block.id, columnCount, rows, headerParagraphIds, paragraphIds: collectParagraphs(block).map((p) => p.id) };
  }
  return null;
}

/** Human/LLM-readable rendering of the block tree; ids are what a migration plan references. */
export function renderOutline(blocks, indent = '') {
  const lines = [];
  for (const b of blocks) {
    if (b.type === 'p') {
      const flags = [b.style ?? '-'];
      if (b.list) flags.push(`${b.list.ordered ? 'nr' : 'bullet'}${b.list.level}`);
      const images = b.images.length ? ` {Bild ${b.images.join(',')}}` : '';
      lines.push(`${indent}${b.id} [${flags.join(' ')}] ${b.text.replace(/\n/g, ' ⏎ ')}${images}`);
    } else {
      lines.push(`${indent}${b.id} TABLE (${b.rows.length} Zeilen)`);
      b.rows.forEach((row, r) => {
        lines.push(`${indent}  Zeile ${r + 1}`);
        row.cells.forEach((cell, c) => {
          const span = cell.gridSpan > 1 ? ` span=${cell.gridSpan}` : '';
          const merge = cell.vMerge ? ` vMerge=${cell.vMerge}` : '';
          lines.push(`${indent}    Zelle ${c + 1}${span}${merge}`);
          lines.push(...renderOutline(cell.blocks, `${indent}      `));
        });
      });
    }
  }
  return lines;
}
