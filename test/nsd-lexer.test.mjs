import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../scripts/lib/nsd-lexer.mjs';

function types(tokens) {
  return tokens.map((t) => t.type);
}

test('skips whitespace and line comments, tokenizes a keyword and punctuation', () => {
  const tokens = tokenize('// a comment\nsettings {\n}\n');
  assert.deepEqual(types(tokens), ['KEYWORD', 'LBRACE', 'RBRACE', 'EOF']);
  assert.equal(tokens[0].value, 'settings');
});

test('skips the line-1 JSON envelope comment', () => {
  const tokens = tokenize('// {"specmanVersion":"1.3.0"}\nsettings {}\n');
  assert.deepEqual(types(tokens), ['KEYWORD', 'LBRACE', 'RBRACE', 'EOF']);
});

test('tokenizes a backtick string containing braces and parens verbatim', () => {
  const tokens = tokenize('`resolver="NamedStyle:default {name=default,}"`');
  assert.equal(tokens.length, 2); // BACKTICK_STRING + EOF
  assert.equal(tokens[0].type, 'BACKTICK_STRING');
  assert.equal(tokens[0].value, '`resolver="NamedStyle:default {name=default,}"`');
});

test('rejects an unterminated backtick string', () => {
  assert.throws(() => tokenize('`unterminated'), /unterminated/i);
});

test('tokenizes a plain integer as INT', () => {
  const tokens = tokenize('700');
  assert.deepEqual(types(tokens), ['INT', 'EOF']);
  assert.equal(tokens[0].value, '700');
});

test('tokenizes an 8-digit all-numeric run as STEP_ID (tie broken by declaration order)', () => {
  const tokens = tokenize('12345678');
  assert.deepEqual(types(tokens), ['STEP_ID', 'EOF']);
});

test('tokenizes a 9-digit run as INT (longer match beats STEP_ID)', () => {
  const tokens = tokenize('123456789');
  assert.deepEqual(types(tokens), ['INT', 'EOF']);
  assert.equal(tokens[0].value, '123456789');
});

test('tokenizes a 7-digit run as INT (too short for STEP_ID)', () => {
  const tokens = tokenize('1234567');
  assert.deepEqual(types(tokens), ['INT', 'EOF']);
});

test('tokenizes a real lowercase-hex step id', () => {
  const tokens = tokenize('5582897d');
  assert.deepEqual(types(tokens), ['STEP_ID', 'EOF']);
});

test('tokenizes a hex-looking identifier of exactly 8 chars starting with a letter as STEP_ID', () => {
  const tokens = tokenize('aaaa1234');
  assert.deepEqual(types(tokens), ['STEP_ID', 'EOF']);
});

test('tokenizes a longer all-hex-lowercase word as ID, not STEP_ID', () => {
  const tokens = tokenize('aaaaaaaaa'); // 9 chars, all valid hex letters
  assert.deepEqual(types(tokens), ['ID', 'EOF']);
  assert.equal(tokens[0].value, 'aaaaaaaaa');
});

test('tokenizes an 8-char word containing a non-hex letter as ID, not STEP_ID', () => {
  const tokens = tokenize('collapse'); // 8 chars but contains non-hex letters
  assert.deepEqual(types(tokens), ['ID', 'EOF']);
});

test('tokenizes dotted step numbers as STEP_NUM', () => {
  const tokens = tokenize('2.3');
  assert.deepEqual(types(tokens), ['STEP_NUM', 'EOF']);
  assert.equal(tokens[0].value, '2.3');
});

test('tokenizes lettered step numbers as STEP_NUM', () => {
  const tokens = tokenize('3b');
  assert.deepEqual(types(tokens), ['STEP_NUM', 'EOF']);
});

test('tokenizes a multi-level lettered dotted step number as STEP_NUM', () => {
  const tokens = tokenize('3.2.4.2b');
  assert.deepEqual(types(tokens), ['STEP_NUM', 'EOF']);
});

test('tokenizes a percentage value as PERCENT', () => {
  const tokens = tokenize('39.07%');
  assert.deepEqual(types(tokens), ['PERCENT', 'EOF']);
  assert.equal(tokens[0].value, '39.07%');
});

test('tokenizes a hex color as COLOR_HEX', () => {
  const tokens = tokenize('#dcdcdc');
  assert.deepEqual(types(tokens), ['COLOR_HEX', 'EOF']);
});

test('recognizes all step-type keywords distinctly from ID', () => {
  const tokens = tokenize('simple break while doWhile ifElse if case subsequence source');
  assert.deepEqual(types(tokens), [
    'KEYWORD', 'KEYWORD', 'KEYWORD', 'KEYWORD', 'KEYWORD', 'KEYWORD', 'KEYWORD', 'KEYWORD', 'KEYWORD', 'EOF',
  ]);
});

test('does not misclassify a keyword-prefixed longer identifier as a keyword', () => {
  const tokens = tokenize('caseSensitiveThing');
  assert.deepEqual(types(tokens), ['ID', 'EOF']);
  assert.equal(tokens[0].value, 'caseSensitiveThing');
});

test('tokenizes a base64 image block as one opaque token', () => {
  const tokens = tokenize('[base64:aGVsbG8=]');
  assert.deepEqual(types(tokens), ['BASE64_BLOCK', 'EOF']);
  assert.equal(tokens[0].value, '[base64:aGVsbG8=]');
});

test('tokenizes a plain bracket (not base64) as LBRACKET', () => {
  const tokens = tokenize('[33.09%, 33.24%]');
  assert.deepEqual(types(tokens), ['LBRACKET', 'PERCENT', 'COMMA', 'PERCENT', 'RBRACKET', 'EOF']);
});

test('tokenizes a full mainSequence skeleton with correct token stream', () => {
  const src = 'mainSequence {\n    simple(1, 5582897d, `hi`, plain=`hi`);\n}\n';
  const tokens = tokenize(src);
  assert.deepEqual(types(tokens), [
    'KEYWORD', 'LBRACE',
    'KEYWORD', 'LPAREN', 'INT', 'COMMA', 'STEP_ID', 'COMMA', 'BACKTICK_STRING',
    'COMMA', 'KEYWORD', 'EQUALS', 'BACKTICK_STRING', 'RPAREN', 'SEMI',
    'RBRACE', 'EOF',
  ]);
});

test('tracks line and column for error reporting', () => {
  const tokens = tokenize('settings {\n  width=700\n}\n');
  const widthToken = tokens.find((t) => t.value === 'width');
  assert.equal(widthToken.line, 2);
});
