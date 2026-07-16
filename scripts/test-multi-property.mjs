import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const Empty = class {};
class MockTFile {
  constructor(path) {
    this.path = path;
    this.extension = path.includes(".") ? path.split(".").pop() : "";
    this.parent = null;
  }
}
class MockTFolder {
  constructor(path) {
    this.path = path;
    this.children = [];
    this.parent = null;
  }
}
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    return {
      FuzzySuggestModal: Empty,
      Modal: Empty,
      Notice: Empty,
      Plugin: Empty,
      PluginSettingTab: Empty,
      Setting: Empty,
      TFile: MockTFile,
      TFolder: MockTFolder,
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
  buildActionPreviewState,
  buildOperationEditorModel,
  calculateInlineSuggestHorizontalGeometry,
  captureModalScrollState,
  convertOperationsForOperation,
  emptyResult,
  evaluateOperations,
  filterExistingPropertyCandidates,
  filterOperationPropertyCandidates,
  focusWithoutScroll,
  getUnavailablePropertyNames,
  normalizeAction,
  normalizeAutoTargets,
  normalizeSettings,
  normalizeTargets,
  restoreModalScrollState,
  revealOperationCardWithoutJump,
  targetMatchesPath,
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
assert.deepEqual(legacy.manualActions[0].targets, [{ type: TARGETS.FILE, path: "note.md" }]);
assert.equal(legacy.autoActions[0].enabled, true);
assert.equal(legacy.autoActions[0].trigger, "created-or-moved-into-folder");
assert.equal(legacy.autoActions[0].lastRunKey, "old-run");
assert.equal(legacy.autoActions[0].unrelated, "preserve");
assert.deepEqual(legacy.autoActions[0].autoTargets, [{ type: TARGETS.FOLDER, path: "Inbox" }]);
assert.deepEqual(normalizeSettings(legacy), legacy, "migration is idempotent");

const migratedFolderTargets = normalizeTargets([
  "publish/essays",
  { id: "root-target", type: TARGETS.FOLDER, path: "/", recursive: false, custom: "keep" },
  { id: "file-target", type: TARGETS.FILE, path: "notes/example.md" }
]);
assert.deepEqual(migratedFolderTargets, [
  { type: TARGETS.FOLDER, path: "publish/essays" },
  { id: "root-target", type: TARGETS.FOLDER, path: "/", custom: "keep" },
  { id: "file-target", type: TARGETS.FILE, path: "notes/example.md" }
], "string and recursive:false targets normalize to ordered all-descendant typed targets while preserving IDs and unknown fields");
assert.deepEqual(normalizeTargets(migratedFolderTargets), migratedFolderTargets, "target migration is idempotent");
assert.deepEqual(normalizeAutoTargets([{ id: "auto-folder", path: "Inbox", recursive: false }]), [
  { id: "auto-folder", type: TARGETS.FOLDER, path: "Inbox" }
], "legacy automatic folder targets migrate to the shared schema");
assert.deepEqual(normalizeAutoTargets("Archive"), [{ type: TARGETS.FOLDER, path: "Archive" }], "scalar string folder targets remain accepted");
assert.deepEqual(normalizeAction({
  id: "legacy-folder-path",
  name: "Legacy folder path",
  operation: ACTIONS.REMOVE,
  operations: [{ propertyName: "title" }],
  target: TARGETS.FOLDER,
  folderPath: "publish/essays"
}).targets, [{ type: TARGETS.FOLDER, path: "publish/essays" }], "old imported folderPath configurations remain accepted");
assert.deepEqual(normalizeAction({
  id: "auto-shared-targets",
  name: "Auto shared targets",
  operation: ACTIONS.REMOVE,
  operations: [{ propertyName: "title" }],
  targets: [{ id: "shared", type: TARGETS.FILE, path: "note.md" }]
}, "auto").autoTargets, [{ id: "shared", type: TARGETS.FILE, path: "note.md" }], "automatic imports using the shared targets field remain accepted");
assert.deepEqual(normalizeTargets([
  { type: TARGETS.FOLDER, path: "one" },
  { type: TARGETS.FOLDER, path: "two" },
  { type: TARGETS.FOLDER, path: "one" }
]).map((target) => target.path), ["one", "two"], "duplicate targets are blocked without changing stable order");

function action(operation, operations, extra = {}) {
  return normalizeAction({ id: `test-${operation}`, name: "test", operation, operations, ...extra });
}
function run(frontmatter, currentAction) {
  const result = emptyResult();
  const decisions = evaluateOperations(frontmatter, currentAction, { automatic: Boolean(currentAction.trigger) });
  applyOperations(frontmatter, currentAction, decisions, result, "note.md");
  return { decisions, result };
}

function addFolder(parent, path, byPath) {
  const folder = new MockTFolder(path);
  folder.parent = parent;
  parent.children.push(folder);
  byPath.set(path, folder);
  return folder;
}

function addFile(parent, path, byPath) {
  const file = new MockTFile(path);
  file.parent = parent;
  parent.children.push(file);
  byPath.set(path, file);
  return file;
}

const rootFolder = new MockTFolder("");
const vaultEntries = new Map([["", rootFolder]]);
addFile(rootFolder, "root.md", vaultEntries);
const publishFolder = addFolder(rootFolder, "publish", vaultEntries);
const essaysFolder = addFolder(publishFolder, "publish/essays", vaultEntries);
addFile(essaysFolder, "publish/essays/post.md", vaultEntries);
const archiveFolder = addFolder(essaysFolder, "publish/essays/archive", vaultEntries);
addFile(archiveFolder, "publish/essays/archive/old.md", vaultEntries);
const yearFolder = addFolder(archiveFolder, "publish/essays/archive/2025", vaultEntries);
addFile(yearFolder, "publish/essays/archive/2025/deep.md", vaultEntries);
addFile(essaysFolder, "publish/essays/image.png", vaultEntries);
const otherFolder = addFolder(rootFolder, "other-folder", vaultEntries);
addFile(otherFolder, "other-folder/file.md", vaultEntries);
const configFolder = addFolder(rootFolder, "vault-config", vaultEntries);
addFile(configFolder, "vault-config/internal.md", vaultEntries);
const dotFolder = addFolder(rootFolder, ".hidden", vaultEntries);
addFile(dotFolder, ".hidden/secret.md", vaultEntries);
const excludedFolder = addFolder(rootFolder, "excluded", vaultEntries);
addFile(excludedFolder, "excluded/skip.md", vaultEntries);

const targetPlugin = Object.create(pluginModule.default.prototype);
targetPlugin.settings = { excludedFolders: ["excluded"], properties: [] };
targetPlugin.app = {
  vault: {
    configDir: "vault-config",
    getRoot: () => rootFolder,
    getAbstractFileByPath: (path) => vaultEntries.get(path === "/" ? "" : path) || null,
    getMarkdownFiles: () => Array.from(vaultEntries.values()).filter((entry) => entry instanceof MockTFile && entry.extension === "md")
  },
  workspace: { getActiveFile: () => vaultEntries.get("publish/essays/post.md") }
};

assert.deepEqual(targetPlugin.getRecursiveMarkdownFilesByPath("/").map((file) => file.path), [
  "other-folder/file.md",
  "publish/essays/archive/2025/deep.md",
  "publish/essays/archive/old.md",
  "publish/essays/post.md",
  "root.md"
], "vault root includes all eligible Markdown descendants and excludes config, dot, excluded, and non-Markdown files");
assert.deepEqual(targetPlugin.getRecursiveMarkdownFilesByPath("publish/essays").map((file) => file.path), [
  "publish/essays/archive/2025/deep.md",
  "publish/essays/archive/old.md",
  "publish/essays/post.md"
], "selected folders include every eligible descendant and exclude files outside the tree");
assert.deepEqual(targetPlugin.resolveConfiguredTargets([
  { type: TARGETS.FOLDER, path: "publish/essays" },
  { type: TARGETS.FOLDER, path: "other-folder" },
  { type: TARGETS.FILE, path: "publish/essays/archive/2025/deep.md" },
  { type: TARGETS.FILE, path: "root.md" }
]).map((file) => file.path), [
  "other-folder/file.md",
  "publish/essays/archive/2025/deep.md",
  "publish/essays/archive/old.md",
  "publish/essays/post.md",
  "root.md"
], "multiple folders and files combine without duplicates while preserving exact file targets");
assert.deepEqual(targetPlugin.resolveTargetFiles(normalizeAction({
  id: "root-action",
  name: "Root",
  operation: ACTIONS.REMOVE,
  operations: [{ propertyName: "title" }],
  targetType: TARGETS.SPECIFIC_TARGETS,
  targets: [{ type: TARGETS.FOLDER, path: "/" }]
})).map((file) => file.path), targetPlugin.getRecursiveMarkdownFilesByPath("/").map((file) => file.path));
assert.deepEqual(targetPlugin.resolveTargetFiles(normalizeAction({
  id: "auto-root-action",
  name: "Auto root",
  trigger: "created-or-moved-into-folder",
  operation: ACTIONS.REMOVE,
  operations: [{ propertyName: "title" }],
  autoTargets: [{ type: TARGETS.FOLDER, path: "/" }]
}, "auto")).map((file) => file.path), targetPlugin.getRecursiveMarkdownFilesByPath("/").map((file) => file.path), "automatic editor and preview resolution uses the same all-descendant target resolver");
assert.equal(targetMatchesPath({ type: TARGETS.FOLDER, path: "publish/essays" }, "publish/essays/archive/2025/deep.md"), true);
assert.equal(targetMatchesPath({ type: TARGETS.FOLDER, path: "publish/essays" }, "other-folder/file.md"), false);
assert.equal(targetMatchesPath({ type: TARGETS.FOLDER, path: "/" }, "publish/essays/post.md"), true);
assert.equal(targetMatchesPath({ type: TARGETS.FILE, path: "root.md" }, "root.md"), true);

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

const exactRemovalFrontmatter = {
  title: "Second post",
  status: "growing",
  heroImage: "/blog-placeholder.jpg",
  Title: "Case-sensitive property"
};
let removalCallbacks = 0;
const removalPlugin = Object.create(pluginModule.default.prototype);
removalPlugin.app = {
  fileManager: {
    processFrontMatter: async (_file, callback) => {
      removalCallbacks += 1;
      callback(exactRemovalFrontmatter);
    }
  }
};
const exactRemovalResult = await removalPlugin.applyAction(
  action(ACTIONS.REMOVE, [{ propertyName: "title" }, { propertyName: "status" }]),
  [{ file: {}, path: "post.md", status: "changed", operations: [] }]
);
assert.deepEqual(exactRemovalFrontmatter, {
  heroImage: "/blog-placeholder.jpg",
  Title: "Case-sensitive property"
}, "exact removal deletes only configured keys and preserves unrelated or differently cased keys");
assert.equal(removalCallbacks, 1, "all removals use one processFrontMatter callback per target file");
assert.equal(exactRemovalResult.filesChanged, 1);
assert.equal(exactRemovalResult.operationsChanged, 2);

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
const automaticSetFrontmatter = { existing: "keep" };
const automaticSetResult = run(automaticSetFrontmatter, action(ACTIONS.SET, [
  { propertyName: "existing", propertyType: PROPERTY_TYPES.TEXT, value: "replace" },
  { propertyName: "new", propertyType: PROPERTY_TYPES.TEXT, value: "added" }
], { trigger: "created-or-moved-into-folder", addIfMissing: true })).result;
assert.deepEqual(automaticSetFrontmatter, { existing: "keep", new: "added" }, "automatic Set skips overwrite conflicts while applying independent safe rows");
assert.equal(automaticSetResult.operationsChanged, 1);
assert.equal(automaticSetResult.operationsSkipped, 1);

const automaticFolderAction = {
  trigger: "created-or-moved-into-folder",
  autoTargets: [{ type: TARGETS.FOLDER, path: "publish/essays" }]
};
assert.equal(targetPlugin.autoActionMatches(automaticFolderAction, vaultEntries.get("publish/essays/archive/2025/deep.md"), "create", ""), true, "automatic create trigger matches nested descendants");
assert.equal(targetPlugin.autoActionMatches(automaticFolderAction, vaultEntries.get("publish/essays/post.md"), "rename", "other-folder/post.md"), true, "automatic rename trigger matches a move into the selected tree");
assert.equal(targetPlugin.autoActionMatches(automaticFolderAction, vaultEntries.get("publish/essays/post.md"), "rename", "publish/essays/archive/post.md"), false, "moves within the same selected tree are not duplicate moved-into-folder runs");
assert.equal(targetPlugin.autoActionMatches({
  trigger: "created-or-moved-into-folder",
  autoTargets: [{ type: TARGETS.FILE, path: "root.md" }]
}, vaultEntries.get("root.md"), "create", ""), true, "automatic exact-file targets are supported by the shared target schema");

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
const duplicateManualError = validateAction(action(ACTIONS.ADD, [
  { propertyName: "same", propertyType: PROPERTY_TYPES.TEXT, value: "a" },
  { propertyName: "same", propertyType: PROPERTY_TYPES.TEXT, value: "b" }
]), "manual");
assert.match(duplicateManualError, /Property 2 duplicates Property 1/i, "manual duplicate validation identifies both conflicting rows");
assert.match(duplicateManualError, /more than once/i);
const duplicateAutomaticError = validateAction(action(ACTIONS.REMOVE, [
  { propertyName: "same" },
  { propertyName: "same" }
], {
  trigger: "created-or-moved-into-folder",
  autoTargets: [{ type: TARGETS.FOLDER, path: "/" }]
}), "auto");
assert.match(duplicateAutomaticError, /Property 2 duplicates Property 1/i, "automatic actions use the same row-specific duplicate validation");
const duplicateExecutionPlugin = Object.create(pluginModule.default.prototype);
let duplicatePreviewCalled = false;
duplicateExecutionPlugin.previewAction = async () => {
  duplicatePreviewCalled = true;
  return [];
};
duplicateExecutionPlugin.saveSettings = async () => {};
const duplicateExecutionAction = action(ACTIONS.REMOVE, [
  { propertyName: "same" },
  { propertyName: "same" }
], {
  trigger: "created-or-moved-into-folder",
  autoTargets: [{ type: TARGETS.FOLDER, path: "/" }]
});
const duplicateExecutionResult = await duplicateExecutionPlugin.previewAndApplyAction(duplicateExecutionAction, null, true);
assert.equal(duplicatePreviewCalled, false, "automatic Preview and Apply stop before resolving files when duplicate source rows fail validation");
assert.equal(duplicateExecutionResult.failed, 1);
assert.equal(duplicateExecutionResult.operationsFailed, 2, "blocked automatic execution reports every invalid duplicate operation row");
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

const oneCardModel = buildOperationEditorModel(ACTIONS.ADD, [
  { propertyName: "one", propertyType: PROPERTY_TYPES.TEXT, value: "a" }
]);
assert.equal(oneCardModel.cards.length, 1, "one operation renders one card model");
assert.equal(oneCardModel.cards[0].title, "Property 1");
assert.deepEqual(oneCardModel.cards[0].fields, ["Property", "Type", "Value"]);
assert.equal(oneCardModel.addButtonLabel, "Add property");

const orderedRows = [{ propertyName: "first" }, { propertyName: "second" }];
const twoCardModel = buildOperationEditorModel(ACTIONS.REMOVE, orderedRows);
assert.equal(twoCardModel.cards.length, 2, "two operations render two card models");
assert.deepEqual(twoCardModel.cards.map((card) => card.title), ["Property 1", "Property 2"]);
assert.equal(twoCardModel.cards[0].row, orderedRows[0], "card keeps the matching operation row");
assert.equal(twoCardModel.cards[1].row, orderedRows[1], "operation order remains stable");
assert.equal(twoCardModel.addButtonLabel, "Add property to remove");
const removableRows = [{ propertyName: "first" }, { propertyName: "middle" }, { propertyName: "last" }];
removableRows.splice(1, 1);
const cardsAfterRemoval = buildOperationEditorModel(ACTIONS.REMOVE, removableRows);
assert.deepEqual(cardsAfterRemoval.cards.map((card) => card.title), ["Property 1", "Property 2"]);
assert.deepEqual(cardsAfterRemoval.cards.map((card) => card.row.propertyName), ["first", "last"], "removing one card preserves and renumbers remaining rows");

const operationCandidates = ["created", "title", "Title", "status", "destination"].map((name) => ({ name }));
const selectedOperationRows = [
  { propertyName: "created" },
  { propertyName: "title" },
  { propertyName: "" }
];
assert.deepEqual(Array.from(getUnavailablePropertyNames(selectedOperationRows, 2)), ["created", "title"], "a new row treats every other selected source property as unavailable");
assert.deepEqual(
  filterOperationPropertyCandidates(operationCandidates, selectedOperationRows, 2).map((candidate) => candidate.name),
  ["Title", "status", "destination"],
  "per-row suggestions exclude other exact-case source names while preserving candidate order"
);
assert.deepEqual(
  filterOperationPropertyCandidates(operationCandidates, selectedOperationRows, 0).map((candidate) => candidate.name),
  ["created", "Title", "status", "destination"],
  "the focused row does not exclude its own current source property"
);
selectedOperationRows[1].propertyName = "status";
assert.deepEqual(
  filterOperationPropertyCandidates(operationCandidates, selectedOperationRows, 2).map((candidate) => candidate.name),
  ["title", "Title", "destination"],
  "changing a row immediately releases its old property and reserves its new property"
);
selectedOperationRows.splice(1, 1);
assert.equal(
  filterOperationPropertyCandidates(operationCandidates, selectedOperationRows, 1).some((candidate) => candidate.name === "status"),
  true,
  "removing a row immediately makes its property available again"
);
selectedOperationRows.splice(0, 1);
assert.equal(
  filterOperationPropertyCandidates(operationCandidates, selectedOperationRows, 0).some((candidate) => candidate.name === "created"),
  true,
  "removing Row 1 immediately releases its selected property"
);
assert.deepEqual(operationCandidates.map((candidate) => candidate.name), ["created", "title", "Title", "status", "destination"], "local operation filtering never mutates the candidate catalog");
const renameSuggestionRows = [
  { propertyName: "created", newPropertyName: "destination" },
  { propertyName: "" }
];
assert.equal(
  filterOperationPropertyCandidates(operationCandidates, renameSuggestionRows, 1).some((candidate) => candidate.name === "destination"),
  true,
  "rename destination names do not hide legitimate source candidates"
);

assert.equal(buildOperationEditorModel(ACTIONS.SET, []).addButtonLabel, "Add property value");
assert.equal(buildOperationEditorModel(ACTIONS.RENAME, []).addButtonLabel, "Add rename");
assert.equal(buildOperationEditorModel(ACTIONS.TYPE, []).addButtonLabel, "Add type change");
assert.deepEqual(buildOperationEditorModel(ACTIONS.RENAME, [{ propertyName: "old", newPropertyName: "new" }]).cards[0].fields, ["Existing property", "New property name"]);
assert.deepEqual(buildOperationEditorModel(ACTIONS.TYPE, [{ propertyName: "date", propertyType: PROPERTY_TYPES.DATE }]).cards[0].fields, ["Property", "Target type", "Convert existing values", "Source date format"]);
assert.deepEqual(buildOperationEditorModel(ACTIONS.TYPE, [{ propertyName: "date-time", propertyType: PROPERTY_TYPES.DATETIME }]).cards[0].fields, ["Property", "Target type", "Convert existing values", "Date-only values to midnight"]);

const switchedToRename = convertOperationsForOperation(orderedRows, ACTIONS.REMOVE, ACTIONS.RENAME);
assert.deepEqual(buildOperationEditorModel(ACTIONS.RENAME, switchedToRename).cards[0].fields, ["Existing property", "New property name"], "switching action type creates rename fields");
const switchedToSet = convertOperationsForOperation([
  { propertyName: "kept", propertyType: PROPERTY_TYPES.NUMBER, value: "2" }
], ACTIONS.ADD, ACTIONS.SET);
assert.deepEqual(buildOperationEditorModel(ACTIONS.SET, switchedToSet).cards[0].fields, ["Property", "Type", "Value"], "switching action type creates value fields");

const noFilesPreview = buildActionPreviewState([], {
  targetType: TARGETS.SPECIFIC_TARGETS,
  targets: [{ type: TARGETS.FOLDER, path: "/" }]
});
assert.equal(noFilesPreview.kind, "no-files");
assert.match(noFilesPreview.message, /No Markdown files matched the selected targets/);
assert.match(noFilesPreview.message, /Folder: \//);
assert.doesNotMatch(noFilesPreview.message, /property does not exist/i, "zero targets are not misreported as missing properties");
const missingPropertyPreview = buildActionPreviewState([{
  path: "note.md",
  status: "skipped",
  operations: [{ status: "skipped", reason: "Property does not exist" }]
}], {});
assert.equal(missingPropertyPreview.kind, "files-resolved", "resolved files with missing properties remain distinct from zero files");
assert.equal(missingPropertyPreview.counts.filesSkipped, 1);

const browserCandidates = Array.from({ length: 30 }, (_, index) => ({
  name: index === 0 ? "alpha" : `Property ${String(index).padStart(2, "0")}`,
  inferredType: PROPERTY_TYPES.TEXT,
  count: index + 1,
  examples: [`note-${index}.md`]
}));
const allBrowserCandidates = filterExistingPropertyCandidates(browserCandidates, "", ["Property 05"]);
assert.equal(allBrowserCandidates.length, 29, "blank property-browser query returns every uncataloged candidate without suggestLimit truncation");
assert.equal(allBrowserCandidates.some((candidate) => candidate.name === "Property 05"), false, "catalog duplicates are excluded");
assert.deepEqual(allBrowserCandidates.map((candidate) => candidate.name), allBrowserCandidates.map((candidate) => candidate.name).slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }) || a.localeCompare(b)), "property browser ordering is deterministic and case-insensitive");
assert.deepEqual(filterExistingPropertyCandidates(browserCandidates, "ALPHA").map((candidate) => candidate.name), ["alpha"], "property browser filtering is case-insensitive");

const alignedPopup = calculateInlineSuggestHorizontalGeometry(
  { left: 120, right: 360, width: 240 },
  { left: 120 },
  { left: 40, right: 640 },
  800
);
assert.deepEqual(alignedPopup, { left: 0, width: 240 }, "inline popup left edge and width match the input where viewport space permits");
const rightClampedPopup = calculateInlineSuggestHorizontalGeometry(
  { left: 560, right: 760, width: 200 },
  { left: 560 },
  { left: 40, right: 650 },
  800
);
assert.deepEqual(rightClampedPopup, { left: 0, width: 90 }, "inline popup width clamps at the modal right boundary without right-edge anchoring");
const leftClampedPopup = calculateInlineSuggestHorizontalGeometry(
  { left: 20, right: 220, width: 200 },
  { left: 20 },
  { left: 40, right: 650 },
  800
);
assert.deepEqual(leftClampedPopup, { left: 20, width: 200 }, "inline popup shifts inside the modal when an input extends beyond its left boundary");

let anchorTop = 120;
const scrollEl = {
  scrollTop: 360,
  getBoundingClientRect: () => ({ top: 20 })
};
const anchorEl = { getBoundingClientRect: () => ({ top: anchorTop }) };
const mockContentEl = {
  closest: () => scrollEl,
  querySelector: () => anchorEl
};
const capturedScroll = captureModalScrollState(mockContentEl);
assert.equal(capturedScroll.scrollTop, 360);
anchorTop = 145;
restoreModalScrollState(mockContentEl, capturedScroll);
assert.equal(scrollEl.scrollTop, 385, "restoring a rerender preserves scrollTop plus the stable operation anchor offset instead of resetting to zero");
let focusOptions = null;
const focusInput = { focus: (options) => { focusOptions = options; } };
focusWithoutScroll(focusInput);
assert.deepEqual(focusOptions, { preventScroll: true }, "new-card focus prevents browser scroll when supported");
let revealOptions = null;
const revealCard = { scrollIntoView: (options) => { revealOptions = options; } };
revealOperationCardWithoutJump(mockContentEl, revealCard, focusInput);
assert.deepEqual(revealOptions, { block: "nearest", inline: "nearest" }, "new cards reveal with nearest scrolling");

const source = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
assert.match(source, /vault\.on\("create"/);
assert.match(source, /vault\.on\("rename"/);
assert.doesNotMatch(source, /vault\.on\("modify"/);
assert.match(source, /confirmOverwrite/);
assert.match(source, /eventName === "create"/);
assert.match(source, /eventName === "rename"/);
assert.match(source, /autoRunKeys/);
assert.match(source, /lastRunKey/);
const operationEditorSource = source.slice(source.indexOf("  addOperationEditor(contentEl) {"), source.indexOf("  addOperationValueEditor(containerEl, row) {"));
assert.ok(operationEditorSource.indexOf('cls: "npo-operation-list"') < operationEditorSource.indexOf('cls: "npo-operation-add-button"'), "add button renders after the operation list");
assert.match(operationEditorSource, /for \(const card of editorModel\.cards\)/, "one card is constructed for each ordered operation model");
assert.ok(operationEditorSource.indexOf('cls: "npo-operation-card-header"') < operationEditorSource.indexOf('"Remove"'), "Remove button belongs to the card header");
assert.match(operationEditorSource, /text: "No properties configured\."/, "empty operation list has a clean empty state");
assert.doesNotMatch(operationEditorSource, /Add operation row/);
assert.match(operationEditorSource, /\(\) => filterOperationPropertyCandidates\(/, "each card obtains live suggestions from the current operation rows");
assert.match(operationEditorSource, /this\.action\.operations,\s*index/s, "suggestion filtering ignores only the focused operation row");
const renderSource = source.slice(source.indexOf("  render(options = {}) {", source.indexOf("class ActionEditorModal")), source.indexOf("  addOperationEditor(contentEl) {"));
assert.ok(renderSource.indexOf("this.addOperationEditor(contentEl);") < renderSource.indexOf('setName("Overwrite existing values")'), "action-level overwrite setting renders after the property list");
assert.ok(renderSource.indexOf("this.addOperationEditor(contentEl);") < renderSource.indexOf('setName("Add if missing")'), "action-level add-if-missing setting renders after the property list");
const targetEditorSource = source.slice(source.indexOf("  addManualTargetSetting(contentEl) {"), source.indexOf("  createVerticalField(containerEl, label, desc) {"));
assert.doesNotMatch(targetEditorSource, /npo-operation-/, "operation-card styles do not leak into target controls");
assert.match(targetEditorSource, /npo-target-row/);
assert.match(targetEditorSource, /this\.setEditorTargets\(targets\.filter/);
assert.match(targetEditorSource, /targets\.concat\(\{ type, path: normalized \}\)/);
assert.doesNotMatch(styles, /\.npo-operation-row\s*\{/);
assert.doesNotMatch(source, /cls: "npo-operation-row"/);
assert.doesNotMatch(styles, /\.npo-operation-card\s*\{[^}]*position:\s*absolute/s, "operation cards are never absolutely positioned");
assert.match(styles, /\.npo-operation-card-header\s*\{[\s\S]*?display: flex;/);
const cardFieldRules = Array.from(styles.matchAll(/\.npo-operation-card-fields\s*\{([^}]*)\}/g));
assert.ok(cardFieldRules.length > 0);
assert.ok(cardFieldRules.every((match) => !/display:\s*flex/.test(match[1])), "operation field containers never flatten nested Setting rows");
assert.match(renderSource, /npo-operation-selector/);
assert.match(renderSource, /npo-operation-selector-control/);
assert.match(targetEditorSource, /npo-target-selector-control/);
assert.match(styles, /\.npo-operation-selector-control,[^}]*justify-content:\s*flex-start/s, "Operation and Target selectors use scoped left alignment");
assert.doesNotMatch(styles, /(^|\n)\.setting-item-control\s*\{/m, "no global Setting control alignment rule is added");
assert.match(operationEditorSource, /rerenderPreservingScroll\(\{ focusOperationIndex:/, "Add preserves scroll and focuses the new card");
assert.match(operationEditorSource, /this\.rerenderPreservingScroll\(\);/, "Remove and Type changes preserve scroll");
assert.match(source, /captureModalScrollState/);
assert.match(source, /focus\(\{ preventScroll: true \}\)/);
assert.match(source, /scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/);
assert.doesNotMatch(source, /window\.scroll|document\.documentElement\.scroll|scrollTo\(/, "no global page scroll call is used");
const inlineChooseSource = source.slice(source.indexOf("  choose(item) {", source.indexOf("class InlineSuggestInput")), source.indexOf("  close() {", source.indexOf("class InlineSuggestInput")));
assert.ok(inlineChooseSource.indexOf("this.close();") < inlineChooseSource.indexOf("this.onChoose(item);"), "choosing an operation suggestion closes its popup before the scroll-preserving refresh");
const inlineSuggestSource = source.slice(source.indexOf("class InlineSuggestInput"), source.indexOf("class PropertySuggestModal"));
assert.match(inlineSuggestSource, /npo-inline-suggest npo-inline-suggest-list/);
assert.match(inlineSuggestSource, /createEl\("button", \{ cls: "npo-inline-suggest-item"/);
assert.ok(inlineSuggestSource.indexOf('cls: "npo-inline-suggest-title"') < inlineSuggestSource.indexOf('cls: "npo-inline-suggest-meta"'), "metadata is constructed beneath the candidate title");
assert.match(inlineSuggestSource, /this\.ownerWindow\.innerWidth/, "popup geometry uses the input owner window rather than the global window");
assert.match(inlineSuggestSource, /calculateInlineSuggestHorizontalGeometry/);
assert.doesNotMatch(inlineSuggestSource, /right:\s*`|style\.right|setCssStyles\(\{[^}]*right:/s, "popup positioning never defaults to a right-edge coordinate");
for (const suggestionClass of ["PropertyInputSuggest", "FolderPathSuggest", "MarkdownFilePathSuggest"]) {
  const classStart = inlineSuggestSource.indexOf(`class ${suggestionClass}`);
  assert.ok(classStart >= 0, `${suggestionClass} uses the shared inline suggestion implementation`);
}
const inlineStyles = styles.slice(styles.indexOf(".npo-inline-suggest {"), styles.indexOf(".npo-action-editor-content"));
assert.match(inlineStyles, /\.npo-inline-suggest\s*\{[^}]*right:\s*auto/s);
assert.match(inlineStyles, /\.npo-inline-suggest\s*\{[^}]*overflow-x:\s*hidden/s);
assert.match(inlineStyles, /\.npo-inline-suggest-item\s*\{[^}]*width:\s*100%/s);
assert.match(inlineStyles, /\.npo-inline-suggest-item\s*\{[^}]*text-align:\s*left/s);
assert.match(inlineStyles, /\.npo-inline-suggest-title,[^}]*text-align:\s*left/s);
assert.match(inlineStyles, /\.npo-inline-suggest-meta\s*\{[^}]*color:\s*var\(--text-muted\)/s);
assert.doesNotMatch(inlineStyles, /justify-content:\s*space-between|margin-left:\s*auto/);
assert.doesNotMatch(styles, /(^|\n)button\s*\{|(^|\n)\.setting-item(-control)?\s*\{/m, "inline alignment does not introduce global button or Setting rules");
assert.doesNotMatch(operationEditorSource, /npo-inline-suggest-item|npo-inline-suggest-opens-/, "operation cards never receive popup item or absolute-position classes");
const actionEditorRenderSource = source.slice(source.indexOf("  render(options = {}) {", source.indexOf("class ActionEditorModal")), source.indexOf("  rerenderPreservingScroll", source.indexOf("class ActionEditorModal")));
assert.match(actionEditorRenderSource, /validateAction\(this\.action, this\.kind\)/, "Save is blocked by shared duplicate validation");
const previewModalSource = source.slice(source.indexOf("class PreviewModal"), source.indexOf("class ResultModal"));
assert.ok((previewModalSource.match(/validateAction\(/g) || []).length >= 2, "Preview and Apply independently block duplicate source rows");
assert.doesNotMatch(source, /getDirectMarkdownFiles|direct child Markdown notes|Include subfolders/);
assert.match(source, /getRecursiveMarkdownFilesByPath/);
assert.match(source, /No Markdown files matched the selected targets/);
assert.doesNotMatch(source, /vault\.modify\(/, "frontmatter actions never rewrite full notes");
const browserSource = source.slice(source.indexOf("class ExistingPropertyBrowserModal"), source.indexOf("class ActionEditorModal"));
for (const key of ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Enter", "Escape"]) assert.match(browserSource, new RegExp(`"${key}"`));
assert.match(browserSource, /npo-existing-property-results/);
const browserFilterSource = source.slice(source.indexOf("function filterExistingPropertyCandidates"), source.indexOf("function formatExistingPropertyCandidate"));
assert.doesNotMatch(browserFilterSource, /suggestLimit|slice\(0,/, "full browser filtering is never truncated by the compact suggestion limit");
assert.match(styles, /\.npo-existing-property-results\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(styles, /\.npo-existing-property-results\s*\{[^}]*overscroll-behavior:\s*contain/s);
assert.match(styles, /\.npo-existing-property-results\s*\{[^}]*overflow-x:\s*hidden/s);
