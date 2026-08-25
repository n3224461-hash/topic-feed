import { TOPIC_TYPE } from "./topic-link";

/**
 * Содержимое новой заметки-топика.
 * Чистая логика: не импортирует "obsidian".
 */
export function newTopicContent(): string {
	return `---\ntype: ${TOPIC_TYPE}\n---\n\n`;
}
