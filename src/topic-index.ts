import { type App, TFile, TFolder, debounce } from "obsidian";
import { isTopicFrontmatter, parseTopicLink } from "./lib/topic-link";
import { BOARD_PROPERTY, isBoardFrontmatter, isTaskFrontmatter } from "./lib/board-link";
import type { TopicInfo } from "./lib/tree";
import type { Sortable } from "./lib/ordering";

/** Заметка так, как её показывает лента. */
export interface FeedNote extends Sortable {
	name: string;
}

/**
 * Кто на какой топик ссылается и когда в топике последний раз что-то менялось.
 *
 * Держим в памяти: проводник сортирует уровень по свежести при каждой
 * перерисовке, а обходить всё хранилище на каждый чих нельзя. Свойства читаем
 * из metadataCache — сами файлы не открываем.
 *
 * Здесь же учитываются канбан-доски соседнего плагина: проводник показывает их
 * наравне с топиками, но в модели связей ленты они не участвуют.
 */
export class TopicIndex {
	/** Путь файла топика → его собственное время правки. */
	private topicMtime = new Map<string, number>();
	/** Путь файла топика → пути заметок, которые на него ссылаются. */
	private members = new Map<string, Set<string>>();
	/** Путь заметки → путь её топика. */
	private noteTopic = new Map<string, string>();
	/** Заметки без топика — путь → время правки. */
	private orphans = new Map<string, number>();

	/** Путь файла доски → её собственное время правки. */
	private boardMtime = new Map<string, number>();
	/** Путь файла доски → пути её задач. */
	private boardTasks = new Map<string, Set<string>>();
	/** Путь задачи → путь её доски. */
	private taskBoard = new Map<string, string>();

	private listeners = new Set<() => void>();

	private notify = debounce(
		() => {
			for (const listener of this.listeners) listener();
		},
		80,
		true,
	);

	constructor(
		private app: App,
		/** Имя свойства связи берём из настроек, поэтому читаем его каждый раз заново. */
		private linkProperty: () => string,
	) {}

	/** Полная пересборка. Дешевле, чем кажется: всё уже лежит в metadataCache. */
	rebuild(): void {
		this.topicMtime.clear();
		this.members.clear();
		this.noteTopic.clear();
		this.orphans.clear();
		this.boardMtime.clear();
		this.boardTasks.clear();
		this.taskBoard.clear();

		const files = this.app.vault.getMarkdownFiles();

		// Сначала топики и доски — иначе ссылку не на что разрешать.
		for (const file of files) {
			if (this.isTopicFile(file)) this.topicMtime.set(file.path, file.stat.mtime);
			else if (this.isBoardFile(file)) this.boardMtime.set(file.path, file.stat.mtime);
		}
		for (const file of files) {
			if (this.isContainer(file.path)) continue;
			this.place(file);
		}

		this.notify();
	}

	/** Подписка на изменения индекса. Возвращает функцию отписки. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Топик ли этот файл. */
	isTopicFile(file: TFile): boolean {
		return isTopicFrontmatter(this.frontmatterOf(file));
	}

	/** Канбан-доска ли этот файл. */
	isBoardFile(file: TFile): boolean {
		return isBoardFrontmatter(this.frontmatterOf(file));
	}

	/** Все топики хранилища со свежестью. */
	allTopics(): TopicInfo[] {
		return [...this.topicMtime.keys()].map((path) =>
			this.containerInfo(path, this.topicMtime, this.members),
		);
	}

	/** Все доски хранилища со свежестью. */
	allBoards(): TopicInfo[] {
		return [...this.boardMtime.keys()].map((path) =>
			this.containerInfo(path, this.boardMtime, this.boardTasks),
		);
	}

	/** Топики и доски вместе — по ним считаются свежесть и счётчик папки. */
	allContainers(): TopicInfo[] {
		return [...this.allTopics(), ...this.allBoards()];
	}

	/** Топики, лежащие непосредственно в этой папке. */
	topicsInFolder(folderPath: string): TopicInfo[] {
		return this.allTopics().filter((topic) => parentOf(topic.path) === folderPath);
	}

	/** Доски, лежащие непосредственно в этой папке. */
	boardsInFolder(folderPath: string): TopicInfo[] {
		return this.allBoards().filter((board) => parentOf(board.path) === folderPath);
	}

	/** Пути подпапок этой папки. */
	subfolders(folderPath: string): string[] {
		const folder = this.folderAt(folderPath);
		if (!folder) return [];
		return folder.children
			.filter((child): child is TFolder => child instanceof TFolder)
			.map((child) => child.path);
	}

	/** Заметки топика — без сортировки, порядок задаёт лента. */
	notesOf(topicPath: string): FeedNote[] {
		return this.notesAt(this.members.get(topicPath));
	}

	/** Сколько задач на доске. */
	taskCount(boardPath: string): number {
		return this.boardTasks.get(boardPath)?.size ?? 0;
	}

	/** Заметки без топика — по всему хранилищу. */
	notesWithoutTopic(): FeedNote[] {
		return this.notesAt(this.orphans.keys());
	}

	/** Путь топика, к которому относится заметка. */
	topicOf(notePath: string): string | null {
		return this.noteTopic.get(notePath) ?? null;
	}

	// ——— поддержание индекса в актуальном состоянии ———

	/** Файл изменился: свойства могли поменяться, разложим заново. */
	handleChanged(file: TFile): void {
		const wasTopic = this.topicMtime.has(file.path);
		const wasBoard = this.boardMtime.has(file.path);

		if (this.isTopicFile(file)) {
			this.forget(file.path);
			this.topicMtime.set(file.path, file.stat.mtime);
			// Заметки могли ссылаться на этот файл, когда он ещё не был топиком.
			if (!wasTopic) this.replaceOrphansPointingAt(file.path);
			this.notify();
			return;
		}

		if (this.isBoardFile(file)) {
			this.forget(file.path);
			this.boardMtime.set(file.path, file.stat.mtime);
			if (!wasBoard) this.collectTasksOf(file.path);
			this.notify();
			return;
		}

		// Контейнер перестал быть контейнером — его содержимое осиротело.
		if (wasTopic) this.dissolveTopic(file.path);
		if (wasBoard) this.dissolveBoard(file.path);

		this.forget(file.path);
		this.place(file);
		this.notify();
	}

	handleDeleted(path: string): void {
		if (this.topicMtime.has(path)) this.dissolveTopic(path);
		if (this.boardMtime.has(path)) this.dissolveBoard(path);
		this.forget(path);
		this.notify();
	}

	/**
	 * Переименование меняет ссылки во всех заметках топика, а сообщения об этом
	 * приходят вразнобой — дешевле и надёжнее пересобрать целиком.
	 */
	handleRenamed(): void {
		this.rebuild();
	}

	// ——— внутреннее ———

	/** Топик и доска — контейнеры: в ленте они не показываются. */
	private isContainer(path: string): boolean {
		return this.topicMtime.has(path) || this.boardMtime.has(path);
	}

	/** Раскладывает обычную заметку: к топику или в «без топика», плюс к доске. */
	private place(file: TFile): void {
		const frontmatter = this.frontmatterOf(file);

		const link = parseTopicLink(frontmatter?.[this.linkProperty()]);
		const topicPath = link ? this.resolveIn(this.topicMtime, link, file.path) : null;

		if (topicPath) {
			this.noteTopic.set(file.path, topicPath);
			addTo(this.members, topicPath, file.path);
		} else {
			this.orphans.set(file.path, file.stat.mtime);
		}

		// Задача может лежать и в топике, и на доске — это разные связи.
		if (!isTaskFrontmatter(frontmatter)) return;
		const boardLink = parseTopicLink(frontmatter?.[BOARD_PROPERTY]);
		const boardPath = boardLink
			? this.resolveIn(this.boardMtime, boardLink, file.path)
			: null;
		if (!boardPath) return;

		this.taskBoard.set(file.path, boardPath);
		addTo(this.boardTasks, boardPath, file.path);
	}

	/** Ссылка ведёт на известный контейнер — вернуть его путь. Иначе связи нет. */
	private resolveIn(
		known: Map<string, number>,
		linkpath: string,
		sourcePath: string,
	): string | null {
		const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
		if (!target) return null;
		return known.has(target.path) ? target.path : null;
	}

	/** Убирает файл из всех карт, кроме списков контейнеров их собственных детей. */
	private forget(path: string): void {
		const topic = this.noteTopic.get(path);
		if (topic) {
			this.members.get(topic)?.delete(path);
			this.noteTopic.delete(path);
		}

		const board = this.taskBoard.get(path);
		if (board) {
			this.boardTasks.get(board)?.delete(path);
			this.taskBoard.delete(path);
		}

		this.orphans.delete(path);
		this.topicMtime.delete(path);
		this.boardMtime.delete(path);
	}

	/** Топик исчез — его заметки становятся заметками без топика. */
	private dissolveTopic(topicPath: string): void {
		for (const member of this.members.get(topicPath) ?? []) {
			this.noteTopic.delete(member);
			const file = this.app.vault.getAbstractFileByPath(member);
			if (file instanceof TFile) this.orphans.set(member, file.stat.mtime);
		}
		this.members.delete(topicPath);
	}

	/** Доска исчезла — её задачи просто теряют доску, на ленту это не влияет. */
	private dissolveBoard(boardPath: string): void {
		for (const task of this.boardTasks.get(boardPath) ?? []) {
			this.taskBoard.delete(task);
		}
		this.boardTasks.delete(boardPath);
	}

	/** Появился новый топик — забираем заметки, которые уже на него ссылались. */
	private replaceOrphansPointingAt(topicPath: string): void {
		for (const path of [...this.orphans.keys()]) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const link = parseTopicLink(this.frontmatterOf(file)?.[this.linkProperty()]);
			if (!link) continue;
			if (this.resolveIn(this.topicMtime, link, file.path) !== topicPath) continue;
			this.orphans.delete(path);
			this.place(file);
		}
	}

	/** Появилась новая доска — собираем задачи, которые уже на неё ссылались. */
	private collectTasksOf(boardPath: string): void {
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.isContainer(file.path)) continue;
			const frontmatter = this.frontmatterOf(file);
			if (!isTaskFrontmatter(frontmatter)) continue;

			const link = parseTopicLink(frontmatter?.[BOARD_PROPERTY]);
			if (!link) continue;
			if (this.resolveIn(this.boardMtime, link, file.path) !== boardPath) continue;

			this.taskBoard.set(file.path, boardPath);
			addTo(this.boardTasks, boardPath, file.path);
		}
	}

	/** Свежесть контейнера: правки его содержимого и его собственные. */
	private containerInfo(
		path: string,
		own: Map<string, number>,
		children: Map<string, Set<string>>,
	): TopicInfo {
		let freshness = own.get(path) ?? 0;
		for (const child of children.get(path) ?? []) {
			const file = this.app.vault.getAbstractFileByPath(child);
			if (file instanceof TFile && file.stat.mtime > freshness) freshness = file.stat.mtime;
		}
		return { path, name: baseName(path), freshness };
	}

	private notesAt(paths: Iterable<string> | undefined): FeedNote[] {
		if (!paths) return [];
		const result: FeedNote[] = [];
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				result.push({ path: file.path, name: file.basename, mtime: file.stat.mtime });
			}
		}
		return result;
	}

	private frontmatterOf(file: TFile): Record<string, unknown> | undefined {
		return this.app.metadataCache.getFileCache(file)?.frontmatter;
	}

	private folderAt(folderPath: string): TFolder | null {
		if (folderPath === "") return this.app.vault.getRoot();
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		return folder instanceof TFolder ? folder : null;
	}
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
	let set = map.get(key);
	if (!set) {
		set = new Set();
		map.set(key, set);
	}
	set.add(value);
}

/** Путь родительской папки: "Проекты/Курс.md" → "Проекты", файл в корне → "". */
export function parentOf(filePath: string): string {
	const cut = filePath.lastIndexOf("/");
	return cut === -1 ? "" : filePath.slice(0, cut);
}

/** Имя файла без пути и расширения. */
export function baseName(filePath: string): string {
	const withExt = filePath.slice(filePath.lastIndexOf("/") + 1);
	return withExt.replace(/\.md$/i, "");
}
