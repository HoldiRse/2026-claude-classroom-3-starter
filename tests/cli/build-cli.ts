import { build } from "../../cli/build.mjs";

/** The suite runs `cli/dist`, so build it rather than trust a stale one. */
export default async function setup() {
  await build();
}
