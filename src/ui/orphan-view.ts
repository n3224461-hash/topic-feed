import { ItemView, type WorkspaceLeaf } from "obsidian";
import { FeedList } from "./feed-list";
import type TopicFeedPlugin from "../main";

export const ORPHAN_VIEW = "topic-feed-orphans";

/**
 * Лента «Без топика»: всё, что ещё не разобрано. Отдельное представление,
 * потому что за ней не стоит файла — топика у этих заметок нет.
 */
export class OrphanFeedView extends ItemView {
	private feed: FeedList | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TopicFeedPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return ORPHAN_VIEW;
	}

	getDisplayText(): string {
		return "Без топика";
	}

	getIcon(): string {
		return "inbox";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("topic-feed-view");
		this.feed = new FeedList(this.contentEl, {
			app: this.app,
			limit: () => this.plugin.settings.previewLength,
			items: () => this.plugin.index.notesWithoutTopic(),
			activePath: () => this.plugin.activeNote,
			emptyText: "Неразобранных заметок нет.",
			onOpen: (file) => this.plugin.openNote(this.leaf, file),
			onContextMenu: (file, event, select) =>
				this.plugin.showNoteMenu(file, event, select),
			onDragStart: (file, event) => this.plugin.startNoteDrag(file, event),
			onCreate: () => void this.plugin.createNote(this.leaf, null),
			onMoveMany: (files) => this.plugin.moveNotes(files),
			onDeleteMany: (files) => this.plugin.deleteNotes(files),
		});

		this.unsubscribe = this.plugin.index.subscribe(() => void this.feed?.render());
		void this.feed.render();
	}

	/** Перерисовывает ленту снаружи — например, когда сменилась открытая заметка. */
	refresh(): void {
		void this.feed?.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.feed?.destroy();
		this.feed = null;
		this.contentEl.empty();
	}
}
