// nsd-lexer.mjs — hand-rolled lexer for the Specman V2 model text format.
//
// Mirrors src/main/antlr4/specman/model/v002/SpecmanModel_V002.g4's lexer rules exactly,
// including declaration-order tie-breaking on same-length matches (ANTLR semantics: longest
// match wins; on a tie, the earlier-declared rule wins). See reference/SpecmanModel_V002.g4.
//
// BACKTICK_STRING is treated as one fully opaque token — its contents (which may include
// `{`/`}`/`(`/`)` from embedded HTML attributes) are never inspected here. That is what makes
// this lexer safe against the brace-in-backtick case observed in reference/suc-template.nsd.

const KEYWORDS = new Set([
  'simple', 'break', 'source', 'while', 'doWhile', 'ifElse', 'if', 'case', 'subsequence',
  'mainSequence', 'intro', 'outro', 'settings',
  'if_branch', 'else_branch', 'default_branch', 'case_branch',
  'catch', 'coCatch', 'catchArea',
  'list', 'item', 'table', 'row', 'cell', 'image', 'text',
  'ordered', 'flat', 'cols', 'width', 'zoom', 'barWidth', 'ifRatio', 'emptyWidth',
  'plain', 'markups', 'scale', 'type', 'change', 'sourceStep', 'deco', 'shade',
  'collapsed', 'headingWidth', 'changeModeEnabled', 'changeSetName', 'pdfOptions',
  'filename', 'modelFilename', 'pageSize', 'portrait', 'paging',
  'true', 'false',
  'added', 'removed', 'target', // 'source' already listed (step keyword + changeType literal)
  'Changed', 'Steplink', 'ChangedSteplink',
  'Full', 'Co',
]);

const PUNCT = {
  '{': 'LBRACE', '}': 'RBRACE', '(': 'LPAREN', ')': 'RPAREN',
  ',': 'COMMA', '=': 'EQUALS', ';': 'SEMI', '|': 'PIPE',
};

function isDigit(ch) { return ch >= '0' && ch <= '9'; }
function isHexLower(ch) { return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'); }
function isLetter(ch) { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'); }
function isIdentChar(ch) { return isLetter(ch) || isDigit(ch) || ch === '_' || ch === '-'; }
function isLowerLetter(ch) { return ch >= 'a' && ch <= 'z'; }

/**
 * Tokenizes Specman V2 model text into a flat token array (always ends with an EOF token).
 * Each token: { type, value, start, end, line, col }. Throws with a line:col-prefixed message
 * on malformed input (unterminated backtick string, unterminated base64 block, unknown char).
 */
export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;

  function advance(count = 1) {
    for (let k = 0; k < count; k++) {
      if (src[i] === '\n') { line++; col = 1; } else { col++; }
      i++;
    }
  }

  function push(type, value, startLine, startCol) {
    tokens.push({ type, value, start: undefined, end: undefined, line: startLine, col: startCol });
  }

  function fail(message) {
    throw new Error(`nsd-lexer: ${message} at line ${line}, col ${col}`);
  }

  while (i < n) {
    const ch = src[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { advance(); continue; }

    // Comments: "// ..." to end of line. Line 1's "// {...}" JSON envelope is likewise just
    // skipped here — the envelope is parsed separately (by the caller) before lexing/parsing
    // the model body, exactly like Specman's own ANTLR pipeline treats it as a skipped token.
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') advance();
      continue;
    }

    const startLine = line;
    const startCol = col;

    // Backtick string: opaque up to the next backtick.
    if (ch === '`') {
      let j = i + 1;
      while (j < n && src[j] !== '`') j++;
      if (j >= n) fail('unterminated backtick string');
      const value = src.slice(i, j + 1);
      push('BACKTICK_STRING', value, startLine, startCol);
      advance(j + 1 - i);
      continue;
    }

    // Hex color: '#' followed by hex digits.
    if (ch === '#') {
      let j = i + 1;
      while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
      if (j === i + 1) fail("expected hex digits after '#'");
      const value = src.slice(i, j);
      push('COLOR_HEX', value, startLine, startCol);
      advance(j - i);
      continue;
    }

    // '[' — either a base64 image block '[base64:...]' or a plain bracket.
    if (ch === '[') {
      if (src.startsWith('[base64:', i)) {
        let j = i + '[base64:'.length;
        while (j < n && /[a-zA-Z0-9+/]/.test(src[j])) j++;
        while (j < n && src[j] === '=') j++;
        if (src[j] !== ']') fail('unterminated base64 block');
        const value = src.slice(i, j + 1);
        push('BASE64_BLOCK', value, startLine, startCol);
        advance(j + 1 - i);
        continue;
      }
      push('LBRACKET', '[', startLine, startCol);
      advance();
      continue;
    }
    if (ch === ']') { push('RBRACKET', ']', startLine, startCol); advance(); continue; }

    // Simple single-character punctuation.
    if (PUNCT[ch]) { push(PUNCT[ch], ch, startLine, startCol); advance(); continue; }

    // Numeric-starting token: STEP_ID | INT | STEP_NUM | PERCENT, longest match wins, ties
    // broken by declaration order (STEP_ID > INT > STEP_NUM > PERCENT), exactly mirroring the
    // grammar's lexer rule order.
    if (isDigit(ch)) {
      const stepIdLen = tryStepId(src, i, n);
      const intLen = matchDigitRun(src, i, n);
      const stepNumLen = matchStepNum(src, i, n);
      const percentLen = matchPercent(src, i, n);
      const candidates = [
        { len: stepIdLen, type: 'STEP_ID' },
        { len: intLen, type: 'INT' },
        { len: stepNumLen, type: 'STEP_NUM' },
        { len: percentLen, type: 'PERCENT' },
      ].filter((c) => c.len > 0);
      if (candidates.length === 0) fail(`unexpected character '${ch}'`);
      let best = candidates[0];
      for (const c of candidates) if (c.len > best.len) best = c;
      const value = src.slice(i, i + best.len);
      push(best.type, value, startLine, startCol);
      advance(best.len);
      continue;
    }

    // Letter-starting token: maximal identifier scan, then reclassify as STEP_ID (exactly 8
    // lowercase hex chars) / KEYWORD (exact literal match) / ID.
    if (isLetter(ch)) {
      let j = i + 1;
      while (j < n && isIdentChar(src[j])) j++;
      const value = src.slice(i, j);
      let type = 'ID';
      if (value.length === 8 && [...value].every(isHexLower)) {
        type = 'STEP_ID';
      } else if (KEYWORDS.has(value)) {
        type = 'KEYWORD';
      }
      push(type, value, startLine, startCol);
      advance(j - i);
      continue;
    }

    fail(`unexpected character '${ch}'`);
  }

  tokens.push({ type: 'EOF', value: '', line, col });
  return tokens;
}

function tryStepId(src, i, n) {
  if (i + 8 > n) return 0;
  for (let k = 0; k < 8; k++) if (!isHexLower(src[i + k])) return 0;
  return 8;
}

function matchDigitRun(src, i, n) {
  let j = i;
  while (j < n && isDigit(src[j])) j++;
  return j - i;
}

// STEP_NUM: [0-9]+[a-z]('.'[0-9]+[a-z]?)*  |  [0-9]+('.'[0-9]+[a-z]?)+
function matchStepNum(src, i, n) {
  // Alternative 1: digits, a mandatory letter, then zero or more ('.' digits optional-letter).
  let j = i;
  while (j < n && isDigit(src[j])) j++;
  const digitsEnd1 = j;
  if (digitsEnd1 > i && j < n && isLowerLetter(src[j])) {
    j++; // the mandatory letter
    j = consumeDotGroups(src, j, n);
    return j - i;
  }
  // Alternative 2: digits, then one or more ('.' digits optional-letter) groups, no leading letter.
  j = digitsEnd1;
  if (j === i) return 0; // no leading digits at all
  const beforeDotGroups = j;
  const afterDotGroups = consumeDotGroups(src, j, n);
  if (afterDotGroups > beforeDotGroups) return afterDotGroups - i;
  return 0;
}

// Consumes zero or more repetitions of: '.' digits+ optional-lowercase-letter
function consumeDotGroups(src, j, n) {
  while (j < n && src[j] === '.' && isDigit(src[j + 1])) {
    j++; // '.'
    while (j < n && isDigit(src[j])) j++;
    if (j < n && isLowerLetter(src[j])) j++;
  }
  return j;
}

function matchPercent(src, i, n) {
  let j = i;
  while (j < n && isDigit(src[j])) j++;
  if (j === i) return 0;
  if (src[j] === '.' && isDigit(src[j + 1])) {
    j++;
    while (j < n && isDigit(src[j])) j++;
  }
  if (src[j] !== '%') return 0;
  return j + 1 - i;
}
