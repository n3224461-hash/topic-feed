import { TFile, TextFileView, type WorkspaceLeaf } from "obsidian";
import { previewText } from "../lib/preview";
import { FeedList } from "./feed-list";
import type TopicFeedPlugin from "../main";

export const FEED_VIEW = "topic-feed-topic";

/** Сколько текста топика показываем в шапке ленты. */
const HEADER_LIMIT = 1200;

/**
 * Лента топика. Наследует TextFileView, поэтому файл остаётся обычной заметкой:
 * Obsidian сам подставляет содержимое и восстанавливает вкладку после перезапуска.
 */
export class TopicFeedView extends TextFileView {
	private feed: FeedList | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TopicFeedPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return FEED_VIEW;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Лента";
	}

	getIcon(): string {
		return "messages-square";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("topic-feed-view");
		this.feed = new FeedList(this.contentEl, {
			app: this.app,
			limit: () => this.plugin.settings.previewLength,
			items: () => (this.file ? this.plugin.index.notesOf(this.file.path) : []),
			header: () => previewText(this.data, HEADER_LIMIT),
			emptyText: "В этом топике пока нет заметок. Перетащите сюда бабл из другой ленты.",
			onOpen: (file) => this.plugin.openNote(this.leaf, file),
			onContextMenu: (file, event, select) =>
				this.plugin.showNoteMenu(file, event, select),
			onDragStart: (file, event) => this.plugin.startNoteDrag(file, event),
			onCreate: () => void this.plugin.createNote(this.leaf, this.file),
			onMoveMany: (files) => this.plugin.moveNotes(files),
			onDeleteMany: (files) => this.plugin.deleteNotes(files),
		});

		this.unsubscribe = this.plugin.index.subscribe(() => void this.feed?.render());
		void this.feed.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.feed?.destroy();
		this.feed = null;
		this.contentEl.empty();
	}

	getViewData(): string {
		return this.data;
	}

	setViewData(data: string, clear: boolean): void {
		this.data = data;
		if (clear) this.feed?.reset();
		void this.feed?.render();
	}

	clear(): void {
		this.data = "";
	}

	/**
	 * Лента не редактирует содержимое файла — все изменения идут через vault
	 * напрямую. Отключаем запись, чтобы вкладка при закрытии не затёрла файл
	 * своей копией содержимого.
	 */
	async save(): Promise<void> {
		// Намеренно пусто.
	}

	/** Файл топика, открытый в этой вкладке. */
	get topicFile(): TFile | null {
		return this.file;
	}
}
