/**
 * Имена файлов: название пользователь пишет свободно, а файл в хранилище
 * должен называться так, чтобы Obsidian его принял и чтобы имя
 * не столкнулось с соседним файлом в той же папке.
 * Чистая логика: не импортирует "obsidian".
 */

/** Запрещено файловыми системами; хвост диапазона — управляющие символы. */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001F\u007F]/g;

const FALLBACK = "Без названия";

/** Убирает из названия символы, которые нельзя класть в имя файла. */
export function safeFileName(name: string): string {
	const cleaned = name
		.replace(FORBIDDEN, " ")
		.replace(/\s+/g, " ")
		.trim()
		// Имя с точки в начале Obsidian считает скрытым файлом.
		.replace(/^\.+/, "")
		.trim();

	return cleaned.length > 0 ? cleaned : FALLBACK;
}

/**
 * Добавляет числовой суффикс, если такое имя в папке уже занято:
 * «Имя», «Имя 2», «Имя 3»…
 * Сравнение без учёта регистра — файловые системы macOS и Windows
 * не различают «Имя» и «имя».
 */
export function uniqueFileName(name: string, taken: ReadonlySet<string>): string {
	const busy = new Set([...taken].map((item) => item.toLowerCase()));
	if (!busy.has(name.toLowerCase())) return name;

	for (let suffix = 2; ; suffix += 1) {
		const candidate = `${name} ${suffix}`;
		if (!busy.has(candidate.toLowerCase())) return candidate;
	}
}
