/** Минимум, который нужен для сортировки ленты. */
export interface Sortable {
	path: string;
	mtime: number;
}

/** Порядок баблов в ленте: по времени последней правки, свежие внизу. */
export function sortFeed<T extends Sortable>(items: readonly T[]): T[] {
	// При равном mtime сравниваем пути — иначе порядок «прыгает» между запусками.
	return [...items].sort(
		(a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path, "ru"),
	);
}
