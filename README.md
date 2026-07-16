# Native Property Operator

Native Property Operator is an Obsidian plugin for safely previewing and applying YAML frontmatter property operations across Markdown notes.

## Safety warning

This plugin modifies YAML frontmatter in Markdown notes. Back up the vault and use preview before applying actions to folders, root targets, or existing-note synchronization.

The plugin only targets visible Markdown notes. It ignores the Obsidian configuration folder, hidden/dot folders, configured excluded folders, attachments, and non-Markdown files.

## Features

- Maintain a property catalog with native property types.
- Browse every uncataloged detected frontmatter property in an alphabetized, scrollable browser with conservative type inference.
- Preview and apply catalog name/type changes.
- Create saved manual actions for adding, removing, renaming, setting values, or changing types for multiple properties.
- Select multiple exact files and folder trees in one action. Every folder includes all eligible Markdown descendants; `/` means the full visible vault.
- Create auto actions with the same typed targets and multi-property rows; they run when matching Markdown notes are created or moved.
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

**Add existing property** opens a full browser. A blank search shows every eligible uncataloged property in case-insensitive alphabetical order; the result area scrolls independently and supports Arrow, Page, Home, End, Enter, and Escape keys. Inline action-field suggestions remain compact.

When changing a catalog property name, destination conflicts are skipped by default. If overwrite is enabled, existing destination values may be replaced after confirmation. Type-only catalog changes update the catalog unless value normalization is explicitly enabled.

## Manual actions

Saved manual actions can target the current file, the current folder tree, or multiple specific files and folders. A folder always includes every eligible Markdown note below it at every depth. The root target `/` includes all visible eligible Markdown notes in the vault. Manual actions support:

- Add property
- Remove property
- Rename property
- Set/change property value
- Change property type

Each saved action uses a typed `operations` array. Add and set rows contain a property name, native type, and value; remove rows contain names; rename rows contain old/new names; and type rows contain a target type plus conservative conversion options. Legacy scalar action fields are migrated to one row automatically.

The manual and automatic action editors share ordered target rows and property cards. Every target and property remains individually removable. Property-specific fields stay inside the card, operation-specific add controls follow the full card list, and action-level overwrite or add-if-missing settings remain outside the cards. Operation and Type controls align left. Compact property, folder, and file suggestions align to the input's left edge, with property metadata beneath the candidate name. Property suggestions omit exact-case source names already selected in another row of the same action while retaining the focused row's own value. Card and target rerenders preserve the modal scroll position; newly added cards are revealed and focused without intentionally scrolling back to the top.

Remove actions inspect current frontmatter and match exact property keys. Removing `title` does not remove `Title` or similarly named keys. All configured operations for one note run inside one `processFrontMatter` callback, preserving unrelated frontmatter.

Before applying a manual action, the plugin shows a preview with changed and skipped notes. Applying multiple files asks for confirmation. If overwrite is enabled and overwrite confirmation is on, the plugin asks for an additional confirmation.

## Auto actions

Auto actions run only when a matching Markdown note is created or moved into a configured folder tree or exact file target. They do not run on ordinary note modification.

Automatic actions use the same ordered file/folder target schema as manual actions. There is no direct-child mode or recursive toggle: selecting a folder always selects its complete descendant tree, and `/` matches the complete visible vault.

When enabling an auto action for the first time, the plugin can preview synchronization for existing matching notes before enabling future automation. You can also run **Sync existing notes** from the auto action list.

## Conflicts and results

Expected conflicts are skipped, not treated as failures. Examples include missing source properties, existing destination properties when overwrite is disabled, and values that cannot be safely converted. Rename destination duplicates and cycles are rejected before Apply. Automatic actions never overwrite existing values: conflicts are explicitly reported as skipped because automatic runs have no confirmation step. Manual type changes require explicit confirmation before synchronizing a native type while incompatible values remain. Automatic type changes preserve incompatible values and skip that row's native type/catalog synchronization. Results keep file-level and operation-level changed, skipped, incompatible, and failed counts separate; one invalid row does not prevent other rows for the same file from applying.

## Installation

Download the release assets from GitHub and place them in your vault under `.obsidian/plugins/native-property-operator/`:

- `main.js`
- `manifest.json`
- `styles.css`

Then enable the plugin in Obsidian settings.

## Development

Install dependencies and build:

```sh
npm ci
npm run build
```

The production build writes `main.js`.

### Manual runtime smoke checklist

Targets:

- Open a manual action; add Folder `/`, another folder, and one file, confirming all selected targets remain visible.
- Remove one target and confirm the others remain in their original order.
- Preview Folder `/` and confirm eligible nested notes at every depth are included.

Properties:

- Select Remove property; add `heroImage`, `pubDate`, `status`, and `title` as four visible cards.
- Remove one middle card and confirm the others remain, renumber cleanly, and retain their values.
- Confirm Operation and Type controls align left with no overlap; save, reopen, and confirm rows persist.

Inline suggestions:

- Open a manual Remove property action, add at least four property cards, and focus an empty Property field.
- Confirm candidate names are left-aligned, metadata appears beneath each name and is left-aligned, and the popup's left edge aligns with the input.
- Confirm properties selected in other rows are absent; choose a candidate and confirm the popup closes without jumping the modal.
- Focus another row and confirm the newly selected property is absent. Remove the first row and confirm its property becomes available again.
- Type a duplicate property manually and confirm validation blocks saving.
- Test folder and file suggestions, a narrow modal width, and confirm each popup remains inside the modal or active window.
- Repeat the same checks in the automatic action editor.

Scroll:

- Scroll to lower property cards, add a property, and confirm the modal stays near the property section with the new card visible.
- Remove a middle card and change a Type; confirm each rerender preserves the nearby viewport.

Removal:

- Target a note containing `title`, `status`, and an unrelated property; preview and confirm one changed file and two changed operations for removal of `title` and `status`.
- Apply and confirm those exact keys are removed while unrelated and differently cased keys remain.

Add existing property:

- Open **Add existing property** with a blank query; confirm all eligible uncataloged properties appear alphabetically and the result list scrolls to the bottom.
- Test Page Down and End, search for one property, select it, and confirm it is added to the catalog.

Automatic actions:

- Confirm the same target rows and property-card layout, all-descendant folder behavior, skipped automatic overwrite conflicts, and no modify trigger.

Responsive layout:

- At a narrow modal width, verify target rows and card headers wrap, fields stack, dropdowns remain visible, and the footer is not clipped.
- Check long property names, List and Tags textareas, Date and Date & time controls, and selected folder/file target rows.

## License

MIT License. See [LICENSE](LICENSE).
