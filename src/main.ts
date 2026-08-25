import {
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	TFile,
	TFolder,
	debounce,
	normalizePath,
	type WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_SETTINGS, type PluginSettings, SettingTab } from "./settings";
import { TopicIndex } from "./topic-index";
import { NoteActions } from "./note-actions";
import { safeFileName, uniqueFileName } from "./lib/file-name";
import { newTopicContent } from "./lib/topic-template";
import type { TreeNode } from "./lib/tree";
import { EXPLORER_VIEW, ExplorerView } from "./ui/explorer-view";
import { FEED_VIEW, TopicFeedView } from "./ui/feed-view";
import { ORPHAN_VIEW, OrphanFeedView } from "./ui/orphan-view";
import { ConfirmModal } from "./ui/confirm-modal";
import { NameModal } from "./ui/name-modal";
import { TopicPicker } from "./ui/topic-picker";

/** Формат, которым бабл представляется при перетаскивании. */
const DRAG_FORMAT = "text/x-topic-feed-note";

export default class TopicFeedPlugin extends Plugin {
	// declare, а не обычное поле: Plugin уже объявляет settings — здесь мы
	// только уточняем тип, не создавая второе свойство.
	declare settings: PluginSettings;

	index!: TopicIndex;
	actions!: NoteActions;

	/** Топики, которые пользователь попросил показать как обычную разметку. */
	private asMarkdown = new Set<string>();

	/** Вкладка справа от ленты, в которой открываются заметки. Переиспользуется. */
	private detailLeaf: WorkspaceLeaf | null = null;

	/** Вкладка, в которой живёт лента. Новый топик открывается здесь же. */
	private feedHomeLeaf: WorkspaceLeaf | null = null;

	/** Какая лента сейчас выбрана: путь топика или «orphans». */
	private activeFeedKey: string | null = null;

	/** Заметка, которую сейчас тащат. Через dataTransfer путь ходит ненадёжно. */
	private dragged: TFile | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));

		this.index = new TopicIndex(this.app, () => this.settings.linkProperty);
		this.actions = new NoteActions(this.app, () => this.settings.linkProperty);

		this.registerView(FEED_VIEW, (leaf) => new TopicFeedView(leaf, this));
		this.registerView(ORPHAN_VIEW, (leaf) => new OrphanFeedView(leaf, this));
		this.registerView(EXPLORER_VIEW, (leaf) => new ExplorerView(leaf, this));

		this.addRibbonIcon("messages-square", "Лента", () => void this.openExplorer());
		this.addRibbonIcon("inbox", "Лента: без топика", () => void this.openOrphanFeed());

		this.addCommand({
			id: "open-explorer",
			name: "Открыть проводник ленты",
			callback: () => void this.openExplorer(),
		});

		this.addCommand({
			id: "open-orphans",
			name: "Лента: без топика",
			callback: () => void this.openOrphanFeed(),
		});

		this.addCommand({
			id: "toggle-markdown",
			name: "Показать топик как разметку",
			checkCallback: (checking) => {
				const leaf = this.app.workspace.getMostRecentLeaf();
				const file = this.topicFileOf(leaf);
				if (!file) return false;
				if (!checking) void this.toggleMarkdown(leaf, file);
				return true;
			},
		});

		this.app.workspace.onLayoutReady(() => {
			this.index.rebuild();
			this.swapFeeds();
		});

		// Свойства заметки меняются — связь и свежесть могли поехать.
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => this.index.handleChanged(file)),
		);
		// resolved приходит, когда Obsidian достроил карту ссылок: до него
		// ссылка на топик может ещё никуда не вести.
		this.registerEvent(this.app.metadataCache.on("resolved", this.rebuildLater));
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.index.handleDeleted(file.path);
				this.asMarkdown.delete(file.path);
			}),
		);
		this.registerEvent(this.app.vault.on("rename", () => this.index.handleRenamed()));
		// Папку могли создать или удалить мимо плагина — проводник это показывает.
		this.registerEvent(this.app.vault.on("create", this.rebuildLater));

		// Топик — обычный .md, поэтому Obsidian открывает его редактором.
		// Подменяем представление, как только вкладка с топиком появилась.
		this.registerEvent(this.app.workspace.on("layout-change", () => this.swapFeeds()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.swapFeeds()));
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => this.trackActiveFeed(leaf)),
		);
		// Доску открывает соседний плагин своим представлением, поэтому ловим
		// её по открытому файлу, а не по типу вкладки.
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file && this.index.isBoardFile(file)) this.setActiveFeed(file.path);
			}),
		);
	}

	// onunload намеренно пуст: представления, команды и подписки Obsidian снимает сам.

	// ——— открытие ———

	/** Открывает проводник в левом сайдбаре, переиспользуя уже открытый. */
	async openExplorer(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(EXPLORER_VIEW)[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}

		const leaf = workspace.getLeftLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: EXPLORER_VIEW, active: true });
		await workspace.revealLeaf(leaf);
	}

	/** Открывает ленту топика в рабочей области. */
	async openTopic(file: TFile): Promise<void> {
		this.asMarkdown.delete(file.path);

		// Топик уже открыт — переходим на его вкладку, а не открываем вторую.
		const opened = this.app.workspace
			.getLeavesOfType(FEED_VIEW)
			.find((leaf) => (leaf.view as TopicFeedView).topicFile?.path === file.path);
		if (opened) {
			this.setActiveFeed(file.path);
			await this.app.workspace.revealLeaf(opened);
			return;
		}

		this.setActiveFeed(file.path);
		await this.feedLeaf().openFile(file);
		this.swapFeeds();
	}

	/** Открывает доску. Представление подменит соседний плагин — или файл
	 *  откроется разметкой, если он выключен. */
	async openBoard(file: TFile): Promise<void> {
		this.setActiveFeed(file.path);
		await this.feedLeaf().openFile(file);
	}

	/** Открывает ленту «Без топика», переиспользуя уже открытую. */
	async openOrphanFeed(): Promise<void> {
		this.setActiveFeed("orphans");

		const existing = this.app.workspace.getLeavesOfType(ORPHAN_VIEW)[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}

		const leaf = this.feedLeaf();
		await leaf.setViewState({ type: ORPHAN_VIEW, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** Открывает заметку в панели справа от ленты, переиспользуя уже открытую. */
	openNote(feedLeaf: WorkspaceLeaf, file: TFile): void {
		// Ленту могли открыть мимо плагина — из файлового дерева или по ссылке.
		this.feedHomeLeaf = feedLeaf;

		if (this.detailLeaf && !this.isOpen(this.detailLeaf)) this.detailLeaf = null;
		if (!this.detailLeaf) {
			this.detailLeaf = this.app.workspace.createLeafBySplit(feedLeaf, "vertical");
		}

		const leaf = this.detailLeaf;
		void leaf.openFile(file).then(() => {
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
		});
	}

	/** Лента, выбранная сейчас: путь топика, «orphans» или ничего. */
	get activeFeed(): string | null {
		return this.activeFeedKey;
	}

	/**
	 * Запоминает открытую ленту. Клик по баблу переводит фокус на заметку,
	 * а клик в проводнике — на сам сайдбар: в обоих случаях прежний выбор
	 * сохраняем, лента никуда не делась.
	 */
	private trackActiveFeed(leaf: WorkspaceLeaf | null): void {
		const view = leaf?.view;
		if (view instanceof TopicFeedView) {
			this.setActiveFeed(view.topicFile?.path ?? null);
		} else if (view instanceof OrphanFeedView) {
			this.setActiveFeed("orphans");
		}
	}

	/** Ставит отметку выбранной ленты и обновляет проводник. */
	private setActiveFeed(key: string | null): void {
		if (this.activeFeedKey === key) return;
		this.activeFeedKey = key;

		for (const leaf of this.app.workspace.getLeavesOfType(EXPLORER_VIEW)) {
			const view = leaf.view;
			if (view instanceof ExplorerView) view.render();
		}
	}

	// ——— действия над заметкой ———

	/** Меню бабла. */
	showNoteMenu(file: TFile, event: MouseEvent): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Переместить в топик")
				.setIcon("message-circle")
				.onClick(() => this.pickTopicFor(file)),
		);

		if (this.index.topicOf(file.path)) {
			menu.addItem((item) =>
				item
					.setTitle("Убрать топик")
					.setIcon("inbox")
					.onClick(() => void this.actions.clearTopic(file)),
			);
		}

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Переименовать")
				.setIcon("pencil")
				.onClick(() => {
					new NameModal(this.app, {
						title: "Новое название",
						placeholder: "Название заметки",
						initial: file.basename,
						confirmText: "Переименовать",
						onSubmit: (name) => void this.actions.rename(file, safeFileName(name)),
					}).open();
				}),
		);

		menu.addItem((item) =>
			item
				.setTitle("Скопировать ссылку")
				.setIcon("link")
				.onClick(() => void this.actions.copyLink(file)),
		);

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Удалить")
				.setIcon("trash-2")
				.onClick(() => void this.actions.remove(file)),
		);

		menu.showAtMouseEvent(event);
	}

	/** Начало перетаскивания бабла. */
	startNoteDrag(file: TFile, event: DragEvent): void {
		this.dragged = file;
		event.dataTransfer?.setData(DRAG_FORMAT, file.path);
		event.dataTransfer?.setData("text/plain", file.path);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";

		const bubble = event.currentTarget;
		if (bubble instanceof HTMLElement) {
			bubble.addClass("is-dragging");
			const clear = () => {
				bubble.removeClass("is-dragging");
				this.dragged = null;
				bubble.removeEventListener("dragend", clear);
			};
			bubble.addEventListener("dragend", clear);
		}
	}

	/** Делает строку проводника целью для бабла. */
	bindDropTarget(el: HTMLElement, node: TreeNode | "orphans"): void {
		// Ни папка, ни доска бабл не принимают: связь ленты держится свойством
		// топика. Показываем это курсором запрета, а не молчаливым бездействием.
		if (node !== "orphans" && node.kind !== "topic") {
			el.addEventListener("dragover", (event) => {
				if (!this.dragged) return;
				event.preventDefault();
				if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
			});
			return;
		}

		el.addEventListener("dragover", (event) => {
			if (!this.dragged) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			el.addClass("is-drop-target");
		});

		// Курсор гуляет по внутренним элементам строки — это не выход из неё.
		el.addEventListener("dragleave", (event) => {
			const to = event.relatedTarget;
			if (to instanceof Node && el.contains(to)) return;
			el.removeClass("is-drop-target");
		});

		el.addEventListener("drop", (event) => {
			el.removeClass("is-drop-target");
			const file = this.dragged;
			this.dragged = null;
			if (!file) return;
			event.preventDefault();

			if (node === "orphans") {
				void this.actions.clearTopic(file);
				return;
			}

			const topic = this.app.vault.getAbstractFileByPath(node.path);
			if (!(topic instanceof TFile)) return;
			if (topic.path === file.path) return;
			void this.actions.moveToTopic(file, topic);
		});
	}

	/**
	 * Удаление из проводника. Топик и доска — обычные заметки, уходят в корзину
	 * с возможностью отмены. Папка уходит вместе со всем содержимым, поэтому
	 * сначала спрашиваем подтверждение: отменить это нельзя.
	 */
	deleteNode(node: TreeNode): void {
		const target = this.app.vault.getAbstractFileByPath(node.path);

		if (target instanceof TFile) {
			void this.actions.remove(target);
			return;
		}

		if (!(target instanceof TFolder)) return;

		const count = countFiles(target);
		new ConfirmModal(this.app, {
			title: `Удалить папку «${target.name}»?`,
			body:
				count === 0
					? "Папка пуста. Она уйдёт в корзину."
					: `Вместе с папкой в корзину уйдёт файлов: ${count}. Отменить это будет нельзя.`,
			confirmText: "Удалить",
			onConfirm: () => void this.actions.removeFolder(target),
		}).open();
	}

	/** Спрашивает топик списком и перекладывает заметку. */
	private pickTopicFor(file: TFile): void {
		const topics = this.index.allTopics().map((topic) => ({
			path: topic.path,
			name: topic.name,
			folder: topic.path.includes("/")
				? topic.path.slice(0, topic.path.lastIndexOf("/"))
				: "",
		}));

		if (topics.length === 0) {
			new Notice("Топиков ещё нет — создайте топик в проводнике ленты");
			return;
		}

		new TopicPicker(this.app, topics, (choice) => {
			const topic = this.app.vault.getAbstractFileByPath(choice.path);
			if (topic instanceof TFile) void this.actions.moveToTopic(file, topic);
		}).open();
	}

	// ——— создание ———

	/** Спрашивает название и создаёт заметку-топик в этой папке. */
	createTopic(folderPath: string): void {
		new NameModal(this.app, {
			title: "Новый топик",
			placeholder: "Название топика",
			confirmText: "Создать",
			onSubmit: (name) => void this.writeTopic(folderPath, name),
		}).open();
	}

	/** Спрашивает название и создаёт папку. */
	createFolder(folderPath: string): void {
		new NameModal(this.app, {
			title: "Новая папка",
			placeholder: "Название папки",
			confirmText: "Создать",
			onSubmit: (name) => void this.writeFolder(folderPath, name),
		}).open();
	}

	private async writeTopic(folderPath: string, name: string): Promise<void> {
		const taken = new Set(
			this.childNames(folderPath).map((child) => child.replace(/\.md$/i, "")),
		);
		const fileName = uniqueFileName(safeFileName(name), taken);
		const path = normalizePath(folderPath === "" ? `${fileName}.md` : `${folderPath}/${fileName}.md`);

		try {
			const file = await this.app.vault.create(path, newTopicContent());
			this.index.rebuild();
			await this.openTopic(file);
		} catch (error) {
			console.error("Topic Feed: не удалось создать топик", path, error);
			new Notice("Не удалось создать топик — подробности в консоли разработчика");
		}
	}

	private async writeFolder(folderPath: string, name: string): Promise<void> {
		const taken = new Set(this.childNames(folderPath));
		const folderName = uniqueFileName(safeFileName(name), taken);
		const path = normalizePath(folderPath === "" ? folderName : `${folderPath}/${folderName}`);

		try {
			await this.app.vault.createFolder(path);
			this.index.rebuild();
		} catch (error) {
			console.error("Topic Feed: не удалось создать папку", path, error);
			new Notice("Не удалось создать папку — подробности в консоли разработчика");
		}
	}

	private childNames(folderPath: string): string[] {
		const folder =
			folderPath === ""
				? this.app.vault.getRoot()
				: this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) return [];
		return folder.children.map((child) => child.name);
	}

	// ——— служебное ———

	private rebuildLater = debounce(() => this.index.rebuild(), 300, true);

	/**
	 * Вкладка рабочей области, в которой показываем ленту.
	 *
	 * Заметку справа лента открывает сама, и после клика по баблу активной
	 * становится именно она — открывать в ней следующую ленту нельзя. Поэтому
	 * сначала возвращаем активность вкладке ленты, а дальше решение принимает
	 * сам Obsidian: закреплённая вкладка не будет перезаписана, рядом с ней
	 * откроется новая.
	 */
	private feedLeaf(): WorkspaceLeaf {
		const home = this.feedHomeLeaf;
		if (home && home !== this.detailLeaf && this.isOpen(home)) {
			this.app.workspace.setActiveLeaf(home, { focus: false });
		}

		const leaf = this.app.workspace.getLeaf(false);
		this.feedHomeLeaf = leaf;
		return leaf;
	}

	/** Переводит открытые markdown-вкладки с топиками в представление ленты. */
	private swapFeeds(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;

			const file = view.file;
			if (!file || !this.index.isTopicFile(file)) continue;
			if (this.asMarkdown.has(file.path)) continue;

			void leaf.setViewState({ ...leaf.getViewState(), type: FEED_VIEW }).then(() => {
				if (leaf === this.app.workspace.getMostRecentLeaf()) {
					this.setActiveFeed(file.path);
				}
			});
		}
	}

	/** Файл топика, открытый во вкладке, — в любом из двух представлений. */
	private topicFileOf(leaf: WorkspaceLeaf | null): TFile | null {
		const view = leaf?.view;
		if (view instanceof TopicFeedView) return view.topicFile;
		if (view instanceof MarkdownView && view.file && this.index.isTopicFile(view.file)) {
			return view.file;
		}
		return null;
	}

	/** Переключает вкладку между лентой и разметкой и запоминает выбор. */
	private async toggleMarkdown(leaf: WorkspaceLeaf | null, file: TFile): Promise<void> {
		if (!leaf) return;

		const toMarkdown = leaf.view instanceof TopicFeedView;
		if (toMarkdown) this.asMarkdown.add(file.path);
		else this.asMarkdown.delete(file.path);

		const state = leaf.getViewState();
		await leaf.setViewState({
			...state,
			type: toMarkdown ? "markdown" : FEED_VIEW,
		});
	}

	/** Жива ли вкладка: пользователь мог закрыть её вручную. */
	private isOpen(leaf: WorkspaceLeaf): boolean {
		let open = false;
		this.app.workspace.iterateAllLeaves((item) => {
			if (item === leaf) open = true;
		});
		return open;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.index.rebuild();
	}
}

/** Сколько файлов лежит внутри папки, включая вложенные. */
function countFiles(folder: TFolder): number {
	let count = 0;
	for (const child of folder.children) {
		if (child instanceof TFolder) count += countFiles(child);
		else count += 1;
	}
	return count;
}
