export type ReorderPlacement = "before" | "after";

export function reorderById<T extends { id?: string }>(
  items: T[],
  draggedId: string,
  targetId: string,
  placement: ReorderPlacement = "before"
): T[] {
  if (!Array.isArray(items) || draggedId === targetId) return items;

  const sourceIndex = items.findIndex((item) => item && item.id === draggedId);
  const targetIndex = items.findIndex((item) => item && item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return items;

  const reordered = items.slice();
  const [dragged] = reordered.splice(sourceIndex, 1);
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const insertionIndex = placement === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  reordered.splice(insertionIndex, 0, dragged);
  return reordered;
}

export function moveItemByOffset<T extends { id?: string }>(items: T[], itemId: string, offset: number): T[] {
  if (!Number.isInteger(offset) || offset === 0 || !Array.isArray(items)) return items;

  const currentIndex = items.findIndex((item) => item && item.id === itemId);
  if (currentIndex < 0) return items;

  const targetIndex = currentIndex + offset;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  return moveItemToIndex(items, itemId, targetIndex);
}

export function moveItemToIndex<T extends { id?: string }>(items: T[], itemId: string, targetIndex: number): T[] {
  if (!Array.isArray(items) || !Number.isInteger(targetIndex)) return items;

  const currentIndex = items.findIndex((item) => item && item.id === itemId);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length || currentIndex === targetIndex) return items;

  const reordered = items.slice();
  const [moved] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  return reordered;
}
