const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const REQUIRE_BANNER = {
  js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
};

function bundleServer(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "server.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(outDir, "server.js"),
    target: "node18",
  });
}

function bundleMcp(outDir) {
  const mcpOutDir = path.join(outDir, "mcp");
  fs.mkdirSync(mcpOutDir, { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "mcp", "create-ticket-server.mjs")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: path.join(mcpOutDir, "create-ticket-server.mjs"),
    target: "node18",
    // dotenv (and any other CJS dep) calls require() internally; esbuild's
    // ESM output has no ambient require, so give it one via createRequire.
    banner: REQUIRE_BANNER,
  });
}

function bundleServerResources(outDir) {
  bundleServer(outDir);
  bundleMcp(outDir);
}

module.exports = { bundleServerResources };

if (require.main === module) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("Usage: node scripts/bundle-server.js <outDir>");
    process.exit(1);
  }
  bundleServerResources(path.resolve(outDir));
}
