import { App, Modal, Setting } from "obsidian";

export interface ConfirmModalOptions {
	title: string;
	/** Что именно произойдёт — одной-двумя строками. */
	body: string;
	confirmText: string;
	onConfirm: () => void;
}

/** Окно подтверждения для действий, которые нельзя отменить. */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly options: ConfirmModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);

		const container = this.contentEl.createDiv({ cls: "topic-feed-modal" });
		container.createEl("p", { text: this.options.body });

		new Setting(container)
			.addButton((button) => button.setButtonText("Отмена").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(this.options.confirmText)
					.setWarning()
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
