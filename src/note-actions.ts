import { type App, Notice, TFile } from "obsidian";
import { makeTopicLink } from "./lib/topic-link";

/** Сколько секунд висит уведомление с кнопкой «Отменить». */
const UNDO_SECONDS = 8;

/**
 * Действия над заметками из ленты. Каждое — штучное и с отменой:
 * плагин работает с единственной копией чужих заметок.
 */
export class NoteActions {
	constructor(
		private app: App,
		private linkProperty: () => string,
	) {}

	/** Привязывает заметку к топику. Прежнее значение свойства можно вернуть. */
	async moveToTopic(file: TFile, topic: TFile): Promise<void> {
		const property = this.linkProperty();
		const before = this.readProperty(file, property);

		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter[property] = makeTopicLink(topic.basename);
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
		const before = this.readProperty(file, property);
		if (before === undefined) {
			new Notice("У заметки и так нет топика");
			return;
		}

		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				delete frontmatter[property];
			});
		} catch (error) {
			console.error("Topic Feed: не удалось убрать свойство", file.path, error);
			new Notice("Не удалось изменить свойство — подробности в консоли разработчика");
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
			if (this.app.vault.getAbstractFileByPath(path)) {
				new Notice("Заметка с таким именем уже есть — восстановить не получилось");
				return;
			}
			try {
				await this.app.vault.create(path, content);
			} catch (error) {
				console.error("Topic Feed: не удалось восстановить заметку", path, error);
				new Notice("Не удалось восстановить заметку — подробности в консоли разработчика");
			}
		});
	}

	/** Переименовывает заметку, сохраняя папку. Ссылки обновляет Obsidian. */
	async rename(file: TFile, name: string): Promise<void> {
		const folder = file.parent?.path ?? "";
		const target = folder === "" ? `${name}.md` : `${folder}/${name}.md`;
		if (target === file.path) return;

		if (this.app.vault.getAbstractFileByPath(target)) {
			new Notice("Заметка с таким именем уже есть");
			return;
		}

		try {
			await this.app.fileManager.renameFile(file, target);
		} catch (error) {
			console.error("Topic Feed: не удалось переименовать заметку", file.path, error);
			new Notice("Не удалось переименовать заметку — подробности в консоли разработчика");
		}
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

	private readProperty(file: TFile, property: string): unknown {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return frontmatter?.[property];
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

	/** Уведомление с кнопкой «Отменить». */
	private undoNotice(message: string, undo: () => Promise<void>): void {
		const fragment = document.createDocumentFragment();
		fragment.createSpan({ text: message });

		const button = fragment.createEl("button", {
			text: "Отменить",
			cls: "topic-feed-undo",
		});

		const notice = new Notice(fragment, UNDO_SECONDS * 1000);
		button.onclick = () => {
			notice.hide();
			void undo();
		};
	}
}
