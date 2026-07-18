# Native Property Operator

Native Property Operator is an Obsidian plugin for safely previewing and applying YAML frontmatter property operations across Markdown notes.

## Safety warning

This plugin modifies YAML frontmatter in Markdown notes. Back up the vault and use preview before applying actions to folders, root targets, or existing-note synchronization.

The plugin only targets visible Markdown notes. It ignores the Obsidian configuration folder, hidden/dot folders, configured excluded folders, attachments, and non-Markdown files.

## Features

- Maintain a property catalog with native property types.
- Browse every uncataloged detected frontmatter property in an alphabetized, scrollable browser with conservative type inference.
- Reorder property catalog entries, manual actions, and automatic actions with dedicated drag handles or Alt/Option + Arrow Up/Down.
- Persist each list's order across settings navigation, reloads, restarts, and configuration export/import.
- Preview and apply catalog name/type changes.
- Create saved manual actions for adding, removing, renaming, setting values, or changing types for multiple properties.
- Select multiple exact files and folder trees in one action. Every folder includes all eligible Markdown descendants; `/` means the full visible vault.
- Folder targets are canonicalized from the vault without renaming folders: `publish` resolves to a unique `Publish` folder, nested casing is preserved, and case-equivalent targets are deduplicated.
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

Every browser result is a separate readable row with property name, detected type, file count, and representative examples. Property catalog cards and saved action cards have a dedicated `grip-vertical` handle. Dragging starts only from that handle; keyboard users can focus the handle and use Alt/Option + Arrow Up or Arrow Down. The saved arrays retain their current order during migration, adding a property appends it, deleting removes only that entry, and renaming keeps the same position. Reordering does not apply actions, rename properties, scan notes, or modify frontmatter.

When changing a catalog property name, destination conflicts are skipped by default. If overwrite is enabled, existing destination values may be replaced after confirmation. Type-only catalog changes update the catalog unless value normalization is explicitly enabled.

## Manual actions

Saved manual actions can target the current file, the current folder tree, or multiple specific files and folders. A folder always includes every eligible Markdown note below it at every depth. The root target `/` includes all visible eligible Markdown notes in the vault. Manual actions support:

- Add property
- Remove property
- Rename property
- Set/change property value
- Change property type

Each saved action uses a typed `operations` array. Add and set rows contain an exact known property name and value; their current configured/detected type is read-only and drives the value editor. Remove rows contain names; rename rows contain old/new names; and type rows contain a source property plus an explicitly editable target type and conservative conversion options. Legacy scalar action fields are migrated to one row automatically. Every operation row has a stable ID and can be reordered with its `grip-vertical` handle or Alt/Option + Arrow Up/Down; the complete property reference, type, value, conversion options, and unknown fields move together.

Selecting an existing property in an action binds the row to its exact canonical name and detected/configured type. Typing the exact name resolves identically to choosing a suggestion. The selected name and current type are shown as a read-only reference; **Change property** is required to choose another property. Add-property rows never expose an editable Type selector and cannot invent unknown property types; configure an unknown property on the Properties tab first. Rename locks its source, and Change type keeps only its target type editable. Legacy name-only references are matched by exact configured name first, then exact detected name; unresolved or type-incompatible references require review before Save, Preview, Apply, or automatic execution.

Manual action cards and automatic action cards can be reordered independently. Their stable action IDs, targets, enabled state, trigger, result summaries, and unrelated configuration fields remain unchanged. A valid drop or keyboard move saves immediately; a persistence failure restores the previous order and reports the failure.

Saved action cards use separate header, summary, and footer sections. Summaries keep the target, operation, result state, and counts readable while clamping to four rendered lines; the complete summary remains available through the native tooltip. Preview, Apply, Edit, Delete, and Sync existing notes stay together in a bottom-right footer that wraps as a group only when the available width requires it.

The manual and automatic action editors share ordered target rows and property-operation cards. Every target and operation remains individually removable. Property-specific fields stay inside the card, operation-specific add controls follow the full card list, and action-level overwrite or add-if-missing settings remain outside the cards. Operation and Type controls align left. Compact property, folder, and file suggestions align to the input's left edge and use a neutral theme-native popup surface. Candidate names and complete property metadata wrap in content-sized rows, while long result lists scroll independently with mouse, trackpad, touch, and keyboard navigation. Property suggestions omit exact-case source names already selected in another row of the same action while retaining the focused row's own value. Card and target rerenders preserve the modal scroll position; newly added cards are revealed and focused without intentionally scrolling back to the top.

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
npm test
npm run lint
npm run check
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

- Open a manual Remove property action and focus an empty Property field.
- In both light and dark themes, confirm the popup uses a neutral native surface and unselected candidates have no persistent filled-button background.
- Hover a candidate, then move with Arrow Down; confirm only the hovered or keyboard-selected row uses the darker highlight.
- Confirm every property name and its complete metadata are visible on separate lines, including long wrapping content, with no clipping or row overlap.
- Use enough candidates to exceed the popup height. Scroll with a mouse wheel and trackpad, confirming the popup scrolls instead of the modal behind it.
- Navigate with Arrow, Page, Home, and End keys and confirm the selected row remains visible. Press Enter to select and Escape to close.
- Confirm properties selected in other rows are absent. Select a candidate, confirm the popup closes without jumping, then remove that row and confirm its property becomes available again.
- Type a duplicate property manually and confirm validation blocks saving.
- Repeat the appearance, wrapping, scrolling, and navigation checks with folder suggestions, file suggestions, the automatic action editor, and a narrow modal width.

Scroll:

- Scroll to lower property cards, add a property, and confirm the modal stays near the property section with the new card visible.
- Remove a middle card and change a Type; confirm each rerender preserves the nearby viewport.

Removal:

- Target a note containing `title`, `status`, and an unrelated property; preview and confirm one changed file and two changed operations for removal of `title` and `status`.
- Apply and confirm those exact keys are removed while unrelated and differently cased keys remain.

Add existing property:

- Open **Add existing property** with a blank query; confirm all eligible uncataloged properties appear alphabetically and the result list scrolls to the bottom.
- Test Page Down and End, search for one property, select it, and confirm it is added to the catalog.
- In light theme, confirm the result panel uses the native light surface, unselected rows are neutral, hover affects only one row, and keyboard selection is visibly darker; repeat in dark theme.
- Confirm normal rows are not permanently filled, hover/selection are darker or contrasting only on the active row, and focus has a visible outline without affecting neighboring rows.

Canonical folders and locked properties:

- If the vault has a `Publish` folder, enter `publish` and `Publish` in target pickers and confirm each resolves to one displayed/stored `Publish` target. Repeat with `Publish/essays` and confirm nested casing is preserved. If no such folder exists, do not create or rename one for this check.
- Select an existing property in Add, Remove, Set, Rename, and Change type operations. Confirm its canonical name/type are read-only, **Change property** is explicit, Rename only edits its destination, and Change type only edits its target type.
- Confirm Add can still configure a genuinely new property, unresolved legacy references block Save/Preview/Apply, and a catalog type change requiring review does not execute until corrected.
- Open Add property in both Manual and Automatic actions; confirm no editable Type dropdown exists, exact typing resolves canonical names/types, unknown names show “Add this property to the Properties tab first so its type can be defined,” and Change type still exposes its target-type dropdown.

Property and action ordering:

- Create or add at least five catalog properties. Drag the fifth property to the first position and confirm the insertion indicator, readable card layout, and clickable controls.
- Close and reopen settings, reload Obsidian, and confirm catalog order persists. Rename a property and confirm its position is unchanged; delete one and confirm the remaining order is stable.
- Focus a property handle and use Alt/Option + Arrow Up/Down. Confirm focus stays on the moved handle and first/last boundaries are safe.
- Create at least four manual actions and four automatic actions. Reorder each list independently, confirm Preview, Apply, Edit, Delete, toggles, targets, and last-run information remain intact, and confirm reordering does not execute actions.
- In a saved action editor, create at least four Add/Remove/Set/Rename/Change type rows, reorder them by handle and by Alt/Option + Arrow Up/Down, and confirm the full row data moves together, focus returns to the handle, and order survives Save/reopen and export/import.
- Confirm every saved action card has a wrapped title header, a summary capped at four rendered lines, and a bottom-right footer. Confirm manual buttons appear Preview, Apply, Edit, Delete and automatic buttons appear Sync existing notes, Edit, Delete.
- Resize the settings view to a narrow width and confirm footer buttons wrap as one horizontal group without clipping, overlap, or horizontal page scrolling; repeat in light/dark themes and a popout.

Add existing property browser:

- Leave the search blank and confirm every candidate is a distinct row with separate name, type/count, and examples lines.
- Scroll with mouse and trackpad to the final result, then test Page Down, End, Home, Arrow navigation, Enter selection, and Escape closing.
- Confirm long names and paths wrap without clipping, the results list scrolls independently, and the settings/modal behind it does not scroll.

Overlap audit:

- Test General, Properties, Manual actions, and Auto actions plus every editor, preview/result modal, target selector, property-operation variant, conversion control, and Save/Cancel footer.
- Repeat at normal and narrow modal widths, in light and dark themes, and in a popout window.
- Confirm no overlapping labels/buttons, clipped metadata, card intersections, hidden dropdowns, footer overlap, or horizontal page scrolling. Confirm compact suggestions, the Add existing property browser, and action-editor lists scroll inside the active window.

Automatic actions:

- Confirm the same target rows and property-card layout, all-descendant folder behavior, skipped automatic overwrite conflicts, and no modify trigger.

Responsive layout:

- At a narrow modal width, verify target rows and card headers wrap, fields stack, dropdowns remain visible, and the footer is not clipped.
- Check long property names, List and Tags textareas, Date and Date & time controls, and selected folder/file target rows.

## License

MIT License. See [LICENSE](LICENSE).
