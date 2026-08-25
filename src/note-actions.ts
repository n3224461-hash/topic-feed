import { type App, Notice, TFile, TFolder } from "obsidian";
import { makeTopicLink } from "./lib/topic-link";

/** Сколько секунд висит уведомление с кнопкой «Отменить». */
const UNDO_SECONDS = 8;

/**
 * Действия над заметками из ленты. Каждое — штучное и с отменой:
 * плагин работает с единственной копией чужих заметок.
 */
export class NoteActions {
	/**
	 * Живое уведомление об отмене всегда одно. Иначе после двух перемещений
	 * подряд старая кнопка откатила бы заметку через голову новой.
	 */
	private pendingUndo: Notice | null = null;

	constructor(
		private app: App,
		private linkProperty: () => string,
	) {}

	/** Привязывает заметку к топику. Прежнее значение свойства можно вернуть. */
	async moveToTopic(file: TFile, topic: TFile): Promise<void> {
		const property = this.linkProperty();
		// Короткая ссылка от Obsidian: она учитывает одинаковые имена в разных
		// папках, поэтому связь ведёт именно в этот топик, а не в его тёзку.
		const linktext = this.app.metadataCache.fileToLinktext(topic, file.path);

		let before: unknown;
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// Прежнее значение читаем здесь же: metadataCache отстаёт от диска.
				before = frontmatter[property];
				frontmatter[property] = makeTopicLink(linktext);
			});
		} catch (error) {
			console.error("Topic Feed: не удалось изменить свойство", file.path, error);
			new Notice("Не удалось изменить свойство — подробности в консоли разработчика");
			return;
		}

		this.undoNotice(`«${file.basename}» → «${topic.basename}»`, async () => {
			await this.restoreProperty(file, property, before);
		});
	}

	/** Убирает связь с топиком: заметка уходит в «Без топика». */
	async clearTopic(file: TFile): Promise<void> {
		const property = this.linkProperty();

		let before: unknown;
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				before = frontmatter[property];
				delete frontmatter[property];
			});
		} catch (error) {
			console.error("Topic Feed: не удалось убрать свойство", file.path, error);
			new Notice("Не удалось изменить свойство — подробности в консоли разработчика");
			return;
		}

		if (before === undefined) {
			new Notice("У заметки и так нет топика");
			return;
		}

		this.undoNotice(`«${file.basename}» без топика`, async () => {
			await this.restoreProperty(file, property, before);
		});
	}

	/**
	 * Отправляет заметку в корзину по настройке хранилища.
	 * Содержимое запоминаем заранее: системную корзину программно не разобрать,
	 * поэтому отмена восстанавливает файл из памяти.
	 */
	async remove(file: TFile): Promise<void> {
		const path = file.path;
		const name = file.basename;

		let content = "";
		try {
			content = await this.app.vault.read(file);
		} catch (error) {
			console.error("Topic Feed: не удалось прочитать заметку перед удалением", path, error);
			new Notice("Не удалось прочитать заметку — удаление отменено");
			return;
		}

		try {
			await this.app.fileManager.trashFile(file);
		} catch (error) {
			console.error("Topic Feed: не удалось удалить заметку", path, error);
			new Notice("Не удалось удалить заметку — подробности в консоли разработчика");
			return;
		}

		this.undoNotice(`«${name}» в корзине`, async () => {
			await this.restoreFile(path, content);
		});
	}

	/** Переименовывает заметку, сохраняя папку. Ссылки обновляет Obsidian. */
	async rename(file: TFile, name: string): Promise<void> {
		const folder = file.parent?.path ?? "";
		const target = folder === "" || folder === "/" ? `${name}.md` : `${folder}/${name}.md`;
		if (target === file.path) return;

		if (this.pathTaken(target)) {
			new Notice("Заметка с таким именем уже есть");
			return;
		}

		const before = file.path;
		try {
			await this.app.fileManager.renameFile(file, target);
		} catch (error) {
			console.error("Topic Feed: не удалось переименовать заметку", file.path, error);
			new Notice("Не удалось переименовать заметку — подробности в консоли разработчика");
			return;
		}

		// Отмена — обратное переименование: ссылки Obsidian перепишет так же.
		this.undoNotice(`Переименована в «${name}»`, async () => {
			try {
				await this.app.fileManager.renameFile(file, before);
			} catch (error) {
				console.error("Topic Feed: не удалось вернуть имя", before, error);
				new Notice("Не удалось вернуть имя — подробности в консоли разработчика");
			}
		});
	}

	/** Кладёт в буфер обмена ссылку на заметку в том виде, как её пишет Obsidian. */
	async copyLink(file: TFile): Promise<void> {
		const link = this.app.fileManager.generateMarkdownLink(file, file.path);
		try {
			await navigator.clipboard.writeText(link);
			new Notice("Ссылка скопирована");
		} catch (error) {
			console.error("Topic Feed: не удалось скопировать ссылку", error);
			new Notice("Не удалось скопировать ссылку");
		}
	}

	/**
	 * Занят ли путь. Сравниваем без учёта регистра: macOS и Windows не различают
	 * «Идеи.md» и «идеи.md», а поиск по точному пути — различает.
	 */
	private pathTaken(path: string): boolean {
		const lower = path.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.some((item) => item.path.toLowerCase() === lower);
	}

	private async restoreProperty(
		file: TFile,
		property: string,
		value: unknown,
	): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				if (value === undefined) delete frontmatter[property];
				else frontmatter[property] = value;
			});
		} catch (error) {
			console.error("Topic Feed: не удалось отменить изменение", file.path, error);
			new Notice("Не удалось отменить — подробности в консоли разработчика");
		}
	}

	/** Возвращает удалённую заметку на прежнее место. */
	private async restoreFile(path: string, content: string): Promise<void> {
		if (this.pathTaken(path)) {
			new Notice("Заметка с таким именем уже есть — восстановить не получилось");
			return;
		}

		// Папку могли удалить, пока висело уведомление.
		const folder = path.slice(0, path.lastIndexOf("/"));
		if (folder !== "" && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
			try {
				await this.app.vault.createFolder(folder);
			} catch (error) {
				console.error("Topic Feed: не удалось создать папку для заметки", folder, error);
				new Notice("Папки для заметки больше нет — восстановить не получилось");
				return;
			}
		}

		try {
			await this.app.vault.create(path, content);
		} catch (error) {
			console.error("Topic Feed: не удалось восстановить заметку", path, error);
			new Notice("Не удалось восстановить заметку — подробности в консоли разработчика");
		}
	}

	/** Уведомление с кнопкой «Отменить». Живым остаётся только последнее. */
	private undoNotice(message: string, undo: () => Promise<void>): void {
		this.pendingUndo?.hide();

		const fragment = document.createDocumentFragment();
		fragment.createSpan({ text: message });

		const button = fragment.createEl("button", {
			text: "Отменить",
			cls: "topic-feed-undo",
		});

		const notice = new Notice(fragment, UNDO_SECONDS * 1000);
		this.pendingUndo = notice;

		button.onclick = () => {
			notice.hide();
			if (this.pendingUndo === notice) this.pendingUndo = null;
			void undo();
		};
	}
}
