import { App, FuzzySuggestModal } from "obsidian";
import type { FuzzyMatch } from "obsidian";

export interface TopicChoice {
	/** Путь файла топика. */
	path: string;
	/** Имя топика без расширения. */
	name: string;
	/** Папка топика, показывается второй строкой. */
	folder: string;
}

/** Поиск топика по названию — для пункта меню «Переместить в топик». */
export class TopicPicker extends FuzzySuggestModal<TopicChoice> {
	constructor(
		app: App,
		private readonly topics: TopicChoice[],
		private readonly onChoose: (topic: TopicChoice) => void,
	) {
		super(app);
		this.setPlaceholder("Куда переместить заметку");
	}

	getItems(): TopicChoice[] {
		return this.topics;
	}

	getItemText(topic: TopicChoice): string {
		return topic.name;
	}

	// FuzzySuggestModal отдаёт сюда результат поиска, а не сам элемент.
	renderSuggestion(match: FuzzyMatch<TopicChoice>, el: HTMLElement): void {
		const topic = match.item;
		el.createDiv({ text: topic.name });
		// У топика в корне папки нет — вторую строку не рисуем.
		if (topic.folder.length === 0) return;
		el.createDiv({ cls: "topic-feed-suggestion-folder", text: topic.folder });
	}

	onChooseItem(topic: TopicChoice): void {
		this.onChoose(topic);
	}
}
