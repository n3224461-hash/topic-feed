import { type App, TFile } from "obsidian";
import { sortFeed } from "../lib/ordering";
import { previewText } from "../lib/preview";
import { dateLabel, fullDateLabel } from "../lib/date-label";
import type { FeedNote } from "../topic-index";

/** Сколько баблов показываем сразу и сколько добавляем при прокрутке вверх. */
const PAGE = 30;

/** Насколько близко к верхнему краю надо подойти, чтобы догрузить старое. */
const LOAD_ZONE = 200;

export interface FeedListOptions {
	app: App;
	/** Длина текста в бабле. Читается заново: настройку можно поменять на ходу. */
	limit: () => number;
	/** Заметки ленты в любом порядке — сортирует сама лента. */
	items: () => FeedNote[];
	/** Шапка ленты: собственный текст заметки-топика. */
	header?: () => string;
	/** Что написать, когда лента пуста. */
	emptyText: string;
	onOpen: (file: TFile) => void;
	onContextMenu?: (file: TFile, event: MouseEvent) => void;
	onDragStart?: (file: TFile, event: DragEvent) => void;
}

/**
 * Отрисовка ленты баблов. Общая часть для ленты топика и ленты «Без топика»:
 * они отличаются только тем, откуда берутся заметки.
 */
export class FeedList {
	private scrollEl: HTMLElement;
	private listEl: HTMLElement;

	/** Сколько заметок показано снизу. Растёт при прокрутке вверх. */
	private shown = PAGE;

	/** Первая отрисовка прокручивает ленту вниз, последующие — нет. */
	private atStart = true;

	/** Текст превью по пути заметки, чтобы не перечитывать файл на каждую перерисовку. */
	private cache = new Map<string, { mtime: number; limit: number; text: string }>();

	/** Отрисовка асинхронная — по номеру отбрасываем результаты устаревших. */
	private renderId = 0;

	constructor(
		private containerEl: HTMLElement,
		private opts: FeedListOptions,
	) {
		this.containerEl.addClass("topic-feed-feed");
		this.scrollEl = this.containerEl.createDiv({ cls: "topic-feed-scroll" });
		this.listEl = this.scrollEl.createDiv({ cls: "topic-feed-list" });
		this.scrollEl.addEventListener("scroll", this.onScroll);
	}

	destroy(): void {
		this.scrollEl.removeEventListener("scroll", this.onScroll);
		this.containerEl.empty();
	}

	/** Сбрасывает прокрутку и показанное окно — при переходе на другой топик. */
	reset(): void {
		this.shown = PAGE;
		this.atStart = true;
		this.cache.clear();
	}

	async render(): Promise<void> {
		const id = ++this.renderId;
		const items = sortFeed(this.opts.items());
		const from = Math.max(0, items.length - this.shown);
		const visible = items.slice(from);

		const texts = await Promise.all(visible.map((note) => this.previewOf(note)));
		if (id !== this.renderId) return;

		const keepFromBottom = this.scrollEl.scrollHeight - this.scrollEl.scrollTop;

		this.listEl.empty();

		const headerText = this.opts.header?.().trim();
		if (headerText) {
			const header = this.listEl.createDiv({ cls: "topic-feed-header" });
			header.createDiv({ cls: "topic-feed-header-label", text: "Описание топика" });
			header.createDiv({ cls: "topic-feed-header-body", text: headerText });
		}

		if (items.length === 0) {
			this.listEl.createDiv({ cls: "topic-feed-empty", text: this.opts.emptyText });
			return;
		}

		if (from > 0) {
			this.listEl.createDiv({
				cls: "topic-feed-more",
				text: `Выше ещё ${from}`,
			});
		}

		visible.forEach((note, index) => {
			this.renderBubble(note, texts[index] ?? "");
		});

		// Первый показ — вниз, к свежему. Догрузка старого — сохраняем место,
		// иначе лента прыгает под курсором.
		if (this.atStart) {
			this.atStart = false;
			this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
		} else {
			this.scrollEl.scrollTop = this.scrollEl.scrollHeight - keepFromBottom;
		}
	}

	private renderBubble(note: FeedNote, text: string): void {
		const row = this.listEl.createDiv({ cls: "topic-feed-row" });
		const bubble = row.createDiv({ cls: "topic-feed-bubble" });
		bubble.dataset.path = note.path;
		bubble.setAttribute("draggable", "true");

		bubble.createDiv({ cls: "topic-feed-title", text: note.name });
		if (text) bubble.createDiv({ cls: "topic-feed-text", text });

		const stamp = bubble.createDiv({
			cls: "topic-feed-stamp",
			text: dateLabel(note.mtime, Date.now()),
		});
		stamp.setAttribute("aria-label", `Создана ${fullDateLabel(this.createdAt(note))}`);

		bubble.addEventListener("click", () => {
			const file = this.fileAt(note.path);
			if (file) this.opts.onOpen(file);
		});

		bubble.addEventListener("contextmenu", (event) => {
			const file = this.fileAt(note.path);
			if (!file) return;
			event.preventDefault();
			this.opts.onContextMenu?.(file, event);
		});

		bubble.addEventListener("dragstart", (event) => {
			const file = this.fileAt(note.path);
			if (!file) return;
			this.opts.onDragStart?.(file, event);
		});
	}

	private createdAt(note: FeedNote): number {
		const file = this.fileAt(note.path);
		return file?.stat.ctime ?? note.mtime;
	}

	private fileAt(path: string): TFile | null {
		const file = this.opts.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	private async previewOf(note: FeedNote): Promise<string> {
		const limit = this.opts.limit();
		const cached = this.cache.get(note.path);
		if (cached && cached.mtime === note.mtime && cached.limit === limit) {
			return cached.text;
		}

		const file = this.fileAt(note.path);
		if (!file) return "";

		try {
			const raw = await this.opts.app.vault.cachedRead(file);
			const text = previewText(raw, limit);
			this.cache.set(note.path, { mtime: note.mtime, limit, text });
			return text;
		} catch (error) {
			console.error("Topic Feed: не удалось прочитать заметку", note.path, error);
			return "";
		}
	}

	private onScroll = (): void => {
		if (this.scrollEl.scrollTop > LOAD_ZONE) return;
		const total = this.opts.items().length;
		if (this.shown >= total) return;
		this.shown += PAGE;
		void this.render();
	};
}
