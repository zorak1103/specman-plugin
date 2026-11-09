import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseDiagram, serializeDiagram, assertValidHtml } from '../scripts/lib/nsd-ast.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const referencePath = path.join(__dirname, '..', 'reference', 'specman-reference-v1.3-model-v2.nsd');
const sucTemplatePath = path.join(__dirname, '..', 'reference', 'suc-template.nsd');

function minimalDiagram(mainSequenceBody) {
  return (
    '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'settings {\n    width=700\n    zoom=100\n    changeModeEnabled=true\n    changeSetName=yellow\n}\n\n' +
    'intro(`intro text`, plain=`intro text`) {\n}\n\n' +
    'mainSequence {\n' + mainSequenceBody + '}\n\n' +
    'outro(`outro text`, plain=`outro text`) {\n}\n'
  );
}

test('parses the envelope and top-level settings', () => {
  const ast = parseDiagram(minimalDiagram('    simple(1, 5582897d, `hi`, plain=`hi`);\n'));
  assert.equal(ast.envelope.specmanVersion, '1.3.0');
  assert.equal(ast.envelope.modelType, 'specman.model.v002.DiagramModel_V002');
  assert.equal(ast.settings.width, 700);
  assert.equal(ast.settings.zoom, 100);
  assert.equal(ast.settings.changeModeEnabled, true);
  assert.equal(ast.settings.changeSetName, 'yellow');
});

test('parses intro/outro as editor content', () => {
  const ast = parseDiagram(minimalDiagram('    simple(1, 5582897d, `hi`, plain=`hi`);\n'));
  assert.equal(ast.intro.head.html, 'intro text');
  assert.equal(ast.intro.head.plain, 'intro text');
  assert.equal(ast.outro.head.plain, 'outro text');
});

test('parses a simple step with markups and change', () => {
  const src = minimalDiagram(
    '    simple(6, e0dc4407, `added text`, plain=`added text`, ' +
    'markups=[(0,4,Changed,yellow)], change=(added, yellow));\n',
  );
  const ast = parseDiagram(src);
  const step = ast.mainSequence.steps[0];
  assert.equal(step.kind, 'simple');
  assert.equal(step.stepNum, '6');
  assert.equal(step.stepId, 'e0dc4407');
  assert.equal(step.content.head.plain, 'added text');
  assert.deepEqual(step.content.head.markups, [{ from: 0, to: 4, type: 'Changed', changeset: 'yellow' }]);
  assert.deepEqual(step.change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
});

test('parses a break step with no change param', () => {
  const src = minimalDiagram('    break(2, 6131450e, `Exception`, plain=`Exception`);\n');
  const ast = parseDiagram(src);
  assert.equal(ast.mainSequence.steps[0].kind, 'break');
  assert.equal(ast.mainSequence.steps[0].change, undefined);
});

test('parses a while step with a body and barWidth', () => {
  const src = minimalDiagram(
    '    while(2, e81623e9, `While loop`, plain=`While loop`, barWidth=18) {\n' +
    '        simple(2.1, a6c0af76, `inner`, plain=`inner`);\n' +
    '    }\n',
  );
  const ast = parseDiagram(src);
  const w = ast.mainSequence.steps[0];
  assert.equal(w.kind, 'while');
  assert.equal(w.barWidth, 18);
  assert.equal(w.body.length, 1);
  assert.equal(w.body[0].stepNum, '2.1');
});

test('parses change= now allowed on a structured step (grammar update)', () => {
  const src = minimalDiagram(
    '    ifElse(1, 717e5669, `cond`, plain=`cond`, ifRatio=50.00%, change=(added, yellow), shade=#dcdcdc) {\n' +
    '        if_branch(`yes`, plain=`yes`) {\n            simple(1.1, afbac578, `y`, plain=`y`);\n        }\n' +
    '        else_branch(`no`, plain=`no`) {\n            simple(2.1, 27ce0689, `n`, plain=`n`);\n        }\n' +
    '    }\n',
  );
  const ast = parseDiagram(src);
  const ie = ast.mainSequence.steps[0];
  assert.equal(ie.kind, 'ifElse');
  assert.deepEqual(ie.change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
  assert.equal(ie.shade, '#dcdcdc');
  assert.equal(ie.ifBranch.body[0].stepNum, '1.1');
  assert.equal(ie.elseBranch.body[0].stepNum, '2.1');
});

test('parses an if step with a single branch', () => {
  const src = minimalDiagram(
    '    if(1, ff611d0d, `cond`, plain=`cond`, emptyWidth=20) {\n' +
    '        if_branch(`yes`, plain=`yes`) {\n            simple(1.1, fbeccd87, `y`, plain=`y`);\n        }\n' +
    '    }\n',
  );
  const ast = parseDiagram(src);
  assert.equal(ast.mainSequence.steps[0].kind, 'if');
  assert.equal(ast.mainSequence.steps[0].emptyWidth, 20);
});

test('parses a case step with default and case branches, and cols', () => {
  const src = minimalDiagram(
    '    case(1, b3fea8cf, `switch`, plain=`switch`, cols=[33.09%, 33.24%, 33.09%]) {\n' +
    '        default_branch(`else`, plain=`else`) {\n            simple(1.1, 2feefd1f, `e`, plain=`e`);\n        }\n' +
    '        case_branch(`c1`, plain=`c1`) {\n            simple(2.1, 4b4d5748, `a`, plain=`a`);\n        }\n' +
    '        case_branch(`c2`, plain=`c2`) {\n            simple(3.1, 46e11496, `b`, plain=`b`);\n        }\n' +
    '    }\n',
  );
  const ast = parseDiagram(src);
  const c = ast.mainSequence.steps[0];
  assert.equal(c.kind, 'case');
  assert.deepEqual(c.cols, ['33.09%', '33.24%', '33.09%']);
  assert.equal(c.defaultBranch.body[0].stepNum, '1.1');
  assert.equal(c.caseBranches.length, 2);
});

test('parses a subsequence step with flat and collapsed flags', () => {
  const src = minimalDiagram(
    '    subsequence(1, f346092d, `sub`, plain=`sub`, flat=true, collapsed=true) {\n' +
    '        simple(1.1, 937834b6, `s`, plain=`s`);\n' +
    '    }\n',
  );
  const ast = parseDiagram(src);
  const s = ast.mainSequence.steps[0];
  assert.equal(s.kind, 'subsequence');
  assert.equal(s.flat, true);
  assert.equal(s.collapsed, true);
});

test('parses a source step with mandatory changeset and sourceStep link', () => {
  const src = minimalDiagram(
    '    source(1, 29735b11, `<strike>.</strike>`, plain=`.`, markups=[(0,0,Changed,orange)], orange, sourceStep=7505df4a);\n',
  );
  const ast = parseDiagram(src);
  const s = ast.mainSequence.steps[0];
  assert.equal(s.kind, 'source');
  assert.equal(s.changeset, 'orange');
  assert.equal(s.sourceStep, '7505df4a');
});

test('parses change=(target, changeset, sourceStep=id) on a simple step', () => {
  const src = minimalDiagram(
    '    simple(1, 7505df4a, `moved`, plain=`moved`, change=(target, orange, sourceStep=29735b11));\n',
  );
  const ast = parseDiagram(src);
  assert.deepEqual(ast.mainSequence.steps[0].change, {
    kind: 'target', changeset: 'orange', sourceStep: '29735b11',
  });
});

test('parses a wrapped catchArea with collapsed/cols, coCatch, and headingWidth', () => {
  const src = minimalDiagram(
    '    break(1, 074ad64c, `X1`, plain=`X1`);\n' +
    '    break(2, 77f1ab52, `X2`, plain=`X2`);\n' +
    '    catchArea(collapsed=true, cols=[20%, 79%]) {\n' +
    '        catch(1, `X1`, plain=`X1`) {\n            simple(1.1, fe4d5e16, `a`, plain=`a`);\n        }\n' +
    '        catch(2, `X2`, plain=`X2`, headingWidth=65) {\n' +
    '            coCatch(3, `X3`, plain=`X3`);\n' +
    '            simple(2.1, 142ae6b6, `b`, plain=`b`);\n' +
    '        }\n' +
    '    }\n',
  );
  const ast = parseDiagram(src);
  const ca = ast.mainSequence.catchArea;
  assert.equal(ca.collapsed, true);
  assert.deepEqual(ca.cols, ['20%', '79%']);
  assert.equal(ca.catches.length, 2);
  assert.equal(ca.catches[1].headingWidth, 65);
  assert.equal(ca.catches[1].coCatches[0].breakStepNum, '3');
});

test('parses a bare (unwrapped) catchArea for backward compatibility', () => {
  const src = minimalDiagram(
    '    break(1, 6131450e, `X`, plain=`X`);\n' +
    '    catch(1, `X`, plain=`X`) {\n        simple(1.1, 92dc561b, `h`, plain=`h`);\n    }\n',
  );
  const ast = parseDiagram(src);
  assert.equal(ast.mainSequence.catchArea.catches.length, 1);
  assert.equal(ast.mainSequence.catchArea.collapsed, undefined);
});

test('parses tail areas: list, text, table', () => {
  const src = minimalDiagram(
    '    simple(1, 97ba3cc4, `head`, plain=`head`) {\n' +
    '        list(ordered=false) {\n' +
    '            item(`yellow`, plain=`yellow`, markups=[(0,5,Changed,yellow)], change=(added, yellow))\n' +
    '            item(`blue`, plain=`blue`)\n' +
    '        }\n' +
    '        text(`trailing`, plain=`trailing`, markups=[(0,7,Changed,yellow)])\n' +
    '        table(width=100%) {\n' +
    '            row { cell(`a`, plain=`a`) | cell(`b`, plain=`b`) }\n' +
    '        }\n' +
    '    }\n',
  );
  const ast = parseDiagram(src);
  const tail = ast.mainSequence.steps[0].content.tail;
  assert.equal(tail[0].kind, 'list');
  assert.equal(tail[0].items.length, 2);
  assert.equal(tail[0].items[0].content.head.plain, 'yellow');
  assert.deepEqual(tail[0].items[0].change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
  assert.equal(tail[1].kind, 'text');
  assert.equal(tail[1].content.plain, 'trailing');
  assert.equal(tail[2].kind, 'table');
  assert.equal(tail[2].widthPercent, '100%');
  assert.equal(tail[2].rows[0].cells[0].content.head.plain, 'a');
});

test('passes an image block through as an opaque, unparsed node', () => {
  const src = minimalDiagram(
    '    simple(1, aaaa1234, `head`, plain=`head`) {\n' +
    '        image(scale=100%, type=png) { [base64:aGVsbG8=] }\n' +
    '    }\n',
  );
  const ast = parseDiagram(src);
  const img = ast.mainSequence.steps[0].content.tail[0];
  assert.equal(img.kind, 'image');
  assert.equal(img.scalePercent, '100%');
  assert.equal(img.imageType, 'png');
  assert.equal(img.raw, '[base64:aGVsbG8=]');
});

test('round-trips a minimal diagram through parse -> serialize -> parse to an equivalent AST', () => {
  const src = minimalDiagram('    simple(1, 5582897d, `hi`, plain=`hi`);\n');
  const ast1 = parseDiagram(src);
  const serialized = serializeDiagram(ast1);
  const ast2 = parseDiagram(serialized);
  assert.deepEqual(ast2, ast1);
});

test('round-trips the full vendored reference file through parse -> serialize -> parse', () => {
  const src = readFileSync(referencePath, 'utf8');
  const ast1 = parseDiagram(src);
  const serialized = serializeDiagram(ast1);
  const ast2 = parseDiagram(serialized);
  assert.deepEqual(ast2, ast1);
});

test('round-trips the vendored SUC template (braces-in-backtick case) through parse -> serialize -> parse', () => {
  const src = readFileSync(sucTemplatePath, 'utf8');
  const ast1 = parseDiagram(src);
  const serialized = serializeDiagram(ast1);
  const ast2 = parseDiagram(serialized);
  assert.deepEqual(ast2, ast1);
});

test('assertValidHtml accepts ordinary HTML without backticks', () => {
  assert.doesNotThrow(() => assertValidHtml('<b>hello</b>'));
});

test('assertValidHtml rejects a backtick, which would prematurely end the BACKTICK_STRING token', () => {
  assert.throws(() => assertValidHtml('a `quote` inside'), /backtick/);
});
