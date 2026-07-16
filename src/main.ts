// @ts-nocheck
import {
  FuzzySuggestModal,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  ToggleComponent,
  normalizePath
} from "obsidian";

const PROPERTY_TYPES = {
  TEXT: "Text",
  LIST: "List",
  NUMBER: "Number",
  CHECKBOX: "Checkbox",
  DATE: "Date",
  DATETIME: "Date & time",
  TAGS: "Tags"
};

const ACTIONS = {
  ADD: "add",
  REMOVE: "remove",
  RENAME: "rename",
  SET: "set",
  TYPE: "type"
};

const TARGETS = {
  CURRENT_FILE: "current-file",
  CURRENT_FOLDER: "current-folder",
  FOLDER: "folder",
  FILE: "file",
  SPECIFIC_TARGETS: "specific-targets",
  PROVIDED_FILES: "provided-files"
};

const AUTO_TRIGGER = "created-or-moved-into-folder";

const DEFAULT_SETTINGS = {
  properties: [],
  manualActions: [],
  autoActions: [],
  excludedFolders: [],
  addMissingOnly: true,
  confirmOverwrite: true,
  suggestLimit: 12
};

const ACTION_LABELS = {
  [ACTIONS.ADD]: "Add property",
  [ACTIONS.REMOVE]: "Remove property",
  [ACTIONS.RENAME]: "Rename property",
  [ACTIONS.SET]: "Set/change property value",
  [ACTIONS.TYPE]: "Change property type"
};

const OPERATION_ADD_BUTTON_LABELS = {
  [ACTIONS.ADD]: "Add property",
  [ACTIONS.REMOVE]: "Add property to remove",
  [ACTIONS.RENAME]: "Add rename",
  [ACTIONS.SET]: "Add property value",
  [ACTIONS.TYPE]: "Add type change"
};

const TARGET_LABELS = {
  [TARGETS.CURRENT_FILE]: "Current file",
  [TARGETS.CURRENT_FOLDER]: "Current folder",
  [TARGETS.FOLDER]: "Folder",
  [TARGETS.FILE]: "File",
  [TARGETS.SPECIFIC_TARGETS]: "Specific targets"
};

export default class NativePropertyOperatorPlugin extends Plugin {
  async onload() {
    const loadedData = await this.loadData();
    this.settings = normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, loadedData));
    if (needsActionMigration(loadedData)) await this.saveSettings();
    this.autoRunKeys = new Set();

    this.addCommand({
      id: "open-native-property-operator",
      name: "Open Native Property Operator settings",
      callback: () => {
        this.app.setting.open();
        this.app.setting.openTabById(this.manifest.id);
      }
    });

    this.addCommand({
      id: "new-manual-action",
      name: "Create saved manual action",
      callback: () => this.openManualActionEditor(null)
    });

    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => this.addFileMenuItems(menu, file)));
    this.registerEvent(this.app.vault.on("create", (file) => this.handleAutoEvent(file, "create", "")));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.handleAutoEvent(file, "rename", oldPath)));

    this.settingTab = new NativePropertyOperatorSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }

  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
  }

  getNativeTypesPath() {
    return normalizePath(`${this.app.vault.configDir}/types.json`);
  }

  async readNativePropertyTypes() {
    const path = this.getNativeTypesPath();
    if (!(await this.app.vault.adapter.exists(path))) return { types: {} };
    try {
      const parsed = JSON.parse(await this.app.vault.adapter.read(path));
      if (!parsed || typeof parsed !== "object") return { types: {} };
      parsed.types = parsed.types && typeof parsed.types === "object" ? parsed.types : {};
      return parsed;
    } catch (error) {
      console.error("Native Property Operator: failed to read property type registry.", error);
      return { types: {} };
    }
  }

  async updateNativePropertyTypeRegistry(oldName, newName, newType) {
    const propertyName = String(newName || "").trim();
    if (!propertyName) return;
    const nativeType = nativeTypeIdForPropertyType(newType);
    if (!nativeType) return;
    const path = this.getNativeTypesPath();
    const data = await this.readNativePropertyTypes();
    data.types = data.types || {};
    let changed = false;
    const previousName = String(oldName || "").trim();
    if (previousName && previousName !== propertyName && Object.prototype.hasOwnProperty.call(data.types, previousName)) {
      delete data.types[previousName];
      changed = true;
    }
    if (data.types[propertyName] !== nativeType) {
      data.types[propertyName] = nativeType;
      changed = true;
    }
    if (changed) {
      await this.app.vault.adapter.write(path, `${JSON.stringify(data, null, 2)}\n`);
    }
  }

  openManualActionEditor(action, context = null) {
    new ActionEditorModal(this.app, this, "manual", action, context).open();
  }

  openAutoActionEditor(action) {
    new ActionEditorModal(this.app, this, "auto", action, null).open();
  }

  addFileMenuItems(menu, file) {
    const context = this.getFileMenuContext(file);
    if (!context) return;

    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle("Native Property Operator").setDisabled(true);
    });

    menu.addItem((item) => {
      item
        .setTitle("Create saved manual action here")
        .onClick(() => this.openManualActionEditor(null, context));
    });

    for (const action of this.settings.manualActions) {
      menu.addItem((item) => {
        item
          .setTitle(`Preview saved action: ${action.name}`)
          .onClick(() => new PreviewModal(this.app, this, action, context, false).open());
      });
    }
  }

  getFileMenuContext(file) {
    if (file instanceof TFile) {
      if (!this.isAllowedMarkdownFile(file)) return null;
      return {
        targetType: TARGETS.PROVIDED_FILES,
        files: [file],
        targetPath: file.path,
        label: file.path,
        requiresConfirm: false
      };
    }

    if (file instanceof TFolder) {
      if (!this.isVisibleFolder(file)) return null;
      const files = this.getRecursiveMarkdownFilesInFolder(file);
      if (files.length === 0) return null;
      return {
        targetType: TARGETS.PROVIDED_FILES,
        files,
        targetPath: file.path || "/",
        label: `${file.path || "/"} Markdown notes and descendants`,
        requiresConfirm: true
      };
    }

    return null;
  }

  getActiveMarkdownFile() {
    const file = this.app.workspace.getActiveFile();
    return this.isAllowedMarkdownFile(file) ? file : null;
  }

  isVisibleFolder(folder) {
    if (!(folder instanceof TFolder)) return false;
    const parts = folder.path ? folder.path.split("/") : [];
    if (parts.includes(this.app.vault.configDir)) return false;
    if (parts.some((part) => part.startsWith(".") && part.length > 1)) return false;
    const normalizedPath = normalizePathInput(folder.path);
    return !(this.settings.excludedFolders || []).some((excludedFolder) => {
      const excluded = normalizePathInput(excludedFolder);
      return excluded && normalizedPath && (normalizedPath === excluded || normalizedPath.startsWith(`${excluded}/`));
    });
  }

  isAllowedMarkdownFile(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return false;
    const parts = file.path.split("/");
    if (parts.includes(this.app.vault.configDir)) return false;
    if (parts.some((part) => part.startsWith(".") && part.length > 1)) return false;
    return !this.settings.excludedFolders.some((folder) => {
      const normalized = normalizePathInput(folder);
      return normalized && normalized !== "/" && (file.path === normalized || file.path.startsWith(`${normalized}/`));
    });
  }

  getRecursiveMarkdownFilesByPath(folderPath) {
    const normalized = normalizeFolderPath(folderPath);
    const folder = normalized === "/" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(normalized);
    if (!(folder instanceof TFolder)) return [];
    return this.getRecursiveMarkdownFilesInFolder(folder);
  }

  getVisibleFolders() {
    const folders = [this.app.vault.getRoot()];
    const visit = (folder) => {
      for (const child of folder.children) {
        if (!(child instanceof TFolder) || !this.isVisibleFolder(child)) continue;
        folders.push(child);
        visit(child);
      }
    };
    visit(this.app.vault.getRoot());
    return folders
      .map((folder) => folder.path || "/")
      .sort((a, b) => a.localeCompare(b));
  }

  getVisibleMarkdownFilePaths() {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.isAllowedMarkdownFile(file))
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b));
  }

  getVisibleMarkdownFiles() {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.isAllowedMarkdownFile(file))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getRecursiveMarkdownFilesInFolder(folder) {
    if (!this.isVisibleFolder(folder)) return [];
    const files = [];
    const visit = (currentFolder) => {
      for (const child of currentFolder.children) {
        if (child instanceof TFolder) {
          if (this.isVisibleFolder(child)) visit(child);
          continue;
        }
        if (this.isAllowedMarkdownFile(child)) files.push(child);
      }
    };
    visit(folder);
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  getMarkdownFilesForTarget(target) {
    if (!target) return [];
    if (target.type === TARGETS.FILE) {
      const file = this.app.vault.getAbstractFileByPath(String(target.path || "").trim());
      return this.isAllowedMarkdownFile(file) ? [file] : [];
    }
    if (target.type === TARGETS.FOLDER) return this.getRecursiveMarkdownFilesByPath(target.path);
    return [];
  }

  resolveConfiguredTargets(targets) {
    const byPath = new Map();
    for (const target of targets || []) {
      for (const file of this.getMarkdownFilesForTarget(target)) byPath.set(file.path, file);
    }
    return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  }

  resolveAutoActionExistingFiles(action) {
    return this.resolveConfiguredTargets(action.autoTargets || []);
  }

  openAutoSyncPreview(action, enableAfterApply = false) {
    const files = this.resolveAutoActionExistingFiles(action);
    new PreviewModal(this.app, this, action, {
      targetType: TARGETS.PROVIDED_FILES,
      files,
      label: "existing matching notes",
      requiresConfirm: files.length > 1,
      isInitialSync: true,
      enableAfterApply
    }, false).open();
  }

  resolveTargetFiles(action, context = null) {
    if (context && context.files) {
      return context.files.filter((file) => this.isAllowedMarkdownFile(file)).sort((a, b) => a.path.localeCompare(b.path));
    }

    if (action.trigger && action.autoTargets && action.autoTargets.length > 0) {
      return this.resolveConfiguredTargets(action.autoTargets);
    }

    if (action.targets && action.targets.length > 0) {
      return this.resolveConfiguredTargets(action.targets);
    }

    if (action.targetType === TARGETS.FILE) {
      const file = this.app.vault.getAbstractFileByPath(action.targetPath || "");
      return this.isAllowedMarkdownFile(file) ? [file] : [];
    }

    if (action.targetType === TARGETS.FOLDER) {
      return this.getRecursiveMarkdownFilesByPath(action.targetFolder || action.targetPath || "");
    }

    const activeFile = this.getActiveMarkdownFile();
    if (!activeFile) return [];

    if (action.targetType === TARGETS.CURRENT_FOLDER) {
      return activeFile.parent ? this.getRecursiveMarkdownFilesInFolder(activeFile.parent) : [];
    }

    return [activeFile];
  }

  getPropertyType(propertyName, fallback = PROPERTY_TYPES.TEXT) {
    const property = this.settings.properties.find((item) => item.name === propertyName);
    return property ? property.type : fallback;
  }

  buildPropertyCandidates(files) {
    const byName = new Map();
    for (const property of this.settings.properties) {
      byName.set(property.name, {
        name: property.name,
        type: property.type,
        configured: true,
        detectedCount: 0
      });
    }

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
      for (const key of Object.keys(frontmatter)) {
        if (key === "position") continue;
        const current = byName.get(key) || {
          name: key,
          type: PROPERTY_TYPES.TEXT,
          configured: false,
          detectedCount: 0
        };
        current.detectedCount += 1;
        byName.set(key, current);
      }
    }

    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  scanDetectedProperties() {
    const catalogNames = new Set(this.settings.properties.map((property) => property.name));
    const byName = new Map();
    for (const file of this.getVisibleMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
      for (const [name, value] of Object.entries(frontmatter)) {
        if (name === "position" || catalogNames.has(name)) continue;
        const current = byName.get(name) || { name, count: 0, values: [], examples: [] };
        current.count += 1;
        if (current.values.length < 25) current.values.push(value);
        if (current.examples.length < 3) current.examples.push(file.path);
        byName.set(name, current);
      }
    }
    return Array.from(byName.values())
      .map((entry) => Object.assign(entry, { inferredType: inferPropertyType(entry.name, entry.values) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  previewCatalogChange(change) {
    const entries = [];
    for (const file of this.getVisibleMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
      const decision = evaluateCatalogChange(frontmatter, change);
      entries.push({
        file,
        path: file.path,
        status: decision.status,
        reason: decision.reason,
        value: decision.value,
        originalValue: decision.originalValue
      });
    }
    return entries;
  }

  async applyCatalogChange(change, previewEntries) {
    const result = emptyResult();
    for (const entry of previewEntries) {
      if (entry.status !== "changed") {
        incrementResultForCatalogStatus(result, entry);
        continue;
      }
      try {
        await this.app.fileManager.processFrontMatter(entry.file, (frontmatter) => {
          const currentValue = frontmatter[change.oldName];
          if (!valuesEqual(currentValue, entry.originalValue)) {
            throw new SkippedOperationError("Value changed since preview");
          }
          const decision = evaluateCatalogChange(frontmatter, change);
          if (decision.status !== "changed") throw new SkippedOperationError(decision.reason);
          mutateCatalogChange(frontmatter, change, decision.value);
        });
        result.changed += 1;
      } catch (error) {
        if (error instanceof SkippedOperationError) {
          result.skipped += 1;
          result.reasons.push(`${entry.path}: ${error.message}`);
        } else {
          result.failed += 1;
          result.reasons.push(`${entry.path}: ${error && error.message ? error.message : String(error)}`);
        }
      }
    }
    return result;
  }

  async previewAction(action, context = null) {
    const files = this.resolveTargetFiles(action, context);
    const entries = [];
    const operation = normalizeAction(action);

    for (const file of files) {
      try {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
        const decisions = evaluateOperations(frontmatter, operation, { automatic: Boolean(operation.trigger) });
        const changed = decisions.filter((item) => item.status === "changed").length;
        entries.push({
          file,
          path: file.path,
          status: changed > 0 ? "changed" : "skipped",
          reason: summarizeOperationDecisions(decisions),
          operations: decisions
        });
      } catch (error) {
        const reason = `Could not read current frontmatter: ${error && error.message ? error.message : String(error)}`;
        entries.push({
          file,
          path: file.path,
          status: "failed",
          reason,
          operations: [{ status: "failed", reason }]
        });
      }
    }

    return entries;
  }

  evaluateFrontmatter(frontmatter, action) {
    const decisions = evaluateOperations(frontmatter, action);
    return decisions.find((item) => item.status === "changed") || decisions[0] || {
      status: "skipped",
      reason: "No property operations configured"
    };
  }

  async applyAction(action, previewEntries, options = {}) {
    const result = emptyResult();
    const operation = normalizeAction(action);
    const automatic = Boolean(operation.trigger);
    const incompatibleTypeRows = new Set();
    const failedTypeRows = new Set();
    const successfulTypeRows = new Set();
    let typeConversionFailed = false;

    for (const entry of previewEntries) {
      let outcome = { changed: 0, skipped: 0, failed: 0, incompatible: 0 };
      let callbackFailed = false;
      try {
        await this.app.fileManager.processFrontMatter(entry.file, (frontmatter) => {
          const decisions = evaluateOperations(frontmatter, operation, { automatic });
          outcome = applyOperations(frontmatter, operation, decisions, result, entry.path);
          for (const decision of decisions) {
            if (decision.status === "incompatible" && decision.propertyName) incompatibleTypeRows.add(decision.propertyName);
            if (operation.operation === ACTIONS.TYPE && decision.status === "changed" && decision.propertyName) successfulTypeRows.add(decision.propertyName);
            if (operation.operation === ACTIONS.TYPE && decision.status === "incompatible" && !automatic && options.allowIncompatibleTypeChange && decision.propertyName) successfulTypeRows.add(decision.propertyName);
          }
        });
      } catch (error) {
        callbackFailed = true;
        if (operation.operation === ACTIONS.TYPE) typeConversionFailed = true;
        result.failed += 1;
        result.filesFailed += 1;
        result.reasons.push(`${entry.path}: ${error && error.message ? error.message : String(error)}`);
      }
      if (operation.operation === ACTIONS.TYPE && outcome.failedRows) {
        for (const propertyName of outcome.failedRows) failedTypeRows.add(propertyName);
        if (outcome.failedRows.length > 0) typeConversionFailed = true;
      }
      if (outcome.changed > 0) result.changed += 1;
      if (!callbackFailed && outcome.failed > 0) {
        result.failed += 1;
        result.filesFailed += 1;
      }
      if (outcome.changed === 0 && outcome.failed === 0 && outcome.skipped > 0) result.skipped += 1;
      if (outcome.changed > 0) result.filesChanged += 1;
      if (outcome.changed === 0 && outcome.failed === 0 && outcome.skipped > 0) result.filesSkipped += 1;
    }

    if (operation.operation === ACTIONS.TYPE) {
      const registryRows = uniqueTypeOperations(operation.operations);
      for (const row of registryRows) {
        if (!successfulTypeRows.has(row.propertyName)) {
          result.registrySkipped += 1;
          result.reasons.push(`${row.propertyName}: native type synchronization skipped because no target contained a safely changeable value`);
          continue;
        }
        if (typeConversionFailed && failedTypeRows.has(row.propertyName)) {
          result.registrySkipped += 1;
          result.reasons.push(`${row.propertyName}: native type synchronization skipped because its value conversion failed`);
          continue;
        }
        if (typeConversionFailed && failedTypeRows.size === 0) {
          result.registrySkipped += 1;
          result.reasons.push(`${row.propertyName}: native type synchronization skipped because a target file conversion failed`);
          continue;
        }
        if (automatic && incompatibleTypeRows.has(row.propertyName)) {
          result.registrySkipped += 1;
          result.reasons.push(`${row.propertyName}: native type synchronization skipped because an automatic value conversion was incompatible`);
          continue;
        }
        if (!automatic && incompatibleTypeRows.has(row.propertyName) && !options.allowIncompatibleTypeChange) {
          result.registrySkipped += 1;
          result.reasons.push(`${row.propertyName}: native type synchronization requires explicit incompatible-value confirmation`);
          continue;
        }
        try {
          await this.updateNativePropertyTypeRegistry(row.propertyName, row.propertyName, row.propertyType);
        } catch (error) {
          result.registryFailed += 1;
          const reason = `native type synchronization failed: ${error && error.message ? error.message : String(error)}`;
          result.reasons.push(`${row.propertyName}: ${reason}`);
          recordOperationResult(result, "types.json", row, "failed", reason);
          continue;
        }
        const catalogProperty = (this.settings && this.settings.properties || []).find((property) => property.name === row.propertyName);
        if (catalogProperty) catalogProperty.type = row.propertyType;
      }
    }

    return result;
  }

  mutateFrontmatter(frontmatter, action) {
    const decisions = evaluateOperations(frontmatter, action);
    applyOperations(frontmatter, action, decisions, emptyResult(), "frontmatter");
  }

  async previewAndApplyAction(action, context = null, isAuto = false) {
    const actionKind = isAuto || action.trigger ? "auto" : "manual";
    const validationError = validateAction(action, actionKind);
    if (validationError) {
      const result = emptyResult();
      result.failed = 1;
      result.operationsFailed = normalizeOperations(action).length;
      result.reasons.push(`Action validation failed: ${validationError}`);
      action.lastResult = result;
      action.lastResultAt = new Date().toISOString();
      await this.saveSettings();
      if (!isAuto) new Notice(validationError);
      return result;
    }
    const previewEntries = await this.previewAction(action, context);
    const result = await this.applyAction(action, previewEntries);
    action.lastResult = result;
    action.lastResultAt = new Date().toISOString();
    await this.saveSettings();
    if (!isAuto) new ResultModal(this.app, result).open();
    return result;
  }

  async handleAutoEvent(file, eventName, oldPath) {
    if (!this.isAllowedMarkdownFile(file)) return;
    for (const action of this.settings.autoActions) {
      if (!action.enabled) continue;
      if (!this.autoActionMatches(action, file, eventName, oldPath)) continue;

      const runKey = `${action.id}:${eventName}:${file.path}:${oldPath || ""}`;
      if (this.autoRunKeys.has(runKey) || action.lastRunKey === runKey) continue;
      this.autoRunKeys.add(runKey);
      getOwnerWindow(this.app.workspace && this.app.workspace.containerEl).setTimeout(() => this.autoRunKeys.delete(runKey), 5000);

      action.lastRunKey = runKey;
      await this.previewAndApplyAction(action, {
        targetType: TARGETS.PROVIDED_FILES,
        files: [file],
        label: file.path,
        requiresConfirm: false
      }, true);
    }
  }

  autoActionMatches(action, file, eventName, oldPath) {
    if (action.trigger !== AUTO_TRIGGER) return false;
    const targets = action.autoTargets || [];
    const matched = targets.some((target) => targetMatchesPath(target, file.path));
    if (!matched) return false;
    if (eventName === "create") return true;
    if (eventName === "rename") {
      return !targets.some((target) => targetMatchesPath(target, oldPath));
    }
    return false;
  }
};

class SkippedOperationError extends Error {}

function evaluateOperations(frontmatter, action, options = {}) {
  const operations = normalizeOperations(action);
  const sourceNames = action.operation === ACTIONS.RENAME
    ? new Set(operations.map((row) => row.propertyName).filter(Boolean))
    : new Set();
  const automatic = Boolean(options.automatic);
  const allowOverwrite = Boolean(action.overwrite) && !automatic;

  return operations.map((row) => {
    const propertyName = row.propertyName;
    const hasProperty = Boolean(propertyName) && Object.prototype.hasOwnProperty.call(frontmatter, propertyName);

    if (!propertyName) return Object.assign({}, row, { status: "skipped", reason: "Missing property name" });

    if (action.operation === ACTIONS.ADD) {
      if (hasProperty && (!action.overwrite || automatic)) {
        return Object.assign({}, row, { status: "skipped", reason: automatic ? "Property already exists (automatic overwrite is disabled)" : "Property already exists" });
      }
      return Object.assign({}, row, { status: "changed", reason: hasProperty ? "Will overwrite property value" : "Will add property" });
    }

    if (action.operation === ACTIONS.REMOVE) {
      return Object.assign({}, row, hasProperty
        ? { status: "changed", reason: "Will remove property" }
        : { status: "skipped", reason: "Property does not exist" });
    }

    if (action.operation === ACTIONS.SET) {
      if (automatic && hasProperty) return Object.assign({}, row, { status: "skipped", reason: "Property already exists (automatic overwrite is disabled)" });
      if (!hasProperty && !action.addIfMissing) return Object.assign({}, row, { status: "skipped", reason: "Property does not exist" });
      return Object.assign({}, row, { status: "changed", reason: hasProperty ? "Will change property value" : "Will add missing property" });
    }

    if (action.operation === ACTIONS.RENAME) {
      const destination = row.newPropertyName;
      const hasDestination = Boolean(destination) && Object.prototype.hasOwnProperty.call(frontmatter, destination);
      if (!destination) return Object.assign({}, row, { status: "skipped", reason: "Missing new property name" });
      if (propertyName === destination) return Object.assign({}, row, { status: "skipped", reason: "Source and destination are the same" });
      if (!hasProperty) return Object.assign({}, row, { status: "skipped", reason: "Source property does not exist" });
      if (hasDestination && !sourceNames.has(destination) && !allowOverwrite) {
        return Object.assign({}, row, { status: "skipped", reason: automatic ? "Destination property already exists (automatic overwrite is disabled)" : "Destination property already exists" });
      }
      return Object.assign({}, row, { status: "changed", reason: hasDestination ? "Will overwrite destination property" : "Will rename property" });
    }

    if (action.operation === ACTIONS.TYPE) {
      if (!hasProperty) return Object.assign({}, row, { status: "skipped", reason: "Property does not exist" });
      if (!Object.values(PROPERTY_TYPES).includes(row.propertyType)) {
        return Object.assign({}, row, { status: "skipped", reason: "Unsupported property type" });
      }
      const currentValue = frontmatter[propertyName];
      if (!row.normalizeValues || isBlankPropertyValue(currentValue)) {
        return Object.assign({}, row, { status: "changed", reason: isBlankPropertyValue(currentValue) ? "Will preserve blank/null value and change type" : "Will change native property type" });
      }
      const converted = convertValueToPropertyType(currentValue, row.propertyType, row);
      if (!converted.ok) return Object.assign({}, row, { status: "incompatible", reason: converted.reason || "Value cannot be safely converted", originalValue: currentValue });
      if (valuesEqual(currentValue, converted.value)) {
        return Object.assign({}, row, { status: "changed", reason: "Value already matches selected type", value: converted.value, originalValue: currentValue });
      }
      return Object.assign({}, row, { status: "changed", reason: "Will convert value and change native property type", value: converted.value, originalValue: currentValue });
    }

    return Object.assign({}, row, { status: "skipped", reason: "Unknown operation" });
  });
}

function applyOperations(frontmatter, action, decisions, result, path) {
  const outcome = { changed: 0, skipped: 0, failed: 0, incompatible: 0, failedRows: [] };
  const changedRenames = decisions.filter((item) => item.status === "changed" && action.operation === ACTIONS.RENAME);
  const renameValues = new Map(changedRenames.map((item) => [item.propertyName, frontmatter[item.propertyName]]));

  if (action.operation === ACTIONS.RENAME && changedRenames.length > 0) {
    for (const row of changedRenames) delete frontmatter[row.propertyName];
    for (const row of changedRenames) frontmatter[row.newPropertyName] = renameValues.get(row.propertyName);
  }

  for (const decision of decisions) {
    if (decision.status === "changed") {
      if (action.operation !== ACTIONS.RENAME) {
        try {
          mutateOperation(frontmatter, action, decision);
        } catch (error) {
          outcome.failed += 1;
          outcome.failedRows.push(decision.propertyName);
          result.operationsFailed += 1;
          result.reasons.push(`${path}: ${decision.propertyName}: ${error && error.message ? error.message : String(error)}`);
          recordOperationResult(result, path, decision, "failed", error && error.message ? error.message : String(error));
          continue;
        }
      }
      outcome.changed += 1;
      result.operationsChanged += 1;
      recordOperationResult(result, path, decision, "changed", decision.reason);
      continue;
    }

    if (decision.status === "incompatible") {
      outcome.skipped += 1;
      outcome.incompatible += 1;
      result.operationsSkipped += 1;
      result.skippedIncompatible += 1;
      result.reasons.push(`${path}: ${decision.propertyName}: ${decision.reason}`);
      recordOperationResult(result, path, decision, "skipped", decision.reason);
      continue;
    }

    outcome.skipped += 1;
    result.operationsSkipped += 1;
    result.reasons.push(`${path}: ${decision.propertyName || "property"}: ${decision.reason}`);
    recordOperationResult(result, path, decision, "skipped", decision.reason);
  }
  return outcome;
}

function mutateOperation(frontmatter, action, row) {
  if (action.operation === ACTIONS.ADD || action.operation === ACTIONS.SET) {
    frontmatter[row.propertyName] = normalizeValueForType(row.value, row.propertyType);
    return;
  }
  if (action.operation === ACTIONS.REMOVE) {
    delete frontmatter[row.propertyName];
    return;
  }
  if (action.operation === ACTIONS.TYPE) {
    if (row.normalizeValues && !isBlankPropertyValue(row.value)) frontmatter[row.propertyName] = row.value;
    return;
  }
}

function recordOperationResult(result, path, operation, status, reason) {
  if (!Array.isArray(result.operationResults)) result.operationResults = [];
  result.operationResults.push({
    path,
    propertyName: operation.propertyName || "",
    status,
    reason
  });
}

function summarizeOperationDecisions(decisions) {
  if (!decisions || decisions.length === 0) return "No property operations configured";
  const changed = decisions.filter((item) => item.status === "changed").length;
  const incompatible = decisions.filter((item) => item.status === "incompatible").length;
  const skipped = decisions.filter((item) => item.status === "skipped").length;
  const parts = [];
  if (changed) parts.push(`${changed} change${changed === 1 ? "" : "s"}`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (incompatible) parts.push(`${incompatible} incompatible`);
  return parts.join(", ");
}

function uniqueTypeOperations(operations) {
  const seen = new Set();
  return (operations || []).filter((row) => {
    const key = `${row.propertyName}:${row.propertyType}`;
    if (!row.propertyName || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

class NativePropertyOperatorSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.section = "General";
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    this.renderBreadcrumb(containerEl);
    this.renderRootNav(containerEl);
    if (this.section === "General") this.renderGeneral(containerEl);
    if (this.section === "Properties") this.renderProperties(containerEl);
    if (this.section === "Manual actions") this.renderManualActions(containerEl);
    if (this.section === "Auto actions") this.renderAutoActions(containerEl);
  }

  renderBreadcrumb(containerEl) {
    const breadcrumbEl = containerEl.createDiv();
    breadcrumbEl.addClass("native-property-operator-style-001");
    breadcrumbEl.addClass("native-property-operator-style-002");
    breadcrumbEl.addClass("native-property-operator-style-003");
    breadcrumbEl.addClass("native-property-operator-style-004");
    breadcrumbEl.createEl("button", { text: "Native Property Operator" }, (button) => {
      button.addEventListener("click", () => this.openSection("General"));
    });
    breadcrumbEl.createSpan({ text: ">" });
    if (this.section === "General") {
      breadcrumbEl.createEl("button", { text: "General" }, (button) => {
        button.disabled = true;
      });
      return;
    }
    breadcrumbEl.createEl("button", { text: this.section }, (button) => {
      button.disabled = true;
    });
  }

  renderRootNav(containerEl) {
    const navEl = containerEl.createDiv();
    navEl.addClass("native-property-operator-style-005");
    navEl.addClass("native-property-operator-style-006");
    navEl.addClass("native-property-operator-style-007");
    navEl.addClass("native-property-operator-style-008");
    for (const section of ["General", "Properties", "Manual actions", "Auto actions"]) {
      navEl.createEl("button", { text: section }, (button) => {
        if (this.section === section) button.addClass("mod-cta");
        button.addEventListener("click", () => this.openSection(section));
      });
    }
  }

  openSection(section) {
    this.section = section;
    this.display();
  }

  renderGeneral(containerEl) {
    containerEl.createEl("p", {
      text: `Safety: this plugin only targets normal visible Markdown notes. It always ignores ${this.app.vault.configDir}, dot folders, hidden/internal folders, and non-Markdown files. This cannot be disabled.`
    });

    new Setting(containerEl)
      .setName("Add missing only")
      .setDesc("New add actions start with overwrite turned off.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.addMissingOnly)
          .onChange(async (value) => {
            this.plugin.settings.addMissingOnly = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Confirm overwrite")
      .setDesc("Require confirmation before an overwrite action is applied.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.confirmOverwrite)
          .onChange(async (value) => {
            this.plugin.settings.confirmOverwrite = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Suggest/picker threshold")
      .setDesc("Use filtered suggest when a picker has more entries than this.")
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.suggestLimit))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isInteger(parsed) && parsed > 0) {
              this.plugin.settings.suggestLimit = parsed;
              await this.plugin.saveSettings();
            }
          });
      });

    this.renderExcludedFolders(containerEl);
  }

  renderExcludedFolders(containerEl) {
    new Setting(containerEl).setName("Excluded visible folders").setHeading();
    if (this.plugin.settings.excludedFolders.length === 0) {
      containerEl.createEl("p", { text: "No excluded folders." });
    }

    for (const folder of this.plugin.settings.excludedFolders) {
      new Setting(containerEl)
        .setName(folder)
        .addButton((button) => {
          button.setButtonText("Edit").onClick(() => {
            new TextInputModal(this.app, "Edit excluded folder", folder, async (value) => {
              const normalized = normalizePathInput(value);
              this.plugin.settings.excludedFolders = uniqueStrings(
                this.plugin.settings.excludedFolders.map((item) => item === folder ? normalized : item).filter(Boolean)
              );
              await this.plugin.saveSettings();
              this.display();
            }).open();
          });
        })
        .addButton((button) => {
          button.setButtonText("Delete").setWarning().onClick(async () => {
            this.plugin.settings.excludedFolders = this.plugin.settings.excludedFolders.filter((item) => item !== folder);
            await this.plugin.saveSettings();
            this.display();
          });
        });
    }

    let pending = "";
    const folderOptions = this.plugin.getVisibleFolders();
    const addEl = containerEl.createDiv();
    addEl.addClass("native-property-operator-style-009");
    const labelEl = addEl.createDiv({ text: "Add excluded folder" });
    labelEl.addClass("native-property-operator-style-010");
    const wrapperEl = addEl.createDiv();
    wrapperEl.addClass("native-property-operator-style-011");
    wrapperEl.addClass("native-property-operator-style-012");
    const inputEl = wrapperEl.createEl("input", { type: "text" });
    inputEl.addClass("text-input");
    inputEl.addClass("native-property-operator-style-013");
    inputEl.addClass("native-property-operator-style-014");
    inputEl.placeholder = "Vault-relative visible folder path";
    inputEl.addEventListener("input", () => {
      pending = normalizeFolderPath(inputEl.value);
    });
    new FolderPathSuggest(inputEl, folderOptions, (folder) => {
      pending = folder;
      inputEl.value = folder;
    });
    const addButton = addEl.createEl("button", { text: "Add" });
    addButton.addClass("native-property-operator-style-015");
    addButton.addEventListener("click", async () => {
      if (!pending) {
        new Notice("Excluded folder is required.");
        return;
      }
      this.plugin.settings.excludedFolders = uniqueStrings(this.plugin.settings.excludedFolders.concat(normalizePathInput(pending)));
      await this.plugin.saveSettings();
      this.display();
    });
  }

  renderProperties(containerEl) {
    if (this.plugin.settings.properties.length === 0) {
      containerEl.createEl("p", { text: "No properties configured." });
    }

    for (const property of this.plugin.settings.properties) {
      let nextName = property.name;
      let nextType = property.type;
      const cardEl = containerEl.createDiv({ cls: "npo-property-card" });
      cardEl.addClass("native-property-operator-style-016");
      cardEl.addClass("native-property-operator-style-017");
      cardEl.addClass("native-property-operator-style-018");
      cardEl.addClass("native-property-operator-style-019");
      cardEl.addClass("native-property-operator-style-020");

      const mainRowEl = cardEl.createDiv({ cls: "npo-property-main-row" });
      mainRowEl.addClass("native-property-operator-style-021");
      mainRowEl.addClass("native-property-operator-style-022");
      mainRowEl.addClass("native-property-operator-style-023");
      mainRowEl.addClass("native-property-operator-style-024");

      const nameControlEl = mainRowEl.createDiv({ cls: "npo-property-name-control" });
      nameControlEl.addClass("native-property-operator-style-025");
      nameControlEl.addClass("native-property-operator-style-026");
      const nameLabelEl = nameControlEl.createDiv({ text: "Property name" });
      nameLabelEl.addClass("native-property-operator-style-027");
      nameLabelEl.addClass("native-property-operator-style-028");
      nameLabelEl.addClass("native-property-operator-style-029");
      nameLabelEl.addClass("native-property-operator-style-030");
      const inputEl = nameControlEl.createEl("input", { type: "text", value: property.name });
      inputEl.addClass("text-input");
      inputEl.addClass("native-property-operator-style-031");
      inputEl.addClass("native-property-operator-style-032");
      inputEl.addEventListener("input", () => {
        nextName = inputEl.value.trim();
      });

      const typeControlEl = mainRowEl.createDiv({ cls: "npo-property-type-control" });
      typeControlEl.addClass("native-property-operator-style-033");
      typeControlEl.addClass("native-property-operator-style-034");
      const typeLabelEl = typeControlEl.createDiv({ text: "Type" });
      typeLabelEl.addClass("native-property-operator-style-035");
      typeLabelEl.addClass("native-property-operator-style-036");
      typeLabelEl.addClass("native-property-operator-style-037");
      typeLabelEl.addClass("native-property-operator-style-038");
      const selectEl = typeControlEl.createEl("select");
      selectEl.addClass("dropdown");
      selectEl.addClass("native-property-operator-style-039");
      selectEl.addClass("native-property-operator-style-040");
      for (const type of Object.values(PROPERTY_TYPES)) {
        selectEl.createEl("option", { text: type, value: type });
      }
      selectEl.value = property.type;
      selectEl.addEventListener("change", () => {
        nextType = selectEl.value;
      });

      const actionsEl = cardEl.createDiv({ cls: "npo-property-button-row" });
      actionsEl.addClass("native-property-operator-style-041");
      actionsEl.addClass("native-property-operator-style-042");
      actionsEl.addClass("native-property-operator-style-043");
      actionsEl.addClass("native-property-operator-style-044");
      actionsEl.addClass("native-property-operator-style-045");
      actionsEl.addClass("native-property-operator-style-046");
      const applyButton = actionsEl.createEl("button", { text: "Apply changes..." });
      applyButton.addEventListener("click", () => {
        if (!nextName) {
          new Notice("Property name is required.");
          return;
        }
        if (this.plugin.settings.properties.some((item) => item.id !== property.id && item.name === nextName)) {
          new Notice("A catalog property with that name already exists.");
          return;
        }
        if (property.name === nextName && property.type === nextType) {
          new Notice("No property changes to apply.");
          return;
        }
        new PropertyCatalogApplyModal(this.app, this.plugin, {
          id: property.id,
          name: property.name,
          type: property.type
        }, nextName, nextType, () => this.display()).open();
      });
      const revertButton = actionsEl.createEl("button", { text: "Revert" });
      revertButton.addEventListener("click", () => {
        nextName = property.name;
        nextType = property.type;
        inputEl.value = property.name;
        selectEl.value = property.type;
      });
      const deleteButton = actionsEl.createEl("button", { text: "Delete from catalog" });
      deleteButton.addClass("mod-warning");
      deleteButton.addEventListener("click", async () => {
        const confirmed = await confirmModal(this.app, "Delete from catalog?", "This removes the property definition from the plugin catalog only. Notes will not be changed.");
        if (!confirmed) return;
        this.plugin.settings.properties = this.plugin.settings.properties.filter((item) => item.id !== property.id);
        await this.plugin.saveSettings();
        this.display();
      });
    }

    new Setting(containerEl).addButton((button) => {
      button.setButtonText("Add property").onClick(() => {
        new PropertyEditorModal(this.app, this.plugin, null, async (property) => {
          this.plugin.settings.properties.push(property);
          await this.plugin.saveSettings();
          this.display();
        }).open();
      });
    }).addButton((button) => {
      button.setButtonText("Add existing property").onClick(() => {
        const detected = this.plugin.scanDetectedProperties();
        if (detected.length === 0) {
          new Notice("No uncataloged properties detected in visible Markdown notes.");
          return;
        }
        new ExistingPropertyBrowserModal(this.app, detected, this.plugin.settings.properties.map((property) => property.name), async (item) => {
          if (this.plugin.settings.properties.some((property) => property.name === item.name)) {
            new Notice("Property is already in the catalog.");
            return;
          }
          this.plugin.settings.properties.push(normalizeProperty({
            id: createId(),
            name: item.name,
            type: item.inferredType
          }));
          await this.plugin.saveSettings();
          this.display();
          new Notice(`Added ${item.name} to the property catalog.`);
        }).open();
      });
    });
  }

  renderManualActions(containerEl) {
    if (this.plugin.settings.manualActions.length === 0) {
      containerEl.createEl("p", { text: "No saved manual actions." });
    }

    for (const action of this.plugin.settings.manualActions) {
      new Setting(containerEl)
        .setName(action.name)
        .setDesc(`${displayTarget(action)} - ${describeAction(action)} - ${displayResult(action.lastResult)}`)
        .addButton((button) => button.setButtonText("Preview").onClick(() => new PreviewModal(this.app, this.plugin, action, null, false).open()))
        .addButton((button) => button.setButtonText("Apply").setCta().onClick(() => new PreviewModal(this.app, this.plugin, action, null, false).open()))
        .addButton((button) => button.setButtonText("Edit").onClick(() => this.plugin.openManualActionEditor(action)))
        .addButton((button) => button.setButtonText("Delete").setWarning().onClick(async () => {
          this.plugin.settings.manualActions = this.plugin.settings.manualActions.filter((item) => item.id !== action.id);
          await this.plugin.saveSettings();
          this.display();
        }));
    }

    new Setting(containerEl).addButton((button) => {
      button.setButtonText("Add manual action").onClick(() => this.plugin.openManualActionEditor(null));
    });
  }

  renderAutoActions(containerEl) {
    if (this.plugin.settings.autoActions.length === 0) {
      containerEl.createEl("p", { text: "No auto actions." });
    }

    for (const action of this.plugin.settings.autoActions) {
      new Setting(containerEl)
        .setName(action.name)
        .setDesc(`${displayAutoTargets(action)} - New or moved Markdown note - ${describeAction(action)} - ${displayResult(action.lastResult)}${displayInitialSyncResult(action)}`)
        .addToggle((toggle) => toggle.setValue(Boolean(action.enabled)).onChange(async (value) => {
          if (value && !action.enabled && !action.lastInitialSyncAt) {
            const choice = await initialSyncPrompt(this.app);
            if (choice === "cancel") {
              this.display();
              return;
            }
            if (choice === "preview") {
              this.plugin.openAutoSyncPreview(action, true);
              this.display();
              return;
            }
          }
          action.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        }))
        .addButton((button) => button.setButtonText("Sync existing notes").onClick(() => this.plugin.openAutoSyncPreview(action, false)))
        .addButton((button) => button.setButtonText("Edit").onClick(() => this.plugin.openAutoActionEditor(action)))
        .addButton((button) => button.setButtonText("Delete").setWarning().onClick(async () => {
          this.plugin.settings.autoActions = this.plugin.settings.autoActions.filter((item) => item.id !== action.id);
          await this.plugin.saveSettings();
          this.display();
        }));
    }

    new Setting(containerEl).addButton((button) => {
      button.setButtonText("Add auto action").onClick(() => this.plugin.openAutoActionEditor(null));
    });
  }

  addTextAdder(containerEl, name, placeholder, onAdd) {
    let pending = "";
    new Setting(containerEl)
      .setName(name)
      .addText((text) => text.setPlaceholder(placeholder).onChange((value) => {
        pending = value.trim();
      }))
      .addButton((button) => button.setButtonText("Add").onClick(async () => {
        if (!pending) {
          new Notice(`${name} is required.`);
          return;
        }
        await onAdd(pending);
      }));
  }

}

class PropertyEditorModal extends Modal {
  constructor(app, plugin, property, onSave) {
    super(app);
    this.plugin = plugin;
    this.property = Object.assign({ id: createId(), name: "", type: PROPERTY_TYPES.TEXT }, property || {});
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.property.name ? "Edit property" : "Add property" });

    new Setting(contentEl)
      .setName("Property name")
      .addText((text) => text.setValue(this.property.name).onChange((value) => {
        this.property.name = value.trim();
      }));

    new Setting(contentEl)
      .setName("Native Obsidian property type")
      .addDropdown((dropdown) => {
        for (const type of Object.values(PROPERTY_TYPES)) dropdown.addOption(type, type);
        dropdown.setValue(this.property.type).onChange((value) => {
          this.property.type = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Save").setCta().onClick(async () => {
        if (!this.property.name) {
          new Notice("Property name is required.");
          return;
        }
        await this.onSave(normalizeProperty(this.property));
        this.close();
      }));
  }
}

class PropertyCatalogApplyModal extends Modal {
  constructor(app, plugin, property, newName, newType, onDone) {
    super(app);
    this.plugin = plugin;
    this.property = property;
    this.oldName = property.name;
    this.oldType = property.type;
    this.newName = String(newName || "").trim();
    this.newType = Object.values(PROPERTY_TYPES).includes(newType) ? newType : PROPERTY_TYPES.TEXT;
    this.onDone = onDone;
    this.overwrite = false;
    this.normalizeValues = shouldDefaultNormalizeCatalogChange(this.oldType, this.newType);
    this.dateSourceFormat = "auto";
    this.dateOnlyToMidnight = false;
    this.allowIncompatibleTypeChange = false;
    this.previewEntries = [];
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Apply property catalog change" });
    contentEl.createEl("p", {
      text: `Catalog change: ${this.oldName} (${this.oldType}) -> ${this.newName || "(missing name)"} (${this.newType}).`
    });
    contentEl.createEl("p", {
      text: "Property type changes are separated into catalog metadata, safe frontmatter value conversion, and the native property type registry. Preview before applying."
    });

    new Setting(contentEl)
      .setName("Previous type")
      .setDesc(this.oldType);

    new Setting(contentEl)
      .setName("New type")
      .setDesc(this.newType);

    if (this.oldName !== this.newName) {
      new Setting(contentEl)
        .setName("Overwrite destination conflicts")
        .setDesc("If a note already has the new property name, overwrite it instead of skipping.")
        .addToggle((toggle) => toggle.setValue(this.overwrite).onChange((value) => {
          this.overwrite = value;
          this.previewEntries = [];
          this.render();
        }));
    }

    new Setting(contentEl)
      .setName("Convert existing values")
      .setDesc("Conservative conversion only. Blank/null values are preserved. Unsafe or ambiguous values are reported and preserved.")
      .addToggle((toggle) => toggle.setValue(this.normalizeValues).onChange((value) => {
        this.normalizeValues = value;
        this.previewEntries = [];
        this.render();
      }));

    if (this.normalizeValues && this.newType === PROPERTY_TYPES.DATE && this.oldType === PROPERTY_TYPES.TEXT) {
      new Setting(contentEl)
        .setName("Source date format")
        .setDesc("Auto accepts only unambiguous ISO formats.")
        .addDropdown((dropdown) => dropdown
          .addOption("auto", "Auto: unambiguous ISO formats only")
          .addOption("ymd", "YYYY-MM-DD")
          .addOption("dmy", "DD/MM/YYYY")
          .addOption("mdy", "MM/DD/YYYY")
          .setValue(this.dateSourceFormat)
          .onChange((value) => {
            this.dateSourceFormat = value;
            this.previewEntries = [];
            this.render();
          }));
    }

    if (this.normalizeValues && this.newType === PROPERTY_TYPES.DATETIME) {
      new Setting(contentEl)
        .setName("Convert date-only values to 00:00:00")
        .setDesc("When off, date-only values are incompatible with Date & time.")
        .addToggle((toggle) => toggle.setValue(this.dateOnlyToMidnight).onChange((value) => {
          this.dateOnlyToMidnight = value;
          this.previewEntries = [];
          this.render();
        }));
    }

    new Setting(contentEl)
      .setName("Target scope")
      .setDesc("Visible Markdown notes only. Hidden folders, the configured vault config folder, excluded folders, and non-Markdown files are ignored.");

    if (this.previewEntries.length > 0) this.renderPreview(contentEl);

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Preview").onClick(() => this.preview()))
      .addButton((button) => button.setButtonText("Apply").setCta().onClick(() => this.apply()));
  }

  getChange() {
    return {
      propertyId: this.property.id,
      oldName: this.oldName,
      oldType: this.oldType,
      newName: this.newName,
      newType: this.newType,
      overwrite: this.overwrite,
      normalizeValues: this.normalizeValues,
      dateSourceFormat: this.dateSourceFormat,
      dateOnlyToMidnight: this.dateOnlyToMidnight
    };
  }

  preview() {
    if (!this.newName) {
      new Notice("New property name is required.");
      return;
    }
    if (this.oldName === this.newName && this.oldType === this.newType && !this.normalizeValues) {
      new Notice("No property changes to apply.");
      return;
    }
    this.previewEntries = this.plugin.previewCatalogChange(this.getChange());
    this.render();
  }

  renderPreview(contentEl) {
    const summary = summarizeCatalogPreview(this.previewEntries);
    contentEl.createEl("h3", { text: "Preview" });
    contentEl.createEl("p", {
      text: `Files checked: ${summary.total}. Compatible changes: ${summary.changed}. Already valid/unchanged: ${summary.unchanged}. Blank preserved: ${summary.blank}. Incompatible: ${summary.incompatible}. Other skipped: ${summary.skipped}. Failed reads: ${summary.failed}.`
    });
    const list = contentEl.createEl("ul");
    const representative = this.previewEntries
      .filter((entry) => entry.status !== "skipped" || entry.reason !== `${this.oldName} does not exist`)
      .slice(0, 50);
    for (const entry of representative) {
      const valuePreview = entry.status === "changed" && !valuesEqual(entry.originalValue, entry.value)
        ? `: ${displayValueForPreview(entry.originalValue)} -> ${displayValueForPreview(entry.value)}`
        : "";
      list.createEl("li", { text: `${entry.status}: ${entry.path} (${entry.reason})${valuePreview}` });
    }
    if (this.previewEntries.length > representative.length) {
      contentEl.createEl("p", { text: `Showing ${representative.length} representative notes from ${this.previewEntries.length} checked.` });
    }
  }

  async apply() {
    if (!this.newName) {
      new Notice("New property name is required.");
      return;
    }
    if (this.previewEntries.length === 0) this.preview();
    const hasCatalogChange = this.oldName !== this.newName || this.oldType !== this.newType;
    if (this.previewEntries.length === 0 && !hasCatalogChange) return;

    const summary = summarizeCatalogPreview(this.previewEntries);
    if (summary.incompatible > 0 && hasCatalogChange && isDateLikePropertyType(this.newType)) {
      const proceed = await confirmModal(
        this.app,
        "Preserve incompatible values and change type?",
        `${summary.incompatible} value(s) cannot be safely converted. Choose Apply only to convert compatible values, preserve incompatible values unchanged, and still change the native property type.`
      );
      if (!proceed) return;
      this.allowIncompatibleTypeChange = true;
    }

    if (summary.changed > 1) {
      const confirmed = await confirmModal(this.app, "Apply property catalog change?", `This will modify ${summary.changed} visible Markdown note(s).`);
      if (!confirmed) return;
    }
    if (summary.changed > 0 && this.overwrite && this.plugin.settings.confirmOverwrite) {
      const confirmedOverwrite = await confirmModal(this.app, "Confirm overwrite", "Overwrite is enabled. Existing destination property values may be replaced.");
      if (!confirmedOverwrite) return;
    }

    let result = emptyResult();
    if (summary.changed > 0) {
      result = await this.plugin.applyCatalogChange(this.getChange(), this.previewEntries);
    } else {
      result.blank = summary.blank;
      result.unchanged = summary.unchanged;
      result.skippedIncompatible = summary.incompatible;
      result.skipped = summary.skipped + summary.incompatible + summary.blank + summary.unchanged;
    }

    if (result.failed > 0) {
      new ResultModal(this.app, result).open();
      new Notice("Catalog update cancelled because one or more file conversions failed.");
      return;
    }

    this.plugin.settings.properties = this.plugin.settings.properties.map((item) => {
      if (item.id !== this.property.id) return item;
      return normalizeProperty(Object.assign({}, item, { name: this.newName, type: this.newType }));
    });
    await this.plugin.saveSettings();
    try {
      await this.plugin.updateNativePropertyTypeRegistry(this.oldName, this.newName, this.newType);
    } catch (error) {
      new Notice(`Catalog saved, but native property type update failed: ${error && error.message ? error.message : String(error)}`);
      console.error("Native Property Operator: failed to update native property type registry.", error);
    }
    if (this.onDone) this.onDone();
    if (summary.changed > 0 || result.reasons.length > 0) new ResultModal(this.app, result).open();
    else new Notice("Catalog and native property type updated. No note changes to apply.");
    this.close();
  }
}

class ExistingPropertyBrowserModal extends Modal {
  constructor(app, items, catalogNames, onChoose) {
    super(app);
    this.items = items;
    this.catalogNames = catalogNames;
    this.onChoose = onChoose;
    this.query = "";
    this.filteredItems = [];
    this.selectedIndex = 0;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("npo-existing-property-browser");
    contentEl.createEl("h2", { text: "Add existing property" });
    const searchSetting = new Setting(contentEl).setName("Search properties");
    searchSetting.settingEl.addClass("npo-existing-property-search");
    searchSetting.addText((text) => {
      this.inputEl = text.inputEl;
      text.setPlaceholder("Type to filter, or leave blank to browse all").onChange((value) => {
        this.query = value;
        this.selectedIndex = 0;
        this.renderResults();
      });
      text.inputEl.addEventListener("keydown", (event) => this.handleKeydown(event));
    });
    this.resultsEl = contentEl.createDiv({ cls: "npo-existing-property-results" });
    this.renderResults();
    focusWithoutScroll(this.inputEl);
  }

  renderResults() {
    this.filteredItems = filterExistingPropertyCandidates(this.items, this.query, this.catalogNames);
    this.resultsEl.empty();
    if (this.filteredItems.length === 0) {
      this.resultsEl.createDiv({ cls: "npo-existing-property-empty", text: "No matching uncataloged properties." });
      return;
    }
    this.selectedIndex = Math.min(this.selectedIndex, this.filteredItems.length - 1);
    for (const [index, item] of this.filteredItems.entries()) {
      const rowEl = this.resultsEl.createEl("button", {
        cls: "npo-existing-property-result",
        text: formatExistingPropertyCandidate(item)
      });
      rowEl.toggleClass("npo-existing-property-result-selected", index === this.selectedIndex);
      rowEl.addEventListener("click", () => this.chooseSelected(index));
    }
  }

  handleKeydown(event) {
    const keys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Enter", "Escape"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      this.close();
      return;
    }
    if (event.key === "Enter") {
      this.chooseSelected(this.selectedIndex);
      return;
    }
    if (this.filteredItems.length === 0) return;
    if (event.key === "Home") this.selectedIndex = 0;
    else if (event.key === "End") this.selectedIndex = this.filteredItems.length - 1;
    else if (event.key === "ArrowUp") this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    else if (event.key === "ArrowDown") this.selectedIndex = Math.min(this.filteredItems.length - 1, this.selectedIndex + 1);
    else if (event.key === "PageUp") this.selectedIndex = Math.max(0, this.selectedIndex - 10);
    else if (event.key === "PageDown") this.selectedIndex = Math.min(this.filteredItems.length - 1, this.selectedIndex + 10);
    this.renderResults();
    const selectedEl = this.resultsEl.children[this.selectedIndex];
    if (selectedEl && typeof selectedEl.scrollIntoView === "function") selectedEl.scrollIntoView({ block: "nearest" });
  }

  async chooseSelected(index) {
    const item = this.filteredItems[index];
    if (!item) return;
    this.close();
    try {
      await this.onChoose(item);
    } catch (error) {
      new Notice(`Could not add property: ${error && error.message ? error.message : String(error)}`);
    }
  }
}

class ActionEditorModal extends Modal {
  constructor(app, plugin, kind, action, context) {
    super(app);
    this.plugin = plugin;
    this.kind = kind;
    this.context = context;
    this.pendingOperationFocusIndex = null;
    this.action = normalizeAction(action || createEmptyAction(kind));
    if (!action && this.action.operation === ACTIONS.ADD) {
      this.action.overwrite = !this.plugin.settings.addMissingOnly;
    }
    if (context) {
      this.action.targetType = TARGETS.SPECIFIC_TARGETS;
      this.action.targets = context.targetPath && context.files && context.files.length === 1
        ? [{ type: TARGETS.FILE, path: context.files[0].path }]
        : [{ type: TARGETS.FOLDER, path: normalizeFolderPath(context.targetPath || "/") }];
    }
  }

  onOpen() {
    this.render();
  }

  render(options = {}) {
    const { contentEl } = this;
    const scrollState = options.scrollState || null;
    this.renderedOperationFocusTarget = null;
    contentEl.empty();
    contentEl.addClass("npo-action-editor-content");
    contentEl.createEl("h2", { text: this.kind === "auto" ? "Auto action" : "Manual action" });

    new Setting(contentEl)
      .setName("Name")
      .addText((text) => text.setValue(this.action.name).onChange((value) => {
        this.action.name = value.trim();
      }));

    if (this.kind === "auto") {
      new Setting(contentEl)
        .setName("Trigger")
        .setDesc("Runs when a Markdown note is created in or moved into a selected folder tree, or matches a selected file target.")
        .addText((text) => text.setValue("New or moved Markdown note").setDisabled(true));

      this.addAutoTargetsSetting(contentEl);
    } else {
      this.addManualTargetSetting(contentEl);
    }

    const operationSetting = new Setting(contentEl).setName("Operation");
    operationSetting.settingEl.addClass("npo-operation-selector");
    operationSetting.controlEl.addClass("npo-operation-selector-control");
    operationSetting.addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(ACTION_LABELS)) dropdown.addOption(value, label);
        dropdown.setValue(this.action.operation).onChange((value) => {
          this.action.operations = convertOperationsForOperation(this.action.operations, this.action.operation, value);
          this.action.operation = value;
          this.rerenderPreservingScroll();
        });
      });

    this.addOperationEditor(contentEl);

    if (this.action.operation === ACTIONS.ADD || this.action.operation === ACTIONS.RENAME) {
      new Setting(contentEl)
        .setName("Overwrite existing values")
        .setDesc("Explicit overwrite requires confirmation when applied manually.")
        .addToggle((toggle) => toggle.setValue(Boolean(this.action.overwrite)).onChange((value) => {
          this.action.overwrite = value;
        }));
    }

    if (this.action.operation === ACTIONS.SET) {
      new Setting(contentEl)
        .setName("Add if missing")
        .setDesc("Off by default. Otherwise set/change only updates existing properties.")
        .addToggle((toggle) => toggle.setValue(Boolean(this.action.addIfMissing)).onChange((value) => {
          this.action.addIfMissing = value;
        }));
    }

    const footerEl = contentEl.createDiv({ cls: "npo-action-editor-footer" });
    new Setting(footerEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Save").setCta().onClick(async () => {
        const error = validateAction(this.action, this.kind);
        if (error) {
          new Notice(error);
          return;
        }
        try {
          await this.saveAction();
          this.close();
        } catch (error) {
          new Notice(`Could not save action: ${error && error.message ? error.message : String(error)}`);
        }
      }));

    const focusTarget = this.renderedOperationFocusTarget;
    scheduleModalScrollRestore(contentEl, scrollState, () => {
      if (focusTarget) revealOperationCardWithoutJump(contentEl, focusTarget.cardEl, focusTarget.inputEl);
    });
  }

  rerenderPreservingScroll(options = {}) {
    const scrollState = captureModalScrollState(this.contentEl);
    if (Number.isInteger(options.focusOperationIndex)) this.pendingOperationFocusIndex = options.focusOperationIndex;
    this.render({ scrollState });
  }

  addOperationEditor(contentEl) {
    const fieldEl = this.createVerticalField(
      contentEl,
      ACTION_LABELS[this.action.operation],
      "Configure one or more typed property operations. Each row is applied independently within the target note transaction."
    );
    fieldEl.addClass("npo-operation-section");
    const operations = this.action.operations || (this.action.operations = [defaultOperation(this.action.operation)]);
    const editorModel = buildOperationEditorModel(this.action.operation, operations);
    const listEl = fieldEl.createDiv({ cls: "npo-operation-list" });
    if (editorModel.cards.length === 0) {
      listEl.createDiv({ cls: "npo-operation-empty-state", text: "No properties configured." });
    }

    const candidates = this.plugin.buildPropertyCandidates(this.plugin.resolveTargetFiles(this.action, this.context));
    for (const card of editorModel.cards) {
      const { index, row } = card;
      const cardEl = listEl.createDiv({ cls: "npo-operation-card" });
      cardEl.setAttr("data-operation-index", String(index));
      const headerEl = cardEl.createDiv({ cls: "npo-operation-card-header" });
      headerEl.createDiv({ cls: "npo-operation-card-title", text: card.title });
      const removeButton = this.createSmallButton(headerEl, "Remove", () => {
        this.action.operations.splice(index, 1);
        this.rerenderPreservingScroll();
      });
      removeButton.addClass("npo-operation-card-remove");
      const fieldsEl = cardEl.createDiv({ cls: "npo-operation-card-fields" });

      const sourceSetting = new Setting(fieldsEl).setName(card.fields[0]);
      const sourceInput = this.createFullWidthInput(sourceSetting.controlEl, row.propertyName || "");
      sourceInput.placeholder = this.action.operation === ACTIONS.RENAME ? "Old property name" : "Property name";
      sourceInput.addEventListener("input", () => {
        row.propertyName = sourceInput.value.trim();
        if (this.action.operation !== ACTIONS.REMOVE && this.action.operation !== ACTIONS.RENAME) {
          row.propertyType = this.plugin.getPropertyType(row.propertyName, row.propertyType || PROPERTY_TYPES.TEXT);
        }
      });
      new PropertyInputSuggest(sourceInput, () => filterOperationPropertyCandidates(
        candidates,
        this.action.operations,
        index
      ), (candidate) => {
        row.propertyName = candidate.name;
        if (this.action.operation !== ACTIONS.REMOVE && this.action.operation !== ACTIONS.RENAME) {
          row.propertyType = this.plugin.getPropertyType(candidate.name, row.propertyType || PROPERTY_TYPES.TEXT);
        }
        this.rerenderPreservingScroll();
      });

      if (this.pendingOperationFocusIndex === index) {
        this.pendingOperationFocusIndex = null;
        this.renderedOperationFocusTarget = { cardEl, inputEl: sourceInput };
      }

      if (this.action.operation === ACTIONS.RENAME) {
        const destinationSetting = new Setting(fieldsEl).setName("New property name");
        const destinationInput = this.createFullWidthInput(destinationSetting.controlEl, row.newPropertyName || "");
        destinationInput.placeholder = "New property name";
        destinationInput.addEventListener("input", () => {
          row.newPropertyName = destinationInput.value.trim();
        });
      }

      if (this.action.operation === ACTIONS.ADD || this.action.operation === ACTIONS.SET || this.action.operation === ACTIONS.TYPE) {
        const typeSetting = new Setting(fieldsEl).setName(this.action.operation === ACTIONS.TYPE ? "Target type" : "Type");
        typeSetting.addDropdown((dropdown) => {
          for (const type of Object.values(PROPERTY_TYPES)) dropdown.addOption(type, type);
          dropdown.setValue(row.propertyType || PROPERTY_TYPES.TEXT).onChange((value) => {
            row.propertyType = value;
            this.rerenderPreservingScroll();
          });
        });
        if (this.action.operation !== ACTIONS.TYPE) this.addOperationValueEditor(fieldsEl, row);
        else this.addTypeConversionOptions(fieldsEl, row);
      }
    }

    const addButtonContainer = fieldEl.createDiv({ cls: "npo-operation-add-button" });
    this.createSmallButton(addButtonContainer, editorModel.addButtonLabel, () => {
      this.action.operations.push(defaultOperation(this.action.operation));
      this.rerenderPreservingScroll({ focusOperationIndex: this.action.operations.length - 1 });
    });
  }

  addOperationValueEditor(containerEl, row) {
    const type = row.propertyType || PROPERTY_TYPES.TEXT;
    if (type === PROPERTY_TYPES.CHECKBOX) {
      new Setting(containerEl)
        .setName("Value")
        .addToggle((toggle) => toggle.setValue(row.value === true || row.value === "true").onChange((value) => {
          row.value = value;
        }));
      return;
    }
    if (type === PROPERTY_TYPES.LIST || type === PROPERTY_TYPES.TAGS) {
      new Setting(containerEl)
        .setName("Value")
        .setDesc("Comma-separated values.")
        .addTextArea((text) => text.setValue(Array.isArray(row.value) ? row.value.join(", ") : String(row.value || "")).onChange((value) => {
          row.value = value;
        }));
      return;
    }
    new Setting(containerEl)
      .setName("Value")
      .addText((text) => {
        text.setValue(String(row.value == null ? "" : row.value)).onChange((value) => {
          row.value = value;
        });
        if (type === PROPERTY_TYPES.NUMBER) text.inputEl.type = "number";
        if (type === PROPERTY_TYPES.DATE) text.inputEl.type = "date";
        if (type === PROPERTY_TYPES.DATETIME) text.inputEl.type = "datetime-local";
      });
  }

  addTypeConversionOptions(containerEl, row) {
    new Setting(containerEl)
      .setName("Convert existing values")
      .setDesc("Unsafe values are preserved and reported as incompatible.")
      .addToggle((toggle) => toggle.setValue(row.normalizeValues !== false).onChange((value) => {
        row.normalizeValues = value;
      }));
    if (row.propertyType === PROPERTY_TYPES.DATE) {
      new Setting(containerEl)
        .setName("Source date format")
        .addDropdown((dropdown) => dropdown
          .addOption("auto", "Auto: unambiguous ISO only")
          .addOption("ymd", "YYYY-MM-DD")
          .addOption("dmy", "DD/MM/YYYY")
          .addOption("mdy", "MM/DD/YYYY")
          .setValue(row.dateSourceFormat || "auto")
          .onChange((value) => { row.dateSourceFormat = value; }));
    }
    if (row.propertyType === PROPERTY_TYPES.DATETIME) {
      new Setting(containerEl)
        .setName("Date-only values to midnight")
        .addToggle((toggle) => toggle.setValue(Boolean(row.dateOnlyToMidnight)).onChange((value) => {
          row.dateOnlyToMidnight = value;
        }));
    }
  }

  addManualTargetSetting(contentEl) {
    const targetSetting = new Setting(contentEl).setName("Target");
    targetSetting.settingEl.addClass("npo-target-selector");
    targetSetting.controlEl.addClass("npo-target-selector-control");
    targetSetting.addDropdown((dropdown) => {
        dropdown
          .addOption(TARGETS.CURRENT_FILE, TARGET_LABELS[TARGETS.CURRENT_FILE])
          .addOption(TARGETS.CURRENT_FOLDER, TARGET_LABELS[TARGETS.CURRENT_FOLDER])
          .addOption(TARGETS.SPECIFIC_TARGETS, TARGET_LABELS[TARGETS.SPECIFIC_TARGETS])
          .setValue(this.action.targetType)
          .onChange((value) => {
            this.action.targetType = value;
            if (value === TARGETS.SPECIFIC_TARGETS && !this.action.targets) this.action.targets = [];
            this.rerenderPreservingScroll();
          });
      });

    if (this.action.targetType === TARGETS.SPECIFIC_TARGETS) this.addSpecificTargetsSetting(contentEl);
  }

  addAutoTargetsSetting(contentEl) {
    this.addTargetSelectionSetting(contentEl, true);
  }

  addSpecificTargetsSetting(contentEl) {
    this.addTargetSelectionSetting(contentEl, false);
  }

  addTargetSelectionSetting(contentEl, automatic) {
    const fieldEl = this.createVerticalField(
      contentEl,
      "Selected targets",
      "Folder targets include all Markdown notes in the selected folder and its subfolders. File targets match only that exact Markdown file."
    );
    fieldEl.addClass("npo-target-section");
    const targets = automatic ? (this.action.autoTargets || []) : (this.action.targets || []);
    const listEl = fieldEl.createDiv({ cls: "npo-target-list" });
    if (targets.length === 0) {
      listEl.createDiv({ cls: "npo-target-empty-state", text: "No targets selected." });
    }
    for (const [index, target] of targets.entries()) {
      const rowEl = listEl.createDiv({ cls: "npo-target-row" });
      const label = target.type === TARGETS.FOLDER ? displayFolderPath(target.path) : target.path;
      rowEl.createSpan({ cls: "npo-target-label", text: `${target.type === TARGETS.FOLDER ? "Folder" : "File"}: ${label}` });
      const removeButton = rowEl.createEl("button", { text: "Remove" });
      removeButton.addClass("npo-target-remove");
      removeButton.addEventListener("click", () => {
        this.setEditorTargets(targets.filter((_, itemIndex) => itemIndex !== index), automatic);
        this.rerenderPreservingScroll();
      });
    }
    const addersEl = fieldEl.createDiv({ cls: "npo-target-adders" });
    const folderOptions = this.filterAvailableTargets(targets, TARGETS.FOLDER, this.plugin.getVisibleFolders());
    const fileOptions = this.filterAvailableTargets(targets, TARGETS.FILE, this.plugin.getVisibleMarkdownFilePaths());
    this.addTargetAutocomplete(addersEl, "Add folder", "Visible vault folder path. The full folder tree is included.", TARGETS.FOLDER, folderOptions, automatic);
    this.addTargetAutocomplete(addersEl, "Add file", "Visible Markdown note path.", TARGETS.FILE, fileOptions, automatic);
  }

  setEditorTargets(targets, automatic) {
    if (automatic) this.action.autoTargets = uniqueTargets(targets);
    else {
      this.action.targets = uniqueTargets(targets);
      this.action.targetType = TARGETS.SPECIFIC_TARGETS;
    }
  }

  addTargetAutocomplete(containerEl, label, desc, type, options, automatic) {
    const fieldEl = this.createVerticalField(containerEl, label, desc);
    fieldEl.addClass("npo-target-adder");
    const inputEl = this.createFullWidthInput(fieldEl, "");
    let pending = "";
    inputEl.addEventListener("input", () => {
      pending = type === TARGETS.FOLDER ? normalizeFolderPath(inputEl.value) : inputEl.value.trim();
    });
    const addTarget = (path) => {
      const normalized = type === TARGETS.FOLDER ? normalizeFolderPath(path) : String(path || "").trim();
      if (!normalized) {
        new Notice(`${label} path is required.`);
        return;
      }
      const targets = automatic ? (this.action.autoTargets || []) : (this.action.targets || []);
      if (targets.some((target) => target.type === type && target.path === normalized)) {
        new Notice(`${type === TARGETS.FOLDER ? "Folder" : "File"} target is already selected.`);
        return;
      }
      this.setEditorTargets(targets.concat({ type, path: normalized }), automatic);
      this.rerenderPreservingScroll();
    };
    if (type === TARGETS.FOLDER) new FolderPathSuggest(inputEl, options, addTarget);
    else new MarkdownFilePathSuggest(inputEl, options, addTarget);
    const addButton = fieldEl.createEl("button", { text: label });
    addButton.addClass("native-property-operator-style-074");
    addButton.addEventListener("click", () => addTarget(pending));
  }

  filterAvailableTargets(targets, type, options) {
    const existing = new Set((targets || [])
      .filter((target) => target.type === type)
      .map((target) => type === TARGETS.FOLDER ? normalizeFolderPath(target.path) : String(target.path || "").trim()));
    return options.filter((option) => {
      const normalized = type === TARGETS.FOLDER ? normalizeFolderPath(option) : String(option || "").trim();
      return normalized && !existing.has(normalized);
    });
  }

  createVerticalField(containerEl, label, desc) {
    const fieldEl = containerEl.createDiv({ cls: "npo-vertical-field" });
    fieldEl.addClass("native-property-operator-style-078");
    const labelEl = fieldEl.createDiv({ text: label });
    labelEl.addClass("native-property-operator-style-079");
    if (desc) {
      const descEl = fieldEl.createDiv({ text: desc });
      descEl.addClass("native-property-operator-style-080");
      descEl.addClass("native-property-operator-style-081");
      descEl.addClass("native-property-operator-style-082");
    }
    return fieldEl;
  }

  createFullWidthInput(containerEl, value) {
    const wrapperEl = containerEl.createDiv({ cls: "npo-suggest-wrapper" });
    wrapperEl.addClass("native-property-operator-style-083");
    const inputEl = wrapperEl.createEl("input", { type: "text", value: value || "" });
    inputEl.addClass("text-input");
    inputEl.addClass("native-property-operator-style-084");
    inputEl.addClass("native-property-operator-style-085");
    return inputEl;
  }

  createSmallButton(containerEl, label, onClick) {
    const button = containerEl.createEl("button", { text: label });
    button.addClass("native-property-operator-style-086");
    button.addEventListener("click", onClick);
    return button;
  }

  async saveAction() {
    const action = normalizeAction(this.action);
    if (this.kind === "auto") {
      const index = this.plugin.settings.autoActions.findIndex((item) => item.id === action.id);
      if (index >= 0) this.plugin.settings.autoActions[index] = action;
      else this.plugin.settings.autoActions.push(action);
    } else {
      const index = this.plugin.settings.manualActions.findIndex((item) => item.id === action.id);
      if (index >= 0) this.plugin.settings.manualActions[index] = action;
      else this.plugin.settings.manualActions.push(action);
    }
    await this.plugin.saveSettings();
    if (this.plugin.settingTab) {
      this.plugin.settingTab.section = this.kind === "auto" ? "Auto actions" : "Manual actions";
      this.plugin.settingTab.display();
    }
    new Notice(this.kind === "auto" ? "Auto action saved." : "Manual action saved.");
  }
}

class PreviewModal extends Modal {
  constructor(app, plugin, action, context, applyImmediately) {
    super(app);
    this.plugin = plugin;
    this.action = action;
    this.context = context;
    this.applyImmediately = applyImmediately;
    this.previewEntries = [];
  }

  async onOpen() {
    const error = validateAction(this.action, this.action.trigger ? "auto" : "manual");
    if (error) {
      new Notice(error);
      this.close();
      return;
    }

    this.previewEntries = await this.plugin.previewAction(this.action, this.context);
    this.render();
    if (this.applyImmediately) await this.apply();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Preview: ${this.action.name}` });

    const previewState = buildActionPreviewState(this.previewEntries, this.action, this.context);
    const counts = previewState.counts;
    if (previewState.kind === "no-files") {
      contentEl.createEl("p", { cls: "npo-preview-no-files", text: previewState.message });
    } else {
      contentEl.createEl("p", { text: `Files: ${counts.filesChanged} changed, ${counts.filesSkipped} skipped, ${counts.filesFailed} failed. Operations: ${counts.changed} changed, ${counts.skipped} skipped, ${counts.incompatible} incompatible, ${counts.failed} failed.` });
      const list = contentEl.createEl("ul");
      for (const entry of this.previewEntries.slice(0, 30)) {
        list.createEl("li", { text: `${entry.status}: ${entry.path} (${entry.reason})` });
      }
      if (this.previewEntries.length > 30) contentEl.createEl("p", { text: `Showing 30 of ${this.previewEntries.length} notes.` });
    }

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Close").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Apply").setCta().setDisabled(previewState.kind === "no-files").onClick(() => this.apply()));
  }

  async apply() {
    const validationError = validateAction(this.action, this.action.trigger ? "auto" : "manual");
    if (validationError) {
      new Notice(validationError);
      return;
    }
    if (this.previewEntries.length === 0) {
      new Notice(buildActionPreviewState(this.previewEntries, this.action, this.context).message);
      return;
    }
    const counts = summarizeActionPreview(this.previewEntries);
    const hasTypeSync = this.action.operation === ACTIONS.TYPE && normalizeOperations(this.action).length > 0;
    if (counts.changed === 0 && counts.incompatible === 0 && !hasTypeSync) {
      new Notice("Preview has no changes to apply.");
      return;
    }

    const multiFile = counts.changed > 0 && (this.previewEntries.length > 1 || (this.context && this.context.requiresConfirm));
    if (multiFile) {
      const confirmed = await confirmModal(this.app, "Apply multiple-file operation?", `This will modify ${counts.changed} property operation(s) across the selected notes.`);
      if (!confirmed) return;
    }

    let allowIncompatibleTypeChange = false;
    if (counts.incompatible > 0 && this.action.operation === ACTIONS.TYPE && !this.action.trigger) {
      const confirmedIncompatible = await confirmModal(this.app, "Preserve incompatible values and change type?", `${counts.incompatible} value(s) cannot be safely converted. Compatible values will be converted, incompatible values will be preserved, and native types will be synchronized.`);
      if (!confirmedIncompatible) return;
      allowIncompatibleTypeChange = true;
    }

    if (this.action.overwrite && !this.action.trigger && this.plugin.settings.confirmOverwrite) {
      const confirmedOverwrite = await confirmModal(this.app, "Confirm overwrite", "Overwrite is enabled. Existing property values may be replaced.");
      if (!confirmedOverwrite) return;
    }

    const result = await this.plugin.applyAction(this.action, this.previewEntries, { allowIncompatibleTypeChange });
    this.action.lastResult = result;
    this.action.lastResultAt = new Date().toISOString();
    if (this.context && this.context.isInitialSync) {
      this.action.lastInitialSyncResult = result;
      this.action.lastInitialSyncAt = new Date().toISOString();
      if (this.context.enableAfterApply) this.action.enabled = true;
    }
    await this.plugin.saveSettings();
    new ResultModal(this.app, result).open();
    this.close();
  }
}

class ResultModal extends Modal {
  constructor(app, result) {
    super(app);
    this.result = result;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Property action complete" });
    contentEl.createEl("p", { text: displayResult(this.result) });
    if (this.result.reasons && this.result.reasons.length > 0) {
      const list = contentEl.createEl("ul");
      for (const reason of this.result.reasons.slice(0, 50)) list.createEl("li", { text: reason });
    }
    new Setting(contentEl).addButton((button) => button.setButtonText("Close").setCta().onClick(() => this.close()));
  }
}

class ConfirmModal extends Modal {
  constructor(app, title, message, resolve) {
    super(app);
    this.title = title;
    this.message = message;
    this.resolve = resolve;
    this.resolved = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.message });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(false)))
      .addButton((button) => button.setButtonText("Apply").setWarning().onClick(() => this.finish(true)));
  }

  onClose() {
    if (!this.resolved) this.finish(false);
  }

  finish(value) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}

class InitialSyncChoiceModal extends Modal {
  constructor(app, resolve) {
    super(app);
    this.resolve = resolve;
    this.resolved = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Sync existing notes?" });
    contentEl.createEl("p", {
      text: "Run this action on existing matching notes before enabling future automation?"
    });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish("cancel")))
      .addButton((button) => button.setButtonText("Enable without sync").onClick(() => this.finish("enable")))
      .addButton((button) => button.setButtonText("Preview sync").setCta().onClick(() => this.finish("preview")));
  }

  onClose() {
    if (!this.resolved) this.finish("cancel");
  }

  finish(value) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}

class TextInputModal extends Modal {
  constructor(app, title, value, onSave) {
    super(app);
    this.title = title;
    this.value = value || "";
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    new Setting(contentEl).setName("Value").addText((text) => text.setValue(this.value).onChange((value) => {
      this.value = value;
    }));
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Save").setCta().onClick(async () => {
        if (!this.value.trim()) {
          new Notice("Value is required.");
          return;
        }
        await this.onSave(this.value.trim());
        this.close();
      }));
  }
}

class InlineSuggestInput {
  constructor(inputEl, getItems, getText, onChoose, getNote = null, options = {}) {
    this.inputEl = inputEl;
    this.getItems = getItems;
    this.getText = getText;
    this.onChoose = onChoose;
    this.getNote = getNote;
    this.maxDropdownHeight = options.maxDropdownHeight || 300;
    this.minimumDropdownHeight = options.minimumDropdownHeight || 120;
    this.suggestions = [];
    this.selectedIndex = 0;
    this.limit = 100;
    this.ownerWindow = getOwnerWindow(inputEl);
    this.containerEl = inputEl.parentElement;
    this.dropdownEl = this.containerEl.createDiv({ cls: "npo-inline-suggest npo-inline-suggest-list" });

    this.inputEl.addEventListener("input", () => this.render());
    this.inputEl.addEventListener("focus", () => this.render());
    this.inputEl.addEventListener("keydown", (event) => this.handleKeydown(event));
    this.inputEl.addEventListener("blur", () => {
      this.ownerWindow.setTimeout(() => this.close(), 150);
    });
  }

  getSuggestions(query) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const items = this.getItems();
    return items
      .filter((item) => {
        const text = this.getText(item).toLowerCase();
        return !normalizedQuery || text.includes(normalizedQuery);
      })
      .slice(0, this.limit);
  }

  render() {
    this.suggestions = this.getSuggestions(this.inputEl.value);
    this.selectedIndex = 0;
    this.dropdownEl.empty();
    if (this.suggestions.length === 0) {
      this.close();
      return;
    }

    this.fitDropdownToInput();
    this.dropdownEl.addClass("npo-inline-suggest-visible");
    for (const [index, item] of this.suggestions.entries()) {
      const itemEl = this.dropdownEl.createEl("button", { cls: "npo-inline-suggest-item", type: "button" });
      itemEl.toggleClass("npo-inline-suggest-item-selected", index === this.selectedIndex);
      itemEl.createDiv({ cls: "npo-inline-suggest-title", text: this.getText(item) });
      if (this.getNote) {
        const note = this.getNote(item);
        if (note) {
          itemEl.createDiv({ cls: "npo-inline-suggest-meta", text: note });
        }
      }
      itemEl.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.choose(item);
      });
    }
  }

  handleKeydown(event) {
    if (event.key === "Enter" && this.suggestions.length > 0) {
      event.preventDefault();
      this.choose(this.suggestions[this.selectedIndex]);
      return;
    }
    if (event.key === "Escape") {
      this.close();
      return;
    }
    if (this.suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1);
      this.renderSelection();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.renderSelection();
    }
  }

  renderSelection() {
    const items = this.dropdownEl.children;
    for (let index = 0; index < items.length; index += 1) {
      items[index].toggleClass("npo-inline-suggest-item-selected", index === this.selectedIndex);
    }
  }

  choose(item) {
    this.inputEl.value = this.getText(item);
    this.close();
    this.onChoose(item);
  }

  close() {
    this.dropdownEl.removeClass("npo-inline-suggest-visible");
    this.dropdownEl.empty();
    this.suggestions = [];
    this.selectedIndex = 0;
  }

  fitDropdownToInput() {
    const inputRect = this.inputEl.getBoundingClientRect();
    const containerRect = this.containerEl.getBoundingClientRect();
    const modalEl = this.inputEl.closest(".modal-content") || this.inputEl.closest(".modal");
    const modalRect = modalEl ? modalEl.getBoundingClientRect() : {
      left: 0,
      right: this.ownerWindow.innerWidth,
      top: 0,
      bottom: this.ownerWindow.innerHeight
    };
    const bottomGap = 24;
    const topGap = 16;
    const minimumHeight = this.minimumDropdownHeight;
    const boundaryBottom = Math.min(this.ownerWindow.innerHeight, modalRect.bottom);
    const boundaryTop = Math.max(0, modalRect.top);
    const availableBelow = boundaryBottom - inputRect.bottom - bottomGap;
    const availableAbove = inputRect.top - boundaryTop - topGap;
    const opensUp = availableBelow < minimumHeight && availableAbove > availableBelow;
    const available = opensUp ? availableAbove : availableBelow;
    const maxHeight = Math.min(this.maxDropdownHeight, Math.max(minimumHeight, available));
    const horizontal = calculateInlineSuggestHorizontalGeometry(
      inputRect,
      containerRect,
      modalRect,
      this.ownerWindow.innerWidth
    );
    this.dropdownEl.toggleClass("npo-inline-suggest-opens-up", opensUp);
    this.dropdownEl.toggleClass("npo-inline-suggest-opens-down", !opensUp);
    this.dropdownEl.setCssStyles({
      left: `${horizontal.left}px`,
      width: `${horizontal.width}px`,
      maxHeight: `${maxHeight}px`
    });
  }
}

class FolderPathSuggest extends InlineSuggestInput {
  constructor(inputEl, folders, onChoose) {
    super(inputEl, () => folders, (folder) => folder, onChoose);
  }
}

class MarkdownFilePathSuggest extends InlineSuggestInput {
  constructor(inputEl, paths, onChoose) {
    super(inputEl, () => paths, (path) => path, onChoose);
  }
}

class PropertyInputSuggest extends InlineSuggestInput {
  constructor(inputEl, candidates, onChoose) {
    const getCandidates = typeof candidates === "function" ? candidates : () => candidates;
    super(
      inputEl,
      getCandidates,
      (candidate) => candidate.name,
      onChoose,
      (candidate) => propertyCandidateNote(candidate),
      { maxDropdownHeight: 320, minimumDropdownHeight: 260 }
    );
  }
}

class PropertySuggestModal extends FuzzySuggestModal {
  constructor(app, candidates, onChoose) {
    super(app);
    this.candidates = candidates;
    this.onChoose = onChoose;
  }

  getItems() {
    return this.candidates;
  }

  getItemText(item) {
    return formatCandidate(item);
  }

  onChooseItem(item) {
    this.onChoose(item);
  }
}

class FolderSuggestModal extends FuzzySuggestModal {
  constructor(app, folders, onChoose) {
    super(app);
    this.folders = folders;
    this.onChoose = onChoose;
  }

  getItems() {
    return this.folders;
  }

  getItemText(item) {
    return item;
  }

  onChooseItem(item) {
    this.onChoose(item);
  }
}

function confirmModal(app, title, message) {
  return new Promise((resolve) => new ConfirmModal(app, title, message, resolve).open());
}

function initialSyncPrompt(app) {
  return new Promise((resolve) => new InitialSyncChoiceModal(app, resolve).open());
}

function normalizeSettings(settings) {
  const source = settings || {};
  const normalized = Object.assign({}, source, {
    properties: normalizeProperties(source.properties || migrateProperties(source.propertyNames || [])),
    manualActions: (source.manualActions || migrateActions(source.savedActions || [], "manual")).map((action) => normalizeAction(action, "manual")),
    autoActions: (source.autoActions || migrateActions(source.folderRules || [], "auto")).map((action) => normalizeAction(action, "auto")),
    excludedFolders: uniqueStrings((source.excludedFolders || []).map(normalizePathInput).filter(Boolean)),
    addMissingOnly: source.addMissingOnly !== false,
    confirmOverwrite: source.confirmOverwrite !== false,
    suggestLimit: Number.isInteger(source.suggestLimit) && source.suggestLimit > 0 ? source.suggestLimit : 12
  });
  delete normalized.propertyNames;
  delete normalized.savedActions;
  delete normalized.folderRules;
  return normalized;
}

function needsActionMigration(settings) {
  const source = settings || {};
  if (source.propertyNames || source.savedActions || source.folderRules) return true;
  if ((source.autoActions || []).some((action) => action && action.autoTargets == null && action.targets != null)) return true;
  return [source.manualActions, source.autoActions].some((actions) => (actions || []).some((action) => {
    if (!Array.isArray(action.operations)) return true;
    if (["propertyName", "newPropertyName", "propertyType", "value", "valueType"].some((field) => Object.prototype.hasOwnProperty.call(action, field))) return true;
    if (targetsNeedMigration(action.targets) || targetsNeedMigration(action.autoTargets)) return true;
    if (!Array.isArray(action.targets) && (action.targetFolder || action.targetPath)) return true;
    if (Array.isArray(action.targets) && action.targets.length === 0 && (
      action.targetType === TARGETS.FOLDER && action.targetFolder
      || action.targetType === TARGETS.FILE && action.targetPath
    )) return true;
    return false;
  }));
}

function targetsNeedMigration(targets) {
  if (targets == null) return false;
  if (!Array.isArray(targets)) return true;
  return targets.some((target) => {
    if (typeof target === "string") return true;
    if (!target || typeof target !== "object") return true;
    if (Object.prototype.hasOwnProperty.call(target, "recursive")) return true;
    return target.type !== TARGETS.FOLDER && target.type !== TARGETS.FILE;
  });
}

function migrateProperties(propertyNames) {
  return uniqueStrings(propertyNames).map((name) => ({
    id: createId(),
    name,
    type: PROPERTY_TYPES.TEXT
  }));
}

function normalizeProperties(properties) {
  const seen = new Set();
  const normalized = [];
  for (const property of properties || []) {
    const item = normalizeProperty(property);
    if (!item.name || seen.has(item.name)) continue;
    seen.add(item.name);
    normalized.push(item);
  }
  return normalized;
}

function normalizeProperty(property) {
  return {
    id: property.id || createId(),
    name: String(property.name || "").trim(),
    type: Object.values(PROPERTY_TYPES).includes(property.type) ? property.type : PROPERTY_TYPES.TEXT
  };
}

function migrateActions(actions, kind) {
  return (actions || []).map((action) => {
    const migrated = Object.assign(createEmptyAction(kind), action || {});
    migrated.operation = action.operation || action.action || ACTIONS.ADD;
    migrated.targetType = action.targetType || action.target || TARGETS.CURRENT_FILE;
    migrated.propertyName = action.propertyName || "";
    migrated.newPropertyName = action.newPropertyName || "";
    migrated.value = action.value == null ? "" : action.value;
    migrated.propertyType = action.propertyType || oldValueTypeToPropertyType(action.valueType);
    migrated.overwrite = Boolean(action.overwrite);
    migrated.targetFolder = normalizeFolderPath(action.folderPath || action.targetFolder || "/");
    migrated.targetPath = String(action.targetPath || "").trim();
    const migratedTargets = action.targets != null && (!Array.isArray(action.targets) || action.targets.length > 0) ? action.targets : singleTargetFromLegacy(migrated);
    migrated.targets = normalizeTargets(migratedTargets);
    const legacyAutoTargets = kind === "auto" && action.autoTargets == null && action.targets != null ? action.targets : autoTargetFromLegacy(action);
    migrated.autoTargets = normalizeAutoTargets(action.autoTargets != null ? action.autoTargets : legacyAutoTargets);
    migrated.operations = Array.isArray(action.operations) ? action.operations : null;
    if (kind === "auto" && !migrated.trigger) migrated.trigger = AUTO_TRIGGER;
    return migrated;
  });
}

function createEmptyAction(kind) {
  return {
    id: createId(),
    name: "",
    enabled: kind === "auto" ? false : undefined,
    trigger: kind === "auto" ? AUTO_TRIGGER : undefined,
    operation: ACTIONS.ADD,
    targetType: kind === "auto" ? TARGETS.FOLDER : TARGETS.CURRENT_FILE,
    targetFolder: "/",
    targetPath: "",
    targets: [],
    autoTargets: [],
    operations: [defaultOperation(ACTIONS.ADD)],
    propertyName: "",
    newPropertyName: "",
    propertyType: PROPERTY_TYPES.TEXT,
    value: "",
    overwrite: false,
    addIfMissing: false,
    lastResult: null,
    lastResultAt: "",
    lastInitialSyncResult: null,
    lastInitialSyncAt: "",
    lastRunKey: ""
  };
}

function normalizeAction(action, explicitKind = null) {
  const kind = explicitKind || (action && action.trigger ? "auto" : "manual");
  const base = Object.assign(createEmptyAction(kind), action || {});
  base.id = base.id || createId();
  base.name = String(base.name || "").trim();
  base.operation = normalizeOperationName(action && (action.operation || action.action) || base.operation);
  base.targetType = Object.values(TARGETS).includes(action && (action.targetType || action.target) || base.targetType)
    ? (action && (action.targetType || action.target) || base.targetType)
    : TARGETS.CURRENT_FILE;
  base.targetFolder = normalizeFolderPath(action && (action.folderPath || action.targetFolder) || base.targetFolder || "/");
  base.targetPath = String(base.targetPath || "").trim();
  const explicitTargets = action && action.targets != null ? action.targets : null;
  const incomingTargets = explicitTargets && (!Array.isArray(explicitTargets) || explicitTargets.length > 0) ? explicitTargets : singleTargetFromLegacy(base);
  base.targets = normalizeTargets(incomingTargets);
  const hasAutoTargets = Boolean(action && action.autoTargets != null);
  const incomingAutoTargets = hasAutoTargets
    ? action.autoTargets
    : kind === "auto" && action && action.targets != null
      ? action.targets
      : autoTargetFromLegacy(action || {});
  base.autoTargets = normalizeAutoTargets(incomingAutoTargets);
  if (!base.trigger && base.targets.length > 0) base.targetType = TARGETS.SPECIFIC_TARGETS;
  base.operations = Array.isArray(action && action.operations) ? action.operations : null;
  base.operations = normalizeOperations(base);
  base.overwrite = Boolean(base.overwrite);
  base.addIfMissing = Boolean(base.addIfMissing);
  if (kind === "auto" || base.trigger) {
    base.trigger = AUTO_TRIGGER;
    base.enabled = Boolean(base.enabled);
    base.targets = [];
  } else {
    delete base.enabled;
    delete base.trigger;
    delete base.lastRunKey;
    delete base.autoTargets;
  }
  delete base.propertyName;
  delete base.newPropertyName;
  delete base.propertyType;
  delete base.value;
  delete base.valueType;
  delete base.action;
  return base;
}

function normalizeOperationName(operation) {
  if (operation === "change-type" || operation === "changeType" || operation === "type-change") return ACTIONS.TYPE;
  return Object.values(ACTIONS).includes(operation) ? operation : ACTIONS.ADD;
}

function defaultOperation(operation) {
  if (operation === ACTIONS.REMOVE) return { propertyName: "" };
  if (operation === ACTIONS.RENAME) return { propertyName: "", newPropertyName: "" };
  if (operation === ACTIONS.TYPE) return {
    propertyName: "",
    propertyType: PROPERTY_TYPES.TEXT,
    normalizeValues: true,
    dateSourceFormat: "auto",
    dateOnlyToMidnight: false
  };
  return { propertyName: "", propertyType: PROPERTY_TYPES.TEXT, value: "" };
}

function operationCardFieldLabels(operation, row = {}) {
  if (operation === ACTIONS.REMOVE) return ["Property"];
  if (operation === ACTIONS.RENAME) return ["Existing property", "New property name"];
  if (operation === ACTIONS.TYPE) {
    const labels = ["Property", "Target type", "Convert existing values"];
    if (row.propertyType === PROPERTY_TYPES.DATE) labels.push("Source date format");
    if (row.propertyType === PROPERTY_TYPES.DATETIME) labels.push("Date-only values to midnight");
    return labels;
  }
  return ["Property", "Type", "Value"];
}

function buildOperationEditorModel(operation, operations) {
  const rows = Array.isArray(operations) ? operations : [];
  return {
    addButtonLabel: OPERATION_ADD_BUTTON_LABELS[operation] || "Add property",
    cards: rows.map((row, index) => ({
      index,
      row,
      title: `Property ${index + 1}`,
      fields: operationCardFieldLabels(operation, row)
    }))
  };
}

function convertOperationsForOperation(rows, fromOperation, toOperation) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (fromOperation === toOperation) return sourceRows;
  if (toOperation === ACTIONS.REMOVE) {
    return sourceRows.map((row) => ({ propertyName: String(row.propertyName || "").trim() }));
  }
  if (toOperation === ACTIONS.RENAME) {
    if (fromOperation === ACTIONS.RENAME) {
      return sourceRows.map((row) => ({
        propertyName: String(row.propertyName || "").trim(),
        newPropertyName: String(row.newPropertyName || "").trim()
      }));
    }
    return [defaultOperation(ACTIONS.RENAME)];
  }
  if (toOperation === ACTIONS.TYPE) {
    if (fromOperation === ACTIONS.TYPE) return sourceRows.map((row) => Object.assign({}, defaultOperation(ACTIONS.TYPE), row));
    return [defaultOperation(ACTIONS.TYPE)];
  }
  if ((toOperation === ACTIONS.ADD || toOperation === ACTIONS.SET) && (fromOperation === ACTIONS.ADD || fromOperation === ACTIONS.SET)) {
    return sourceRows.map((row) => ({
      propertyName: String(row.propertyName || "").trim(),
      propertyType: Object.values(PROPERTY_TYPES).includes(row.propertyType) ? row.propertyType : PROPERTY_TYPES.TEXT,
      value: row.value == null ? "" : row.value
    }));
  }
  return [defaultOperation(toOperation)];
}

function normalizeOperations(action) {
  const operation = normalizeOperationName(action && action.operation);
  let incoming = Array.isArray(action && action.operations) ? action.operations : null;
  if (!incoming) {
    if (operation === ACTIONS.RENAME) {
      incoming = [{ propertyName: action && action.propertyName, newPropertyName: action && action.newPropertyName }];
    } else if (operation === ACTIONS.REMOVE) {
      incoming = [{ propertyName: action && action.propertyName }];
    } else if (operation === ACTIONS.TYPE) {
      incoming = [{
        propertyName: action && action.propertyName,
        propertyType: action && action.propertyType,
        normalizeValues: action && action.normalizeValues,
        dateSourceFormat: action && action.dateSourceFormat,
        dateOnlyToMidnight: action && action.dateOnlyToMidnight
      }];
    } else {
      incoming = [{
        propertyName: action && action.propertyName,
        propertyType: action && action.propertyType,
        value: action && action.value
      }];
    }
  }

  return incoming.map((row) => {
    const source = row || {};
    if (operation === ACTIONS.REMOVE) return { propertyName: String(source.propertyName || source.name || "").trim() };
    if (operation === ACTIONS.RENAME) return {
      propertyName: String(source.propertyName || source.oldName || source.name || "").trim(),
      newPropertyName: String(source.newPropertyName || source.newName || source.destination || "").trim()
    };
    if (operation === ACTIONS.TYPE) return {
      propertyName: String(source.propertyName || source.name || source.oldName || "").trim(),
      propertyType: Object.values(PROPERTY_TYPES).includes(source.propertyType || source.newType) ? (source.propertyType || source.newType) : PROPERTY_TYPES.TEXT,
      normalizeValues: source.normalizeValues !== false,
      dateSourceFormat: ["auto", "ymd", "dmy", "mdy"].includes(source.dateSourceFormat) ? source.dateSourceFormat : "auto",
      dateOnlyToMidnight: Boolean(source.dateOnlyToMidnight)
    };
    return {
      propertyName: String(source.propertyName || source.name || "").trim(),
      propertyType: Object.values(PROPERTY_TYPES).includes(source.propertyType || source.type) ? (source.propertyType || source.type) : PROPERTY_TYPES.TEXT,
      value: source.value == null ? "" : source.value
    };
  });
}

function singleTargetFromLegacy(action) {
  if (action.targetType === TARGETS.FOLDER && action.targetFolder) {
    return [{ type: TARGETS.FOLDER, path: normalizeFolderPath(action.targetFolder) }];
  }
  if (action.targetType === TARGETS.FILE && action.targetPath) {
    return [{ type: TARGETS.FILE, path: String(action.targetPath).trim() }];
  }
  return [];
}

function normalizeTargets(targets) {
  const targetList = Array.isArray(targets) ? targets : targets == null ? [] : [targets];
  return uniqueTargets(targetList.map((target) => {
    const source = typeof target === "string" ? { type: TARGETS.FOLDER, path: target } : target;
    if (!source || typeof source !== "object") return null;
    const type = source.type === TARGETS.FILE
      ? TARGETS.FILE
      : source.type === TARGETS.FOLDER || !source.type
        ? TARGETS.FOLDER
        : "";
    if (!type) return null;
    const path = type === TARGETS.FOLDER ? normalizeFolderPath(source.path) : String(source.path || "").trim();
    if (!path) return null;
    const normalized = Object.assign({}, source, { type, path });
    delete normalized.recursive;
    return normalized;
  }).filter(Boolean));
}

function uniqueTargets(targets) {
  const seen = new Set();
  const result = [];
  for (const target of targets || []) {
    const key = `${target.type}:${target.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

function autoTargetFromLegacy(action) {
  const folderPath = action && (action.folderPath || action.targetFolder);
  if (!folderPath) return [];
  return [{ type: TARGETS.FOLDER, path: normalizeFolderPath(folderPath) }];
}

function normalizeAutoTargets(targets) {
  return normalizeTargets(targets);
}

function validateAction(action, kind) {
  if (!action.name) return "Action name is required.";
  const operations = normalizeOperations(action);
  if (operations.length === 0) return "Add at least one property operation.";
  const sourceRowsByName = new Map();
  for (const [index, row] of operations.entries()) {
    if (!row.propertyName) return "Every operation row needs a property name.";
    if (sourceRowsByName.has(row.propertyName)) {
      const firstIndex = sourceRowsByName.get(row.propertyName);
      return `Property ${index + 1} duplicates Property ${firstIndex + 1}; property is configured more than once: ${row.propertyName}.`;
    }
    sourceRowsByName.set(row.propertyName, index);
    if (action.operation === ACTIONS.RENAME && !row.newPropertyName) return "Every rename row needs a new property name.";
    if (action.operation === ACTIONS.ADD || action.operation === ACTIONS.SET) {
      const valueError = validateOperationValue(row);
      if (valueError) return `${valueError} for ${row.propertyName}.`;
    }
  }
  if (action.operation === ACTIONS.RENAME) {
    const destinations = new Set();
    const mapping = new Map();
    for (const row of operations) {
      if (row.propertyName === row.newPropertyName) return "A rename source and destination cannot be the same.";
      if (destinations.has(row.newPropertyName)) return `Duplicate rename destination: ${row.newPropertyName}.`;
      destinations.add(row.newPropertyName);
      mapping.set(row.propertyName, row.newPropertyName);
    }
    for (const source of mapping.keys()) {
      const seen = new Set();
      let current = source;
      while (mapping.has(current)) {
        if (seen.has(current)) return "Rename mappings contain a cycle.";
        seen.add(current);
        current = mapping.get(current);
      }
    }
  }
  if (kind === "auto" && (!action.autoTargets || action.autoTargets.length === 0)) return "Add at least one target.";
  if (kind !== "auto" && action.targetType === TARGETS.SPECIFIC_TARGETS && (!action.targets || action.targets.length === 0)) {
    return "Add at least one target.";
  }
  return "";
}

function validateOperationValue(row) {
  const value = row.value;
  const text = String(value == null ? "" : value).trim();
  if (row.propertyType === PROPERTY_TYPES.NUMBER && text && !Number.isFinite(Number(value))) return "Number value is invalid";
  if (row.propertyType === PROPERTY_TYPES.CHECKBOX && text && value !== true && value !== false && value !== "true" && value !== "false") return "Checkbox value must be true or false";
  if (row.propertyType === PROPERTY_TYPES.LIST) {
    if (value != null && !Array.isArray(value) && typeof value !== "string") return "List value must be an array or comma-separated text";
    if (Array.isArray(value) && value.some((item) => typeof item !== "string")) return "List entries must be text";
  }
  if (row.propertyType === PROPERTY_TYPES.TAGS) {
    if (Array.isArray(value) && value.some((item) => typeof item !== "string" || /\s/.test(item.trim()))) return "Tag entries must not contain whitespace";
    if (!Array.isArray(value) && text && !text.includes(",") && /\s/.test(text)) return "Tags must be comma-separated or single tags";
  }
  if (row.propertyType === PROPERTY_TYPES.DATE && text && !isValidDateInput(text)) return "Date value is invalid";
  if (row.propertyType === PROPERTY_TYPES.DATETIME && text && !isValidDateTimeInput(text)) return "Date & time value is invalid";
  return "";
}

function normalizeValueForType(value, type) {
  const text = String(value == null ? "" : value).trim();
  if (type === PROPERTY_TYPES.NUMBER) return text ? Number(text) : null;
  if (type === PROPERTY_TYPES.CHECKBOX) return value === true || value === "true";
  if (type === PROPERTY_TYPES.LIST || type === PROPERTY_TYPES.TAGS) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (!text) return [];
    return text.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (!text) return null;
  return text;
}

function oldValueTypeToPropertyType(valueType) {
  if (valueType === "number") return PROPERTY_TYPES.NUMBER;
  if (valueType === "boolean") return PROPERTY_TYPES.CHECKBOX;
  if (valueType === "list") return PROPERTY_TYPES.LIST;
  return PROPERTY_TYPES.TEXT;
}

function emptyResult() {
  return {
    // Legacy top-level counters remain file-level. Operation-level counters are explicit below.
    changed: 0,
    unchanged: 0,
    blank: 0,
    skippedIncompatible: 0,
    skipped: 0,
    failed: 0,
    filesChanged: 0,
    filesSkipped: 0,
    filesFailed: 0,
    operationsChanged: 0,
    operationsSkipped: 0,
    operationsFailed: 0,
    registrySkipped: 0,
    registryFailed: 0,
    reasons: [],
    operationResults: []
  };
}

function displayResult(result) {
  if (!result) return "No result yet";
  const filesChanged = result.filesChanged == null ? result.changed || 0 : result.filesChanged;
  const filesSkipped = result.filesSkipped == null ? result.skipped || 0 : result.filesSkipped;
  const filesFailed = result.filesFailed == null ? result.failed || 0 : result.filesFailed;
  const operationsChanged = result.operationsChanged == null ? result.changed || 0 : result.operationsChanged;
  const operationsSkipped = result.operationsSkipped == null ? result.skipped || 0 : result.operationsSkipped;
  const operationsFailed = result.operationsFailed == null ? result.failed || 0 : result.operationsFailed;
  return `Files — changed: ${filesChanged}, skipped: ${filesSkipped}, failed: ${filesFailed}. Operations — changed: ${operationsChanged}, skipped: ${operationsSkipped}, failed: ${operationsFailed}. Incompatible: ${result.skippedIncompatible || 0}. Native type sync — skipped: ${result.registrySkipped || 0}, failed: ${result.registryFailed || 0}.`;
}

function summarizeActionPreview(entries) {
  const counts = { changed: 0, skipped: 0, incompatible: 0, failed: 0, filesChanged: 0, filesSkipped: 0, filesFailed: 0 };
  for (const entry of entries || []) {
    let fileChanged = false;
    let fileFailed = false;
    for (const operation of entry.operations || []) {
      if (operation.status === "changed") { counts.changed += 1; fileChanged = true; }
      else if (operation.status === "incompatible") counts.incompatible += 1;
      else if (operation.status === "failed") { counts.failed += 1; fileFailed = true; }
      else counts.skipped += 1;
    }
    if (fileChanged) counts.filesChanged += 1;
    if (fileFailed) counts.filesFailed += 1;
    if (!fileChanged && !fileFailed) counts.filesSkipped += 1;
  }
  return counts;
}

function buildActionPreviewState(entries, action, context = null) {
  const counts = summarizeActionPreview(entries);
  if (!entries || entries.length === 0) {
    const targetDetails = context && context.label
      ? context.label
      : action && action.trigger
        ? displayAutoTargets(action)
        : displayTarget(action || {});
    return {
      kind: "no-files",
      counts,
      message: `No Markdown files matched the selected targets. Targets: ${targetDetails}.`
    };
  }
  return { kind: "files-resolved", counts, message: "" };
}

function displayInitialSyncResult(action) {
  if (!action.lastInitialSyncResult) return "";
  return ` - Last existing-note sync: ${displayResult(action.lastInitialSyncResult)}`;
}

function describeAction(action) {
  const operations = normalizeOperations(action);
  const count = operations.length;
  if (action.operation === ACTIONS.RENAME) return `Rename ${count} propert${count === 1 ? "y" : "ies"}`;
  if (action.operation === ACTIONS.REMOVE) return `Remove ${count} propert${count === 1 ? "y" : "ies"}`;
  if (action.operation === ACTIONS.SET) return `Set/change ${count} propert${count === 1 ? "y" : "ies"}`;
  if (action.operation === ACTIONS.TYPE) return `Change type for ${count} propert${count === 1 ? "y" : "ies"}`;
  return `Add ${count} propert${count === 1 ? "y" : "ies"}`;
}

function displayTarget(action) {
  if (action.targets && action.targets.length > 0) {
    const folderCount = action.targets.filter((target) => target.type === TARGETS.FOLDER).length;
    const fileCount = action.targets.filter((target) => target.type === TARGETS.FILE).length;
    if (action.targets.length === 1) {
      const target = action.targets[0];
      return `${target.type === TARGETS.FOLDER ? "Folder" : "File"}: ${target.path}`;
    }
    return `Folders: ${folderCount}, Files: ${fileCount}`;
  }
  if (action.targetType === TARGETS.FOLDER) return `Folder: ${action.targetFolder || "/"}`;
  if (action.targetType === TARGETS.FILE) return `File: ${action.targetPath || ""}`;
  return TARGET_LABELS[action.targetType] || "Current file";
}

function displayAutoTargets(action) {
  const targets = action.autoTargets || [];
  if (targets.length === 0) return "No targets";
  if (targets.length === 1) {
    const target = targets[0];
    return `${target.type === TARGETS.FILE ? "File" : "Folder"}: ${target.type === TARGETS.FILE ? target.path : displayFolderPath(target.path)}`;
  }
  const folderCount = targets.filter((target) => target.type === TARGETS.FOLDER).length;
  const fileCount = targets.filter((target) => target.type === TARGETS.FILE).length;
  return `Folders: ${folderCount}, Files: ${fileCount}`;
}

function displayFolderPath(path) {
  return normalizeFolderPath(path) === "/" ? "Vault root (/)" : normalizeFolderPath(path);
}

function formatCandidate(candidate) {
  return `${candidate.name} - ${propertyCandidateNote(candidate)}`;
}

function filterExistingPropertyCandidates(candidates, query = "", catalogNames = []) {
  const catalog = new Set((catalogNames || []).map((name) => String(name || "")));
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  return (candidates || [])
    .filter((candidate) => candidate && candidate.name && !catalog.has(candidate.name))
    .filter((candidate) => {
      if (!normalizedQuery) return true;
      return formatExistingPropertyCandidate(candidate).toLocaleLowerCase().includes(normalizedQuery);
    })
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name));
}

function formatExistingPropertyCandidate(candidate) {
  const examples = candidate.examples && candidate.examples.length > 0 ? ` — examples: ${candidate.examples.join(", ")}` : "";
  return `${candidate.name} — ${candidate.inferredType} — appears in ${candidate.count} file(s)${examples}`;
}

function propertyCandidateNote(candidate) {
  const source = candidate.configured && candidate.detectedCount > 0
    ? "configured + detected"
    : candidate.configured
      ? "configured"
      : "detected";
  const count = candidate.detectedCount > 0 ? `, appears in ${candidate.detectedCount} file(s)` : "";
  return `${candidate.type} - ${source}${count}`;
}

function evaluateCatalogChange(frontmatter, change) {
  const oldName = change.oldName;
  const newName = change.newName;
  const rename = oldName !== newName;
  const hasOld = Object.prototype.hasOwnProperty.call(frontmatter, oldName);
  const hasNew = Object.prototype.hasOwnProperty.call(frontmatter, newName);

  if (!hasOld) return { status: "skipped", reason: `${oldName} does not exist` };
  if (rename && hasNew && !change.overwrite) return { status: "skipped", reason: `${newName} already exists` };
  if (!rename && !change.normalizeValues) return { status: "skipped", reason: "No note change selected", originalValue: frontmatter[oldName] };

  const currentValue = frontmatter[oldName];
  if (isBlankPropertyValue(currentValue)) {
    if (rename) return { status: "changed", reason: "Will rename and preserve blank/null value", value: currentValue, originalValue: currentValue };
    return { status: "blank", reason: "Blank/null value will be preserved", value: currentValue, originalValue: currentValue };
  }

  let nextValue = currentValue;
  let valueChanged = false;
  if (change.normalizeValues) {
    const converted = convertValueToPropertyType(currentValue, change.newType, change);
    if (!converted.ok) return { status: "incompatible", reason: converted.reason, originalValue: currentValue };
    nextValue = converted.value;
    valueChanged = !valuesEqual(currentValue, nextValue);
  }

  if (!rename && change.normalizeValues && !valueChanged) {
    return { status: "unchanged", reason: "Value already matches selected type", value: nextValue, originalValue: currentValue };
  }

  const reason = rename && valueChanged
    ? "Will rename property and convert value"
    : rename
      ? "Will rename property"
      : "Will convert value";
  return { status: "changed", reason, value: nextValue, originalValue: currentValue };
}

function mutateCatalogChange(frontmatter, change, value) {
  if (change.oldName !== change.newName) {
    frontmatter[change.newName] = value;
    delete frontmatter[change.oldName];
    return;
  }
  frontmatter[change.oldName] = value;
}

function convertValueToPropertyType(value, type, options = {}) {
  if (isBlankPropertyValue(value)) return { ok: true, value };

  if (type === PROPERTY_TYPES.TEXT) {
    if (typeof value === "string") return { ok: true, value };
    if (typeof value === "number" || typeof value === "boolean") return { ok: true, value: String(value) };
    return { ok: false, reason: "Value is not a safe primitive text value" };
  }

  if (type === PROPERTY_TYPES.NUMBER) {
    if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value };
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return { ok: true, value: Number(value) };
    return { ok: false, reason: "Value is not a finite number" };
  }

  if (type === PROPERTY_TYPES.CHECKBOX) {
    if (typeof value === "boolean") return { ok: true, value };
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return { ok: true, value: true };
      if (normalized === "false") return { ok: true, value: false };
    }
    return { ok: false, reason: "Value is not clearly true or false" };
  }

  if (type === PROPERTY_TYPES.DATE) {
    return convertValueToDate(value, options);
  }

  if (type === PROPERTY_TYPES.DATETIME) {
    return convertValueToDateTime(value, options);
  }

  if (type === PROPERTY_TYPES.LIST) {
    if (Array.isArray(value)) return { ok: true, value };
    if (typeof value === "string" && value.includes(",")) {
      return { ok: true, value: value.split(",").map((item) => item.trim()).filter(Boolean) };
    }
    return { ok: false, reason: "Value is not a list or comma-separated string" };
  }

  if (type === PROPERTY_TYPES.TAGS) {
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return { ok: true, value };
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return { ok: false, reason: "Value is empty" };
      if (text.includes(",")) return { ok: true, value: text.split(",").map((item) => item.trim()).filter(Boolean) };
      if (!/\s/.test(text)) return { ok: true, value: [text] };
    }
    return { ok: false, reason: "Value is not a safe tag list" };
  }

  return { ok: false, reason: "Unsupported property type" };
}

function convertValueToDate(value, options = {}) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return { ok: false, reason: "Value is an invalid Date" };
    return { ok: true, value: formatDateOnly(value) };
  }
  if (typeof value !== "string") return { ok: false, reason: "Value is not a date string" };
  const text = value.trim();
  const isoDateTime = parseIsoLikeDateTime(text);
  if (isoDateTime.ok) return { ok: true, value: isoDateTime.date };
  const sourceFormat = options.dateSourceFormat || "auto";
  if (sourceFormat === "auto" || sourceFormat === "ymd") {
    const parsed = parseDateParts(text, "ymd");
    if (parsed.ok) return { ok: true, value: formatDateParts(parsed.year, parsed.month, parsed.day) };
  }
  if (sourceFormat === "dmy") {
    const parsed = parseDateParts(text, "dmy");
    if (parsed.ok) return { ok: true, value: formatDateParts(parsed.year, parsed.month, parsed.day) };
  }
  if (sourceFormat === "mdy") {
    const parsed = parseDateParts(text, "mdy");
    if (parsed.ok) return { ok: true, value: formatDateParts(parsed.year, parsed.month, parsed.day) };
  }
  return { ok: false, reason: sourceFormat === "auto" ? "Value is not an unambiguous ISO date" : "Value does not match selected source date format" };
}

function convertValueToDateTime(value, options = {}) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return { ok: false, reason: "Value is an invalid Date" };
    return { ok: true, value: formatDateTime(value) };
  }
  if (typeof value !== "string") return { ok: false, reason: "Value is not a date and time string" };
  const text = value.trim();
  const parsedDateTime = parseIsoLikeDateTime(text);
  if (parsedDateTime.ok && parsedDateTime.hasTime) return { ok: true, value: parsedDateTime.datetime };
  if (isValidDateInput(text)) {
    if (options.dateOnlyToMidnight) return { ok: true, value: `${text}T00:00:00` };
    return { ok: false, reason: "Date-only value requires explicit midnight conversion" };
  }
  return { ok: false, reason: "Value is not a valid date and time" };
}

function parseIsoLikeDateTime(text) {
  const match = String(text || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:(?:T| )(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return { ok: false };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return { ok: false };
  const date = formatDateParts(year, month, day);
  if (!match[4]) return { ok: true, date, hasTime: false };
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (!isValidTimeParts(hour, minute, second)) return { ok: false };
  return { ok: true, date, hasTime: true, datetime: `${date}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}` };
}

function parseDateParts(text, format) {
  if (format === "ymd") {
    const match = String(text || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return { ok: false };
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return isValidDateParts(year, month, day) ? { ok: true, year, month, day } : { ok: false };
  }
  const match = String(text || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return { ok: false };
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]);
  const month = format === "dmy" ? second : first;
  const day = format === "dmy" ? first : second;
  return isValidDateParts(year, month, day) ? { ok: true, year, month, day } : { ok: false };
}

function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTimeParts(hour, minute, second) {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23
    && Number.isInteger(minute) && minute >= 0 && minute <= 59
    && Number.isInteger(second) && second >= 0 && second <= 59;
}

function formatDateParts(year, month, day) {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

function formatDateOnly(date) {
  return formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function formatDateTime(date) {
  return `${formatDateOnly(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isBlankPropertyValue(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function inferPropertyType(name, values) {
  const observed = (values || []).filter((value) => !isBlankPropertyValue(value));
  if (observed.length === 0) return PROPERTY_TYPES.TEXT;
  const lowerName = String(name || "").toLowerCase();
  if (observed.every((value) => Array.isArray(value))) {
    return lowerName === "tags" || lowerName.includes("tag") ? PROPERTY_TYPES.TAGS : PROPERTY_TYPES.LIST;
  }
  if (observed.every((value) => typeof value === "boolean" || isBooleanString(value))) return PROPERTY_TYPES.CHECKBOX;
  if (observed.every((value) => typeof value === "number" ? Number.isFinite(value) : isNumericString(value))) return PROPERTY_TYPES.NUMBER;
  const dateKinds = observed.map(classifyDateLikeValue);
  if (dateKinds.every((kind) => kind === "date" || kind === "datetime")) {
    return dateKinds.includes("datetime") ? PROPERTY_TYPES.DATETIME : PROPERTY_TYPES.DATE;
  }
  return PROPERTY_TYPES.TEXT;
}

function isBooleanString(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "false";
}

function isNumericString(value) {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

function classifyDateLikeValue(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return "none";
    return value.getHours() || value.getMinutes() || value.getSeconds() || value.getMilliseconds() ? "datetime" : "date";
  }
  if (typeof value !== "string") return "none";
  const text = value.trim();
  if (isValidDateInput(text)) return "date";
  const parsed = parseIsoLikeDateTime(text);
  return parsed.ok && parsed.hasTime ? "datetime" : "none";
}

function isInferableDateValue(value) {
  const kind = classifyDateLikeValue(value);
  return kind === "date" || kind === "datetime";
}

function isInferableDateTimeValue(value) {
  return classifyDateLikeValue(value) === "datetime";
}

function isInferableDateOnlyValue(value) {
  return classifyDateLikeValue(value) === "date";
}

function nativeTypeIdForPropertyType(type) {
  if (type === PROPERTY_TYPES.TEXT) return "text";
  if (type === PROPERTY_TYPES.LIST) return "multiline";
  if (type === PROPERTY_TYPES.NUMBER) return "number";
  if (type === PROPERTY_TYPES.CHECKBOX) return "checkbox";
  if (type === PROPERTY_TYPES.DATE) return "date";
  if (type === PROPERTY_TYPES.DATETIME) return "datetime";
  if (type === PROPERTY_TYPES.TAGS) return "tags";
  return "text";
}

function shouldDefaultNormalizeCatalogChange(oldType, newType) {
  return oldType === PROPERTY_TYPES.TEXT && (newType === PROPERTY_TYPES.DATE || newType === PROPERTY_TYPES.DATETIME);
}

function isDateLikePropertyType(type) {
  return type === PROPERTY_TYPES.DATE || type === PROPERTY_TYPES.DATETIME;
}

function summarizeCatalogPreview(entries) {
  return {
    total: entries.length,
    changed: entries.filter((entry) => entry.status === "changed").length,
    unchanged: entries.filter((entry) => entry.status === "unchanged").length,
    blank: entries.filter((entry) => entry.status === "blank").length,
    incompatible: entries.filter((entry) => entry.status === "incompatible").length,
    skipped: entries.filter((entry) => entry.status === "skipped").length,
    failed: entries.filter((entry) => entry.status === "failed").length
  };
}

function incrementResultForCatalogStatus(result, entry) {
  if (entry.status === "blank") result.blank = (result.blank || 0) + 1;
  else if (entry.status === "unchanged") result.unchanged = (result.unchanged || 0) + 1;
  else if (entry.status === "incompatible") result.skippedIncompatible = (result.skippedIncompatible || 0) + 1;
  result.skipped += 1;
  result.reasons.push(`${entry.path}: ${entry.reason}`);
}

function displayValueForPreview(value) {
  if (value instanceof Date) return formatDateTime(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.length > 40 ? `${value.slice(0, 37)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "[array]";
  if (typeof value === "object") return "[object]";
  return String(value);
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isValidDateInput(value) {
  return parseDateParts(value, "ymd").ok === true;
}

function isValidDateTimeInput(value) {
  const parsed = parseIsoLikeDateTime(String(value || "").trim());
  return parsed.ok === true && parsed.hasTime === true;
}

function normalizePathInput(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function getOwnerWindow(element) {
  const ownerWindow = element && element.ownerDocument && element.ownerDocument.defaultView;
  if (ownerWindow) return ownerWindow;
  return globalThis.window || globalThis;
}

function getModalScrollContainer(contentEl) {
  if (!contentEl) return null;
  return contentEl.closest && contentEl.closest(".modal-content") || contentEl;
}

function captureModalScrollState(contentEl) {
  const scrollEl = getModalScrollContainer(contentEl);
  if (!scrollEl) return null;
  const anchorEl = contentEl.querySelector && contentEl.querySelector(".npo-operation-section");
  const scrollRect = scrollEl.getBoundingClientRect ? scrollEl.getBoundingClientRect() : { top: 0 };
  const anchorRect = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;
  return {
    scrollTop: Number(scrollEl.scrollTop) || 0,
    anchorOffset: anchorRect ? anchorRect.top - scrollRect.top : null
  };
}

function restoreModalScrollState(contentEl, state) {
  if (!state) return;
  const scrollEl = getModalScrollContainer(contentEl);
  if (!scrollEl) return;
  scrollEl.scrollTop = state.scrollTop;
  if (state.anchorOffset == null) return;
  const anchorEl = contentEl.querySelector && contentEl.querySelector(".npo-operation-section");
  if (!anchorEl || !anchorEl.getBoundingClientRect || !scrollEl.getBoundingClientRect) return;
  const currentOffset = anchorEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
  scrollEl.scrollTop += currentOffset - state.anchorOffset;
}

function focusWithoutScroll(inputEl) {
  if (!inputEl || typeof inputEl.focus !== "function") return;
  try {
    inputEl.focus({ preventScroll: true });
  } catch (_error) {
    inputEl.focus();
  }
}

function revealOperationCardWithoutJump(contentEl, cardEl, inputEl) {
  if (cardEl && typeof cardEl.scrollIntoView === "function") cardEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  focusWithoutScroll(inputEl);
  return getModalScrollContainer(contentEl);
}

function scheduleModalScrollRestore(contentEl, state, afterRestore = null) {
  if (!state && !afterRestore) return;
  const ownerWindow = getOwnerWindow(contentEl);
  const restore = () => {
    restoreModalScrollState(contentEl, state);
    if (afterRestore) afterRestore();
  };
  if (ownerWindow && typeof ownerWindow.requestAnimationFrame === "function") ownerWindow.requestAnimationFrame(restore);
  else restore();
}

function calculateInlineSuggestHorizontalGeometry(inputRect, containerRect, modalRect, viewportWidth) {
  const viewportRight = Math.max(0, Number(viewportWidth) || 0);
  const modalLeft = Number.isFinite(modalRect && modalRect.left) ? modalRect.left : 0;
  const modalRight = Number.isFinite(modalRect && modalRect.right) ? modalRect.right : viewportRight;
  const boundaryLeft = Math.max(0, modalLeft);
  const boundaryRight = Math.max(boundaryLeft, Math.min(viewportRight, modalRight));
  const inputLeft = Number.isFinite(inputRect && inputRect.left) ? inputRect.left : boundaryLeft;
  const inputWidth = Number.isFinite(inputRect && inputRect.width)
    ? Math.max(0, inputRect.width)
    : Math.max(0, Number(inputRect && inputRect.right) - inputLeft);
  const popupLeft = Math.min(Math.max(inputLeft, boundaryLeft), boundaryRight);
  const popupWidth = Math.max(0, Math.min(inputWidth, boundaryRight - popupLeft));
  const containerLeft = Number.isFinite(containerRect && containerRect.left) ? containerRect.left : inputLeft;
  return { left: popupLeft - containerLeft, width: popupWidth };
}

function normalizeFolderPath(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "/") return "/";
  return normalizePathInput(raw);
}

function parentPathFromPath(path) {
  const normalized = String(path || "").split("/");
  normalized.pop();
  return normalized.join("/") || "/";
}

function folderTargetMatchesPath(target, parentPath) {
  const targetPath = normalizeFolderPath(target.path);
  const normalizedParent = normalizeFolderPath(parentPath);
  if (targetPath === "/") return true;
  return normalizedParent === targetPath || normalizedParent.startsWith(`${targetPath}/`);
}

function targetMatchesPath(target, filePath) {
  const normalizedFilePath = String(filePath || "").replace(/^\/+/, "");
  if (!target || !normalizedFilePath) return false;
  if (target.type === TARGETS.FILE) return normalizedFilePath === String(target.path || "").replace(/^\/+/, "");
  if (target.type !== TARGETS.FOLDER) return false;
  return folderTargetMatchesPath(target, parentPathFromPath(normalizedFilePath));
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function getUnavailablePropertyNames(operations, currentIndex) {
  const unavailable = new Set();
  for (const [index, row] of (operations || []).entries()) {
    if (index === currentIndex) continue;
    const propertyName = String(row && row.propertyName || "").trim();
    if (propertyName) unavailable.add(propertyName);
  }
  return unavailable;
}

function filterOperationPropertyCandidates(candidates, operations, currentIndex) {
  const unavailable = getUnavailablePropertyNames(operations, currentIndex);
  return (candidates || []).filter((candidate) => {
    const propertyName = String(candidate && candidate.name || "").trim();
    return propertyName && !unavailable.has(propertyName);
  });
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export {
  ACTIONS,
  PROPERTY_TYPES,
  TARGETS,
  applyOperations,
  buildActionPreviewState,
  buildOperationEditorModel,
  calculateInlineSuggestHorizontalGeometry,
  captureModalScrollState,
  convertOperationsForOperation,
  createEmptyAction,
  defaultOperation,
  emptyResult,
  evaluateOperations,
  filterExistingPropertyCandidates,
  filterOperationPropertyCandidates,
  focusWithoutScroll,
  folderTargetMatchesPath,
  getUnavailablePropertyNames,
  normalizeAction,
  normalizeAutoTargets,
  normalizeSettings,
  normalizeOperations,
  normalizeTargets,
  restoreModalScrollState,
  revealOperationCardWithoutJump,
  targetMatchesPath,
  validateAction
};
