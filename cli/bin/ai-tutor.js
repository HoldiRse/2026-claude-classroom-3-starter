#!/usr/bin/env node
// Committed wrapper, so `npm install` can link the bin before build.mjs has
// produced dist/. The build is the `prepare` script, which npm runs for a
// workspace on install.
try {
  await import("../dist/ai-tutor.js");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
  process.stderr.write(
    "error: ai-tutor is not built yet — run `npm run build -w ai-tutor-cli`\n",
  );
  process.exit(1);
}
