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
  filterExistingPropertyCandidates,
  moveItemByOffset,
  moveItemToIndex,
  normalizeAction,
  normalizeSettings,
  reorderById
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

assert.match(styles, /\.npo-existing-property-results[\s\S]*overflow-y: auto/);
assert.match(styles, /\.npo-existing-property-results[\s\S]*overflow-x: hidden/);
assert.match(styles, /\.npo-existing-property-results[\s\S]*overscroll-behavior: contain/);
assert.match(styles, /\.npo-existing-property-results[\s\S]*scrollbar-gutter: stable/);
assert.match(styles, /\.npo-existing-property-result\s*\{[\s\S]*height: auto/);
assert.match(styles, /\.npo-existing-property-result-title/);
assert.match(styles, /\.npo-reorder-handle/);
assert.match(styles, /\.npo-reorder-target-before/);
assert.match(styles, /\.npo-action-card-header\s*\{[\s\S]*flex-wrap: wrap/);
assert.match(styles, /\.npo-property-main-row\s*\{[\s\S]*min-width: 0/);
assert.doesNotMatch(styles, /(^|\n)\s*(button|input|textarea|select|\.setting-item)\s*\{/);
assert.doesNotMatch(styles, /!important/);
assert.doesNotMatch(styles, /\.style\s*=/);
