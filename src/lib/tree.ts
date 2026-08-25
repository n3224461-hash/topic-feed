/** Узел уровня проводника — папка или топик. */
export interface TreeNode {
	kind: "folder" | "topic" | "board";
	/** Путь папки без завершающего слэша, либо путь файла топика или доски. */
	path: string;
	/** Что показать пользователю. */
	name: string;
	/** Время последней правки: у топика — его заметок, у папки — самого свежего топика внутри. */
	freshness: number;
}

/** Топик или доска так, как их знает индекс. */
export interface TopicInfo {
	/** Путь файла, например "Проекты/Курс.md". */
	path: string;
	name: string;
	freshness: number;
}

/** Разбивает путь на сегменты, игнорируя лишние и повторяющиеся слэши. */
function segments(path: string): string[] {
	return path.split("/").filter((part) => part.length > 0);
}

/** Лежит ли топик внутри папки, включая вложенные папки. */
export function isInsideFolder(topicPath: string, folderPath: string): boolean {
	const folder = segments(folderPath).join("/");
	// Корень содержит всё.
	if (folder === "") return true;
	// Сравниваем по границе сегмента: "ПроектыДругие" не внутри "Проекты".
	return topicPath.startsWith(`${folder}/`);
}

/** Свежесть папки — максимум по топикам внутри неё, включая вложенные. 0, если топиков нет. */
export function folderFreshness(
	folderPath: string,
	topics: readonly TopicInfo[],
): number {
	let max = 0;
	for (const topic of topics) {
		if (isInsideFolder(topic.path, folderPath) && topic.freshness > max) {
			max = topic.freshness;
		}
	}
	return max;
}

/** Сколько топиков лежит внутри папки, включая вложенные. */
export function folderTopicCount(
	folderPath: string,
	topics: readonly TopicInfo[],
): number {
	return topics.filter((topic) => isInsideFolder(topic.path, folderPath)).length;
}

/** Есть ли внутри папки хоть один топик, включая вложенные. */
export function folderHasTopics(
	folderPath: string,
	topics: readonly TopicInfo[],
): boolean {
	return topics.some((topic) => isInsideFolder(topic.path, folderPath));
}

/** Собирает и сортирует один уровень проводника. */
export function buildLevel(input: {
	/** Пути подпапок текущего уровня, например ["Проекты/Архив"]. */
	folders: readonly string[];
	/** Топики, лежащие непосредственно в текущей папке. */
	topics: readonly TopicInfo[];
	/** Доски, лежащие непосредственно в текущей папке. */
	boards?: readonly TopicInfo[];
	/** Все топики и доски хранилища — по ним считается свежесть подпапок. */
	allTopics: readonly TopicInfo[];
	/** Скрывать ли папки, внутри которых нет ни топиков, ни досок. */
	onlyFoldersWithTopics: boolean;
	/** Папки, которые показываем вопреки фильтру: их только что создали. */
	keepFolders?: readonly string[];
}): TreeNode[] {
	const keep = new Set(input.keepFolders ?? []);
	const folderNodes: TreeNode[] = [];
	for (const path of input.folders) {
		if (
			input.onlyFoldersWithTopics &&
			!keep.has(path) &&
			!folderHasTopics(path, input.allTopics)
		) {
			continue;
		}
		const parts = segments(path);
		folderNodes.push({
			kind: "folder",
			path,
			name: parts[parts.length - 1] ?? path,
			freshness: folderFreshness(path, input.allTopics),
		});
	}

	const topicNodes: TreeNode[] = input.topics.map((topic) => ({
		kind: "topic",
		path: topic.path,
		name: topic.name,
		freshness: topic.freshness,
	}));

	const boardNodes: TreeNode[] = (input.boards ?? []).map((board) => ({
		kind: "board",
		path: board.path,
		name: board.name,
		freshness: board.freshness,
	}));

	// Тип узла на порядок не влияет: свежее — выше, при равной свежести — по имени.
	return [...folderNodes, ...topicNodes, ...boardNodes].sort(
		(a, b) => b.freshness - a.freshness || a.name.localeCompare(b.name, "ru"),
	);
}

/** Хлебные крошки для пути папки. Для корня — пустой массив. */
export function breadcrumbs(
	folderPath: string,
): { name: string; path: string }[] {
	const crumbs: { name: string; path: string }[] = [];
	let acc = "";
	for (const part of segments(folderPath)) {
		acc = acc === "" ? part : `${acc}/${part}`;
		crumbs.push({ name: part, path: acc });
	}
	return crumbs;
}
