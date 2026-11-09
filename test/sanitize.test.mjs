import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSanitizeOutput, pickOutputStream } from '../scripts/sanitize.mjs';

test('parses an OK result', () => {
  const result = parseSanitizeOutput('OK\n', 0);
  assert.equal(result.status, 'OK');
  assert.equal(result.ok, true);
});

test('parses a SANITIZED result with step number changes and steplink updates', () => {
  const stdout =
    'SANITIZED\n\n' +
    'Step numbers changed (2):\n' +
    '  500 -> 1 (simple) "Brand new inserted step."\n' +
    '  1 -> 2 (simple) "Simple step. Every step has an ID..."\n\n' +
    'Steplink references updated (1):\n' +
    '  Step 5 (simple): 1 -> 2\n\n' +
    'Plain text fields refreshed: 10\n';
  const result = parseSanitizeOutput(stdout, 0);
  assert.equal(result.status, 'SANITIZED');
  assert.equal(result.ok, true);
  assert.equal(result.stepNumberChanges.length, 2);
  assert.deepEqual(result.stepNumberChanges[0], { from: '500', to: '1', type: 'simple', text: 'Brand new inserted step.' });
  assert.equal(result.steplinkUpdates.length, 1);
  assert.equal(result.plainTextFieldsRefreshed, 10);
});

test('parses an ERROR result for unresolvable steplinks', () => {
  const result = parseSanitizeOutput('ERROR\nUnresolvable steplink references: [1]\n', 1);
  assert.equal(result.status, 'ERROR');
  assert.equal(result.ok, false);
  assert.match(result.message, /Unresolvable steplink references/);
});

test('parses an ERROR result for a syntax error', () => {
  const result = parseSanitizeOutput("ERROR\nline 30:0 mismatched input 'mainSequenceXXX' expecting {')', ','}\n", 1);
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /mismatched input/);
});

test('parses a SANITIZED result with CRLF line endings (real jar output on Windows)', () => {
  const stdout =
    'SANITIZED\r\n\r\n' +
    'Step numbers changed (2):\r\n' +
    '  500 -> 1 (simple) "Brand new inserted step."\r\n' +
    '  1 -> 2 (simple) "Simple step."\r\n\r\n' +
    'Steplink references updated (1):\r\n' +
    '  Step 5 (simple): 1 -> 2\r\n\r\n' +
    'Plain text fields refreshed: 10\r\n';
  const result = parseSanitizeOutput(stdout, 0);
  assert.equal(result.stepNumberChanges.length, 2);
  assert.equal(result.steplinkUpdates.length, 1);
  assert.equal(result.plainTextFieldsRefreshed, 10);
});

test('treats unrecognized first-line output as an error rather than guessing', () => {
  const result = parseSanitizeOutput('SOMETHING UNEXPECTED\n', 1);
  assert.equal(result.ok, false);
  assert.match(result.error, /unerwartete Sanitizer-Ausgabe/);
});

test('pickOutputStream uses stdout when it has a recognized status line', () => {
  assert.equal(pickOutputStream('OK\n', ''), 'OK\n');
  assert.equal(pickOutputStream('SANITIZED\n\nStep numbers changed (0):\n', ''), 'SANITIZED\n\nStep numbers changed (0):\n');
});

test('pickOutputStream falls back to stderr for error paths that print there (verified against the real jar)', () => {
  const stderr = "ERROR\nUnrecognized token 'not': was expecting 'null', 'true', 'false' or NaN\n";
  assert.equal(pickOutputStream('', stderr), stderr);
});

test('pickOutputStream prefers non-empty stdout over stderr when stdout has no known status either', () => {
  assert.equal(pickOutputStream('garbage on stdout', ''), 'garbage on stdout');
});


import { sanitizeUntilStable } from '../scripts/sanitize.mjs';

function fakeRunner(results, contents) {
  let i = 0;
  return { run: () => results[i++], read: () => contents[Math.min(i, contents.length) - 1] };
}

test('sanitizeUntilStable reports OK as stable without a second run', () => {
  const f = fakeRunner([{ ok: true, status: 'OK' }], ['a']);
  const r = sanitizeUntilStable(f.run, f.read);
  assert.equal(r.status, 'OK');
  assert.equal(r.stable, true);
});

test('sanitizeUntilStable marks SANITIZED as stable when a second run leaves the file byte-identical', () => {
  // The jar keeps counting "plain text fields refreshed" for fields whose regenerated plain text it
  // trims on write (e.g. a leading empty <div>) — the counter never reaches 0, the file does settle.
  const f = fakeRunner(
    [{ ok: true, status: 'SANITIZED', stepNumberChanges: [], steplinkUpdates: [], plainTextFieldsRefreshed: 2 },
      { ok: true, status: 'SANITIZED', stepNumberChanges: [], steplinkUpdates: [], plainTextFieldsRefreshed: 2 }],
    ['v1', 'v1'],
  );
  const r = sanitizeUntilStable(f.run, f.read);
  assert.equal(r.status, 'SANITIZED');
  assert.equal(r.stable, true);
  assert.equal(r.plainTextFieldsRefreshed, 2);
});

test('sanitizeUntilStable marks the result unstable when the second run still changes the file', () => {
  const f = fakeRunner(
    [{ ok: true, status: 'SANITIZED', stepNumberChanges: [], steplinkUpdates: [] },
      { ok: true, status: 'SANITIZED', stepNumberChanges: [], steplinkUpdates: [] }],
    ['v1', 'v2'],
  );
  assert.equal(sanitizeUntilStable(f.run, f.read).stable, false);
});

test('sanitizeUntilStable does not run again after an ERROR', () => {
  let runs = 0;
  const r = sanitizeUntilStable(() => { runs++; return { ok: false, status: 'ERROR', message: 'x' }; }, () => 'a');
  assert.equal(r.ok, false);
  assert.equal(runs, 1);
});

test('readSpecVersion reads specmanVersion from the line-1 envelope', async () => {
  const { readSpecVersion } = await import('../scripts/sanitize.mjs');
  assert.equal(
    readSpecVersion('// {"specmanVersion":"1.4.0","modelType":"specman.model.v002.DiagramModel_V002"}\nsettings {}\n'),
    '1.4.0',
  );
  assert.equal(readSpecVersion('settings {}\n'), null);
  assert.equal(readSpecVersion('// {not json}\n'), null);
});

test('attachWarnings adds a warnings array to successful results only when there is something to say', async () => {
  const { attachWarnings } = await import('../scripts/sanitize.mjs');
  assert.deepEqual(attachWarnings({ ok: true, status: 'OK' }, []), { ok: true, status: 'OK' });
  assert.deepEqual(attachWarnings({ ok: true, status: 'OK' }, ['w']), { ok: true, status: 'OK', warnings: ['w'] });
  assert.deepEqual(attachWarnings({ ok: false, status: 'ERROR', message: 'm' }, ['w']), {
    ok: false,
    status: 'ERROR',
    message: 'm',
    warnings: ['w'],
  });
});
