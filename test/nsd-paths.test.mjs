import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';
import { findStep, addressableAreas, resolveArea, listSequences } from '../scripts/lib/nsd-paths.mjs';

function minimalDiagram(mainSequenceBody) {
  return (
    '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'mainSequence {\n' + mainSequenceBody + '}\n'
  );
}

test('findStep locates a top-level step by number', () => {
  const ast = parseDiagram(minimalDiagram(
    '    simple(1, 5582897d, `a`, plain=`a`);\n' +
    '    simple(2, e0dc4407, `b`, plain=`b`);\n',
  ));
  const found = findStep(ast, { stepNum: '2' });
  assert.equal(found.step.stepId, 'e0dc4407');
});

test('findStep locates a nested step by id, inside a while body', () => {
  const ast = parseDiagram(minimalDiagram(
    '    while(1, e81623e9, `loop`, plain=`loop`) {\n' +
    '        simple(1.1, a6c0af76, `inner`, plain=`inner`);\n' +
    '    }\n',
  ));
  const found = findStep(ast, { stepId: 'a6c0af76' });
  assert.equal(found.step.stepNum, '1.1');
});

test('findStep locates a step inside an ifElse branch', () => {
  const ast = parseDiagram(minimalDiagram(
    '    ifElse(1, 1297a277, `cond`, plain=`cond`) {\n' +
    '        if_branch(`yes`, plain=`yes`) {\n            simple(1.1, aaaaaaaa, `y`, plain=`y`);\n        }\n' +
    '        else_branch(`no`, plain=`no`) {\n            simple(2.1, bbbbbbbb, `n`, plain=`n`);\n        }\n' +
    '    }\n',
  ));
  const found = findStep(ast, { stepId: 'bbbbbbbb' });
  assert.equal(found.step.stepNum, '2.1');
  assert.equal(found.parentKey, 'step:1297a277.else_branch');
});

test('findStep returns null when nothing matches', () => {
  const ast = parseDiagram(minimalDiagram('    simple(1, 5582897d, `a`, plain=`a`);\n'));
  assert.equal(findStep(ast, { stepId: 'ffffffff' }), null);
});

test('findStep rejects ambiguous or missing selectors', () => {
  const ast = parseDiagram(minimalDiagram('    simple(1, 5582897d, `a`, plain=`a`);\n'));
  assert.throws(() => findStep(ast, {}), /selector/i);
});

test('addressableAreas reports head, tail text, list items, and table cells with stable keys', () => {
  const ast = parseDiagram(minimalDiagram(
    '    simple(1, 97ba3cc4, `head`, plain=`head`) {\n' +
    '        list(ordered=false) {\n' +
    '            item(`i1`, plain=`i1`)\n' +
    '            item(`i2`, plain=`i2`)\n' +
    '        }\n' +
    '        text(`trailing`, plain=`trailing`)\n' +
    '        table(width=100%) {\n' +
    '            row { cell(`a`, plain=`a`) | cell(`b`, plain=`b`) }\n' +
    '        }\n' +
    '    }\n',
  ));
  const found = findStep(ast, { stepId: '97ba3cc4' });
  const areas = addressableAreas(found.step);
  assert.deepEqual(areas.map((a) => a.key), [
    'head',
    'tail[0].items[0]',
    'tail[0].items[1]',
    'tail[1]',
    'tail[2].rows[0].cells[0]',
    'tail[2].rows[0].cells[1]',
  ]);
  assert.equal(areas.find((a) => a.key === 'head').plain, 'head');
  assert.equal(areas.find((a) => a.key === 'tail[0].items[1]').plain, 'i2');
});

test('listSequences enumerates main sequence and nested bodies/branches with stable keys', () => {
  const ast = parseDiagram(minimalDiagram(
    '    while(1, e81623e9, `loop`, plain=`loop`) {\n' +
    '        simple(1.1, a6c0af76, `inner`, plain=`inner`);\n' +
    '    }\n' +
    '    ifElse(2, 1297a277, `cond`, plain=`cond`) {\n' +
    '        if_branch(`yes`, plain=`yes`) {\n            simple(2.1, aaaaaaaa, `y`, plain=`y`);\n        }\n' +
    '        else_branch(`no`, plain=`no`) {\n            simple(3.1, bbbbbbbb, `n`, plain=`n`);\n        }\n' +
    '    }\n',
  ));
  const seqs = listSequences(ast);
  const keys = seqs.map((s) => s.key);
  assert.ok(keys.includes('main'));
  assert.ok(keys.includes('step:e81623e9.body'));
  assert.ok(keys.includes('step:1297a277.if_branch'));
  assert.ok(keys.includes('step:1297a277.else_branch'));
  const main = seqs.find((s) => s.key === 'main');
  assert.equal(main.steps.length, 2);
});

test('addressableAreas exposes if/else branch headings for an ifElse step', () => {
  const ast = parseDiagram(minimalDiagram(
    '    ifElse(1, 1297a277, `cond`, plain=`cond`) {\n' +
    '        if_branch(`yes`, plain=`yes`) {\n            simple(1.1, aaaaaaaa, `y`, plain=`y`);\n        }\n' +
    '        else_branch(`no`, plain=`no`) {\n            simple(2.1, bbbbbbbb, `n`, plain=`n`);\n        }\n' +
    '    }\n',
  ));
  const found = findStep(ast, { stepId: '1297a277' });
  const areas = addressableAreas(found.step);
  assert.deepEqual(areas.map((a) => a.key), ['head', 'ifBranch.head', 'elseBranch.head']);
  assert.equal(resolveArea(found.step, 'ifBranch.head').plain, 'yes');
  assert.equal(resolveArea(found.step, 'elseBranch.head').plain, 'no');
});

test('addressableAreas exposes default/case branch headings for a case step', () => {
  const ast = parseDiagram(minimalDiagram(
    '    case(1, cafecafe, `switch`, plain=`switch`) {\n' +
    '        default_branch(`default`, plain=`default`) {\n            simple(1.1, aaaaaaaa, `d`, plain=`d`);\n        }\n' +
    '        case_branch(`a`, plain=`a`) {\n            simple(1.2, bbbbbbbb, `a1`, plain=`a1`);\n        }\n' +
    '        case_branch(`b`, plain=`b`) {\n            simple(1.3, cccccccc, `b1`, plain=`b1`);\n        }\n' +
    '    }\n',
  ));
  const found = findStep(ast, { stepId: 'cafecafe' });
  const areas = addressableAreas(found.step);
  assert.deepEqual(areas.map((a) => a.key), ['head', 'defaultBranch.head', 'caseBranch[0].head', 'caseBranch[1].head']);
  assert.equal(resolveArea(found.step, 'caseBranch[1].head').plain, 'b');
});

test('resolveArea throws a clear error for a branch key the step does not have', () => {
  const ast = parseDiagram(minimalDiagram('    simple(1, 5582897d, `a`, plain=`a`);\n'));
  const found = findStep(ast, { stepId: '5582897d' });
  assert.throws(() => resolveArea(found.step, 'ifBranch.head'), /no ifBranch|has no ifBranch/);
});

// ---------------------------------------------------------------------------
// intro/outro blocks, catches
// ---------------------------------------------------------------------------

import { blockAsStep, resolveTarget, listCatches, catchTargetFor } from '../scripts/lib/nsd-paths.mjs';

const blocksSrc =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'intro(`<h1>T</h1>`, plain=`T`) {\n' +
  '    text(`a`, plain=`a`)\n' +
  '    list(ordered=false) {\n        item(`i`, plain=`i`)\n    }\n' +
  '}\n' +
  'mainSequence {\n' +
  '    simple(1, 5582897d, `a`, plain=`a`);\n' +
  '    break(2, 6131450e, `brk`, plain=`brk`);\n' +
  '    while(3, e81623e9, `loop`, plain=`loop`) {\n' +
  '        break(3.1, 79866663, `inner brk`, plain=`inner brk`);\n' +
  '        catchArea {\n' +
  '            catch(3.1, `inner brk`, plain=`inner brk`) {\n' +
  '                simple(3.1.1, 92dc561b, `handle`, plain=`handle`);\n' +
  '            }\n' +
  '        }\n' +
  '    }\n' +
  '    case(4, fde99ef2, `c`, plain=`c`) {\n' +
  '        default_branch(`d`, plain=`d`) {\n' +
  '            break(4.1, 074ad64c, `case brk`, plain=`case brk`);\n' +
  '        }\n' +
  '        case_branch(`x`, plain=`x`) {\n            simple(4.2, 77f1ab52, `s`, plain=`s`);\n        }\n' +
  '        case_branch(`y`, plain=`y`) {\n            simple(4.3, 4f9e39ae, `s`, plain=`s`);\n        }\n' +
  '    }\n' +
  '}\n' +
  'outro(`<div>o</div>`, plain=`o`) {\n}\n';

test('blockAsStep exposes intro/outro as a step-like object with content.head/tail', () => {
  const ast = parseDiagram(blocksSrc);
  const intro = blockAsStep(ast, 'intro');
  assert.deepEqual(addressableAreas(intro).map((a) => a.key), ['head', 'tail[0]', 'tail[1].items[0]']);
  assert.equal(blockAsStep(ast, 'outro').content.head.html, '<div>o</div>');
});

test('blockAsStep fails clearly when the diagram has no such block', () => {
  const ast = parseDiagram('// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\nmainSequence {\n    simple(1, 5582897d, `a`, plain=`a`);\n}\n');
  assert.throws(() => blockAsStep(ast, 'outro'), /outro/);
});

test('resolveTarget resolves intro/outro keywords, step numbers and step ids', () => {
  const ast = parseDiagram(blocksSrc);
  assert.equal(resolveTarget(ast, 'intro').block, 'intro');
  assert.equal(resolveTarget(ast, 'outro').block, 'outro');
  assert.equal(resolveTarget(ast, '3.1').step.stepId, '79866663');
  assert.equal(resolveTarget(ast, '5582897d').step.stepNum, '1');
  assert.equal(resolveTarget(ast, '99'), null);
});

test('listCatches reports catch blocks with their break step and body key, plus uncaught breaks', () => {
  const ast = parseDiagram(blocksSrc);
  const { catches, uncaughtBreaks } = listCatches(ast);
  assert.deepEqual(catches, [{
    ownerKey: 'step:e81623e9.body', index: 0, breakStepNum: '3.1', breakStepId: '79866663',
    bodyKey: 'step:e81623e9.body.catch[0].body', stepCount: 1,
  }]);
  assert.deepEqual(uncaughtBreaks.map((b) => [b.stepId, b.parentKey]), [
    ['6131450e', 'main'], ['074ad64c', 'step:fde99ef2.default_branch'],
  ]);
});

test('catchTargetFor picks the break sequence, or the nearest ancestor that may hold a catchArea', () => {
  const ast = parseDiagram(blocksSrc);
  assert.equal(catchTargetFor(ast, '6131450e').key, 'main');
  assert.equal(catchTargetFor(ast, '074ad64c').key, 'main');
  assert.equal(catchTargetFor(ast, '79866663').key, 'step:e81623e9.body');
  assert.equal(catchTargetFor(ast, '79866663', 'main').key, 'main');
  assert.throws(() => catchTargetFor(ast, '79866663', 'step:fde99ef2.default_branch'), /Vorfahr|catch/);
  assert.throws(() => catchTargetFor(ast, '5582897d'), /break/);
});
