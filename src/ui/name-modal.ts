import { App, Modal, Setting } from "obsidian";

export interface NameModalOptions {
	title: string;
	placeholder: string;
	/** Начальное значение — для переименования. */
	initial?: string;
	confirmText: string;
	onSubmit: (name: string) => void;
}

/** Окно с одним полем ввода: создать папку, создать топик, переименовать заметку. */
export class NameModal extends Modal {
	private name: string;

	constructor(
		app: App,
		private readonly options: NameModalOptions,
	) {
		super(app);
		this.name = options.initial ?? "";
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);

		const container = this.contentEl.createDiv({ cls: "topic-feed-modal" });

		new Setting(container).addText((text) => {
			text
				.setPlaceholder(this.options.placeholder)
				.setValue(this.name)
				.onChange((value) => {
					this.name = value;
				});

			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key !== "Enter") return;
				event.preventDefault();
				this.submit();
			});

			// Фокус откладываем: до конца отрисовки окна поле ещё не в документе.
			// Выделяем текст целиком, чтобы при переименовании печатать поверх.
			window.setTimeout(() => {
				text.inputEl.focus();
				text.inputEl.select();
			}, 0);
		});

		new Setting(container)
			.addButton((button) => button.setButtonText("Отмена").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(this.options.confirmText)
					.setCta()
					.onClick(() => this.submit()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Escape закрывает окно сам — сюда попадают только Enter и кнопка. */
	private submit(): void {
		const name = this.name.trim();
		if (name.length === 0) return;
		this.close();
		this.options.onSubmit(name);
	}
}
