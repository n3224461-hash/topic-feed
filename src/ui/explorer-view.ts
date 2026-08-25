import { ItemView, Menu, TFile, TFolder, setIcon, type WorkspaceLeaf } from "obsidian";
import { breadcrumbs, buildLevel, folderTopicCount, type TreeNode } from "../lib/tree";
import type TopicFeedPlugin from "../main";

export const EXPLORER_VIEW = "topic-feed-explorer";

/** Иконки Lucide по видам узлов. У доски та же, что у представления канбана. */
const ICONS: Record<TreeNode["kind"], string> = {
	folder: "folder",
	topic: "message-circle",
	board: "square-kanban",
};

function countLabel(count: number): string {
	return count === 0 ? "пусто" : `${count}`;
}

/** Проводник ленты: папки и топики одним списком, свежие сверху. */
export class ExplorerView extends ItemView {
	/** Папка, внутрь которой провалился пользователь. Корень — пустая строка. */
	private folderPath = "";

	private crumbsEl!: HTMLElement;
	private listEl!: HTMLElement;
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TopicFeedPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return EXPLORER_VIEW;
	}

	getDisplayText(): string {
		return "Лента";
	}

	getIcon(): string {
		return "messages-square";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("topic-feed-explorer");

		this.crumbsEl = root.createDiv({ cls: "topic-feed-crumbs" });
		this.listEl = root.createDiv({ cls: "topic-feed-nodes" });

		// Правый клик по пустому месту списка — создание в текущей папке.
		this.listEl.addEventListener("contextmenu", (event) => {
			if (event.target !== this.listEl) return;
			event.preventDefault();
			this.showCreateMenu(event);
		});

		this.unsubscribe = this.plugin.index.subscribe(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.contentEl.empty();
	}

	/** Показывает содержимое папки. Пустая строка — корень хранилища. */
	openFolder(folderPath: string): void {
		this.folderPath = folderPath;
		this.render();
	}

	render(): void {
		if (!this.listEl) return;
		// Папка могла исчезнуть, пока её содержимое было открыто. Проверяем до
		// отрисовки крошек, иначе они на один проход покажут удалённую папку.
		if (this.folderPath !== "" && !this.folderExists(this.folderPath)) {
			this.folderPath = "";
		}
		this.renderCrumbs();
		this.renderNodes();
	}

	private renderCrumbs(): void {
		this.crumbsEl.empty();

		const crumbs = breadcrumbs(this.folderPath);
		const row = this.crumbsEl.createDiv({ cls: "topic-feed-crumbs-row" });

		const root = row.createSpan({ cls: "topic-feed-crumb", text: "Хранилище" });
		root.onclick = () => this.openFolder("");

		for (const crumb of crumbs) {
			row.createSpan({ cls: "topic-feed-crumb-sep", text: "›" });
			const item = row.createSpan({ cls: "topic-feed-crumb", text: crumb.name });
			item.onclick = () => this.openFolder(crumb.path);
		}

		const filter = this.crumbsEl.createDiv({ cls: "topic-feed-filter" });
		const button = filter.createEl("button", {
			cls: "clickable-icon",
			attr: {
				"aria-label": this.plugin.settings.onlyFoldersWithTopics
					? "Показывать все папки"
					: "Показывать только папки с топиками",
			},
		});
		setIcon(button, this.plugin.settings.onlyFoldersWithTopics ? "filter" : "filter-x");
		button.onclick = () => {
			this.plugin.settings.onlyFoldersWithTopics =
				!this.plugin.settings.onlyFoldersWithTopics;
			void this.plugin.saveSettings();
			this.render();
		};

		const add = filter.createEl("button", {
			cls: "clickable-icon",
			attr: { "aria-label": "Создать" },
		});
		setIcon(add, "plus");
		add.onclick = (event) => this.showCreateMenu(event);
	}

	private renderNodes(): void {
		this.listEl.empty();
		this.renderOrphans();

		const nodes = buildLevel({
			folders: this.plugin.index.subfolders(this.folderPath),
			topics: this.plugin.index.topicsInFolder(this.folderPath),
			boards: this.plugin.index.boardsInFolder(this.folderPath),
			allTopics: this.plugin.index.allContainers(),
			onlyFoldersWithTopics: this.plugin.settings.onlyFoldersWithTopics,
		});

		if (nodes.length === 0) {
			this.listEl.createDiv({
				cls: "topic-feed-empty",
				text: this.plugin.settings.onlyFoldersWithTopics
					? "Здесь нет топиков. Создайте топик или снимите фильтр."
					: "Здесь пусто.",
			});
			return;
		}

		for (const node of nodes) this.renderNode(node);
	}

	/** «Без топика» — всегда первой строкой, её нельзя убрать. */
	private renderOrphans(): void {
		if (this.folderPath !== "") return;

		const count = this.plugin.index.notesWithoutTopic().length;
		const row = this.listEl.createDiv({ cls: "topic-feed-node is-orphans" });
		if (this.plugin.activeFeed === "orphans") row.addClass("is-active");
		const icon = row.createDiv({ cls: "topic-feed-node-icon" });
		setIcon(icon, "inbox");

		const body = row.createDiv({ cls: "topic-feed-node-body" });
		body.createDiv({ cls: "topic-feed-node-name", text: "Без топика" });
		body.createDiv({
			cls: "topic-feed-node-note",
			text: count === 0 ? "пусто" : `${count}`,
		});

		row.onclick = () => void this.plugin.openOrphanFeed();
		this.plugin.bindDropTarget(row, "orphans");
	}

	private renderNode(node: TreeNode): void {
		const row = this.listEl.createDiv({ cls: `topic-feed-node is-${node.kind}` });
		if (node.kind !== "folder" && this.plugin.activeFeed === node.path) {
			row.addClass("is-active");
		}

		const icon = row.createDiv({ cls: "topic-feed-node-icon" });
		setIcon(icon, ICONS[node.kind]);

		const body = row.createDiv({ cls: "topic-feed-node-body" });
		body.createDiv({ cls: "topic-feed-node-name", text: node.name });

		const note = body.createDiv({ cls: "topic-feed-node-note" });
		note.setText(countLabel(this.countOf(node)));

		if (node.kind === "folder") {
			const chevron = row.createDiv({ cls: "topic-feed-node-chevron" });
			setIcon(chevron, "chevron-right");
			row.onclick = () => this.openFolder(node.path);
		} else {
			row.onclick = () => this.openNode(node);
		}

		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			this.showNodeMenu(node, event);
		});

		this.plugin.bindDropTarget(row, node);
	}

	private showCreateMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Новый топик")
				.setIcon("message-circle")
				.onClick(() => this.plugin.createTopic(this.folderPath)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Новая папка")
				.setIcon("folder-plus")
				.onClick(() => this.plugin.createFolder(this.folderPath)),
		);
		menu.showAtMouseEvent(event);
	}

	private showNodeMenu(node: TreeNode, event: MouseEvent): void {
		const menu = new Menu();

		if (node.kind === "folder") {
			menu.addItem((item) =>
				item
					.setTitle("Открыть папку")
					.setIcon("folder-open")
					.onClick(() => this.openFolder(node.path)),
			);
		} else {
			menu.addItem((item) =>
				item
					.setTitle(node.kind === "board" ? "Открыть доску" : "Открыть ленту")
					.setIcon(ICONS[node.kind])
					.onClick(() => this.openNode(node)),
			);
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Новый топик здесь")
				.setIcon("message-circle")
				.onClick(() =>
					this.plugin.createTopic(node.kind === "folder" ? node.path : this.folderPath),
				),
		);
		menu.showAtMouseEvent(event);
	}

	/** Открывает топик лентой, доску — обычным способом: вид подменит её плагин. */
	private openNode(node: TreeNode): void {
		const file = this.app.vault.getAbstractFileByPath(node.path);
		if (!(file instanceof TFile)) return;
		if (node.kind === "board") void this.plugin.openBoard(file);
		else void this.plugin.openTopic(file);
	}

	/** Что показывать счётчиком: содержимое папки, топика или доски. */
	private countOf(node: TreeNode): number {
		if (node.kind === "folder") {
			return folderTopicCount(node.path, this.plugin.index.allContainers());
		}
		if (node.kind === "board") return this.plugin.index.taskCount(node.path);
		return this.plugin.index.notesOf(node.path).length;
	}

	private folderExists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(path) instanceof TFolder;
	}
}
