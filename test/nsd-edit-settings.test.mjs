import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSettings, setSetting } from '../scripts/nsd-edit-settings.mjs';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';

const srcWithSettings =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'settings {\n' +
  '    width=731\n' +
  '    zoom=100\n' +
  '    changeModeEnabled=false\n' +
  '    changeSetName=yellow\n' +
  '    pdfOptions {\n' +
  '        filename=`temp.pdf`\n' +
  '        pageSize=A4\n' +
  '        portrait=true\n' +
  '        paging=false\n' +
  '    }\n' +
  '}\n' +
  'mainSequence {\n' +
  '    simple(1, 5582897d, `x`, plain=`x`);\n' +
  '}\n';

const srcWithoutSettings =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'mainSequence {\n' +
  '    simple(1, 5582897d, `x`, plain=`x`);\n' +
  '}\n';

test('readSettings returns the parsed settings block', () => {
  const result = readSettings(srcWithSettings);
  assert.equal(result.ok, true);
  assert.equal(result.settings.width, 731);
  assert.equal(result.settings.changeSetName, 'yellow');
  assert.equal(result.settings.pdfOptions.pageSize, 'A4');
});

test('readSettings returns an empty object when there is no settings block', () => {
  const result = readSettings(srcWithoutSettings);
  assert.equal(result.ok, true);
  assert.deepEqual(result.settings, {});
});

test('setSetting changes a top-level int field', () => {
  const result = setSetting(srcWithSettings, { key: 'zoom', value: '150' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.equal(ast.settings.zoom, 150);
});

test('setSetting changes a top-level bool field', () => {
  const result = setSetting(srcWithSettings, { key: 'changeModeEnabled', value: 'true' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.equal(ast.settings.changeModeEnabled, true);
});

test('setSetting changes a nested pdfOptions field', () => {
  const result = setSetting(srcWithSettings, { key: 'pdfOptions.pageSize', value: 'A3' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.equal(ast.settings.pdfOptions.pageSize, 'A3');
  // untouched sibling fields survive
  assert.equal(ast.settings.pdfOptions.filename, 'temp.pdf');
});

test('setSetting creates settings and pdfOptions from scratch when absent', () => {
  const result = setSetting(srcWithoutSettings, { key: 'pdfOptions.portrait', value: 'false' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.equal(ast.settings.pdfOptions.portrait, false);
});

test('setSetting rejects a non-integer value for an int field', () => {
  const result = setSetting(srcWithSettings, { key: 'width', value: 'not-a-number' });
  assert.equal(result.ok, false);
  assert.match(result.error, /integer/);
});

test('setSetting rejects a non-bool value for a bool field', () => {
  const result = setSetting(srcWithSettings, { key: 'changeModeEnabled', value: 'yes' });
  assert.equal(result.ok, false);
  assert.match(result.error, /true.*false/);
});

test('setSetting rejects an unknown top-level key', () => {
  const result = setSetting(srcWithSettings, { key: 'nonsense', value: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown settings key/);
});

test('setSetting rejects an unknown pdfOptions key', () => {
  const result = setSetting(srcWithSettings, { key: 'pdfOptions.nonsense', value: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown pdfOptions key/);
});

test('setSetting rejects a backtick in a string value', () => {
  const result = setSetting(srcWithSettings, { key: 'pdfOptions.filename', value: 'evil`backtick.pdf' });
  assert.equal(result.ok, false);
  assert.match(result.error, /backtick/);
});

test('setSetting round-trips through parse/serialize/parse without throwing', () => {
  const result = setSetting(srcWithSettings, { key: 'changeSetName', value: 'blue' });
  assert.doesNotThrow(() => parseDiagram(result.text));
});
