// nsd-ast.mjs — recursive-descent parser and serializer for the Specman V2 model text format.
// Mirrors reference/SpecmanModel_V002.g4 production-by-production. See that file for the
// authoritative grammar; this module's function names follow its rule names.
//
// Design principle: this library owns syntactic correctness so that callers (nsd-* CLI scripts,
// and ultimately the editing skills) only ever decide *content*, never hand-construct DSL text.
// Since Specman's own `--sanitize` completely reformats a file on every run, this serializer does
// not attempt to reproduce Specman's exact pretty-printing — only grammar-valid output. Unknown/
// unhandled attributes on nodes that are round-tripped unmodified (deco, shade, image blocks,
// source/target linking) are carried through verbatim rather than recomputed.

import { tokenize } from './nsd-lexer.mjs';

const STEP_START_KEYWORDS = new Set([
  'simple', 'break', 'source', 'while', 'doWhile', 'ifElse', 'if', 'case', 'subsequence',
]);
const CHANGE_TYPES = new Set(['added', 'removed', 'source', 'target']);
const MARKUP_TYPES = new Set(['Changed', 'Steplink', 'ChangedSteplink']);

// AST fields for HTML/plain-text content store the string WITHOUT the surrounding backticks —
// the backtick delimiters are pure syntax, not part of the model. The serializer re-adds them.
function unwrapBacktick(tokenValue) { return tokenValue.slice(1, -1); }
function wrapBacktick(content) { return `\`${content}\``; }

// Every caller that writes new HTML content (nsd-set-text, nsd-insert-step, nsd-area, ...) must
// run this first: a literal backtick would prematurely end the BACKTICK_STRING token (see
// nsd-lexer.mjs), silently truncating the HTML and shifting everything lexed afterwards — not a
// loud parse error at write time, but a corrupted file discovered only later.
export function assertValidHtml(html) {
  if (typeof html === 'string' && html.includes('`')) {
    throw new Error("nsd-ast: HTML-Inhalt darf kein Backtick (`) enthalten — es würde den BACKTICK_STRING-Token vorzeitig beenden.");
  }
}

// ============================================================
// Envelope (line 1 JSON comment, read separately from the grammar body — see g4 header comment)
// ============================================================

function parseEnvelopeLine(text) {
  const firstLine = text.split('\n', 1)[0];
  const m = firstLine.match(/^\/\/\s*(\{.*\})\s*$/);
  if (!m) throw new Error('nsd-ast: missing or malformed line-1 JSON envelope comment');
  const obj = JSON.parse(m[1]);
  return { specmanVersion: obj.specmanVersion, modelType: obj.modelType };
}

// ============================================================
// Parser
// ============================================================

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
  }

  cur() { return this.tokens[this.i]; }
  peek(offset) { return this.tokens[this.i + offset]; }
  at(type) { return this.cur().type === type; }
  atKeyword(word) { return this.cur().type === 'KEYWORD' && this.cur().value === word; }
  advance() { return this.tokens[this.i++]; }

  fail(message) {
    const t = this.cur();
    throw new Error(`nsd-ast: ${message} at line ${t.line}, col ${t.col}`);
  }

  expect(type) {
    if (!this.at(type)) this.fail(`expected ${type} but found ${this.cur().type} '${this.cur().value}'`);
    return this.advance();
  }

  expectKeyword(word) {
    if (!this.atKeyword(word)) this.fail(`expected keyword '${word}' but found ${this.cur().type} '${this.cur().value}'`);
    return this.advance();
  }

  // Generic identifier-valued slot (changeset name, image type, deco value, pdf page size, ...).
  // Accepts ID or KEYWORD token types since a value that happens to collide with a reserved word
  // (e.g. a changeset literally named "text") still lexes as KEYWORD, not ID.
  expectIdent() {
    if (this.at('ID') || this.at('KEYWORD')) return this.advance().value;
    this.fail(`expected an identifier but found ${this.cur().type} '${this.cur().value}'`);
  }

  expectBool() {
    if (this.atKeyword('true')) { this.advance(); return true; }
    if (this.atKeyword('false')) { this.advance(); return false; }
    this.fail("expected 'true' or 'false'");
  }

  parseStepNum() {
    if (this.at('INT') || this.at('STEP_NUM')) return this.advance().value;
    this.fail('expected a step number');
  }

  isStepStart() {
    return this.cur().type === 'KEYWORD' && STEP_START_KEYWORDS.has(this.cur().value);
  }

  // Looks ahead for ", <word>" without consuming anything unless it matches, in which case both
  // the comma and the keyword are consumed and the cursor is left right after the keyword.
  consumeOptional(word) {
    if (this.at('COMMA') && this.peek(1).type === 'KEYWORD' && this.peek(1).value === word) {
      this.advance();
      this.advance();
      return true;
    }
    return false;
  }

  // --- htmlContent / markups / changeParam ---

  parseHtmlContent() {
    const html = unwrapBacktick(this.expect('BACKTICK_STRING').value);
    let plain;
    if (this.consumeOptional('plain')) {
      this.expect('EQUALS');
      plain = unwrapBacktick(this.expect('BACKTICK_STRING').value);
    }
    let markups = [];
    if (this.consumeOptional('markups')) {
      this.expect('EQUALS');
      this.expect('LBRACKET');
      while (!this.at('RBRACKET')) markups.push(this.parseMarkup());
      this.expect('RBRACKET');
    }
    return { html, plain, markups };
  }

  parseMarkup() {
    this.expect('LPAREN');
    const from = Number(this.expect('INT').value);
    this.expect('COMMA');
    const to = Number(this.expect('INT').value);
    this.expect('COMMA');
    if (!(this.at('KEYWORD') && MARKUP_TYPES.has(this.cur().value))) {
      this.fail(`expected a markup type (Changed/Steplink/ChangedSteplink) but found '${this.cur().value}'`);
    }
    const type = this.advance().value;
    let changeset;
    if (this.at('COMMA')) { this.advance(); changeset = this.expectIdent(); }
    this.expect('RPAREN');
    return { from, to, type, changeset };
  }

  // Called with the cursor already positioned right after the 'change' keyword (consumeOptional
  // having consumed the comma+keyword already).
  parseChangeParam() {
    this.expect('EQUALS');
    this.expect('LPAREN');
    if (!(this.at('KEYWORD') && CHANGE_TYPES.has(this.cur().value))) {
      this.fail(`expected a change type (added/removed/source/target) but found '${this.cur().value}'`);
    }
    const kind = this.advance().value;
    this.expect('COMMA');
    const changeset = this.expectIdent();
    let sourceStep;
    if (this.consumeOptional('sourceStep')) {
      this.expect('EQUALS');
      sourceStep = this.expect('STEP_ID').value;
    }
    this.expect('RPAREN');
    return { kind, changeset, sourceStep };
  }

  parsePercentList() {
    const values = [this.expect('PERCENT').value];
    while (this.at('COMMA')) { this.advance(); values.push(this.expect('PERCENT').value); }
    return values;
  }

  // --- areas ---

  parseAreaList() {
    const areas = [];
    while (this.atKeyword('list') || this.atKeyword('text') || this.atKeyword('table') || this.atKeyword('image')) {
      areas.push(this.parseArea());
    }
    return areas;
  }

  parseArea() {
    if (this.atKeyword('list')) return this.parseListBlock();
    if (this.atKeyword('text')) return this.parseTextArea();
    if (this.atKeyword('table')) return this.parseTableBlock();
    if (this.atKeyword('image')) return this.parseImageBlock();
    this.fail('expected an area (list/text/table/image)');
  }

  parseListBlock() {
    this.expectKeyword('list');
    this.expect('LPAREN');
    this.expectKeyword('ordered');
    this.expect('EQUALS');
    const ordered = this.expectBool();
    this.expect('RPAREN');
    this.expect('LBRACE');
    const items = [];
    while (this.atKeyword('item')) items.push(this.parseListItem());
    this.expect('RBRACE');
    return { kind: 'list', ordered, items };
  }

  parseListItem() {
    this.expectKeyword('item');
    this.expect('LPAREN');
    const head = this.parseHtmlContent();
    let change;
    if (this.consumeOptional('change')) change = this.parseChangeParam();
    this.expect('RPAREN');
    let tail = [];
    if (this.at('LBRACE')) {
      this.advance();
      while (this.atKeyword('text') || this.atKeyword('table') || this.atKeyword('image')) {
        tail.push(this.parseArea());
      }
      this.expect('RBRACE');
    }
    return { content: { head, tail }, change };
  }

  parseTextArea() {
    this.expectKeyword('text');
    this.expect('LPAREN');
    const content = this.parseHtmlContent();
    let change;
    if (this.consumeOptional('change')) change = this.parseChangeParam();
    this.expect('RPAREN');
    return { kind: 'text', content, change };
  }

  parseTableBlock() {
    this.expectKeyword('table');
    this.expect('LPAREN');
    this.expectKeyword('width');
    this.expect('EQUALS');
    const widthPercent = this.expect('PERCENT').value;
    let cols;
    if (this.consumeOptional('cols')) {
      this.expect('EQUALS');
      this.expect('LBRACKET');
      cols = this.parsePercentList();
      this.expect('RBRACKET');
    }
    let change;
    if (this.consumeOptional('change')) change = this.parseChangeParam();
    this.expect('RPAREN');
    this.expect('LBRACE');
    const rows = [];
    while (this.atKeyword('row')) rows.push(this.parseTableRow());
    this.expect('RBRACE');
    return { kind: 'table', widthPercent, cols, change, rows };
  }

  parseTableRow() {
    this.expectKeyword('row');
    this.expect('LBRACE');
    const cells = [this.parseTableCell()];
    while (this.at('PIPE')) { this.advance(); cells.push(this.parseTableCell()); }
    this.expect('RBRACE');
    return { cells };
  }

  parseTableCell() {
    this.expectKeyword('cell');
    this.expect('LPAREN');
    const head = this.parseHtmlContent();
    this.expect('RPAREN');
    let tail = [];
    if (this.at('LBRACE')) {
      this.advance();
      tail = this.parseAreaList();
      this.expect('RBRACE');
    }
    return { content: { head, tail } };
  }

  // Image blocks are never interpreted, only round-tripped verbatim (grammar comment: "agents
  // must ignore image blocks").
  parseImageBlock() {
    this.expectKeyword('image');
    this.expect('LPAREN');
    this.expectKeyword('scale');
    this.expect('EQUALS');
    const scalePercent = this.expect('PERCENT').value;
    this.expect('COMMA');
    this.expectKeyword('type');
    this.expect('EQUALS');
    const imageType = this.expectIdent();
    let change;
    if (this.consumeOptional('change')) change = this.parseChangeParam();
    this.expect('RPAREN');
    this.expect('LBRACE');
    const raw = this.expect('BASE64_BLOCK').value;
    this.expect('RBRACE');
    return { kind: 'image', scalePercent, imageType, change, raw };
  }

  // --- steps ---

  parseStep() {
    if (this.atKeyword('simple')) return this.parseSimpleOrBreak('simple');
    if (this.atKeyword('break')) return this.parseSimpleOrBreak('break');
    if (this.atKeyword('source')) return this.parseSourceStep();
    if (this.atKeyword('while')) return this.parseLoopStep('while', true);
    if (this.atKeyword('doWhile')) return this.parseLoopStep('doWhile', false);
    if (this.atKeyword('ifElse')) return this.parseIfElseStep();
    if (this.atKeyword('if')) return this.parseIfStep();
    if (this.atKeyword('case')) return this.parseCaseStep();
    if (this.atKeyword('subsequence')) return this.parseSubsequenceStep();
    this.fail('expected a step');
  }

  // Trailing (',' changeParam)? (',' decoParam)? (',' shadeParam)? shared by simple/break and
  // every structured step type; kept as one helper so the fixed relative order can't drift
  // between step kinds.
  parseChangeDecoShade() {
    let change, deco, shade;
    if (this.consumeOptional('change')) change = this.parseChangeParam();
    if (this.consumeOptional('deco')) { this.expect('EQUALS'); deco = this.expectIdent(); }
    if (this.consumeOptional('shade')) { this.expect('EQUALS'); shade = this.expect('COLOR_HEX').value; }
    return { change, deco, shade };
  }

  parseSimpleOrBreak(kw) {
    this.expectKeyword(kw);
    this.expect('LPAREN');
    const stepNum = this.parseStepNum();
    this.expect('COMMA');
    const stepId = this.expect('STEP_ID').value;
    this.expect('COMMA');
    const head = this.parseHtmlContent();
    const { change, deco, shade } = this.parseChangeDecoShade();
    this.expect('RPAREN');
    let tail = [];
    if (this.at('SEMI')) { this.advance(); }
    else { this.expect('LBRACE'); tail = this.parseAreaList(); this.expect('RBRACE'); }
    return { kind: kw, stepNum, stepId, content: { head, tail }, change, deco, shade };
  }

  parseSourceStep() {
    this.expectKeyword('source');
    this.expect('LPAREN');
    const stepNum = this.parseStepNum();
    this.expect('COMMA');
    const stepId = this.expect('STEP_ID').value;
    this.expect('COMMA');
    const head = this.parseHtmlContent();
    this.expect('COMMA');
    const changeset = this.expectIdent();
    let sourceStep;
    if (this.consumeOptional('sourceStep')) { this.expect('EQUALS'); sourceStep = this.expect('STEP_ID').value; }
    let deco, shade;
    if (this.consumeOptional('deco')) { this.expect('EQUALS'); deco = this.expectIdent(); }
    if (this.consumeOptional('shade')) { this.expect('EQUALS'); shade = this.expect('COLOR_HEX').value; }
    this.expect('RPAREN');
    let tail = [];
    if (this.at('SEMI')) { this.advance(); }
    else { this.expect('LBRACE'); tail = this.parseAreaList(); this.expect('RBRACE'); }
    return { kind: 'source', stepNum, stepId, content: { head, tail }, changeset, sourceStep, deco, shade };
  }

  parseLoopStep(kw, hasCatchArea) {
    this.expectKeyword(kw);
    this.expect('LPAREN');
    const stepNum = this.parseStepNum();
    this.expect('COMMA');
    const stepId = this.expect('STEP_ID').value;
    this.expect('COMMA');
    const head = this.parseHtmlContent();
    let barWidth, collapsed;
    if (this.consumeOptional('barWidth')) { this.expect('EQUALS'); barWidth = Number(this.expect('INT').value); }
    if (this.consumeOptional('collapsed')) { this.expect('EQUALS'); this.expectKeyword('true'); collapsed = true; }
    const { change, deco, shade } = this.parseChangeDecoShade();
    this.expect('RPAREN');
    this.expect('LBRACE');
    const tail = this.parseAreaList();
    const body = [];
    while (this.isStepStart()) body.push(this.parseStep());
    let catchArea;
    if (hasCatchArea && (this.atKeyword('catchArea') || this.atKeyword('catch'))) catchArea = this.parseCatchArea();
    this.expect('RBRACE');
    return { kind: kw, stepNum, stepId, content: { head, tail }, barWidth, collapsed, change, deco, shade, body, catchArea };
  }

  parseIfElseStep() {
    this.expectKeyword('ifElse');
    this.expect('LPAREN');
    const stepNum = this.parseStepNum();
    this.expect('COMMA');
    const stepId = this.expect('STEP_ID').value;
    this.expect('COMMA');
    const head = this.parseHtmlContent();
    let ifRatio, collapsed;
    if (this.consumeOptional('ifRatio')) { this.expect('EQUALS'); ifRatio = this.expect('PERCENT').value; }
    if (this.consumeOptional('collapsed')) { this.expect('EQUALS'); this.expectKeyword('true'); collapsed = true; }
    const { change, deco, shade } = this.parseChangeDecoShade();
    this.expect('RPAREN');
    this.expect('LBRACE');
    const tail = this.parseAreaList();
    const ifBranch = this.parseBranch('if_branch', true);
    const elseBranch = this.parseBranch('else_branch', true);
    this.expect('RBRACE');
    return { kind: 'ifElse', stepNum, stepId, content: { head, tail }, ifRatio, collapsed, change, deco, shade, ifBranch, elseBranch };
  }

  parseIfStep() {
    this.expectKeyword('if');
    this.expect('LPAREN');
    const stepNum = this.parseStepNum();
    this.expect('COMMA');
    const stepId = this.expect('STEP_ID').value;
    this.expect('COMMA');
    const head = this.parseHtmlContent();
    let emptyWidth, collapsed;
    if (this.consumeOptional('emptyWidth')) { this.expect('EQUALS'); emptyWidth = Number(this.expect('INT').value); }
    if (this.consumeOptional('collapsed')) { this.expect('EQUALS'); this.expectKeyword('true'); collapsed = true; }
    const { change, deco, shade } = this.parseChangeDecoShade();
    this.expect('RPAREN');
    this.expect('LBRACE');
    const tail = this.parseAreaList();
    const ifBranch = this.parseBranch('if_branch', true);
    this.expect('RBRACE');
    return { kind: 'if', stepNum, stepId, content: { head, tail }, emptyWidth, collapsed, change, deco, shade, ifBranch };
  }

  parseCaseStep() {
    this.expectKeyword('case');
    this.expect('LPAREN');
    const stepNum = this.parseStepNum();
    this.expect('COMMA');
    const stepId = this.expect('STEP_ID').value;
    this.expect('COMMA');
    const head = this.parseHtmlContent();
    let cols, collapsed;
    if (this.consumeOptional('cols')) { this.expect('EQUALS'); this.expect('LBRACKET'); cols = this.parsePercentList(); this.expect('RBRACKET'); }
    if (this.consumeOptional('collapsed')) { this.expect('EQUALS'); this.expectKeyword('true'); collapsed = true; }
    const { change, deco, shade } = this.parseChangeDecoShade();
    this.expect('RPAREN');
    this.expect('LBRACE');
    const tail = this.parseAreaList();
    const defaultBranch = this.parseBranch('default_branch', false);
    const caseBranches = [];
    while (this.atKeyword('case_branch')) caseBranches.push(this.parseBranch('case_branch', false));
    this.expect('RBRACE');
    return { kind: 'case', stepNum, stepId, content: { head, tail }, cols, collapsed, change, deco, shade, defaultBranch, caseBranches };
  }

  parseSubsequenceStep() {
    this.expectKeyword('subsequence');
    this.expect('LPAREN');
    const stepNum = this.parseStepNum();
    this.expect('COMMA');
    const stepId = this.expect('STEP_ID').value;
    this.expect('COMMA');
    const head = this.parseHtmlContent();
    let flat, collapsed;
    if (this.consumeOptional('flat')) { this.expect('EQUALS'); this.expectKeyword('true'); flat = true; }
    if (this.consumeOptional('collapsed')) { this.expect('EQUALS'); this.expectKeyword('true'); collapsed = true; }
    const { change, deco, shade } = this.parseChangeDecoShade();
    this.expect('RPAREN');
    this.expect('LBRACE');
    const tail = this.parseAreaList();
    const body = [];
    while (this.isStepStart()) body.push(this.parseStep());
    let catchArea;
    if (this.atKeyword('catchArea') || this.atKeyword('catch')) catchArea = this.parseCatchArea();
    this.expect('RBRACE');
    return { kind: 'subsequence', stepNum, stepId, content: { head, tail }, flat, collapsed, change, deco, shade, body, catchArea };
  }

  parseBranch(kw, hasCatchArea) {
    this.expectKeyword(kw);
    this.expect('LPAREN');
    const head = this.parseHtmlContent();
    let change;
    if (this.consumeOptional('change')) change = this.parseChangeParam();
    this.expect('RPAREN');
    this.expect('LBRACE');
    const tail = this.parseAreaList();
    const body = [];
    while (this.isStepStart()) body.push(this.parseStep());
    let catchArea;
    if (hasCatchArea && (this.atKeyword('catchArea') || this.atKeyword('catch'))) catchArea = this.parseCatchArea();
    this.expect('RBRACE');
    return { content: { head, tail }, change, body, catchArea };
  }

  // --- catchArea (accepts both the wrapped form and the bare pre-catchArea form) ---

  parseCatchArea() {
    let collapsed;
    let cols;
    let wrapped = false;
    if (this.atKeyword('catchArea')) {
      wrapped = true;
      this.advance();
      if (this.at('LPAREN')) {
        this.advance();
        const setParam = () => {
          if (this.atKeyword('collapsed')) { this.advance(); this.expect('EQUALS'); this.expectKeyword('true'); collapsed = true; return; }
          if (this.atKeyword('cols')) { this.advance(); this.expect('EQUALS'); this.expect('LBRACKET'); cols = this.parsePercentList(); this.expect('RBRACKET'); return; }
          this.fail("expected 'collapsed' or 'cols' in catchArea(...)");
        };
        setParam();
        while (this.at('COMMA')) { this.advance(); setParam(); }
        this.expect('RPAREN');
      }
      this.expect('LBRACE');
    }
    const catches = [];
    while (this.atKeyword('catch')) catches.push(this.parseCatchBlock());
    if (wrapped) this.expect('RBRACE');
    return { collapsed, cols, catches };
  }

  parseCatchBlock() {
    this.expectKeyword('catch');
    this.expect('LPAREN');
    const breakStepNum = this.parseStepNum();
    this.expect('COMMA');
    const head = this.parseHtmlContent();
    let change, headingWidth;
    if (this.consumeOptional('change')) change = this.parseChangeParam();
    if (this.consumeOptional('headingWidth')) { this.expect('EQUALS'); headingWidth = Number(this.expect('INT').value); }
    this.expect('RPAREN');
    this.expect('LBRACE');
    const tail = this.parseAreaList();
    const coCatches = [];
    while (this.atKeyword('coCatch')) coCatches.push(this.parseCoCatch());
    const body = [];
    while (this.isStepStart()) body.push(this.parseStep());
    this.expect('RBRACE');
    return { breakStepNum, content: { head, tail }, change, headingWidth, coCatches, body };
  }

  parseCoCatch() {
    this.expectKeyword('coCatch');
    this.expect('LPAREN');
    const breakStepNum = this.parseStepNum();
    this.expect('COMMA');
    const head = this.parseHtmlContent();
    let change;
    if (this.consumeOptional('change')) change = this.parseChangeParam();
    this.expect('RPAREN');
    this.expect('SEMI');
    return { breakStepNum, content: head, change };
  }

  // --- top-level: settings / intro / outro / mainSequence / diagram ---

  parseSettings() {
    this.expectKeyword('settings');
    this.expect('LBRACE');
    let width, zoom, changeModeEnabled, changeSetName, pdfOptions;
    while (!this.at('RBRACE')) {
      if (this.atKeyword('width')) { this.advance(); this.expect('EQUALS'); width = Number(this.expect('INT').value); continue; }
      if (this.atKeyword('zoom')) { this.advance(); this.expect('EQUALS'); zoom = Number(this.expect('INT').value); continue; }
      if (this.atKeyword('changeModeEnabled')) { this.advance(); this.expect('EQUALS'); changeModeEnabled = this.expectBool(); continue; }
      if (this.atKeyword('changeSetName')) { this.advance(); this.expect('EQUALS'); changeSetName = this.expectIdent(); continue; }
      if (this.atKeyword('pdfOptions')) { this.advance(); pdfOptions = this.parsePdfOptions(); continue; }
      this.fail('unexpected entry in settings block');
    }
    this.expect('RBRACE');
    return { width, zoom, changeModeEnabled, changeSetName, pdfOptions };
  }

  parsePdfOptions() {
    this.expect('LBRACE');
    let filename, modelFilename, pageSize, portrait, paging;
    while (!this.at('RBRACE')) {
      if (this.atKeyword('filename')) { this.advance(); this.expect('EQUALS'); filename = unwrapBacktick(this.expect('BACKTICK_STRING').value); continue; }
      if (this.atKeyword('modelFilename')) { this.advance(); this.expect('EQUALS'); modelFilename = unwrapBacktick(this.expect('BACKTICK_STRING').value); continue; }
      if (this.atKeyword('pageSize')) { this.advance(); this.expect('EQUALS'); pageSize = this.expectIdent(); continue; }
      if (this.atKeyword('portrait')) { this.advance(); this.expect('EQUALS'); portrait = this.expectBool(); continue; }
      if (this.atKeyword('paging')) { this.advance(); this.expect('EQUALS'); paging = this.expectBool(); continue; }
      this.fail('unexpected entry in pdfOptions block');
    }
    this.expect('RBRACE');
    return { filename, modelFilename, pageSize, portrait, paging };
  }

  parseIntroOutro(kw) {
    this.expectKeyword(kw);
    this.expect('LPAREN');
    const head = this.parseHtmlContent();
    this.expect('RPAREN');
    this.expect('LBRACE');
    const tail = this.parseAreaList();
    this.expect('RBRACE');
    return { head, tail };
  }

  parseMainSequence() {
    this.expectKeyword('mainSequence');
    this.expect('LBRACE');
    const steps = [];
    while (this.isStepStart()) steps.push(this.parseStep());
    let catchArea;
    if (this.atKeyword('catchArea') || this.atKeyword('catch')) catchArea = this.parseCatchArea();
    this.expect('RBRACE');
    return { steps, catchArea };
  }

  parseTopDiagram(envelope) {
    let settings;
    if (this.atKeyword('settings')) settings = this.parseSettings();
    let intro;
    if (this.atKeyword('intro')) intro = this.parseIntroOutro('intro');
    const mainSequence = this.parseMainSequence();
    let outro;
    if (this.atKeyword('outro')) outro = this.parseIntroOutro('outro');
    this.expect('EOF');
    return { envelope, settings, intro, mainSequence, outro };
  }
}

export function parseDiagram(text) {
  const envelope = parseEnvelopeLine(text);
  if (envelope.modelType !== 'specman.model.v002.DiagramModel_V002') {
    throw new Error(
      `nsd-ast: unsupported model type '${envelope.modelType}' — this file is not in Specman V2 ` +
      'text format. Open it in Specman 1.3.0+ and save it once to upgrade before editing it here.',
    );
  }
  const tokens = tokenize(text);
  return new Parser(tokens).parseTopDiagram(envelope);
}

// ============================================================
// Serializer
// ============================================================

function markupText(m) {
  const cs = m.changeset !== undefined ? `,${m.changeset}` : '';
  return `(${m.from},${m.to},${m.type}${cs})`;
}

function htmlContentText(hc) {
  let s = wrapBacktick(hc.html);
  if (hc.plain !== undefined) s += `, plain=${wrapBacktick(hc.plain)}`;
  if (hc.markups && hc.markups.length > 0) s += `, markups=[${hc.markups.map(markupText).join('')}]`;
  return s;
}

function changeParamText(c) {
  const src = c.sourceStep !== undefined ? `, sourceStep=${c.sourceStep}` : '';
  return `change=(${c.kind}, ${c.changeset}${src})`;
}

function decoShadeParts(node) {
  const parts = [];
  if (node.deco !== undefined) parts.push(`deco=${node.deco}`);
  if (node.shade !== undefined) parts.push(`shade=${node.shade}`);
  return parts;
}

class Serializer {
  constructor() { this.lines = []; this.indentLevel = 0; }
  indent() { return '    '.repeat(this.indentLevel); }
  line(s) { this.lines.push(this.indent() + s); }
  open(s) { this.line(s); this.indentLevel++; }
  close(s = '}') { this.indentLevel--; this.line(s); }

  serializeAreaList(areas) {
    for (const area of areas) this.serializeArea(area);
  }

  serializeArea(area) {
    if (area.kind === 'list') return this.serializeListBlock(area);
    if (area.kind === 'text') return this.serializeTextArea(area);
    if (area.kind === 'table') return this.serializeTableBlock(area);
    if (area.kind === 'image') return this.serializeImageBlock(area);
    throw new Error(`nsd-ast: unknown area kind '${area.kind}'`);
  }

  serializeListBlock(area) {
    this.open(`list(ordered=${area.ordered}) {`);
    for (const item of area.items) this.serializeListItem(item);
    this.close();
  }

  serializeListItem(item) {
    const parts = [htmlContentText(item.content.head)];
    if (item.change) parts.push(changeParamText(item.change));
    const header = `item(${parts.join(', ')})`;
    if (item.content.tail.length === 0) {
      this.line(header);
    } else {
      this.open(`${header} {`);
      this.serializeAreaList(item.content.tail);
      this.close();
    }
  }

  serializeTextArea(area) {
    const parts = [htmlContentText(area.content)];
    if (area.change) parts.push(changeParamText(area.change));
    this.line(`text(${parts.join(', ')})`);
  }

  serializeTableBlock(area) {
    const parts = [`width=${area.widthPercent}`];
    if (area.cols) parts.push(`cols=[${area.cols.join(', ')}]`);
    if (area.change) parts.push(changeParamText(area.change));
    this.open(`table(${parts.join(', ')}) {`);
    for (const row of area.rows) this.serializeTableRow(row);
    this.close();
  }

  serializeTableRow(row) {
    const cells = row.cells.map((cell) => this.tableCellText(cell)).join(' | ');
    this.line(`row { ${cells} }`);
  }

  tableCellText(cell) {
    const head = `cell(${htmlContentText(cell.content.head)})`;
    if (cell.content.tail.length === 0) return head;
    const inner = new Serializer();
    inner.indentLevel = this.indentLevel + 1;
    inner.serializeAreaList(cell.content.tail);
    return `${head} {\n${inner.lines.join('\n')}\n${this.indent()}}`;
  }

  serializeImageBlock(area) {
    const parts = [`scale=${area.scalePercent}`, `type=${area.imageType}`];
    if (area.change) parts.push(changeParamText(area.change));
    this.open(`image(${parts.join(', ')}) {`);
    this.line(area.raw);
    this.close();
  }

  serializeEditorContentTail(tail) {
    this.serializeAreaList(tail);
  }

  serializeStep(step) {
    if (step.kind === 'simple' || step.kind === 'break') return this.serializeSimpleOrBreak(step);
    if (step.kind === 'source') return this.serializeSourceStep(step);
    if (step.kind === 'while' || step.kind === 'doWhile') return this.serializeLoopStep(step);
    if (step.kind === 'ifElse') return this.serializeIfElseStep(step);
    if (step.kind === 'if') return this.serializeIfStep(step);
    if (step.kind === 'case') return this.serializeCaseStep(step);
    if (step.kind === 'subsequence') return this.serializeSubsequenceStep(step);
    throw new Error(`nsd-ast: unknown step kind '${step.kind}'`);
  }

  headerParts(step) {
    const parts = [step.stepNum, step.stepId, htmlContentText(step.content.head)];
    return parts;
  }

  serializeSimpleOrBreak(step) {
    const parts = this.headerParts(step);
    if (step.change) parts.push(changeParamText(step.change));
    parts.push(...decoShadeParts(step));
    const header = `${step.kind}(${parts.join(', ')})`;
    if (step.content.tail.length === 0) {
      this.line(`${header};`);
    } else {
      this.open(`${header} {`);
      this.serializeEditorContentTail(step.content.tail);
      this.close();
    }
  }

  serializeSourceStep(step) {
    const parts = this.headerParts(step);
    parts.push(step.changeset);
    if (step.sourceStep !== undefined) parts.push(`sourceStep=${step.sourceStep}`);
    parts.push(...decoShadeParts(step));
    const header = `source(${parts.join(', ')})`;
    if (step.content.tail.length === 0) {
      this.line(`${header};`);
    } else {
      this.open(`${header} {`);
      this.serializeEditorContentTail(step.content.tail);
      this.close();
    }
  }

  serializeLoopStep(step) {
    const parts = this.headerParts(step);
    if (step.barWidth !== undefined) parts.push(`barWidth=${step.barWidth}`);
    if (step.collapsed) parts.push('collapsed=true');
    if (step.change) parts.push(changeParamText(step.change));
    parts.push(...decoShadeParts(step));
    this.open(`${step.kind}(${parts.join(', ')}) {`);
    this.serializeAreaList(step.content.tail);
    for (const s of step.body) this.serializeStep(s);
    if (step.catchArea) this.serializeCatchArea(step.catchArea);
    this.close();
  }

  serializeIfElseStep(step) {
    const parts = this.headerParts(step);
    if (step.ifRatio !== undefined) parts.push(`ifRatio=${step.ifRatio}`);
    if (step.collapsed) parts.push('collapsed=true');
    if (step.change) parts.push(changeParamText(step.change));
    parts.push(...decoShadeParts(step));
    this.open(`ifElse(${parts.join(', ')}) {`);
    this.serializeAreaList(step.content.tail);
    this.serializeBranch('if_branch', step.ifBranch);
    this.serializeBranch('else_branch', step.elseBranch);
    this.close();
  }

  serializeIfStep(step) {
    const parts = this.headerParts(step);
    if (step.emptyWidth !== undefined) parts.push(`emptyWidth=${step.emptyWidth}`);
    if (step.collapsed) parts.push('collapsed=true');
    if (step.change) parts.push(changeParamText(step.change));
    parts.push(...decoShadeParts(step));
    this.open(`if(${parts.join(', ')}) {`);
    this.serializeAreaList(step.content.tail);
    this.serializeBranch('if_branch', step.ifBranch);
    this.close();
  }

  serializeCaseStep(step) {
    const parts = this.headerParts(step);
    if (step.cols) parts.push(`cols=[${step.cols.join(', ')}]`);
    if (step.collapsed) parts.push('collapsed=true');
    if (step.change) parts.push(changeParamText(step.change));
    parts.push(...decoShadeParts(step));
    this.open(`case(${parts.join(', ')}) {`);
    this.serializeAreaList(step.content.tail);
    this.serializeBranch('default_branch', step.defaultBranch);
    for (const b of step.caseBranches) this.serializeBranch('case_branch', b);
    this.close();
  }

  serializeSubsequenceStep(step) {
    const parts = this.headerParts(step);
    if (step.flat) parts.push('flat=true');
    if (step.collapsed) parts.push('collapsed=true');
    if (step.change) parts.push(changeParamText(step.change));
    parts.push(...decoShadeParts(step));
    this.open(`subsequence(${parts.join(', ')}) {`);
    this.serializeAreaList(step.content.tail);
    for (const s of step.body) this.serializeStep(s);
    if (step.catchArea) this.serializeCatchArea(step.catchArea);
    this.close();
  }

  serializeBranch(kw, branch) {
    const parts = [htmlContentText(branch.content.head)];
    if (branch.change) parts.push(changeParamText(branch.change));
    this.open(`${kw}(${parts.join(', ')}) {`);
    this.serializeAreaList(branch.content.tail);
    for (const s of branch.body) this.serializeStep(s);
    if (branch.catchArea) this.serializeCatchArea(branch.catchArea);
    this.close();
  }

  serializeCatchArea(catchArea) {
    const params = [];
    if (catchArea.collapsed) params.push('collapsed=true');
    if (catchArea.cols) params.push(`cols=[${catchArea.cols.join(', ')}]`);
    const header = params.length > 0 ? `catchArea(${params.join(', ')}) {` : 'catchArea {';
    this.open(header);
    for (const c of catchArea.catches) this.serializeCatchBlock(c);
    this.close();
  }

  serializeCatchBlock(catchBlock) {
    const parts = [catchBlock.breakStepNum, htmlContentText(catchBlock.content.head)];
    if (catchBlock.change) parts.push(changeParamText(catchBlock.change));
    if (catchBlock.headingWidth !== undefined) parts.push(`headingWidth=${catchBlock.headingWidth}`);
    this.open(`catch(${parts.join(', ')}) {`);
    this.serializeAreaList(catchBlock.content.tail);
    for (const cc of catchBlock.coCatches) this.serializeCoCatch(cc);
    for (const s of catchBlock.body) this.serializeStep(s);
    this.close();
  }

  serializeCoCatch(coCatch) {
    const parts = [coCatch.breakStepNum, htmlContentText(coCatch.content)];
    if (coCatch.change) parts.push(changeParamText(coCatch.change));
    this.line(`coCatch(${parts.join(', ')});`);
  }

  serializeSettings(settings) {
    this.open('settings {');
    if (settings.width !== undefined) this.line(`width=${settings.width}`);
    if (settings.zoom !== undefined) this.line(`zoom=${settings.zoom}`);
    if (settings.changeModeEnabled !== undefined) this.line(`changeModeEnabled=${settings.changeModeEnabled}`);
    if (settings.changeSetName !== undefined) this.line(`changeSetName=${settings.changeSetName}`);
    if (settings.pdfOptions) {
      this.open('pdfOptions {');
      const p = settings.pdfOptions;
      if (p.filename !== undefined) this.line(`filename=${wrapBacktick(p.filename)}`);
      if (p.modelFilename !== undefined) this.line(`modelFilename=${wrapBacktick(p.modelFilename)}`);
      if (p.pageSize !== undefined) this.line(`pageSize=${p.pageSize}`);
      if (p.portrait !== undefined) this.line(`portrait=${p.portrait}`);
      if (p.paging !== undefined) this.line(`paging=${p.paging}`);
      this.close();
    }
    this.close();
  }

  serializeIntroOutro(kw, node) {
    const header = `${kw}(${htmlContentText(node.head)}) {`;
    this.open(header);
    this.serializeAreaList(node.tail);
    this.close();
  }

  serializeMainSequence(mainSequence) {
    this.open('mainSequence {');
    for (const s of mainSequence.steps) this.serializeStep(s);
    if (mainSequence.catchArea) this.serializeCatchArea(mainSequence.catchArea);
    this.close();
  }
}

export function serializeDiagram(ast) {
  const envelopeObj = { specmanVersion: ast.envelope.specmanVersion, modelType: ast.envelope.modelType };
  const s = new Serializer();
  s.lines.push(`// ${JSON.stringify(envelopeObj)}`);
  if (ast.settings) { s.serializeSettings(ast.settings); s.lines.push(''); }
  if (ast.intro) { s.serializeIntroOutro('intro', ast.intro); s.lines.push(''); }
  s.serializeMainSequence(ast.mainSequence);
  if (ast.outro) { s.lines.push(''); s.serializeIntroOutro('outro', ast.outro); }
  s.lines.push('');
  return s.lines.join('\n');
}
