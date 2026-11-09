import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';
import { findStep, listTailAreas, resolveTailContainer } from '../scripts/lib/nsd-paths.mjs';

function minimalDiagram(mainSequenceBody, specmanVersion = '1.3.0') {
  return (
    '// {"specmanVersion":"' + specmanVersion + '","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'mainSequence {\n' + mainSequenceBody + '}\n'
  );
}

test('listTailAreas reports an empty tail as an empty list', () => {
  const ast = parseDiagram(minimalDiagram('    simple(1, 5582897d, `head`, plain=`head`);\n'));
  const found = findStep(ast, { stepId: '5582897d' });
  assert.deepEqual(listTailAreas(found.step), []);
});

test('listTailAreas describes a text, a list, a table, and an image area with stable keys', () => {
  const ast = parseDiagram(minimalDiagram(
    '    simple(1, 97ba3cc4, `head`, plain=`head`) {\n' +
    '        text(`trailing`, plain=`trailing`)\n' +
    '        list(ordered=true) {\n' +
    '            item(`i1`, plain=`i1`)\n' +
    '            item(`i2`, plain=`i2`)\n' +
    '        }\n' +
    '        table(width=100%, cols=[50%, 50%]) {\n' +
    '            row { cell(`a`, plain=`a`) | cell(`b`, plain=`b`) }\n' +
    '            row { cell(`c`, plain=`c`) | cell(`d`, plain=`d`) }\n' +
    '        }\n' +
    '        image(scale=100%, type=png) {\n' +
    '            [base64:YWJj]\n' +
    '        }\n' +
    '        image(scale=100%, type=plantuml) {\n' +
    '            `@startuml\nA -> B\n@enduml`\n' +
    '        }\n' +
    '    }\n',
    '1.4.0',
  ));
  const found = findStep(ast, { stepId: '97ba3cc4' });
  const areas = listTailAreas(found.step);
  assert.deepEqual(areas, [
    { key: 'tail[0]', kind: 'text' },
    { key: 'tail[1]', kind: 'list', ordered: true, itemCount: 2 },
    { key: 'tail[2]', kind: 'table', rowCount: 2, colCount: 2 },
    { key: 'tail[3]', kind: 'image', imageType: 'png' },
    { key: 'tail[4]', kind: 'image', imageType: 'plantuml' },
  ]);
});

test('resolveTailContainer resolves a top-level tail area by index', () => {
  const ast = parseDiagram(minimalDiagram(
    '    simple(1, 97ba3cc4, `head`, plain=`head`) {\n' +
    '        text(`trailing`, plain=`trailing`)\n' +
    '    }\n',
  ));
  const found = findStep(ast, { stepId: '97ba3cc4' });
  const resolved = resolveTailContainer(found.step, 'tail[0]');
  assert.equal(resolved.area.kind, 'text');
  assert.equal(resolved.index, 0);
});

test('resolveTailContainer resolves a table row by index', () => {
  const ast = parseDiagram(minimalDiagram(
    '    simple(1, 97ba3cc4, `head`, plain=`head`) {\n' +
    '        table(width=100%) {\n' +
    '            row { cell(`a`, plain=`a`) }\n' +
    '            row { cell(`b`, plain=`b`) }\n' +
    '        }\n' +
    '    }\n',
  ));
  const found = findStep(ast, { stepId: '97ba3cc4' });
  const resolved = resolveTailContainer(found.step, 'tail[0].rows[1]');
  assert.equal(resolved.row.cells[0].content.head.plain, 'b');
  assert.equal(resolved.index, 1);
});

test('resolveTailContainer resolves a list item by index', () => {
  const ast = parseDiagram(minimalDiagram(
    '    simple(1, 97ba3cc4, `head`, plain=`head`) {\n' +
    '        list(ordered=false) {\n' +
    '            item(`i1`, plain=`i1`)\n' +
    '            item(`i2`, plain=`i2`)\n' +
    '        }\n' +
    '    }\n',
  ));
  const found = findStep(ast, { stepId: '97ba3cc4' });
  const resolved = resolveTailContainer(found.step, 'tail[0].items[1]');
  assert.equal(resolved.item.content.head.plain, 'i2');
  assert.equal(resolved.index, 1);
});

test('resolveTailContainer throws a clear error for an out-of-range index', () => {
  const ast = parseDiagram(minimalDiagram('    simple(1, 97ba3cc4, `head`, plain=`head`);\n'));
  const found = findStep(ast, { stepId: '97ba3cc4' });
  assert.throws(() => resolveTailContainer(found.step, 'tail[0]'), /no tail area|tail\[0\]/);
});

test('resolveTailContainer throws a clear error for a kind mismatch (row key on a list area)', () => {
  const ast = parseDiagram(minimalDiagram(
    '    simple(1, 97ba3cc4, `head`, plain=`head`) {\n' +
    '        list(ordered=false) {\n' +
    '            item(`i1`, plain=`i1`)\n' +
    '        }\n' +
    '    }\n',
  ));
  const found = findStep(ast, { stepId: '97ba3cc4' });
  assert.throws(() => resolveTailContainer(found.step, 'tail[0].rows[0]'), /not a table/);
});
