# Native Property Operator

Native Property Operator is an Obsidian plugin for safely previewing and applying YAML frontmatter property operations across Markdown notes.

## Safety warning

This plugin modifies YAML frontmatter in Markdown notes. Back up the vault and use preview before applying actions to folders, root targets, or existing-note synchronization.

The plugin only targets visible Markdown notes. It ignores the Obsidian configuration folder, hidden/dot folders, configured excluded folders, attachments, and non-Markdown files.

## Features

- Maintain a property catalog with native property types.
- Add existing detected frontmatter properties to the catalog with conservative type inference.
- Preview and apply catalog name/type changes.
- Create saved manual actions for adding, removing, renaming, or setting property values.
- Create auto actions that run when Markdown notes are created in or moved into target folders.
- Preview changes before applying them.
- Report changed, skipped, and failed counts with reasons.
- Confirm multi-file operations and overwrite operations.

## Supported property types

- Text
- List
- Number
- Checkbox
- Date
- Date & time
- Tags

## Property catalog

The catalog stores property names and their intended native Obsidian property type. Catalog changes use draft editing: change the name or type, then choose **Apply changes...** to preview affected notes before writing frontmatter. **Revert** restores the saved catalog values in the editor. **Delete from catalog** removes the catalog entry only and does not change notes.

When changing a catalog property name, destination conflicts are skipped by default. If overwrite is enabled, existing destination values may be replaced after confirmation. Type-only catalog changes update the catalog unless value normalization is explicitly enabled.

## Manual actions

Saved manual actions can target the current file, the current folder, or specific files and folders. Folder targets apply to direct child Markdown notes. Manual actions support:

- Add property
- Remove property
- Rename property
- Set/change property value

Before applying a manual action, the plugin shows a preview with changed and skipped notes. Applying multiple files asks for confirmation. If overwrite is enabled and overwrite confirmation is on, the plugin asks for an additional confirmation.

## Auto actions

Auto actions run only when a Markdown note is created in or moved into a configured target folder. They do not run on ordinary note modification.

Each auto target is a folder and may include subfolders. Without **Include subfolders**, only notes directly inside the target folder match. With **Include subfolders**, notes in nested folders also match. Vault root (`/`) with **Include subfolders** matches all visible Markdown notes in the vault.

When enabling an auto action for the first time, the plugin can preview synchronization for existing matching notes before enabling future automation. You can also run **Sync existing notes** from the auto action list.

## Conflicts and results

Expected conflicts are skipped, not treated as failures. Examples include missing source properties, existing destination properties when overwrite is disabled, and values that cannot be safely converted during catalog normalization. Real write exceptions are counted as failed. One failed file does not stop the remaining files.

## Installation

Download the release assets from GitHub and place them in your vault under `.obsidian/plugins/native-property-operator/`:

- `main.js`
- `manifest.json`

Then enable the plugin in Obsidian settings.

## Development

Install dependencies and build:

```sh
npm ci
npm run build
```

The production build writes `main.js`.

## License

MIT License. See [LICENSE](LICENSE).
