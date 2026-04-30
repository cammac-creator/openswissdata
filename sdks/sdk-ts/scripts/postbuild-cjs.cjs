/**
 * Post-build step for the CJS bundle.
 *
 * The package's `"type": "module"` declaration in the root `package.json`
 * forces Node to treat every `.js` file as ESM. Two fixes are common:
 *
 *   1. Drop a tiny `package.json` with `"type": "commonjs"` inside `dist/cjs/`
 *      so Node uses CJS resolution for that subtree.
 *   2. Rename the entry to `.cjs` and rewrite imports.
 *
 * (1) is simpler and keeps relative imports stable, so that's what we do.
 *
 * The package's `exports` map declares `dist/cjs/index.cjs` as the CJS entry,
 * so we also create that as a one-line re-export of `index.js`.
 */

const fs = require("node:fs");
const path = require("node:path");

const cjsDir = path.join(__dirname, "..", "dist", "cjs");
if (!fs.existsSync(cjsDir)) {
  console.error("dist/cjs/ does not exist — run `tsc -p tsconfig.cjs.json` first");
  process.exit(1);
}

// 1. Mark the subtree as CommonJS so Node ignores the root "type": "module".
fs.writeFileSync(
  path.join(cjsDir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2),
);

// 2. Provide the .cjs entry the package.json `exports` map points to.
const indexJs = path.join(cjsDir, "index.js");
const indexCjs = path.join(cjsDir, "index.cjs");
if (fs.existsSync(indexJs)) {
  fs.writeFileSync(indexCjs, "module.exports = require('./index.js');\n");
}

console.log("postbuild-cjs: dist/cjs ready (commonjs marker + index.cjs)");
