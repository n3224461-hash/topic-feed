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
			await this.app.workspace.revealLeaf(opened);
			return;
		}

		await this.feedLeaf().openFile(file);
		this.swapFeeds();
	}

	/** Открывает ленту «Без топика», переиспользуя уже открытую. */
	async openOrphanFeed(): Promise<void> {
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
		if (this.detailLeaf && !this.isOpen(this.detailLeaf)) this.detailLeaf = null;
		if (!this.detailLeaf) {
			this.detailLeaf = this.app.workspace.createLeafBySplit(feedLeaf, "vertical");
		}

		const leaf = this.detailLeaf;
		void leaf.openFile(file).then(() => {
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
		});
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
		// В папку заметку не перекладываем: связь держится свойством, а не местом.
		if (node !== "orphans" && node.kind !== "topic") return;

		el.addEventListener("dragover", (event) => {
			if (!this.dragged) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			el.addClass("is-drop-target");
		});

		el.addEventListener("dragleave", () => el.removeClass("is-drop-target"));

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

	/** Вкладка рабочей области, в которой показываем ленту. */
	private feedLeaf(): WorkspaceLeaf {
		// Заметку справа лента открывает сама — вставать на её место нельзя.
		const active = this.app.workspace.getMostRecentLeaf();
		if (active && this.detailLeaf && active === this.detailLeaf) {
			return this.app.workspace.getLeaf(true);
		}
		return this.app.workspace.getLeaf(false);
	}

	/** Переводит открытые markdown-вкладки с топиками в представление ленты. */
	private swapFeeds(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;

			const file = view.file;
			if (!file || !this.index.isTopicFile(file)) continue;
			if (this.asMarkdown.has(file.path)) continue;

			void leaf.setViewState({ ...leaf.getViewState(), type: FEED_VIEW });
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
