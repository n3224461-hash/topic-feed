import {
	MarkdownView,
	Plugin,
	TFile,
	type WorkspaceLeaf,
	debounce,
} from "obsidian";
import { DEFAULT_SETTINGS, type PluginSettings, SettingTab } from "./settings";
import { TopicIndex } from "./topic-index";
import { FEED_VIEW, TopicFeedView } from "./ui/feed-view";

export default class TopicFeedPlugin extends Plugin {
	// declare, а не обычное поле: Plugin уже объявляет settings — здесь мы
	// только уточняем тип, не создавая второе свойство.
	declare settings: PluginSettings;

	index!: TopicIndex;

	/** Топики, которые пользователь попросил показать как обычную разметку. */
	private asMarkdown = new Set<string>();

	/** Вкладка справа от ленты, в которой открываются заметки. Переиспользуется. */
	private detailLeaf: WorkspaceLeaf | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));

		this.index = new TopicIndex(this.app, () => this.settings.linkProperty);

		this.registerView(FEED_VIEW, (leaf) => new TopicFeedView(leaf, this));

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

		// Топик — обычный .md, поэтому Obsidian открывает его редактором.
		// Подменяем представление, как только вкладка с топиком появилась.
		this.registerEvent(this.app.workspace.on("layout-change", () => this.swapFeeds()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.swapFeeds()));
	}

	// onunload намеренно пуст: представления, команды и подписки Obsidian снимает сам.

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

	/** Меню бабла. Наполняется на шаге 9. */
	showNoteMenu(_file: TFile, _event: MouseEvent): void {
		// Пока пусто.
	}

	/** Начало перетаскивания бабла. Наполняется на шаге 8. */
	startNoteDrag(_file: TFile, _event: DragEvent): void {
		// Пока пусто.
	}

	/** Открывает ленту топика в рабочей области. */
	async openTopic(file: TFile): Promise<void> {
		this.asMarkdown.delete(file.path);
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
		this.swapFeeds();
	}

	private rebuildLater = debounce(() => this.index.rebuild(), 300, true);

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
		this.settings = { ...this.settings };
		await this.saveData(this.settings);
		this.index.rebuild();
	}
}
