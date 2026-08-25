import { type App, TFile, TFolder, debounce } from "obsidian";
import { isTopicFrontmatter, parseTopicLink } from "./lib/topic-link";
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

		const files = this.app.vault.getMarkdownFiles();

		// Сначала топики — иначе ссылку не на что разрешать.
		for (const file of files) {
			if (this.isTopicFile(file)) this.topicMtime.set(file.path, file.stat.mtime);
		}
		for (const file of files) {
			if (this.topicMtime.has(file.path)) continue;
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
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return isTopicFrontmatter(frontmatter);
	}

	/** Все топики хранилища со свежестью. */
	allTopics(): TopicInfo[] {
		const result: TopicInfo[] = [];
		for (const path of this.topicMtime.keys()) {
			result.push(this.topicInfo(path));
		}
		return result;
	}

	/** Топики, лежащие непосредственно в этой папке. */
	topicsInFolder(folderPath: string): TopicInfo[] {
		return this.allTopics().filter((topic) => parentOf(topic.path) === folderPath);
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
		const paths = this.members.get(topicPath);
		if (!paths) return [];
		const result: FeedNote[] = [];
		for (const path of paths) {
			const note = this.noteAt(path);
			if (note) result.push(note);
		}
		return result;
	}

	/** Заметки без топика — по всему хранилищу. */
	notesWithoutTopic(): FeedNote[] {
		const result: FeedNote[] = [];
		for (const path of this.orphans.keys()) {
			const note = this.noteAt(path);
			if (note) result.push(note);
		}
		return result;
	}

	/** Путь топика, к которому относится заметка. */
	topicOf(notePath: string): string | null {
		return this.noteTopic.get(notePath) ?? null;
	}

	/** Свежесть топика: правки его заметок и его собственные. */
	private topicInfo(path: string): TopicInfo {
		let freshness = this.topicMtime.get(path) ?? 0;
		for (const member of this.members.get(path) ?? []) {
			const file = this.app.vault.getAbstractFileByPath(member);
			if (file instanceof TFile && file.stat.mtime > freshness) freshness = file.stat.mtime;
		}
		return { path, name: baseName(path), freshness };
	}

	private noteAt(path: string): FeedNote | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return null;
		return { path: file.path, name: file.basename, mtime: file.stat.mtime };
	}

	private folderAt(folderPath: string): TFolder | null {
		if (folderPath === "") return this.app.vault.getRoot();
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		return folder instanceof TFolder ? folder : null;
	}

	// ——— поддержание индекса в актуальном состоянии ———

	/** Файл изменился: свойства могли поменяться, разложим заново. */
	handleChanged(file: TFile): void {
		const wasTopic = this.topicMtime.has(file.path);
		const isTopic = this.isTopicFile(file);

		if (isTopic) {
			this.forget(file.path);
			this.topicMtime.set(file.path, file.stat.mtime);
			// Заметки могли ссылаться на этот файл, когда он ещё не был топиком.
			if (!wasTopic) this.replaceOrphansPointingAt(file.path);
			this.notify();
			return;
		}

		if (wasTopic) {
			// Топик перестал быть топиком — его заметки остались без топика.
			this.dissolve(file.path);
		}
		this.forget(file.path);
		this.place(file);
		this.notify();
	}

	handleDeleted(path: string): void {
		if (this.topicMtime.has(path)) this.dissolve(path);
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

	/** Раскладывает обычную заметку: к топику или в «без топика». */
	private place(file: TFile): void {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const link = parseTopicLink(frontmatter?.[this.linkProperty()]);
		const topicPath = link ? this.resolveTopic(link, file.path) : null;

		if (topicPath) {
			this.noteTopic.set(file.path, topicPath);
			let set = this.members.get(topicPath);
			if (!set) {
				set = new Set();
				this.members.set(topicPath, set);
			}
			set.add(file.path);
		} else {
			this.orphans.set(file.path, file.stat.mtime);
		}
	}

	/** Ссылка ведёт на топик — вернуть его путь. Иначе связи нет. */
	private resolveTopic(linkpath: string, sourcePath: string): string | null {
		const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
		if (!target) return null;
		return this.topicMtime.has(target.path) ? target.path : null;
	}

	/** Убирает файл из всех карт, кроме списка топиков. */
	private forget(path: string): void {
		const topic = this.noteTopic.get(path);
		if (topic) {
			this.members.get(topic)?.delete(path);
			this.noteTopic.delete(path);
		}
		this.orphans.delete(path);
		this.topicMtime.delete(path);
	}

	/** Топик исчез — его заметки становятся заметками без топика. */
	private dissolve(topicPath: string): void {
		for (const member of this.members.get(topicPath) ?? []) {
			this.noteTopic.delete(member);
			const file = this.app.vault.getAbstractFileByPath(member);
			if (file instanceof TFile) this.orphans.set(member, file.stat.mtime);
		}
		this.members.delete(topicPath);
	}

	/** Появился новый топик — забираем заметки, которые уже на него ссылались. */
	private replaceOrphansPointingAt(topicPath: string): void {
		for (const path of [...this.orphans.keys()]) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const link = parseTopicLink(frontmatter?.[this.linkProperty()]);
			if (!link) continue;
			if (this.resolveTopic(link, file.path) !== topicPath) continue;
			this.orphans.delete(path);
			this.place(file);
		}
	}
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
