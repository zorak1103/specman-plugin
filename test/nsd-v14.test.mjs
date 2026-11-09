// Specman 1.4 model additions (grammar diff 1.3 -> 1.4): metaTags configuration in settings, the
// tags=[...] step parameter, plantuml/svg image blocks (+ backup=), and change= on table cells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tokenize } from '../scripts/lib/nsd-lexer.mjs';
import { parseDiagram, serializeDiagram } from '../scripts/lib/nsd-ast.mjs';
import { resolveJarPath } from '../scripts/resolve-jar.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ref14Path = path.join(__dirname, '..', 'reference', 'specman-reference-v1.4-model-v2.nsd');

const ENVELOPE = '// {"specmanVersion":"1.4.0","modelType":"specman.model.v002.DiagramModel_V002"}\n';

function diagram({ settings = '', body = '', intro = '' } = {}) {
  return (
    ENVELOPE +
    `settings {\n    width=700\n${settings}}\n\n` +
    (intro ? `intro(\`i\`, plain=\`i\`) {\n${intro}}\n\n` : '') +
    `mainSequence {\n${body}}\n`
  );
}

function roundTrips(src) {
  const ast1 = parseDiagram(src);
  const ast2 = parseDiagram(serializeDiagram(ast1));
  assert.deepEqual(ast2, ast1);
  return ast1;
}

// ---------------------------------------------------------------- the real upstream 1.4 reference

test('the vendored upstream 1.4 reference file parses and round-trips parse -> serialize -> parse', () => {
  const ast = roundTrips(readFileSync(ref14Path, 'utf8'));
  assert.equal(ast.envelope.specmanVersion, '1.4.0');
});

// ---------------------------------------------------------------- lexer

test('lexer: 1.4 words are keywords', () => {
  const kinds = tokenize('metaTags tag tags label background border icon freetext plantuml svg backup')
    .filter((t) => t.type !== 'EOF')
    .map((t) => t.type);
  assert.deepEqual(kinds, Array(11).fill('KEYWORD'));
});

// ---------------------------------------------------------------- settings: metaTags

test('settings.metaTags: parses a full tag configuration, a label-only and an icon-only tag', () => {
  const src = diagram({
    settings:
      '    metaTags {\n' +
      '        tag(`user`, background=#ffcccc, border=#ff0033, label=`User`, icon=`<svg a="1">\n</svg>`, freetext=false)\n' +
      '        tag(`label_only`, background=#ccccff, label=`Label only`)\n' +
      '        tag(`icon_only`, background=#e0e0e000, icon=`<svg/>`)\n' +
      '    }\n',
    body: '    simple(1, 5582897d, `hi`, plain=`hi`);\n',
  });
  const { settings } = roundTrips(src);
  assert.equal(settings.width, 700);
  assert.deepEqual(settings.metaTags, [
    { tagId: 'user', background: '#ffcccc', border: '#ff0033', label: 'User', icon: '<svg a="1">\n</svg>', freetext: false },
    { tagId: 'label_only', background: '#ccccff', border: undefined, label: 'Label only', icon: undefined, freetext: undefined },
    { tagId: 'icon_only', background: '#e0e0e000', border: undefined, label: undefined, icon: '<svg/>', freetext: undefined },
  ]);
});

test('settings: a file without metaTags has settings.metaTags undefined and serializes without the block', () => {
  const src = diagram({ body: '    simple(1, 5582897d, `hi`, plain=`hi`);\n' });
  const ast = parseDiagram(src);
  assert.equal(ast.settings.metaTags, undefined);
  assert.doesNotMatch(serializeDiagram(ast), /metaTags/);
});

// ---------------------------------------------------------------- steps: tags=[...]

test('steps: tags= parses on simple, break, source and every structured step kind, after shade', () => {
  const body =
    '    simple(1, 11111111, `a`, plain=`a`, deco=Full, shade=#dcdcdc, tags=[(`user`)]);\n' +
    '    break(2, 22222222, `b`, plain=`b`, change=(added, yellow), tags=[(`user`, `free text`), (`label_only`)]);\n' +
    '    source(3, 33333333, `c`, plain=`c`, yellow, sourceStep=11111111, tags=[(`user`)]);\n' +
    '    while(4, 44444444, `w`, plain=`w`, barWidth=20, collapsed=true, tags=[(`user`)]) {\n' +
    '        simple(4.1, 55555555, `x`, plain=`x`);\n    }\n' +
    '    doWhile(5, 66666666, `dw`, plain=`dw`, tags=[(`user`)]) {\n' +
    '        simple(5.1, 77777777, `x`, plain=`x`);\n    }\n' +
    '    if(6, 88888888, `i`, plain=`i`, tags=[(`user`)]) {\n' +
    '        if_branch(`yes`, plain=`yes`) {\n            simple(6.1, 99999999, `x`, plain=`x`);\n        }\n    }\n' +
    '    ifElse(7, aaaaaaaa, `ie`, plain=`ie`, tags=[(`user`)]) {\n' +
    '        if_branch(`yes`, plain=`yes`) {\n            simple(7.1, bbbbbbbb, `x`, plain=`x`);\n        }\n' +
    '        else_branch(`no`, plain=`no`) {\n            simple(7.2, cccccccc, `x`, plain=`x`);\n        }\n    }\n' +
    '    case(8, dddddddd, `c`, plain=`c`, tags=[(`user`)]) {\n' +
    '        default_branch(`d`, plain=`d`) {\n            simple(8.1, eeeeeeee, `x`, plain=`x`);\n        }\n    }\n' +
    '    subsequence(9, ffffffff, `s`, plain=`s`, flat=true, tags=[(`user`)]) {\n' +
    '        simple(9.1, 12345678, `x`, plain=`x`);\n    }\n';
  const { mainSequence } = roundTrips(diagram({ body }));
  const [simple, brk, src, ...rest] = mainSequence.steps;
  assert.deepEqual(simple.tags, [{ tagId: 'user', freetext: undefined }]);
  assert.equal(simple.shade, '#dcdcdc');
  assert.deepEqual(brk.tags, [
    { tagId: 'user', freetext: 'free text' },
    { tagId: 'label_only', freetext: undefined },
  ]);
  assert.deepEqual(src.tags, [{ tagId: 'user', freetext: undefined }]);
  for (const step of rest) assert.deepEqual(step.tags, [{ tagId: 'user', freetext: undefined }], step.kind);
});

test('steps: a step without tags has tags undefined and serializes without tags=', () => {
  const ast = parseDiagram(diagram({ body: '    simple(1, 5582897d, `hi`, plain=`hi`);\n' }));
  assert.equal(ast.mainSequence.steps[0].tags, undefined);
  assert.doesNotMatch(serializeDiagram(ast), /tags=/);
});

test('steps: tags= is written last, after change/deco/shade', () => {
  const src = diagram({
    body: '    simple(1, 5582897d, `hi`, plain=`hi`, change=(added, yellow), deco=Full, shade=#dcdcdc, tags=[(`user`)]);\n',
  });
  assert.match(serializeDiagram(parseDiagram(src)), /change=\(added, yellow\), deco=Full, shade=#dcdcdc, tags=\[\(`user`\)\]\)/);
});

test('steps: a backtick in a tag freetext is written as an apostrophe (it would end the string token)', () => {
  const ast = parseDiagram(diagram({ body: '    simple(1, 5582897d, `hi`, plain=`hi`, tags=[(`user`, `ok`)]);\n' }));
  ast.mainSequence.steps[0].tags[0].freetext = 'use `x` here';
  const out = serializeDiagram(ast);
  assert.match(out, /tags=\[\(`user`, `use 'x' here`\)\]/);
  assert.doesNotThrow(() => parseDiagram(out));
});

// ---------------------------------------------------------------- table cell change=

test('table cells: change= parses on a cell with and without a tail, and round-trips', () => {
  const body =
    '    simple(1, 5582897d, `t`, plain=`t`) {\n' +
    '        table(width=100%) {\n' +
    '            row { cell(`a`, plain=`a`, change=(added, yellow)) | cell(`b`, plain=`b`, change=(added, yellow)) {\n' +
    '                text(`inner`, plain=`inner`)\n            } | cell(`c`, plain=`c`) }\n' +
    '        }\n    }\n';
  const ast = roundTrips(diagram({ body }));
  const cells = ast.mainSequence.steps[0].content.tail[0].rows[0].cells;
  assert.deepEqual(cells[0].change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
  assert.deepEqual(cells[1].change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
  assert.equal(cells[1].content.tail.length, 1);
  assert.equal(cells[2].change, undefined);
});

// ---------------------------------------------------------------- image blocks: plantuml / svg

test('images: plantuml blocks (with and without backup=) and svg blocks round-trip verbatim', () => {
  const body =
    '    simple(1, 5582897d, `img`, plain=`img`) {\n' +
    '        image(scale=100%, type=plantuml) { `@startuml\nA -> B\n@enduml` }\n' +
    '        image(scale=50%, type=plantuml, change=(added, yellow)) { `@startuml\nA -> C\n@enduml`, backup=(yellow, `@startuml\nA -> B\n@enduml`) }\n' +
    '        image(scale=275%, type=svg) { `<svg xmlns="http://www.w3.org/2000/svg"></svg>` }\n' +
    '    }\n';
  const ast = roundTrips(diagram({ body }));
  const [plain, withBackup, svg] = ast.mainSequence.steps[0].content.tail;
  assert.equal(plain.kind, 'image');
  assert.equal(plain.imageType, 'plantuml');
  assert.equal(plain.scalePercent, '100%');
  assert.equal(plain.raw, '`@startuml\nA -> B\n@enduml`');
  assert.equal(plain.backup, undefined);
  assert.deepEqual(withBackup.change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
  assert.deepEqual(withBackup.backup, { changeset: 'yellow', raw: '`@startuml\nA -> B\n@enduml`' });
  assert.equal(svg.imageType, 'svg');
  assert.equal(svg.raw, '`<svg xmlns="http://www.w3.org/2000/svg"></svg>`');
});

test('images: a base64 png block still parses as before', () => {
  const body = '    simple(1, 5582897d, `img`, plain=`img`) {\n        image(scale=100%, type=png) { [base64:QUJD] }\n    }\n';
  const ast = roundTrips(diagram({ body }));
  const img = ast.mainSequence.steps[0].content.tail[0];
  assert.equal(img.imageType, 'png');
  assert.equal(img.raw, '[base64:QUJD]');
});

// ---------------------------------------------------------------- newer-than-supported hint

test('a parse failure in a file from a newer Specman than the plugin knows points at the plugin version', () => {
  const src = diagram({ body: '    simple(1, 5582897d, `hi`, plain=`hi`, brandNewParam=1);\n' })
    .replace('"1.4.0"', '"9.9.0"');
  assert.throws(() => parseDiagram(src), /Specman 9\.9\.0.*plugin only knows.*up to Specman 1\.4\.0.*update the plugin/s);
});

test('a parse failure in a file from a supported Specman version does not blame the plugin version', () => {
  const src = diagram({ body: '    simple(1, 5582897d, `hi`, plain=`hi`, brandNewParam=1);\n' });
  assert.throws(() => parseDiagram(src), (err) => !/plugin/i.test(err.message));
});

// The real jar is the oracle for "grammar-valid": whatever this serializer writes for the full 1.4
// feature set (metaTags, tags=, plantuml + backup, svg, cell change) must be accepted by Specman.
const jar = resolveJarPath(process.env);
test(
  'the real sanitizer accepts the re-serialized 1.4 reference and leaves it stable',
  { skip: !jar.ok && 'SPECMAN_JAR not set to a usable jar' },
  async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { runSanitize, sanitizeUntilStable } = await import('../scripts/sanitize.mjs');
    const dir = mkdtempSync(path.join(tmpdir(), 'specman-v14-'));
    const file = path.join(dir, 'roundtrip.nsd');
    try {
      writeFileSync(file, serializeDiagram(parseDiagram(readFileSync(ref14Path, 'utf8'))));
      const result = sanitizeUntilStable(
        () => runSanitize(jar.path, file),
        () => readFileSync(file, 'utf8'),
      );
      assert.equal(result.ok, true, result.message ?? result.error);
      assert.equal(result.stable, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
