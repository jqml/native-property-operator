import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vault = path.join(os.homedir(), "Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian Pro");
const target = path.join(vault, ".obsidian/plugins/native-property-operator");
const assets = ["main.js", "manifest.json", "styles.css"];
const manifest = JSON.parse(await fs.readFile(path.join(target, "manifest.json"), "utf8"));
if (manifest.id !== "native-property-operator") throw new Error("Unexpected destination plugin");
for (const root of [target, ...assets.map((asset) => path.join(target, asset))]) {
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error(`Refusing to replace a linked path: ${root}`);
}
for (const asset of assets) await fs.access(path.join(source, asset));
const backup = path.join(os.homedir(), "Backups/obsidian-plugins", `${new Date().toISOString().replace(/[:.]/g, "-")}-native-property-operator`);
await fs.mkdir(backup, { recursive: true });
await fs.cp(target, path.join(backup, "pro-plugin-before"), { recursive: true });
// Only the three release assets are deployed. data.json and other vault settings stay in place.
for (const asset of assets) {
  const temporary = path.join(target, `${asset}.npo-staging`);
  await fs.copyFile(path.join(source, asset), temporary);
  await fs.rename(temporary, path.join(target, asset));
}
process.stdout.write(`Installed in ${target}\nBackup: ${backup}\nReload with: obsidian vault="Obsidian Pro" plugin:reload id=native-property-operator\n`);
