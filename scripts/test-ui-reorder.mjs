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
  }
}
class MockTFolder {}
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    return {
      FuzzySuggestModal: Empty,
      ButtonComponent: Empty,
      Modal: Empty,
      Notice: Empty,
      Plugin: Empty,
      PluginSettingTab: Empty,
      Setting: Empty,
      TFile: MockTFile,
      TFolder: MockTFolder,
      ToggleComponent: Empty,
      normalizePath: (value) => value,
      setIcon: () => {}
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
  filterExistingPropertyCandidates,
  formatActionCardSummary,
  formatActionCardSummaryTooltip,
  canonicalFolderPath,
  canonicalizeTargetsWithPath,
  moveItemByOffset,
  moveItemToIndex,
  normalizeAction,
  normalizeSettings,
  reorderById,
  resolveActionPropertyReference,
  uniqueTargets,
  validateActionPropertyReferences
} = pluginModule;

function ids(items) {
  return items.map((item) => item.id);
}

function assertOrder(actual, expected, message) {
  assert.deepEqual(ids(actual), expected, message);
}

const source = fs.readFileSync("src/main.ts", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const original = [
  { id: "one", name: "One", unrelated: { keep: true } },
  { id: "two", name: "Two", enabled: false },
  { id: "three", name: "Three", value: [1, 2] }
];
assertOrder(reorderById(original, "one", "three", "after"), ["two", "three", "one"], "first item moves after last");
assertOrder(reorderById(original, "two", "three", "after"), ["one", "three", "two"], "middle item moves to last");
assertOrder(reorderById(original, "three", "one", "before"), ["three", "one", "two"], "last item moves to first");
assertOrder(moveItemByOffset(original, "two", -1), ["two", "one", "three"], "move up works");
assertOrder(moveItemByOffset(original, "two", 1), ["one", "three", "two"], "move down works");
assertOrder(moveItemToIndex(original, "one", 1), ["two", "one", "three"], "move to index works");
assert.equal(reorderById(original, "one", "one", "before"), original, "self-drop is a no-op");
assert.equal(moveItemByOffset(original, "missing", 1), original, "unknown IDs are a no-op");
assert.equal(moveItemToIndex([], "missing", 0).length, 0, "empty list is safe");
assert.equal(moveItemByOffset([{ id: "only" }], "only", -1)[0].id, "only", "one-item boundary is safe");
const duplicateIds = [{ id: "duplicate", value: 1 }, { id: "duplicate", value: 2 }];
assert.equal(moveItemByOffset(duplicateIds, "duplicate", 1), duplicateIds, "duplicate IDs are a safe no-op");
assert.deepEqual(original, [
  { id: "one", name: "One", unrelated: { keep: true } },
  { id: "two", name: "Two", enabled: false },
  { id: "three", name: "Three", value: [1, 2] }
], "reorder helpers do not mutate objects or the source array");

const candidates = Array.from({ length: 120 }, (_, index) => ({
  name: `Property ${String(119 - index).padStart(3, "0")}`,
  count: index + 1,
  inferredType: index % 2 === 0 ? PROPERTY_TYPES.TEXT : PROPERTY_TYPES.DATE,
  examples: [`folder/long-example-${index}.md`]
}));
const filtered = filterExistingPropertyCandidates(candidates, "", ["Property 050"]);
assert.equal(filtered.length, 119, "blank query returns every uncataloged candidate");
assert.equal(filtered.some((candidate) => candidate.name === "Property 050"), false, "catalog duplicates are excluded");
assert.deepEqual(filtered.map((candidate) => candidate.name), filtered.map((candidate) => candidate.name).slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }) || a.localeCompare(b)), "blank query remains alphabetized");
assert.equal(filterExistingPropertyCandidates(candidates, "long-example-119", []).length, 1, "metadata remains searchable");

const settings = normalizeSettings({
  properties: [
    { id: "property-2", name: "Second", type: PROPERTY_TYPES.NUMBER, custom: "keep" },
    { id: "property-1", name: "First", type: PROPERTY_TYPES.TEXT }
  ],
  manualActions: [
    normalizeAction({ id: "manual-2", name: "Manual 2", operation: ACTIONS.ADD, operations: [{ propertyName: "two" }], unrelated: { keep: true } }, "manual"),
    normalizeAction({ id: "manual-1", name: "Manual 1", operation: ACTIONS.REMOVE, operations: [{ propertyName: "one" }] }, "manual")
  ],
  autoActions: [
    normalizeAction({ id: "auto-2", name: "Auto 2", trigger: "created-or-moved-into-folder", enabled: true, operations: [{ propertyName: "two" }] }, "auto"),
    normalizeAction({ id: "auto-1", name: "Auto 1", trigger: "created-or-moved-into-folder", enabled: false, operations: [{ propertyName: "one" }] }, "auto")
  ]
});
assertOrder(settings.properties, ["property-2", "property-1"], "property migration preserves visible order");
assertOrder(settings.manualActions, ["manual-2", "manual-1"], "manual action order persists");
assertOrder(settings.autoActions, ["auto-2", "auto-1"], "automatic action order persists independently");
assert.equal(settings.properties[0].custom, "keep", "unrelated property fields survive normalization");
assert.equal(settings.manualActions[0].unrelated.keep, true, "unrelated action fields survive normalization");
assert.deepEqual(normalizeSettings(settings), settings, "order normalization is idempotent");

const cardAction = {
  name: "Publish metadata",
  targetType: "folder",
  targetFolder: "Publish",
  operation: ACTIONS.ADD,
  operations: [{ propertyName: "a" }, { propertyName: "b" }, { propertyName: "c" }, { propertyName: "d" }],
  autoTargets: [{ type: TARGETS.FOLDER, path: "Publish" }],
  lastResult: {
    filesChanged: 5,
    filesSkipped: 0,
    filesFailed: 1,
    operationsChanged: 4,
    operationsSkipped: 12,
    operationsFailed: 1,
    skippedIncompatible: 2,
    registrySkipped: 0,
    registryFailed: 0
  },
  lastInitialSyncResult: {
    filesChanged: 5,
    filesSkipped: 1,
    filesFailed: 0,
    operationsChanged: 4,
    operationsSkipped: 0,
    operationsFailed: 0
  }
};
const cardSummary = formatActionCardSummary(cardAction, true);
assert.equal(cardSummary.split("\n").length, 4, "action summary is limited to four source lines");
assert.match(cardSummary, /Folder: Publish/);
assert.match(cardSummary, /Status: 1 failed, 2 incompatible/);
assert.match(cardSummary, /Files: 5 changed, 0 skipped, 1 failed/);
assert.match(formatActionCardSummary({ ...cardAction, lastResult: null }, false), /No result yet\./);
assert.match(formatActionCardSummaryTooltip(cardAction, true), /Files — changed: 5/);
assert.equal(cardAction.lastResult.filesChanged, 5, "summary formatting does not mutate result data");

const visibleFolders = ["/", "Publish", "Publish/essays", "Publish/essays/archive"];
assert.equal(canonicalFolderPath("publish", visibleFolders), "Publish", "folder matching preserves canonical casing");
assert.equal(canonicalFolderPath("PUBLISH/ESSAYS/ARCHIVE", visibleFolders), "Publish/essays/archive", "nested folder matching preserves every path segment casing");
assert.equal(canonicalFolderPath("missing", visibleFolders), "missing", "unmatched folder paths are not rewritten");
const canonicalTargets = canonicalizeTargetsWithPath([
  { type: TARGETS.FOLDER, path: "publish" },
  { type: TARGETS.FOLDER, path: "Publish" },
  { type: TARGETS.FOLDER, path: "Publish/essays" },
  { type: TARGETS.FILE, path: "Publish/essay.md" }
], (path) => canonicalFolderPath(path, visibleFolders));
assert.deepEqual(canonicalTargets, [
  { type: TARGETS.FOLDER, path: "Publish" },
  { type: TARGETS.FOLDER, path: "Publish/essays" },
  { type: TARGETS.FILE, path: "Publish/essay.md" }
], "case-equivalent folder targets canonicalize and deduplicate");
assert.equal(uniqueTargets([
  { type: TARGETS.FOLDER, path: "publish" },
  { type: TARGETS.FOLDER, path: "Publish" }
]).length, 1, "folder target duplicate detection is case-insensitive");

const propertyPlugin = {
  settings: {
    properties: [
      { id: "publish-date", name: "PublishDate", type: PROPERTY_TYPES.DATE },
      { id: "access-level", name: "AccessLevel", type: PROPERTY_TYPES.NUMBER }
    ]
  },
  resolveTargetFiles: () => [],
  buildPropertyCandidates: () => [
    { name: "PublishDate", type: PROPERTY_TYPES.DATE },
    { name: "DetectedOnly", type: PROPERTY_TYPES.TEXT }
  ]
};
const configuredBinding = resolveActionPropertyReference({ propertyId: "publish-date", propertyName: "PublishDate" }, propertyPlugin, propertyPlugin.buildPropertyCandidates());
assert.deepEqual(configuredBinding, { id: "publish-date", name: "PublishDate", type: PROPERTY_TYPES.DATE, kind: "configured" }, "configured references bind by stable ID");
assert.deepEqual(resolveActionPropertyReference({ propertyName: "DetectedOnly" }, propertyPlugin, propertyPlugin.buildPropertyCandidates()), { name: "DetectedOnly", type: PROPERTY_TYPES.TEXT, kind: "detected" }, "detected references bind by exact canonical name");
assert.equal(resolveActionPropertyReference({ propertyName: "publishdate" }, propertyPlugin, propertyPlugin.buildPropertyCandidates()), null, "property references do not use fuzzy or case-insensitive guessing");

const legacyOperations = normalizeSettings({
  properties: [{ id: "publish-date", name: "PublishDate", type: PROPERTY_TYPES.DATE }],
  manualActions: [{ id: "legacy-action", name: "Legacy", operation: ACTIONS.REMOVE, operations: [{ propertyName: "PublishDate", unrelated: "keep" }] }],
  autoActions: []
});
const legacyRow = legacyOperations.manualActions[0].operations[0];
assert.match(legacyRow.id, /^[a-z0-9]+-[a-z0-9]+$/, "legacy operation receives one stable ID");
assert.equal(legacyRow.propertyId, "publish-date", "legacy exact configured property binds to its catalog ID");
assert.equal(legacyRow.propertyReferenceKind, "configured", "legacy configured property reference is explicit");
assert.equal(legacyRow.unrelated, "keep", "operation migration preserves unknown fields");
assert.deepEqual(normalizeSettings(legacyOperations), legacyOperations, "operation/property reference migration is idempotent");
const duplicateIdSettings = normalizeSettings({
  manualActions: [{ name: "Duplicate IDs", operation: ACTIONS.ADD, operations: [
    { id: "same", propertyName: "One" },
    { id: "same", propertyName: "Two" }
  ] }],
  autoActions: []
});
assert.notEqual(duplicateIdSettings.manualActions[0].operations[0].id, duplicateIdSettings.manualActions[0].operations[1].id, "duplicate operation IDs are repaired during migration");
assert.deepEqual(normalizeSettings(duplicateIdSettings), duplicateIdSettings, "duplicate operation ID repair is idempotent");
const unresolvedAction = normalizeAction({ name: "Review", operation: ACTIONS.REMOVE, operations: [{ id: "review-row", propertyName: "Missing" }] }, "manual");
assert.match(validateActionPropertyReferences(unresolvedAction, propertyPlugin), /requires review|exact existing property selection/, "unresolved existing property blocks validation");
const mismatchedAction = normalizeAction({ name: "Mismatch", operation: ACTIONS.ADD, operations: [{ id: "mismatch-row", propertyName: "PublishDate", propertyType: PROPERTY_TYPES.NUMBER, value: 1 }] }, "manual");
assert.match(validateActionPropertyReferences(mismatchedAction, propertyPlugin), /select it explicitly|requires review/, "typed existing property must be explicitly selected and type-compatible");
const newAction = normalizeAction({ name: "New", operation: ACTIONS.ADD, operations: [{ id: "new-row", propertyName: "BrandNew", propertyType: PROPERTY_TYPES.TEXT, value: "x" }] }, "manual");
assert.equal(validateActionPropertyReferences(newAction, propertyPlugin), "", "genuinely new Add property remains editable");
const orderedOperations = normalizeAction({ name: "Ordered", operation: ACTIONS.ADD, operations: [
  { id: "op-1", propertyName: "One", propertyType: PROPERTY_TYPES.TEXT, value: "1", unknown: { keep: true } },
  { id: "op-2", propertyName: "Two", propertyType: PROPERTY_TYPES.TEXT, value: "2" },
  { id: "op-3", propertyName: "Three", propertyType: PROPERTY_TYPES.TEXT, value: "3" }
] }, "manual");
const movedOperations = moveItemToIndex(orderedOperations.operations, "op-1", 2);
assert.deepEqual(movedOperations.map((row) => row.id), ["op-2", "op-3", "op-1"], "operation rows use shared reorder helpers");
assert.deepEqual(movedOperations[2].unknown, { keep: true }, "operation reorder preserves complete row objects");
const automaticOrdered = normalizeAction({ name: "Automatic", trigger: "created-or-moved-into-folder", lastRunKey: "run-1", operation: ACTIONS.ADD, operations: orderedOperations.operations }, "auto");
moveItemByOffset(automaticOrdered.operations, "op-2", 1);
assert.equal(automaticOrdered.lastRunKey, "run-1", "operation reorder does not alter automatic run state");

assert.match(source, /rowEl\.createDiv\(\{ cls: "npo-existing-property-result-title"/);
assert.match(source, /rowEl\.createDiv\(\{[\s\S]*npo-existing-property-result-meta/);
assert.match(source, /rowEl\.createDiv\(\{[\s\S]*npo-existing-property-result-examples/);
assert.doesNotMatch(source, /text: formatExistingPropertyCandidate\(item\)/, "browser no longer uses one flat candidate text node");
assert.match(source, /scrollIntoView\(\{ block: "nearest" \}\)/);
assert.match(source, /\["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Enter", "Escape"\]/);
assert.match(source, /setIcon\(handleEl, "grip-vertical"\)/);
assert.match(source, /handleEl\.draggable = true/);
assert.doesNotMatch(source, /itemEl\.draggable = true/);
assert.match(source, /event\.dataTransfer\.setData\("text\/plain", id\)/);
assert.match(source, /npo-reorder-target-before/);
assert.match(source, /focusReorderHandle\(listEl\.ownerDocument/);
assert.doesNotMatch(source, /vault\.modify/);
assert.doesNotMatch(source, /fetch\(/);

const manualSection = source.slice(source.indexOf("  renderManualActions(containerEl)"), source.indexOf("  renderAutoActions(containerEl)"));
const autoSection = source.slice(source.indexOf("  renderAutoActions(containerEl)"), source.indexOf("  addTextAdder(containerEl"));
for (const section of [manualSection, autoSection]) {
  assert.match(section, /createActionCardHeader\(cardEl, action/);
  assert.match(section, /createActionCardSummary\(cardEl, action/);
  assert.match(section, /createActionCardFooter\(cardEl\)/);
  assert.match(section, /createNativeActionButton\(footerActionsEl/);
  assert.doesNotMatch(section, /new Setting\(headerEl\)/);
  assert.doesNotMatch(section, /\.setDesc\(/);
}
assert.match(autoSection, /new ToggleComponent\(headerControlsEl\)/);
assert.match(source, /npo-action-card-title/);
assert.match(source, /npo-action-card-header-controls/);
assert.match(source, /npo-action-card-summary/);
assert.match(source, /npo-action-card-footer/);
assert.match(source, /npo-action-card-actions/);
assert.ok(manualSection.indexOf('"Preview"') < manualSection.indexOf('"Apply"'), "manual Preview precedes Apply");
assert.ok(manualSection.indexOf('"Apply"') < manualSection.indexOf('"Edit"'), "manual Apply precedes Edit");
assert.ok(manualSection.indexOf('"Edit"') < manualSection.indexOf('"Delete"'), "manual Edit precedes Delete");
assert.ok(autoSection.indexOf('"Sync existing notes"') < autoSection.indexOf('"Edit"'), "automatic sync precedes Edit");
assert.ok(autoSection.indexOf('"Edit"') < autoSection.indexOf('"Delete"'), "automatic Edit precedes Delete");
assert.doesNotMatch(source, /npo-action-setting/);
assert.match(source, /npo-locked-property-reference/);
assert.match(source, /Change property/);
assert.match(source, /row\.propertyReferenceKind/);
assert.match(source, /data-operation-index/);
assert.match(source, /listKey: `operations-\$\{this\.action\.id\}`/);
assert.match(source, /pendingOperationFocusIndex/);
assert.match(source, /validateActionPropertyReferences/);

assert.match(styles, /\.npo-existing-property-results[\s\S]*overflow-y: auto/);
assert.match(styles, /\.npo-existing-property-results[\s\S]*overflow-x: hidden/);
assert.match(styles, /\.npo-existing-property-results[\s\S]*overscroll-behavior: contain/);
assert.match(styles, /\.npo-existing-property-results[\s\S]*scrollbar-gutter: stable/);
assert.match(styles, /\.npo-existing-property-results\s*\{[\s\S]*background:\s*var\(--background-primary\)/);
assert.match(styles, /\.npo-existing-property-result\s*\{[\s\S]*background:\s*transparent/);
assert.match(styles, /\.npo-existing-property-result:hover,[\s\S]*\.npo-existing-property-result-selected[\s\S]*background:\s*var\(--background-modifier-hover\)/);
assert.doesNotMatch(styles, /\.npo-existing-property-results\s*\{[\s\S]*background:\s*(?:white|black|#[0-9a-f]{3,8})/i);
assert.match(styles, /\.npo-existing-property-result\s*\{[\s\S]*height: auto/);
assert.match(styles, /\.npo-existing-property-result-title/);
assert.match(styles, /\.npo-reorder-handle/);
assert.match(styles, /\.npo-reorder-target-before/);
assert.match(styles, /\.npo-action-card-header\s*\{[\s\S]*flex-wrap: wrap/);
const summaryCss = styles.slice(styles.indexOf(".npo-action-card-summary"), styles.indexOf(".npo-action-card-footer"));
assert.match(summaryCss, /display:\s*-webkit-box/);
assert.match(summaryCss, /-webkit-box-orient:\s*vertical/);
assert.match(summaryCss, /-webkit-line-clamp:\s*4/);
assert.match(summaryCss, /overflow:\s*hidden/);
assert.match(summaryCss, /overflow-wrap:\s*anywhere/);
assert.match(summaryCss, /white-space:\s*pre-line/);
assert.doesNotMatch(summaryCss, /height:\s*\d+px/);
const footerCss = styles.slice(styles.indexOf(".npo-action-card-footer"), styles.indexOf("@media (max-width"));
assert.match(footerCss, /display:\s*flex/);
assert.match(footerCss, /justify-content:\s*flex-end/);
assert.doesNotMatch(footerCss, /position:\s*absolute/);
const actionsCss = styles.slice(styles.indexOf(".npo-action-card-actions"), styles.indexOf("@media (max-width"));
assert.match(actionsCss, /flex-wrap:\s*nowrap/);
assert.match(styles, /\.npo-action-card-actions\s*\{[\s\S]*flex-wrap:\s*wrap/);
assert.doesNotMatch(styles, /\.npo-action-setting/);
assert.match(styles, /\.npo-property-main-row\s*\{[\s\S]*min-width: 0/);
assert.doesNotMatch(styles, /(^|\n)\s*(button|input|textarea|select|\.setting-item)\s*\{/);
assert.doesNotMatch(styles, /!important/);
assert.doesNotMatch(styles, /\.style\s*=/);
