/**
 * Подготовка списка для показа пользователю.
 * Чистая функция: не импортирует "obsidian", поэтому покрыта тестами.
 */
export function formatItems(items: string[], limit = 10): string[] {
	const shown = items.slice(0, limit);
	const hidden = items.length - shown.length;
	return hidden > 0 ? [...shown, `…и ещё ${hidden}`] : shown;
}
