import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, type PluginSettings, SettingTab } from "./settings";
import { PanelView, VIEW_TYPE } from "./ui/panel";
import { ConfirmModal } from "./ui/confirm-modal";
import { formatItems } from "./lib/format";

export default class TopicFeedPlugin extends Plugin {
	// declare, а не обычное поле: Plugin уже объявляет settings — здесь мы
	// только уточняем тип, не создавая второе свойство.
	declare settings: PluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingTab(this.app, this));

		this.registerView(VIEW_TYPE, (leaf) => new PanelView(leaf, this));

		this.addRibbonIcon("panel-right", "Topic Feed", () => {
			void this.activatePanel();
		});

		this.addCommand({
			id: "open-panel",
			name: "Открыть панель",
			callback: () => void this.activatePanel(),
		});

		this.addCommand({
			id: "show-confirm",
			name: "Показать окно подтверждения",
			callback: () => {
				new ConfirmModal(this.app, {
					title: "Пример подтверждения",
					body: formatItems(["Первая заметка", "Вторая заметка"]),
					confirmText: "Выполнить",
					onConfirm: () => {
						// Здесь будет действие плагина.
					},
				}).open();
			},
		});
	}

	// onunload намеренно пуст. Панель Obsidian закроет сам —
	// вызывать detachLeavesOfType не нужно, это ломает восстановление вкладок.

	/** Открывает панель в правой колонке, переиспользуя уже открытую. */
	async activatePanel(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length > 0) {
			const leaf = existing[0];
			if (leaf) {
				await workspace.revealLeaf(leaf);
				return;
			}
		}

		const leaf: WorkspaceLeaf | null = workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
