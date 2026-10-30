import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..", "kit");

export function kitScript() {
  return readFileSync(join(KIT, "iso-kit.mjs"), "utf8").replace(/^export /gm, "");
}
