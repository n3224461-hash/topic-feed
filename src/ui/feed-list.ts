import { type App, TFile, setIcon, setTooltip } from "obsidian";
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
	/** Третий аргумент включает бабл в выделение — пункт «Выбрать» в меню. */
	onContextMenu?: (file: TFile, event: MouseEvent, select: () => void) => void;
	onDragStart?: (file: TFile, event: DragEvent) => void;
	/** Клик по бабл-плейсхолдеру внизу ленты. */
	onCreate?: () => void;
	/** Действия над выделенными заметками. */
	onMoveMany?: (files: TFile[]) => void;
	onDeleteMany?: (files: TFile[]) => void;
}

/**
 * Отрисовка ленты баблов. Общая часть для ленты топика и ленты «Без топика»:
 * они отличаются только тем, откуда берутся заметки.
 */
export class FeedList {
	private scrollEl: HTMLElement;
	private listEl: HTMLElement;
	/** Подвал ленты: бабл создания заметки, который не уезжает при прокрутке. */
	private footerEl: HTMLElement | null = null;

	/** Пути выделенных заметок. Пока набор пуст, выделения не видно вовсе. */
	private selected = new Set<string>();

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
		this.footerEl = this.containerEl.createDiv({ cls: "topic-feed-footer" });
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
		this.selected.clear();
	}

	/** Включает или выключает бабл в выделении. */
	toggleSelect(path: string): void {
		if (!this.selected.delete(path)) this.selected.add(path);
		void this.render();
	}

	/** Отмечает все заметки ленты, а не только нарисованные. */
	selectAll(): void {
		for (const note of this.opts.items()) this.selected.add(note.path);
		void this.render();
	}

	/** Снимает выделение целиком — чекбоксы исчезают. */
	clearSelection(): void {
		if (this.selected.size === 0) return;
		this.selected.clear();
		void this.render();
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

		// Выделенное могли удалить или переместить мимо ленты.
		const alive = new Set(items.map((note) => note.path));
		for (const path of [...this.selected]) {
			if (!alive.has(path)) this.selected.delete(path);
		}
		this.containerEl.toggleClass("is-selecting", this.selected.size > 0);
		this.renderFooter();

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

	/** В подвале либо действия над выделенным, либо бабл создания заметки. */
	private renderFooter(): void {
		if (!this.footerEl) return;
		this.footerEl.empty();
		// Панель действий встаёт над баблом создания, а не вместо него: внизу
		// справа проходит строка состояния Obsidian и накрывает кнопки собой.
		if (this.selected.size > 0) this.renderSelectionBar();
		this.renderPlaceholder();
	}

	/** Панель действий: появляется вместе с первым выделенным баблом. */
	private renderSelectionBar(): void {
		if (!this.footerEl) return;
		const bar = this.footerEl.createDiv({ cls: "topic-feed-selection" });

		const total = this.opts.items().length;
		const all = total > 0 && this.selected.size >= total;

		const info = bar.createDiv({ cls: "topic-feed-selection-count" });
		info.createSpan({ text: `Выбрано: ${this.selected.size}` });

		const toggle = info.createSpan({
			cls: "topic-feed-select-all",
			text: all ? "Снять все" : "Выбрать все",
		});
		toggle.onclick = () => (all ? this.clearSelection() : this.selectAll());

		if (this.opts.onMoveMany) {
			const move = bar.createEl("button", { text: "Переместить в топик" });
			move.onclick = () => this.runOnSelected(this.opts.onMoveMany);
		}

		if (this.opts.onDeleteMany) {
			const remove = bar.createEl("button", { cls: "mod-warning", text: "Удалить" });
			remove.onclick = () => this.runOnSelected(this.opts.onDeleteMany);
		}

		const cancel = bar.createEl("button", { text: "Отмена" });
		cancel.onclick = () => this.clearSelection();
	}

	/** Отдаёт выделенные файлы действию и снимает выделение. */
	private runOnSelected(action?: (files: TFile[]) => void): void {
		if (!action) return;
		const files: TFile[] = [];
		for (const path of this.selected) {
			const file = this.fileAt(path);
			if (file) files.push(file);
		}
		if (files.length === 0) return;
		this.clearSelection();
		action(files);
	}

	/**
	 * Пустой бабл в самом низу: с него начинается новая заметка.
	 * Живёт в подвале, а не в списке, — поэтому виден при любой прокрутке.
	 */
	private renderPlaceholder(): void {
		if (!this.opts.onCreate || !this.footerEl) return;

		const row = this.footerEl.createDiv({ cls: "topic-feed-row" });
		const bubble = row.createDiv({
			cls: "topic-feed-bubble topic-feed-placeholder",
		});

		const icon = bubble.createSpan({ cls: "topic-feed-placeholder-icon" });
		setIcon(icon, "plus");
		bubble.createSpan({ text: "Создать заметку" });

		bubble.onclick = () => this.opts.onCreate?.();
	}

	private renderBubble(note: FeedNote, text: string): void {
		const row = this.listEl.createDiv({ cls: "topic-feed-row" });

		// Чекбоксы появляются только когда выделен хотя бы один бабл.
		if (this.selected.size > 0) {
			const checked = this.selected.has(note.path);
			const box = row.createDiv({
				cls: checked ? "topic-feed-check is-checked" : "topic-feed-check",
			});
			if (checked) setIcon(box, "check");
			box.onclick = () => this.toggleSelect(note.path);
		}

		const bubble = row.createDiv({ cls: "topic-feed-bubble" });
		bubble.dataset.path = note.path;
		bubble.setAttribute("draggable", "true");

		bubble.createDiv({ cls: "topic-feed-title", text: note.name });
		if (text) bubble.createDiv({ cls: "topic-feed-text", text });

		const stamp = bubble.createDiv({
			cls: "topic-feed-stamp",
			text: dateLabel(note.mtime, Date.now()),
		});
		setTooltip(stamp, `Создана ${fullDateLabel(this.createdAt(note))}`);

		bubble.addEventListener("click", () => {
			// В режиме выделения клик по баблу переключает выбор, а не открывает
			// заметку — так же, как в мессенджере.
			if (this.selected.size > 0) {
				this.toggleSelect(note.path);
				return;
			}
			const file = this.fileAt(note.path);
			if (file) this.opts.onOpen(file);
		});

		bubble.addEventListener("contextmenu", (event) => {
			const file = this.fileAt(note.path);
			if (!file) return;
			event.preventDefault();
			this.opts.onContextMenu?.(file, event, () => this.toggleSelect(note.path));
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
