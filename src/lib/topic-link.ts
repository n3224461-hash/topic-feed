/**
 * Связь заметки с топиком: распознавание топика и разбор ссылки на него.
 * Чистая логика: не импортирует "obsidian".
 */

/** Значение свойства type у заметки-топика. */
export const TOPIC_TYPE = "topic";

/** Топик ли это — по свойствам заметки. */
export function isTopicFrontmatter(
	frontmatter: Record<string, unknown> | undefined | null,
): boolean {
	if (!frontmatter) return false;
	const type = frontmatter["type"];
	if (typeof type !== "string") return false;
	return type.trim().toLowerCase() === TOPIC_TYPE;
}

/**
 * Читает значение свойства связи и возвращает linkpath топика без скобок и алиаса.
 * null, если связи нет.
 */
export function parseTopicLink(value: unknown): string | null {
	// У заметки один топик, но Obsidian хранит свойство-ссылку списком.
	if (Array.isArray(value)) {
		for (const item of value) {
			const parsed = parseTopicLink(item);
			if (parsed !== null) return parsed;
		}
		return null;
	}

	if (typeof value !== "string") return null;

	let text = value.trim();
	if (text.startsWith("[[") && text.endsWith("]]")) {
		text = text.slice(2, -2);
	}

	// Порядок как в Obsidian: [[путь#якорь|алиас]].
	const aliasAt = text.indexOf("|");
	if (aliasAt !== -1) text = text.slice(0, aliasAt);
	const anchorAt = text.indexOf("#");
	if (anchorAt !== -1) text = text.slice(0, anchorAt);

	text = text.trim();
	return text.length > 0 ? text : null;
}

/** Собирает значение свойства связи для ссылки на топик по его имени. */
export function makeTopicLink(topicBasename: string): string {
	const name = topicBasename.trim();
	if (name.length === 0) {
		throw new Error("Имя топика пустое — ссылку не построить");
	}
	return `[[${name}]]`;
}
