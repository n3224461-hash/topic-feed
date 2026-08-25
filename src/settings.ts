import { App, PluginSettingTab, Setting } from "obsidian";
import type TopicFeedPlugin from "./main";

export interface PluginSettings {
	greeting: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	greeting: "мир",
};

export class SettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: TopicFeedPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		// Обязательно: display() вызывается заново при каждом открытии настроек.
		containerEl.empty();

		new Setting(containerEl)
			.setName("Кого приветствовать")
			.setDesc("Подставляется в текст уведомления")
			.addText((text) =>
				text
					.setPlaceholder("мир")
					.setValue(this.plugin.settings.greeting)
					.onChange(async (value) => {
						this.plugin.settings.greeting = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
