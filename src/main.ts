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
  ToggleComponent
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
  SET: "set"
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
  [ACTIONS.SET]: "Set/change property value"
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
    this.settings = normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, await this.loadData()));
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
      const files = this.getDirectMarkdownFilesInFolder(file);
      if (files.length === 0) return null;
      return {
        targetType: TARGETS.PROVIDED_FILES,
        files,
        targetPath: file.path || "/",
        label: `${file.path || "/"} direct Markdown notes`,
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
    if (parts.includes(".obsidian")) return false;
    return !parts.some((part) => part.startsWith(".") && part.length > 1);
  }

  isAllowedMarkdownFile(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return false;
    const parts = file.path.split("/");
    if (parts.includes(".obsidian")) return false;
    if (parts.some((part) => part.startsWith(".") && part.length > 1)) return false;
    return !this.settings.excludedFolders.some((folder) => {
      const normalized = normalizePathInput(folder);
      return normalized && normalized !== "/" && (file.path === normalized || file.path.startsWith(`${normalized}/`));
    });
  }

  getDirectMarkdownFilesInFolder(folder) {
    if (!this.isVisibleFolder(folder)) return [];
    return folder.children
      .filter((child) => this.isAllowedMarkdownFile(child))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getDirectMarkdownFilesByPath(folderPath) {
    const normalized = normalizeFolderPath(folderPath);
    const folder = normalized === "/" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(normalized);
    if (!(folder instanceof TFolder)) return [];
    return this.getDirectMarkdownFilesInFolder(folder);
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

  getMarkdownFilesForAutoTarget(target) {
    const folderPath = normalizeFolderPath(target.path);
    if (folderPath === "/" && target.recursive) {
      return this.app.vault.getMarkdownFiles().filter((file) => this.isAllowedMarkdownFile(file));
    }
    const folder = folderPath === "/" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder) || !this.isVisibleFolder(folder)) return [];
    return target.recursive ? this.getRecursiveMarkdownFilesInFolder(folder) : this.getDirectMarkdownFilesInFolder(folder);
  }

  resolveAutoActionExistingFiles(action) {
    const byPath = new Map();
    for (const target of action.autoTargets || []) {
      for (const file of this.getMarkdownFilesForAutoTarget(target)) {
        if (this.isAllowedMarkdownFile(file)) byPath.set(file.path, file);
      }
    }
    return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
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

    if (action.targets && action.targets.length > 0) {
      const byPath = new Map();
      for (const target of action.targets) {
        const files = target.type === TARGETS.FOLDER
          ? this.getDirectMarkdownFilesByPath(target.path)
          : [this.app.vault.getAbstractFileByPath(target.path)].filter((file) => this.isAllowedMarkdownFile(file));
        for (const file of files) byPath.set(file.path, file);
      }
      return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
    }

    if (action.targetType === TARGETS.FILE) {
      const file = this.app.vault.getAbstractFileByPath(action.targetPath || "");
      return this.isAllowedMarkdownFile(file) ? [file] : [];
    }

    if (action.targetType === TARGETS.FOLDER) {
      return this.getDirectMarkdownFilesByPath(action.targetFolder || action.targetPath || "");
    }

    const activeFile = this.getActiveMarkdownFile();
    if (!activeFile) return [];

    if (action.targetType === TARGETS.CURRENT_FOLDER) {
      return activeFile.parent ? this.getDirectMarkdownFilesInFolder(activeFile.parent) : [];
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
        value: decision.value
      });
    }
    return entries;
  }

  async applyCatalogChange(change, previewEntries) {
    const result = emptyResult();
    for (const entry of previewEntries) {
      if (entry.status !== "changed") {
        result.skipped += 1;
        result.reasons.push(`${entry.path}: ${entry.reason}`);
        continue;
      }
      try {
        await this.app.fileManager.processFrontMatter(entry.file, (frontmatter) => {
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
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
      const decision = this.evaluateFrontmatter(frontmatter, operation);
      entries.push({
        file,
        path: file.path,
        status: decision.status,
        reason: decision.reason
      });
    }

    return entries;
  }

  evaluateFrontmatter(frontmatter, action) {
    const propertyName = action.propertyName;
    const newPropertyName = action.newPropertyName;
    const hasProperty = Object.prototype.hasOwnProperty.call(frontmatter, propertyName);
    const hasNewProperty = newPropertyName ? Object.prototype.hasOwnProperty.call(frontmatter, newPropertyName) : false;

    if (!propertyName) return { status: "skipped", reason: "Missing property name" };

    if (action.operation === ACTIONS.ADD) {
      if (hasProperty && !action.overwrite) return { status: "skipped", reason: "Property already exists" };
      return { status: "changed", reason: hasProperty ? "Will overwrite property value" : "Will add property" };
    }

    if (action.operation === ACTIONS.REMOVE) {
      if (!hasProperty) return { status: "skipped", reason: "Property does not exist" };
      return { status: "changed", reason: "Will remove property" };
    }

    if (action.operation === ACTIONS.RENAME) {
      if (!newPropertyName) return { status: "skipped", reason: "Missing new property name" };
      if (propertyName === newPropertyName) return { status: "skipped", reason: "Source and destination are the same" };
      if (!hasProperty) return { status: "skipped", reason: "Source property does not exist" };
      if (hasNewProperty && !action.overwrite) return { status: "skipped", reason: "Destination property already exists" };
      return { status: "changed", reason: hasNewProperty ? "Will overwrite destination property" : "Will rename property" };
    }

    if (action.operation === ACTIONS.SET) {
      if (!hasProperty && !action.addIfMissing) return { status: "skipped", reason: "Property does not exist" };
      return { status: "changed", reason: hasProperty ? "Will change property value" : "Will add missing property" };
    }

    return { status: "skipped", reason: "Unknown operation" };
  }

  async applyAction(action, previewEntries) {
    const result = emptyResult();
    const operation = normalizeAction(action);

    for (const entry of previewEntries) {
      if (entry.status !== "changed") {
        result.skipped += 1;
        result.reasons.push(`${entry.path}: ${entry.reason}`);
        continue;
      }

      try {
        await this.app.fileManager.processFrontMatter(entry.file, (frontmatter) => {
          const decision = this.evaluateFrontmatter(frontmatter, operation);
          if (decision.status !== "changed") throw new SkippedOperationError(decision.reason);
          this.mutateFrontmatter(frontmatter, operation);
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

  mutateFrontmatter(frontmatter, action) {
    if (action.operation === ACTIONS.ADD || action.operation === ACTIONS.SET) {
      frontmatter[action.propertyName] = normalizeValueForType(action.value, action.propertyType);
      return;
    }

    if (action.operation === ACTIONS.REMOVE) {
      delete frontmatter[action.propertyName];
      return;
    }

    if (action.operation === ACTIONS.RENAME) {
      frontmatter[action.newPropertyName] = frontmatter[action.propertyName];
      delete frontmatter[action.propertyName];
    }
  }

  async previewAndApplyAction(action, context = null, isAuto = false) {
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
      window.setTimeout(() => this.autoRunKeys.delete(runKey), 5000);

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
    const parentPath = file.parent ? file.parent.path || "/" : "/";
    const matched = (action.autoTargets || []).some((target) => folderTargetMatchesPath(target, parentPath));
    if (!matched) return false;
    if (eventName === "create") return true;
    if (eventName === "rename") {
      const oldParent = parentPathFromPath(oldPath);
      return oldParent !== parentPath;
    }
    return false;
  }
};

class SkippedOperationError extends Error {}

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
    breadcrumbEl.style.display = "flex";
    breadcrumbEl.style.alignItems = "center";
    breadcrumbEl.style.gap = "8px";
    breadcrumbEl.style.marginBottom = "10px";
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
    navEl.style.display = "flex";
    navEl.style.flexWrap = "wrap";
    navEl.style.gap = "8px";
    navEl.style.margin = "0 0 14px";
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
      text: "Safety: this plugin only targets normal visible Markdown notes. It always ignores .obsidian, dot folders, hidden/internal folders, and non-Markdown files. This cannot be disabled."
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
    containerEl.createEl("h3", { text: "Excluded visible folders" });
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
    addEl.style.margin = "12px 0";
    const labelEl = addEl.createDiv({ text: "Add excluded folder" });
    labelEl.style.fontWeight = "600";
    const wrapperEl = addEl.createDiv();
    wrapperEl.style.position = "relative";
    wrapperEl.style.marginTop = "6px";
    const inputEl = wrapperEl.createEl("input", { type: "text" });
    inputEl.addClass("text-input");
    inputEl.style.width = "100%";
    inputEl.style.boxSizing = "border-box";
    inputEl.placeholder = "Vault-relative visible folder path";
    inputEl.addEventListener("input", () => {
      pending = normalizeFolderPath(inputEl.value);
    });
    new FolderPathSuggest(inputEl, folderOptions, (folder) => {
      pending = folder;
      inputEl.value = folder;
    });
    const addButton = addEl.createEl("button", { text: "Add" });
    addButton.style.marginTop = "6px";
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
      cardEl.style.background = "var(--background-secondary)";
      cardEl.style.border = "1px solid var(--background-modifier-border)";
      cardEl.style.borderRadius = "8px";
      cardEl.style.padding = "12px";
      cardEl.style.margin = "10px 0";

      const mainRowEl = cardEl.createDiv({ cls: "npo-property-main-row" });
      mainRowEl.style.display = "flex";
      mainRowEl.style.flexWrap = "wrap";
      mainRowEl.style.gap = "12px";
      mainRowEl.style.alignItems = "flex-end";

      const nameControlEl = mainRowEl.createDiv({ cls: "npo-property-name-control" });
      nameControlEl.style.flex = "1 1 320px";
      nameControlEl.style.minWidth = "260px";
      const nameLabelEl = nameControlEl.createDiv({ text: "Property name" });
      nameLabelEl.style.fontSize = "12px";
      nameLabelEl.style.fontWeight = "600";
      nameLabelEl.style.opacity = "0.75";
      nameLabelEl.style.marginBottom = "4px";
      const inputEl = nameControlEl.createEl("input", { type: "text", value: property.name });
      inputEl.addClass("text-input");
      inputEl.style.width = "100%";
      inputEl.style.boxSizing = "border-box";
      inputEl.addEventListener("input", () => {
        nextName = inputEl.value.trim();
      });

      const typeControlEl = mainRowEl.createDiv({ cls: "npo-property-type-control" });
      typeControlEl.style.flex = "0 0 180px";
      typeControlEl.style.minWidth = "160px";
      const typeLabelEl = typeControlEl.createDiv({ text: "Type" });
      typeLabelEl.style.fontSize = "12px";
      typeLabelEl.style.fontWeight = "600";
      typeLabelEl.style.opacity = "0.75";
      typeLabelEl.style.marginBottom = "4px";
      const selectEl = typeControlEl.createEl("select");
      selectEl.addClass("dropdown");
      selectEl.style.width = "100%";
      selectEl.style.boxSizing = "border-box";
      for (const type of Object.values(PROPERTY_TYPES)) {
        selectEl.createEl("option", { text: type, value: type });
      }
      selectEl.value = property.type;
      selectEl.addEventListener("change", () => {
        nextType = selectEl.value;
      });

      const actionsEl = cardEl.createDiv({ cls: "npo-property-button-row" });
      actionsEl.style.display = "flex";
      actionsEl.style.flexWrap = "wrap";
      actionsEl.style.gap = "8px";
      actionsEl.style.justifyContent = "flex-start";
      actionsEl.style.alignItems = "center";
      actionsEl.style.marginTop = "10px";
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
        new ExistingPropertySuggestModal(this.app, detected, async (item) => {
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
    this.normalizeValues = false;
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
      text: "This workflow previews any note changes first. Type-only changes update the plugin catalog after Apply; note values are only rewritten if normalization is explicitly enabled."
    });

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
      .setName("Normalize existing values to selected type")
      .setDesc("Conservative conversion only. Unsafe or ambiguous values are skipped with reasons.")
      .addToggle((toggle) => toggle.setValue(this.normalizeValues).onChange((value) => {
        this.normalizeValues = value;
        this.previewEntries = [];
        this.render();
      }));

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
      normalizeValues: this.normalizeValues
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
    const changed = this.previewEntries.filter((entry) => entry.status === "changed").length;
    const skipped = this.previewEntries.filter((entry) => entry.status === "skipped").length;
    contentEl.createEl("h3", { text: "Preview" });
    contentEl.createEl("p", { text: `Changed if applied: ${changed}. Skipped: ${skipped}. Failed: 0.` });
    const list = contentEl.createEl("ul");
    for (const entry of this.previewEntries.slice(0, 40)) {
      list.createEl("li", { text: `${entry.status}: ${entry.path} (${entry.reason})` });
    }
    if (this.previewEntries.length > 40) {
      contentEl.createEl("p", { text: `Showing 40 of ${this.previewEntries.length} notes.` });
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

    const changed = this.previewEntries.filter((entry) => entry.status === "changed").length;
    if (changed > 0) {
      const confirmed = await confirmModal(this.app, "Apply property catalog change?", `This will modify ${changed} visible Markdown note(s).`);
      if (!confirmed) return;
      if (this.overwrite && this.plugin.settings.confirmOverwrite) {
        const confirmedOverwrite = await confirmModal(this.app, "Confirm overwrite", "Overwrite is enabled. Existing destination property values may be replaced.");
        if (!confirmedOverwrite) return;
      }
    }

    let result = emptyResult();
    if (changed > 0) {
      result = await this.plugin.applyCatalogChange(this.getChange(), this.previewEntries);
    }

    this.plugin.settings.properties = this.plugin.settings.properties.map((item) => {
      if (item.id !== this.property.id) return item;
      return normalizeProperty(Object.assign({}, item, { name: this.newName, type: this.newType }));
    });
    await this.plugin.saveSettings();
    if (this.onDone) this.onDone();
    if (changed > 0) new ResultModal(this.app, result).open();
    else new Notice("Catalog updated. No note changes to apply.");
    this.close();
  }
}

class ExistingPropertySuggestModal extends FuzzySuggestModal {
  constructor(app, items, onChoose) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
  }

  getItems() {
    return this.items;
  }

  getItemText(item) {
    const examples = item.examples && item.examples.length > 0 ? ` - examples: ${item.examples.join(", ")}` : "";
    return `${item.name} - ${item.inferredType} - appears in ${item.count} file(s)${examples}`;
  }

  onChooseItem(item) {
    this.onChoose(item);
  }
}

class ActionEditorModal extends Modal {
  constructor(app, plugin, kind, action, context) {
    super(app);
    this.plugin = plugin;
    this.kind = kind;
    this.context = context;
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

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.paddingBottom = "120px";
    contentEl.createEl("h2", { text: this.kind === "auto" ? "Auto action" : "Manual action" });

    new Setting(contentEl)
      .setName("Name")
      .addText((text) => text.setValue(this.action.name).onChange((value) => {
        this.action.name = value.trim();
      }));

    if (this.kind === "auto") {
      new Setting(contentEl)
        .setName("Trigger")
        .setDesc("Runs only when a Markdown note is created in or moved into a target folder.")
        .addText((text) => text.setValue("New or moved Markdown note").setDisabled(true));

      this.addAutoTargetsSetting(contentEl);
    } else {
      this.addManualTargetSetting(contentEl);
    }

    new Setting(contentEl)
      .setName("Operation")
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(ACTION_LABELS)) dropdown.addOption(value, label);
        dropdown.setValue(this.action.operation).onChange((value) => {
          this.action.operation = value;
          this.render();
        });
      });

    this.addPropertyPicker(contentEl, "Property", "propertyName");

    if (this.action.operation === ACTIONS.RENAME) {
      this.addPropertyPicker(contentEl, "New property", "newPropertyName", true);
    }

    if (this.action.operation === ACTIONS.ADD || this.action.operation === ACTIONS.SET) {
      this.addValueEditor(contentEl);
    }

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

    new Setting(contentEl)
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
  }

  addManualTargetSetting(contentEl) {
    new Setting(contentEl)
      .setName("Target")
      .addDropdown((dropdown) => {
        dropdown
          .addOption(TARGETS.CURRENT_FILE, TARGET_LABELS[TARGETS.CURRENT_FILE])
          .addOption(TARGETS.CURRENT_FOLDER, TARGET_LABELS[TARGETS.CURRENT_FOLDER])
          .addOption(TARGETS.SPECIFIC_TARGETS, TARGET_LABELS[TARGETS.SPECIFIC_TARGETS])
          .setValue(this.action.targetType)
          .onChange((value) => {
            this.action.targetType = value;
            if (value === TARGETS.SPECIFIC_TARGETS && !this.action.targets) this.action.targets = [];
            this.render();
          });
      });

    if (this.action.targetType === TARGETS.SPECIFIC_TARGETS) this.addSpecificTargetsSetting(contentEl);
  }

  addAutoTargetsSetting(contentEl) {
    const fieldEl = this.createVerticalField(
      contentEl,
      "Targets",
      "Add one or more visible folders. Auto actions run when a Markdown note is created in or moved into these folders."
    );
    const rootNote = fieldEl.createDiv({
      text: "Folder targets run when a Markdown note is created or moved into a target folder. By default, only notes directly inside the folder are included. Enable 'Include subfolders' to also include notes created or moved inside nested folders. Vault root (/) with Include subfolders enabled applies to all visible Markdown notes in the vault."
    });
    rootNote.style.fontSize = "12px";
    rootNote.style.opacity = "0.75";
    rootNote.style.margin = "0 0 8px";

    const targets = this.action.autoTargets || [];
    if (targets.length === 0) {
      const emptyEl = fieldEl.createDiv({ text: "No target folders." });
      emptyEl.style.opacity = "0.75";
      emptyEl.style.marginBottom = "6px";
    }
    for (const [index, target] of targets.entries()) {
      const rowEl = fieldEl.createDiv();
      rowEl.style.display = "flex";
      rowEl.style.flexWrap = "wrap";
      rowEl.style.alignItems = "center";
      rowEl.style.justifyContent = "space-between";
      rowEl.style.gap = "8px";
      rowEl.style.margin = "6px 0";
      const folderEl = rowEl.createSpan({ text: `Folder: ${displayFolderPath(target.path)}` });
      folderEl.style.flex = "1 1 220px";
      const controlsEl = rowEl.createDiv();
      controlsEl.style.display = "flex";
      controlsEl.style.alignItems = "center";
      controlsEl.style.justifyContent = "flex-end";
      controlsEl.style.gap = "8px";
      controlsEl.style.flex = "0 1 auto";
      controlsEl.createSpan({ text: "Include subfolders" });
      new ToggleComponent(controlsEl)
        .setValue(Boolean(target.recursive))
        .onChange((value) => {
          this.action.autoTargets[index].recursive = value;
        });
      const removeButton = controlsEl.createEl("button", { text: "Remove" });
      removeButton.addEventListener("click", () => {
        this.action.autoTargets = targets.filter((_, itemIndex) => itemIndex !== index);
        this.render();
      });
    }

    this.addAutoTargetAutocomplete(fieldEl);
  }

  addAutoTargetAutocomplete(containerEl) {
    const existing = new Set((this.action.autoTargets || []).map((target) => normalizeFolderPath(target.path)));
    const options = this.plugin.getVisibleFolders().filter((folder) => !existing.has(normalizeFolderPath(folder)));
    const fieldEl = this.createVerticalField(containerEl, "Add folder", "Visible vault folder path.");
    if (options.length === 0) {
      const emptyEl = fieldEl.createDiv({ text: "No remaining folder targets." });
      emptyEl.style.opacity = "0.75";
      return;
    }
    const inputEl = this.createFullWidthInput(fieldEl, "");
    let pending = "";
    inputEl.addEventListener("input", () => {
      pending = normalizeFolderPath(inputEl.value);
    });
    const addTarget = (path) => {
      const normalized = normalizeFolderPath(path);
      if (!normalized) {
        new Notice("Folder path is required.");
        return;
      }
      this.action.autoTargets = uniqueAutoTargets((this.action.autoTargets || []).concat({ path: normalized, recursive: false }));
      this.render();
    };
    new FolderPathSuggest(inputEl, options, addTarget);
    const addButton = fieldEl.createEl("button", { text: "Add folder" });
    addButton.style.marginTop = "6px";
    addButton.addEventListener("click", () => addTarget(pending));
  }

  addSpecificTargetsSetting(contentEl) {
    const fieldEl = this.createVerticalField(contentEl, "Targets", "Add one or more folders and Markdown notes. Folder targets use direct child Markdown notes only.");
    const targets = this.action.targets || [];
    if (targets.length === 0) {
      const emptyEl = fieldEl.createDiv({ text: "No specific targets." });
      emptyEl.style.opacity = "0.75";
      emptyEl.style.marginBottom = "6px";
    }
    for (const [index, target] of targets.entries()) {
      const rowEl = fieldEl.createDiv();
      rowEl.style.display = "flex";
      rowEl.style.alignItems = "center";
      rowEl.style.gap = "8px";
      rowEl.style.margin = "4px 0";
      rowEl.createSpan({ text: `${target.type === TARGETS.FOLDER ? "Folder" : "File"}: ${target.path}` });
      const removeButton = rowEl.createEl("button", { text: "Remove" });
      removeButton.addEventListener("click", () => {
        this.action.targets = targets.filter((_, itemIndex) => itemIndex !== index);
        this.render();
      });
    }
    const folderOptions = this.filterAvailableTargets(TARGETS.FOLDER, this.plugin.getVisibleFolders());
    const fileOptions = this.filterAvailableTargets(TARGETS.FILE, this.plugin.getVisibleMarkdownFilePaths());
    this.addTargetAutocomplete(fieldEl, "Add folder", "Visible vault folder path.", TARGETS.FOLDER, folderOptions);
    this.addTargetAutocomplete(fieldEl, "Add file", "Visible Markdown note path.", TARGETS.FILE, fileOptions);
  }

  addTargetAutocomplete(containerEl, label, desc, type, options) {
    const fieldEl = this.createVerticalField(containerEl, label, desc);
    if (options.length === 0) {
      const emptyEl = fieldEl.createDiv({ text: `No remaining ${type === TARGETS.FOLDER ? "folder" : "file"} targets.` });
      emptyEl.style.opacity = "0.75";
      return;
    }
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
      this.action.targets = uniqueTargets((this.action.targets || []).concat({ type, path: normalized }));
      this.action.targetType = TARGETS.SPECIFIC_TARGETS;
      this.render();
    };
    if (type === TARGETS.FOLDER) new FolderPathSuggest(inputEl, options, addTarget);
    else new MarkdownFilePathSuggest(inputEl, options, addTarget);
    const addButton = fieldEl.createEl("button", { text: label });
    addButton.style.marginTop = "6px";
    addButton.addEventListener("click", () => addTarget(pending));
  }

  filterAvailableTargets(type, options) {
    const existing = new Set((this.action.targets || [])
      .filter((target) => target.type === type)
      .map((target) => type === TARGETS.FOLDER ? normalizeFolderPath(target.path) : String(target.path || "").trim()));
    return options.filter((option) => {
      const normalized = type === TARGETS.FOLDER ? normalizeFolderPath(option) : String(option || "").trim();
      return normalized && !existing.has(normalized);
    });
  }

  addFileTargetSetting(contentEl) {
    const fileOptions = this.plugin.getVisibleMarkdownFilePaths();
    const fieldEl = this.createVerticalField(contentEl, "File path", "Vault-relative visible Markdown note path.");
    const inputEl = this.createFullWidthInput(fieldEl, this.action.targetPath || "");
    inputEl.addEventListener("input", () => {
      this.action.targetPath = inputEl.value.trim();
    });
    inputEl.addEventListener("change", () => {
      this.action.targetPath = inputEl.value.trim();
      this.render();
    });
    new MarkdownFilePathSuggest(inputEl, fileOptions, (path) => {
      this.action.targetPath = path;
      inputEl.value = path;
      this.render();
    });
  }

  addPropertyPicker(contentEl, label, field, allowManual = true) {
    const files = this.plugin.resolveTargetFiles(this.action, this.context);
    const candidates = this.plugin.buildPropertyCandidates(files);
    const current = this.action[field] || "";
    const desc = files.length > 0
      ? `${files.length} target note(s). Candidates combine configured and detected properties.`
      : "Candidates combine configured and detected properties when target notes are available.";
    const fieldEl = this.createVerticalField(contentEl, label, desc);
    const inputEl = this.createFullWidthInput(fieldEl, current);
    inputEl.disabled = !allowManual;
    inputEl.addEventListener("input", () => {
      const previousType = this.action.propertyType;
      this.action[field] = inputEl.value.trim();
      if (field === "propertyName") this.syncTypeFromProperty();
      this.updateResolvedPropertyType(fieldEl);
      if (field === "propertyName" && previousType !== this.action.propertyType && this.hasExactConfiguredProperty(this.action.propertyName)) {
        window.setTimeout(() => this.render(), 0);
      }
    });
    inputEl.addEventListener("change", () => {
      this.action[field] = inputEl.value.trim();
      if (field === "propertyName") this.syncTypeFromProperty();
      this.render();
    });
    new PropertyInputSuggest(inputEl, candidates, (candidate) => {
      this.chooseProperty(field, candidate.name);
    });
    this.updateResolvedPropertyType(fieldEl);
  }

  chooseProperty(field, value) {
    this.action[field] = value;
    if (field === "propertyName") this.syncTypeFromProperty();
    this.render();
  }

  syncTypeFromProperty() {
    this.action.propertyType = this.plugin.getPropertyType(this.action.propertyName, PROPERTY_TYPES.TEXT);
  }

  hasExactConfiguredProperty(propertyName) {
    return this.plugin.settings.properties.some((property) => property.name === propertyName);
  }

  getSelectedPropertyCandidate() {
    const files = this.plugin.resolveTargetFiles(this.action, this.context);
    return this.plugin.buildPropertyCandidates(files).find((candidate) => candidate.name === this.action.propertyName);
  }

  updateResolvedPropertyType(fieldEl) {
    if (!fieldEl) return;
    let resolvedEl = fieldEl.querySelector(".npo-resolved-type");
    if (!resolvedEl) {
      resolvedEl = fieldEl.createDiv({ cls: "npo-resolved-type" });
      resolvedEl.style.marginTop = "4px";
      resolvedEl.style.fontSize = "12px";
      resolvedEl.style.opacity = "0.75";
    }
    const candidate = this.getSelectedPropertyCandidate();
    if (candidate) {
      const source = candidate.configured && candidate.detectedCount > 0
        ? "configured + detected"
        : candidate.configured
          ? "configured"
          : "detected only";
      resolvedEl.setText(`Resolved type: ${candidate.type} / ${source}`);
      return;
    }
    resolvedEl.setText(`Resolved type: ${this.action.propertyType || PROPERTY_TYPES.TEXT} / manual`);
  }

  addValueEditor(contentEl) {
    const type = this.plugin.getPropertyType(this.action.propertyName, this.action.propertyType || PROPERTY_TYPES.TEXT);
    this.action.propertyType = type;

    if (type === PROPERTY_TYPES.CHECKBOX) {
      new Setting(contentEl)
        .setName("Value")
        .addToggle((toggle) => toggle.setValue(this.action.value === true || this.action.value === "true").onChange((value) => {
          this.action.value = value;
        }));
      return;
    }

    if (type === PROPERTY_TYPES.LIST || type === PROPERTY_TYPES.TAGS) {
      new Setting(contentEl)
        .setName("Value")
        .setDesc("Comma-separated values.")
        .addTextArea((text) => text.setValue(Array.isArray(this.action.value) ? this.action.value.join(", ") : String(this.action.value || "")).onChange((value) => {
          this.action.value = value;
        }));
      return;
    }

    new Setting(contentEl)
      .setName(`Value (${type})`)
      .addText((text) => {
        text.setValue(String(this.action.value == null ? "" : this.action.value)).onChange((value) => {
          this.action.value = value;
        });
        if (type === PROPERTY_TYPES.NUMBER) text.inputEl.type = "number";
        if (type === PROPERTY_TYPES.DATE) text.inputEl.type = "date";
        if (type === PROPERTY_TYPES.DATETIME) text.inputEl.type = "datetime-local";
      });
  }

  createVerticalField(containerEl, label, desc) {
    const fieldEl = containerEl.createDiv({ cls: "npo-vertical-field" });
    fieldEl.style.margin = "12px 0";
    const labelEl = fieldEl.createDiv({ text: label });
    labelEl.style.fontWeight = "600";
    if (desc) {
      const descEl = fieldEl.createDiv({ text: desc });
      descEl.style.fontSize = "12px";
      descEl.style.opacity = "0.75";
      descEl.style.margin = "4px 0 6px";
    }
    return fieldEl;
  }

  createFullWidthInput(containerEl, value) {
    const wrapperEl = containerEl.createDiv({ cls: "npo-suggest-wrapper" });
    wrapperEl.style.position = "relative";
    const inputEl = wrapperEl.createEl("input", { type: "text", value: value || "" });
    inputEl.addClass("text-input");
    inputEl.style.width = "100%";
    inputEl.style.boxSizing = "border-box";
    return inputEl;
  }

  createSmallButton(containerEl, label, onClick) {
    const button = containerEl.createEl("button", { text: label });
    button.style.marginTop = "6px";
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
    const error = validateAction(this.action, "manual");
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

    const changed = this.previewEntries.filter((entry) => entry.status === "changed").length;
    const skipped = this.previewEntries.filter((entry) => entry.status === "skipped").length;
    contentEl.createEl("p", { text: `Changed if applied: ${changed}. Skipped: ${skipped}. Failed: 0.` });

    const list = contentEl.createEl("ul");
    for (const entry of this.previewEntries.slice(0, 30)) {
      list.createEl("li", { text: `${entry.status}: ${entry.path} (${entry.reason})` });
    }
    if (this.previewEntries.length > 30) contentEl.createEl("p", { text: `Showing 30 of ${this.previewEntries.length} notes.` });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Close").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Apply").setCta().onClick(() => this.apply()));
  }

  async apply() {
    const changed = this.previewEntries.filter((entry) => entry.status === "changed").length;
    if (changed === 0) {
      new Notice("Preview has no changes to apply.");
      return;
    }

    const multiFile = this.previewEntries.length > 1 || (this.context && this.context.requiresConfirm);
    if (multiFile) {
      const confirmed = await confirmModal(this.app, "Apply multiple-file operation?", `This will modify ${changed} Markdown note(s).`);
      if (!confirmed) return;
    }

    if (this.action.overwrite && this.plugin.settings.confirmOverwrite) {
      const confirmedOverwrite = await confirmModal(this.app, "Confirm overwrite", "Overwrite is enabled. Existing property values may be replaced.");
      if (!confirmedOverwrite) return;
    }

    const result = await this.plugin.applyAction(this.action, this.previewEntries);
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
    this.containerEl = inputEl.parentElement;
    this.dropdownEl = this.containerEl.createDiv();
    this.dropdownEl.style.position = "absolute";
    this.dropdownEl.style.zIndex = "1000";
    this.dropdownEl.style.display = "none";
    this.dropdownEl.style.background = "var(--background-primary)";
    this.dropdownEl.style.border = "1px solid var(--background-modifier-border)";
    this.dropdownEl.style.borderRadius = "6px";
    this.dropdownEl.style.boxShadow = "var(--shadow-s)";
    this.dropdownEl.style.overflowY = "auto";
    this.dropdownEl.style.maxHeight = `${this.maxDropdownHeight}px`;

    this.inputEl.addEventListener("input", () => this.render());
    this.inputEl.addEventListener("focus", () => this.render());
    this.inputEl.addEventListener("keydown", (event) => this.handleKeydown(event));
    this.inputEl.addEventListener("blur", () => {
      window.setTimeout(() => this.close(), 150);
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
    this.dropdownEl.style.display = "block";
    for (const [index, item] of this.suggestions.entries()) {
      const itemEl = this.dropdownEl.createDiv();
      itemEl.style.padding = "6px 8px";
      itemEl.style.cursor = "pointer";
      itemEl.style.background = index === this.selectedIndex ? "var(--background-modifier-hover)" : "";
      itemEl.createDiv({ text: this.getText(item) });
      if (this.getNote) {
        const note = this.getNote(item);
        if (note) {
          const noteEl = itemEl.createDiv({ text: note });
          noteEl.style.fontSize = "12px";
          noteEl.style.opacity = "0.75";
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
      items[index].style.background = index === this.selectedIndex ? "var(--background-modifier-hover)" : "";
    }
  }

  choose(item) {
    this.inputEl.value = this.getText(item);
    this.onChoose(item);
    this.close();
  }

  close() {
    this.dropdownEl.style.display = "none";
    this.dropdownEl.empty();
    this.suggestions = [];
    this.selectedIndex = 0;
  }

  fitDropdownToInput() {
    const inputRect = this.inputEl.getBoundingClientRect();
    const modalEl = this.inputEl.closest(".modal-content") || this.inputEl.closest(".modal");
    const modalRect = modalEl ? modalEl.getBoundingClientRect() : {
      top: 0,
      bottom: window.innerHeight
    };
    const bottomGap = 24;
    const topGap = 16;
    const minimumHeight = this.minimumDropdownHeight;
    const boundaryBottom = Math.min(window.innerHeight, modalRect.bottom);
    const boundaryTop = Math.max(0, modalRect.top);
    const availableBelow = boundaryBottom - inputRect.bottom - bottomGap;
    const availableAbove = inputRect.top - boundaryTop - topGap;
    const opensUp = availableBelow < minimumHeight && availableAbove > availableBelow;
    const available = opensUp ? availableAbove : availableBelow;
    const maxHeight = Math.min(this.maxDropdownHeight, Math.max(minimumHeight, available));
    this.dropdownEl.style.left = "0";
    this.dropdownEl.style.top = opensUp ? "auto" : "calc(100% + 4px)";
    this.dropdownEl.style.bottom = opensUp ? "calc(100% + 4px)" : "auto";
    this.dropdownEl.style.width = "100%";
    this.dropdownEl.style.maxHeight = `${maxHeight}px`;
    this.dropdownEl.style.overflowY = "auto";
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
    super(
      inputEl,
      () => candidates,
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
  const normalized = {
    properties: normalizeProperties(source.properties || migrateProperties(source.propertyNames || [])),
    manualActions: (source.manualActions || migrateActions(source.savedActions || [], "manual")).map(normalizeAction),
    autoActions: (source.autoActions || migrateActions(source.folderRules || [], "auto")).map(normalizeAction),
    excludedFolders: uniqueStrings((source.excludedFolders || []).map(normalizePathInput).filter(Boolean)),
    addMissingOnly: source.addMissingOnly !== false,
    confirmOverwrite: source.confirmOverwrite !== false,
    suggestLimit: Number.isInteger(source.suggestLimit) && source.suggestLimit > 0 ? source.suggestLimit : 12
  };
  return normalized;
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
    const migrated = createEmptyAction(kind);
    migrated.name = action.name || "";
    migrated.operation = action.operation || action.action || ACTIONS.ADD;
    migrated.targetType = action.target || TARGETS.CURRENT_FILE;
    migrated.propertyName = action.propertyName || "";
    migrated.newPropertyName = action.newPropertyName || "";
    migrated.value = action.value == null ? "" : action.value;
    migrated.propertyType = oldValueTypeToPropertyType(action.valueType);
    migrated.overwrite = Boolean(action.overwrite);
    migrated.targetFolder = normalizeFolderPath(action.folderPath || action.targetFolder || "/");
    migrated.targetPath = String(action.targetPath || "").trim();
    migrated.targets = normalizeTargets(action.targets || singleTargetFromLegacy(migrated));
    migrated.autoTargets = normalizeAutoTargets(action.autoTargets || autoTargetFromLegacy(migrated));
    if (kind === "auto") migrated.enabled = false;
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

function normalizeAction(action) {
  const base = Object.assign(createEmptyAction(action && action.trigger ? "auto" : "manual"), action || {});
  base.id = base.id || createId();
  base.name = String(base.name || "").trim();
  base.operation = Object.values(ACTIONS).includes(base.operation) ? base.operation : ACTIONS.ADD;
  base.targetType = Object.values(TARGETS).includes(base.targetType) ? base.targetType : TARGETS.CURRENT_FILE;
  base.targetFolder = normalizeFolderPath(base.targetFolder || "/");
  base.targetPath = String(base.targetPath || "").trim();
  const incomingTargets = Array.isArray(action && action.targets) ? action.targets : singleTargetFromLegacy(base);
  base.targets = normalizeTargets(incomingTargets);
  const hasAutoTargets = Array.isArray(action && action.autoTargets);
  const incomingAutoTargets = hasAutoTargets ? action.autoTargets : autoTargetFromLegacy(action || {});
  base.autoTargets = normalizeAutoTargets(incomingAutoTargets);
  if (!base.trigger && base.targets.length > 0) base.targetType = TARGETS.SPECIFIC_TARGETS;
  base.propertyName = String(base.propertyName || "").trim();
  base.newPropertyName = String(base.newPropertyName || "").trim();
  base.propertyType = Object.values(PROPERTY_TYPES).includes(base.propertyType) ? base.propertyType : PROPERTY_TYPES.TEXT;
  base.overwrite = Boolean(base.overwrite);
  base.addIfMissing = Boolean(base.addIfMissing);
  if (base.operation === ACTIONS.ADD && base.overwrite == null) base.overwrite = false;
  if (base.trigger) {
    base.trigger = AUTO_TRIGGER;
    base.enabled = Boolean(base.enabled);
    base.targets = [];
  } else {
    delete base.enabled;
    delete base.trigger;
    delete base.lastRunKey;
    delete base.autoTargets;
  }
  return base;
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
  return uniqueTargets((targets || []).map((target) => {
    const type = target.type === TARGETS.FOLDER ? TARGETS.FOLDER : target.type === TARGETS.FILE ? TARGETS.FILE : "";
    if (!type) return null;
    const path = type === TARGETS.FOLDER ? normalizeFolderPath(target.path) : String(target.path || "").trim();
    if (!path) return null;
    return { type, path };
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
  if (!action.targetFolder) return [];
  return [{ path: normalizeFolderPath(action.targetFolder), recursive: false }];
}

function normalizeAutoTargets(targets) {
  return uniqueAutoTargets((targets || []).map((target) => {
    const path = normalizeFolderPath(target.path);
    if (!path) return null;
    return { path, recursive: Boolean(target.recursive) };
  }).filter(Boolean));
}

function uniqueAutoTargets(targets) {
  const seen = new Set();
  const result = [];
  for (const target of targets || []) {
    const path = normalizeFolderPath(target.path);
    if (seen.has(path)) continue;
    seen.add(path);
    result.push({ path, recursive: Boolean(target.recursive) });
  }
  return result;
}

function validateAction(action, kind) {
  if (!action.name) return "Action name is required.";
  if (!action.propertyName) return "Property is required.";
  if (action.operation === ACTIONS.RENAME && !action.newPropertyName) return "New property is required.";
  if ((action.operation === ACTIONS.ADD || action.operation === ACTIONS.SET) && action.propertyType === PROPERTY_TYPES.NUMBER) {
    if (String(action.value == null ? "" : action.value).trim() && !Number.isFinite(Number(action.value))) return "Number value is invalid.";
  }
  if ((action.operation === ACTIONS.ADD || action.operation === ACTIONS.SET) && action.propertyType === PROPERTY_TYPES.DATE) {
    const value = String(action.value == null ? "" : action.value).trim();
    if (value && !isValidDateInput(value)) return "Date value must use YYYY-MM-DD.";
  }
  if ((action.operation === ACTIONS.ADD || action.operation === ACTIONS.SET) && action.propertyType === PROPERTY_TYPES.DATETIME) {
    const value = String(action.value == null ? "" : action.value).trim();
    if (value && !isValidDateTimeInput(value)) return "Date & time value must use the native date-time format.";
  }
  if (kind === "auto" && (!action.autoTargets || action.autoTargets.length === 0)) return "Add at least one target folder.";
  if (kind !== "auto" && action.targetType === TARGETS.SPECIFIC_TARGETS && (!action.targets || action.targets.length === 0)) {
    return "Add at least one target.";
  }
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
    changed: 0,
    skipped: 0,
    failed: 0,
    reasons: []
  };
}

function displayResult(result) {
  if (!result) return "No result yet";
  return `Changed: ${result.changed || 0}. Skipped: ${result.skipped || 0}. Failed: ${result.failed || 0}.`;
}

function displayInitialSyncResult(action) {
  if (!action.lastInitialSyncResult) return "";
  return ` - Last existing-note sync: ${displayResult(action.lastInitialSyncResult)}`;
}

function describeAction(action) {
  const property = action.propertyName || "no property";
  if (action.operation === ACTIONS.RENAME) return `Rename ${property} to ${action.newPropertyName || "no property"}`;
  if (action.operation === ACTIONS.REMOVE) return `Remove ${property}`;
  if (action.operation === ACTIONS.SET) return `Set/change ${property}`;
  return `Add ${property}`;
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
  if (targets.length === 0) return "No target folders";
  if (targets.length === 1) {
    const target = targets[0];
    return `Folder: ${displayFolderPath(target.path)}${target.recursive ? " include subfolders" : ""}`;
  }
  const recursiveCount = targets.filter((target) => target.recursive).length;
  return recursiveCount > 0 ? `Folders: ${targets.length}, include subfolders: ${recursiveCount}` : `Folders: ${targets.length}`;
}

function displayFolderPath(path) {
  return normalizeFolderPath(path) === "/" ? "Vault root (/)" : normalizeFolderPath(path);
}

function formatCandidate(candidate) {
  return `${candidate.name} - ${propertyCandidateNote(candidate)}`;
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
  if (!rename && !change.normalizeValues) return { status: "skipped", reason: "No note change selected" };

  const currentValue = frontmatter[oldName];
  let nextValue = currentValue;
  let valueChanged = false;
  if (change.normalizeValues) {
    const converted = convertValueToPropertyType(currentValue, change.newType);
    if (!converted.ok) return { status: "skipped", reason: converted.reason };
    nextValue = converted.value;
    valueChanged = !valuesEqual(currentValue, nextValue);
  }

  if (!rename && change.normalizeValues && !valueChanged) {
    return { status: "skipped", reason: "Value already matches selected type" };
  }

  const reason = rename && valueChanged
    ? "Will rename property and normalize value"
    : rename
      ? "Will rename property"
      : "Will normalize value";
  return { status: "changed", reason, value: nextValue };
}

function mutateCatalogChange(frontmatter, change, value) {
  if (change.oldName !== change.newName) {
    frontmatter[change.newName] = value;
    delete frontmatter[change.oldName];
    return;
  }
  frontmatter[change.oldName] = value;
}

function convertValueToPropertyType(value, type) {
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
    if (typeof value === "string" && isValidDateInput(value.trim())) return { ok: true, value: value.trim() };
    return { ok: false, reason: "Value is not a valid date" };
  }

  if (type === PROPERTY_TYPES.DATETIME) {
    if (typeof value === "string" && isValidDateTimeInput(value.trim())) return { ok: true, value: value.trim() };
    return { ok: false, reason: "Value is not a valid date and time" };
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

function inferPropertyType(name, values) {
  const observed = (values || []).filter((value) => value !== null && value !== undefined);
  if (observed.length === 0) return PROPERTY_TYPES.TEXT;
  const lowerName = String(name || "").toLowerCase();
  if (observed.every((value) => Array.isArray(value))) {
    return lowerName === "tags" || lowerName.includes("tag") ? PROPERTY_TYPES.TAGS : PROPERTY_TYPES.LIST;
  }
  if (observed.every((value) => typeof value === "boolean" || isBooleanString(value))) return PROPERTY_TYPES.CHECKBOX;
  if (observed.every((value) => typeof value === "number" ? Number.isFinite(value) : isNumericString(value))) return PROPERTY_TYPES.NUMBER;
  if (observed.every(isInferableDateValue)) {
    return observed.some(isInferableDateTimeValue) ? PROPERTY_TYPES.DATETIME : PROPERTY_TYPES.DATE;
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

function isInferableDateValue(value) {
  return isInferableDateTimeValue(value) || isInferableDateOnlyValue(value);
}

function isInferableDateTimeValue(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T| |'T')\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?$/.test(text)) return false;
  const normalized = text.replace("'T'", "T").replace(" ", "T");
  return Number.isFinite(new Date(normalized).getTime());
}

function isInferableDateOnlyValue(value) {
  return typeof value === "string" && isValidDateInput(value.trim());
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isValidDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value);
}

function isValidDateTimeInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return false;
  return Number.isFinite(new Date(value).getTime());
}

function normalizePathInput(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
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
  if (!target.recursive) return normalizedParent === targetPath;
  if (targetPath === "/") return true;
  return normalizedParent === targetPath || normalizedParent.startsWith(`${targetPath}/`);
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
