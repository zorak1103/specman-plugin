// versions.mjs — dotted-version helpers shared by resolve-jar.mjs (jar vs. spec) and nsd-ast.mjs
// (spec vs. the model format this plugin knows).

// Only the leading numeric dotted part counts: "1.4.0-SNAPSHOT" and "1.4.0" compare equal, so a
// pre-release suffix never produces NaN (and thereby a bogus "newer" verdict).
function numericParts(version) {
  const m = version.match(/^\d+(?:\.\d+)*/);
  return m ? m[0].split('.').map(Number) : [];
}

/** Numeric dotted-version comparison; missing components count as 0. Returns <0, 0 or >0. */
export function compareVersions(a, b) {
  const pa = numericParts(a);
  const pb = numericParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
