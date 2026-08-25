import { ItemView, WorkspaceLeaf } from "obsidian";
import type TopicFeedPlugin from "../main";

export const VIEW_TYPE = "topic-feed-panel";

export class PanelView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: TopicFeedPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Topic Feed";
	}

	/** Имя иконки из набора Lucide: https://lucide.dev */
	getIcon(): string {
		return "panel-right";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass("topic-feed-panel");

		el.createEl("h4", { text: "Topic Feed" });
		el.createEl("p", {
			text: `Приветствие из настроек: ${this.plugin.settings.greeting}`,
			cls: "topic-feed-muted",
		});

		el.createEl("button", { text: "Обновить" }).onclick = () => this.render();
	}
}
