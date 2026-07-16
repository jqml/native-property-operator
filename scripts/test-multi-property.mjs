import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const Empty = class {};
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    return {
      FuzzySuggestModal: Empty,
      Modal: Empty,
      Notice: Empty,
      Plugin: Empty,
      PluginSettingTab: Empty,
      Setting: Empty,
      TFile: class TFile {},
      TFolder: class TFolder {},
      ToggleComponent: Empty,
      normalizePath: (value) => value
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginModule = require("../main.js");
Module._load = originalLoad;
const {
  ACTIONS,
  PROPERTY_TYPES,
  TARGETS,
  applyOperations,
  emptyResult,
  evaluateOperations,
  normalizeAction,
  normalizeSettings,
  validateAction
} = pluginModule;

const legacy = normalizeSettings({
  manualActions: [{
    id: "manual-legacy",
    name: "Legacy manual",
    operation: ACTIONS.ADD,
    targetType: TARGETS.FILE,
    targetPath: "note.md",
    propertyName: "priority",
    propertyType: PROPERTY_TYPES.NUMBER,
    value: "2",
    overwrite: false,
    customField: { keep: true }
  }],
  autoActions: [{
    id: "auto-legacy",
    name: "Legacy auto",
    enabled: true,
    targetType: TARGETS.FOLDER,
    targetFolder: "Inbox",
    propertyName: "created",
    value: "yes",
    lastRunKey: "old-run",
    autoTargets: [{ path: "Inbox", recursive: true }],
    unrelated: "preserve"
  }]
});
assert.deepEqual(legacy.manualActions[0].operations, [{ propertyName: "priority", propertyType: PROPERTY_TYPES.NUMBER, value: "2" }]);
assert.equal(legacy.manualActions[0].propertyName, undefined);
assert.equal(legacy.manualActions[0].customField.keep, true);
assert.equal(legacy.autoActions[0].enabled, true);
assert.equal(legacy.autoActions[0].trigger, "created-or-moved-into-folder");
assert.equal(legacy.autoActions[0].lastRunKey, "old-run");
assert.deepEqual(legacy.autoActions[0].autoTargets, [{ path: "Inbox", recursive: true }]);
assert.deepEqual(normalizeSettings(legacy), legacy, "migration is idempotent");

function action(operation, operations, extra = {}) {
  return normalizeAction({ id: `test-${operation}`, name: "test", operation, operations, ...extra });
}
function run(frontmatter, currentAction) {
  const result = emptyResult();
  const decisions = evaluateOperations(frontmatter, currentAction, { automatic: Boolean(currentAction.trigger) });
  applyOperations(frontmatter, currentAction, decisions, result, "note.md");
  return { decisions, result };
}

let currentAction = action(ACTIONS.ADD, [
  { propertyName: "one", propertyType: PROPERTY_TYPES.TEXT, value: "a" },
  { propertyName: "count", propertyType: PROPERTY_TYPES.NUMBER, value: "3" }
], { overwrite: false });
let result = run({}, currentAction).result;
assert.deepEqual(result.operationsChanged, 2);
assert.deepEqual(result.operationsSkipped, 0);

const missingOnly = action(ACTIONS.ADD, [{ propertyName: "existing", propertyType: PROPERTY_TYPES.TEXT, value: "replace" }], { overwrite: false });
assert.equal(run({ existing: "keep" }, missingOnly).result.operationsSkipped, 1, "addMissingOnly keeps existing values");

currentAction = action(ACTIONS.REMOVE, [{ propertyName: "one" }, { propertyName: "missing" }]);
result = run({ one: "a" }, currentAction).result;
assert.equal(result.operationsChanged, 1);
assert.equal(result.operationsSkipped, 1);

currentAction = action(ACTIONS.SET, [
  { propertyName: "one", propertyType: PROPERTY_TYPES.TEXT, value: "b" },
  { propertyName: "two", propertyType: PROPERTY_TYPES.TEXT, value: "c" }
], { addIfMissing: true });
const setFrontmatter = { one: "a" };
result = run(setFrontmatter, currentAction).result;
assert.deepEqual(setFrontmatter, { one: "b", two: "c" });
assert.equal(result.operationsChanged, 2);

currentAction = action(ACTIONS.TYPE, [
  { propertyName: "date", propertyType: PROPERTY_TYPES.DATE, normalizeValues: true },
  { propertyName: "bad", propertyType: PROPERTY_TYPES.DATETIME, normalizeValues: true }
]);
const typedFrontmatter = { date: "2026-07-15T13:45:22", bad: "not a date" };
const typedRun = run(typedFrontmatter, currentAction);
assert.equal(typedFrontmatter.date, "2026-07-15");
assert.equal(typedFrontmatter.bad, "not a date");
assert.equal(typedRun.result.operationsChanged, 1);
assert.equal(typedRun.result.skippedIncompatible, 1);

const failedFrontmatter = new Proxy({}, {
  set(target, property, value) {
    if (property === "bad") throw new Error("simulated property write failure");
    target[property] = value;
    return true;
  }
});
const failedRun = run(failedFrontmatter, action(ACTIONS.ADD, [
  { propertyName: "good", propertyType: PROPERTY_TYPES.TEXT, value: "kept" },
  { propertyName: "bad", propertyType: PROPERTY_TYPES.TEXT, value: "rejected" }
]));
assert.equal(failedFrontmatter.good, "kept");
assert.equal(failedRun.result.operationsChanged, 1);
assert.equal(failedRun.result.operationsFailed, 1);

const typePlugin = Object.create(pluginModule.default.prototype);
let typesJson = "";
typePlugin.app = {
  vault: {
    configDir: "vault-config",
    adapter: {
      exists: async () => false,
      read: async () => "",
      write: async (_path, value) => { typesJson = value; }
    }
  },
  fileManager: {
    processFrontMatter: async (_file, callback) => callback({ date: "2026-07-15" })
  }
};
await typePlugin.applyAction(action(ACTIONS.TYPE, [{ propertyName: "date", propertyType: PROPERTY_TYPES.DATE }]), [{ file: {}, path: "note.md", status: "changed", operations: [] }]);
assert.equal(JSON.parse(typesJson).types.date, "date", "type action synchronizes native types.json");

let automaticTypesWrites = 0;
const automaticTypePlugin = Object.create(pluginModule.default.prototype);
automaticTypePlugin.app = {
  vault: {
    configDir: "vault-config",
    adapter: {
      exists: async () => false,
      read: async () => "",
      write: async () => { automaticTypesWrites += 1; }
    }
  },
  fileManager: {
    processFrontMatter: async (_file, callback) => callback({ bad: "not a date" })
  }
};
const automaticTypeResult = await automaticTypePlugin.applyAction(
  action(ACTIONS.TYPE, [{ propertyName: "bad", propertyType: PROPERTY_TYPES.DATE }], { trigger: "created-or-moved-into-folder" }),
  [{ file: {}, path: "Inbox/bad.md", status: "skipped", operations: [] }]
);
assert.equal(automaticTypesWrites, 0, "automatic incompatible type skips native registry synchronization");
assert.equal(automaticTypeResult.registrySkipped, 1);

let manualTypesWrites = 0;
const manualTypePlugin = Object.create(pluginModule.default.prototype);
manualTypePlugin.app = {
  vault: {
    configDir: "vault-config",
    adapter: {
      exists: async () => false,
      read: async () => "",
      write: async () => { manualTypesWrites += 1; }
    }
  },
  fileManager: {
    processFrontMatter: async (_file, callback) => callback({ bad: "not a date" })
  }
};
await manualTypePlugin.applyAction(
  action(ACTIONS.TYPE, [{ propertyName: "bad", propertyType: PROPERTY_TYPES.DATE }]),
  [{ file: {}, path: "note.md", status: "skipped", operations: [] }],
  { allowIncompatibleTypeChange: true }
);
assert.equal(manualTypesWrites, 1, "manual incompatible type requires and honors explicit confirmation");

currentAction = action(ACTIONS.ADD, [
  { propertyName: "safe", propertyType: PROPERTY_TYPES.TEXT, value: "new" },
  { propertyName: "existing", propertyType: PROPERTY_TYPES.TEXT, value: "unsafe" }
], { trigger: "created-or-moved-into-folder", overwrite: true });
const autoFrontmatter = { existing: "keep" };
let callbacks = 0;
const fakePlugin = Object.create(pluginModule.default.prototype);
fakePlugin.app = { fileManager: { processFrontMatter: async (_file, callback) => { callbacks += 1; callback(autoFrontmatter); } } };
const autoResult = await fakePlugin.applyAction(currentAction, [{ file: {}, path: "Inbox/new.md", status: "changed", operations: [] }]);
assert.equal(callbacks, 1, "one processFrontMatter call per automatic target file");
assert.equal(autoFrontmatter.existing, "keep", "automatic overwrite remains safe");
assert.equal(autoFrontmatter.safe, "new");
assert.equal(autoResult.changed, 1, "one file changed");
assert.equal(autoResult.operationsChanged, 1);
assert.equal(autoResult.operationsSkipped, 1);

const cycle = action(ACTIONS.RENAME, [
  { propertyName: "a", newPropertyName: "b" },
  { propertyName: "b", newPropertyName: "a" }
]);
assert.match(validateAction(cycle, "manual"), /cycle/i);
const duplicateDestination = action(ACTIONS.RENAME, [
  { propertyName: "a", newPropertyName: "c" },
  { propertyName: "b", newPropertyName: "c" }
]);
assert.match(validateAction(duplicateDestination, "manual"), /destination/i);
assert.match(validateAction(action(ACTIONS.ADD, [
  { propertyName: "same", propertyType: PROPERTY_TYPES.TEXT, value: "a" },
  { propertyName: "same", propertyType: PROPERTY_TYPES.TEXT, value: "b" }
]), "manual"), /more than once/i);
assert.match(validateAction(action(ACTIONS.ADD, [{ propertyName: "checked", propertyType: PROPERTY_TYPES.CHECKBOX, value: "maybe" }]), "manual"), /Checkbox/i);
assert.match(validateAction(action(ACTIONS.ADD, [{ propertyName: "tags", propertyType: PROPERTY_TYPES.TAGS, value: "two words" }]), "manual"), /Tags/i);
const renameChainFrontmatter = { a: 1, b: 2 };
const renameChainResult = run(renameChainFrontmatter, action(ACTIONS.RENAME, [
  { propertyName: "a", newPropertyName: "b" },
  { propertyName: "b", newPropertyName: "c" }
])).result;
assert.deepEqual(renameChainFrontmatter, { b: 1, c: 2 });
assert.equal(renameChainResult.operationsChanged, 2);
const automaticRenameFrontmatter = { old: "value", destination: "keep" };
const automaticRename = action(ACTIONS.RENAME, [{ propertyName: "old", newPropertyName: "destination" }], { trigger: "created-or-moved-into-folder", overwrite: true });
assert.equal(run(automaticRenameFrontmatter, automaticRename).result.operationsSkipped, 1);
assert.equal(automaticRenameFrontmatter.destination, "keep");

const source = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
assert.match(source, /vault\.on\("create"/);
assert.match(source, /vault\.on\("rename"/);
assert.doesNotMatch(source, /vault\.on\("modify"/);
assert.match(source, /confirmOverwrite/);
assert.match(source, /eventName === "create"/);
assert.match(source, /eventName === "rename"/);
assert.match(source, /autoRunKeys/);
assert.match(source, /lastRunKey/);
