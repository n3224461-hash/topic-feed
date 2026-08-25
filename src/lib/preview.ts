/**
 * Превью заметки для бабла ленты.
 * Чистая логика: не импортирует "obsidian".
 */

/**
 * Готовит текст заметки для показа в бабле ленты:
 * срезает свойства, снимает разметку, обрезает по границе слова.
 */
export function previewText(raw: string | null | undefined, limit: number): string {
	// Содержимое вкладки Obsidian подставляет не сразу: пока файл не прочитан,
	// у представления вместо текста лежит null.
	if (!raw || limit < 1) return "";

	const body = stripFrontmatter(raw);
	const plain = stripMarkup(body);
	const text = collapseWhitespace(plain).trim();

	return truncateAtWord(text, limit);
}

/** Срезает блок свойств, только если он открыт первой строкой и закрыт. */
function stripFrontmatter(raw: string): string {
	const lines = raw.split("\n");
	if (lines.length === 0) return raw;
	if ((lines[0] ?? "").trimEnd() !== "---") return raw;

	for (let i = 1; i < lines.length; i++) {
		if (/^-{3,}\s*$/.test(lines[i] ?? "")) {
			return lines.slice(i + 1).join("\n");
		}
	}
	// Закрывающей строки нет — это обычный текст, не свойства.
	return raw;
}

function stripMarkup(text: string): string {
	return (
		text
			.replace(/<!--[\s\S]*?-->/g, "")
			// Код в превью бесполезен — блок удаляем целиком.
			.replace(/```[\s\S]*?```/g, "")
			.replace(/`([^`\n]*)`/g, "$1")
			.replace(/!\[\[[^\]]*\]\]/g, "")
			.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
			.replace(/\[\[([^\]]+)\]\]/g, (_match: string, target: string) => {
				const aliasAt = target.indexOf("|");
				if (aliasAt !== -1) return target.slice(aliasAt + 1);
				const segments = target.split("/");
				return segments[segments.length - 1] ?? target;
			})
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			// Линии до маркеров списка: "***" не должно стать пунктом.
			.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "")
			.replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
			.replace(/^[ \t]*(?:>[ \t]?)+/gm, "")
			.replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "")
			.replace(/~~([\s\S]*?)~~/g, "$1")
			.replace(/==([\s\S]*?)==/g, "$1")
			.replace(/\*\*([\s\S]*?)\*\*/g, "$1")
			.replace(/__([\s\S]*?)__/g, "$1")
			.replace(/\*([^*\n]+)\*/g, "$1")
			.replace(/_([^_\n]+)_/g, "$1")
	);
}

function collapseWhitespace(text: string): string {
	const lines = text
		.split("\n")
		.map((line) => line.replace(/[ \t]+/g, " ").trim());
	return lines.join("\n").replace(/\n{4,}/g, "\n\n");
}

function truncateAtWord(text: string, limit: number): string {
	if (text.length <= limit) return text;

	const head = text.slice(0, limit);
	// Символ на границе — пробел, значит слово закончилось ровно по лимиту.
	if (/\s/.test(text.charAt(limit))) {
		return trimTail(head) + "…";
	}

	const lastSpace = head.search(/\s\S*$/);
	if (lastSpace === -1) return head + "…";

	return trimTail(head.slice(0, lastSpace)) + "…";
}

/** Снимает хвостовые пробелы и знаки препинания перед многоточием. */
function trimTail(text: string): string {
	return text.replace(/[\s\p{P}\p{S}]+$/u, "");
}
