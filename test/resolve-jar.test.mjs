import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveJarPath,
  parseJarVersion,
  compareVersions,
  specVersionWarning,
  MIN_SUPPORTED_VERSION,
} from '../scripts/resolve-jar.mjs';

// A file that starts with the ZIP local-file-header magic is all the validator can reasonably
// demand without opening the archive (a jar is a ZIP).
const ZIP_STUB = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('stub')]);

function withTempJar(fileName, content, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'specman-'));
  const jarPath = path.join(dir, fileName);
  writeFileSync(jarPath, content);
  try {
    return fn(jarPath, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('resolveJarPath returns the path and version when SPECMAN_JAR is a valid current jar', () => {
  withTempJar('specman-1.4.0-jar-with-dependencies.jar', ZIP_STUB, (jarPath) => {
    const result = resolveJarPath({ SPECMAN_JAR: jarPath });
    assert.equal(result.ok, true);
    assert.equal(result.path, jarPath);
    assert.equal(result.version, '1.4.0');
    assert.deepEqual(result.warnings, []);
  });
});

test('resolveJarPath fails clearly when SPECMAN_JAR is not set', () => {
  const result = resolveJarPath({});
  assert.equal(result.ok, false);
  assert.match(result.error, /SPECMAN_JAR/);
  assert.match(result.error, /nicht gesetzt/);
});

test('resolveJarPath treats a blank SPECMAN_JAR like an unset one', () => {
  const result = resolveJarPath({ SPECMAN_JAR: '   ' });
  assert.equal(result.ok, false);
  assert.match(result.error, /nicht gesetzt/);
});

test('resolveJarPath fails clearly when SPECMAN_JAR points at a nonexistent file', () => {
  const result = resolveJarPath({ SPECMAN_JAR: 'C:/nonexistent/specman.jar' });
  assert.equal(result.ok, false);
  assert.match(result.error, /nicht gefunden/);
});

test('resolveJarPath rejects a SPECMAN_JAR that points at a directory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'specman-'));
  const jarDir = path.join(dir, 'specman-1.4.0-jar-with-dependencies.jar');
  mkdirSync(jarDir);
  try {
    const result = resolveJarPath({ SPECMAN_JAR: jarDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /Verzeichnis/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveJarPath rejects a SPECMAN_JAR that is not a .jar file', () => {
  withTempJar('README.adoc', ZIP_STUB, (p) => {
    const result = resolveJarPath({ SPECMAN_JAR: p });
    assert.equal(result.ok, false);
    assert.match(result.error, /\.jar/);
  });
});

test('resolveJarPath rejects a .jar file that is not a ZIP archive', () => {
  withTempJar('specman-1.4.0-jar-with-dependencies.jar', 'not a real jar', (p) => {
    const result = resolveJarPath({ SPECMAN_JAR: p });
    assert.equal(result.ok, false);
    assert.match(result.error, /kein gültiges Jar|ZIP/);
  });
});

test('resolveJarPath strips surrounding quotes from SPECMAN_JAR and warns about them', () => {
  withTempJar('specman-1.4.0-jar-with-dependencies.jar', ZIP_STUB, (jarPath) => {
    const result = resolveJarPath({ SPECMAN_JAR: `"${jarPath}"` });
    assert.equal(result.ok, true);
    assert.equal(result.path, jarPath);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /Anführungszeichen/);
  });
});

test('resolveJarPath warns when the jar is older than the minimum supported version', () => {
  withTempJar('specman-1.3.1-jar-with-dependencies.jar', ZIP_STUB, (jarPath) => {
    const result = resolveJarPath({ SPECMAN_JAR: jarPath });
    assert.equal(result.ok, true);
    assert.equal(result.version, '1.3.1');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], new RegExp(MIN_SUPPORTED_VERSION.replace(/\./g, '\\.')));
  });
});

test('resolveJarPath warns when the version cannot be read from the file name', () => {
  withTempJar('specman.jar', ZIP_STUB, (jarPath) => {
    const result = resolveJarPath({ SPECMAN_JAR: jarPath });
    assert.equal(result.ok, true);
    assert.equal(result.version, null);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /Version/);
  });
});

test('parseJarVersion reads the version from the standard jar file name', () => {
  assert.equal(parseJarVersion('D:/apps/specman-1.4.0-jar-with-dependencies.jar'), '1.4.0');
  assert.equal(parseJarVersion('C:\\apps\\specman-1.10.2-jar-with-dependencies.jar'), '1.10.2');
  assert.equal(parseJarVersion('specman-1.5-SNAPSHOT-jar-with-dependencies.jar'), '1.5');
  assert.equal(parseJarVersion('specman.jar'), null);
});

test('compareVersions orders numerically, not lexically', () => {
  assert.equal(compareVersions('1.4.0', '1.4.0'), 0);
  assert.ok(compareVersions('1.3.1', '1.4.0') < 0);
  assert.ok(compareVersions('1.10.0', '1.4.0') > 0);
  assert.equal(compareVersions('1.4', '1.4.0'), 0);
});

test('specVersionWarning flags a spec written by a newer Specman than the jar', () => {
  assert.match(specVersionWarning('1.3.1', '1.4.0'), /1\.4\.0/);
  assert.equal(specVersionWarning('1.4.0', '1.4.0'), null);
  assert.equal(specVersionWarning('1.4.0', '1.3.0'), null);
  assert.equal(specVersionWarning(null, '1.4.0'), null);
  assert.equal(specVersionWarning('1.4.0', undefined), null);
});

test('compareVersions ignores a pre-release suffix instead of returning NaN', () => {
  assert.equal(compareVersions('1.4.0-SNAPSHOT', '1.4.0'), 0);
  assert.ok(compareVersions('1.5.0-rc1', '1.4.0') > 0);
});

test('specVersionWarning does not warn for a SNAPSHOT spec saved by a same-version jar', () => {
  assert.equal(specVersionWarning('1.4.0', '1.4.0-SNAPSHOT'), null);
});
