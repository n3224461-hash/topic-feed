/**
 * Канбан-доски соседнего плагина. Topic Feed только показывает их в проводнике
 * и ничего в них не пишет, поэтому знает о них минимум: три константы.
 * Чистая логика: не импортирует "obsidian".
 */

/** Значение свойства type у заметки-доски. */
export const BOARD_TYPE = "kanban";

/** Значение свойства type у заметки-задачи. */
export const TASK_TYPE = "task";

/** Имя свойства, которым задача связана со своей доской. */
export const BOARD_PROPERTY = "kanban";

/** Доска ли это — по свойствам заметки. */
export function isBoardFrontmatter(
	frontmatter: Record<string, unknown> | undefined | null,
): boolean {
	return hasType(frontmatter, BOARD_TYPE);
}

/** Задача ли это — по свойствам заметки. */
export function isTaskFrontmatter(
	frontmatter: Record<string, unknown> | undefined | null,
): boolean {
	return hasType(frontmatter, TASK_TYPE);
}

function hasType(
	frontmatter: Record<string, unknown> | undefined | null,
	expected: string,
): boolean {
	if (!frontmatter) return false;
	const type = frontmatter["type"];
	if (typeof type !== "string") return false;
	return type.trim().toLowerCase() === expected;
}
