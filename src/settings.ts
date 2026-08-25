import { App, PluginSettingTab, Setting } from "obsidian";
import type TopicFeedPlugin from "./main";

export interface PluginSettings {
	/** Сколько символов текста показывать в бабле. */
	previewLength: number;
	/** Имя свойства, которым заметка связана с топиком. */
	linkProperty: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	previewLength: 500,
	linkProperty: "topic",
};

/** Границы длины превью: ниже нечего читать, выше бабл перестаёт быть баблом. */
const MIN_PREVIEW = 40;
const MAX_PREVIEW = 2000;

export class SettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: TopicFeedPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		// Обязательно: display() вызывается заново при каждом открытии настроек.
		containerEl.empty();

		new Setting(containerEl)
			.setName("Длина текста в бабле")
			.setDesc(
				`Сколько символов заметки показывать в ленте. От ${MIN_PREVIEW} до ${MAX_PREVIEW}.`,
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.previewLength))
					.setValue(String(this.plugin.settings.previewLength))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isNaN(parsed)) return;
						this.plugin.settings.previewLength = clamp(parsed, MIN_PREVIEW, MAX_PREVIEW);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Свойство связи")
			.setDesc(
				"Имя свойства, в котором у заметки записана ссылка на топик. Меняйте, только если в хранилище уже принято другое слово.",
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.linkProperty)
					.setValue(this.plugin.settings.linkProperty)
					.onChange(async (value) => {
						const name = value.trim();
						if (name.length === 0) return;
						this.plugin.settings.linkProperty = name;
						await this.plugin.saveSettings();
					}),
			);
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
