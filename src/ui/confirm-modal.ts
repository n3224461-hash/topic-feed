import { App, Modal, Setting } from "obsidian";

export interface ConfirmOptions {
	title: string;
	/** Строки, которые увидит пользователь перед подтверждением. */
	body: string[];
	confirmText: string;
	onConfirm: () => void;
}

/**
 * Окно подтверждения перед необратимым действием.
 * Показывай здесь, что именно будет затронуто, — не только количество.
 */
export class ConfirmModal extends Modal {
	constructor(app: App, private options: ConfirmOptions) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("topic-feed-modal");
		contentEl.createEl("h3", { text: this.options.title });

		const list = contentEl.createEl("ul", { cls: "topic-feed-list" });
		for (const line of this.options.body) {
			list.createEl("li", { text: line });
		}

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Отмена").onClick(() => this.close()),
			)
			.addButton((b) =>
				b
					.setButtonText(this.options.confirmText)
					.setCta()
					.onClick(() => {
						this.close();
						this.options.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
