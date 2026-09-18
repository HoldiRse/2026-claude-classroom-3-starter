import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

/**
 * One bundle, because @ai-tutor/todo-api-schema ships TypeScript source that
 * node cannot load through a workspace link. The runtime dependencies in
 * package.json stay external and are resolved from node_modules as usual, so
 * only this repo's own code is inlined.
 */
export async function build() {
  await esbuild({
    absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
    entryPoints: ["src/ai-tutor.ts"],
    outfile: "dist/ai-tutor.js",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: [
      "commander",
      "better-auth",
      "better-auth/*",
      "zod",
      "@modelcontextprotocol/server",
      "@modelcontextprotocol/server/*",
    ],
    logLevel: "warning",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await build();
}
