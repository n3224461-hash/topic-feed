import { describe, expect, it } from "vitest";
import { safeFileName, uniqueFileName } from "../src/lib/file-name";

describe("safeFileName", () => {
	it("оставляет обычное название как есть", () => {
		expect(safeFileName("Планы на осень")).toBe("Планы на осень");
	});

	it("убирает символы, недопустимые в именах файлов", () => {
		expect(safeFileName('Отчёт: "план/факт" за 2026?')).toBe("Отчёт план факт за 2026");
	});

	it("убирает остальные запрещённые символы", () => {
		expect(safeFileName("A*B<C>D|E\\F")).toBe("A B C D E F");
	});

	it("убирает управляющие символы", () => {
		expect(safeFileName("Итоги\tнедели\nи точка")).toBe("Итоги недели и точка");
	});

	it("схлопывает лишние пробелы и срезает их по краям", () => {
		expect(safeFileName("  много    пробелов  ")).toBe("много пробелов");
	});

	it("не оставляет точку в начале", () => {
		expect(safeFileName("...скрытый")).toBe("скрытый");
		expect(safeFileName(". Заметка")).toBe("Заметка");
	});

	it("оставляет точки внутри названия", () => {
		expect(safeFileName("v1.2 итог")).toBe("v1.2 итог");
	});

	it("подставляет запасное название, если ничего не осталось", () => {
		expect(safeFileName("///")).toBe("Без названия");
		expect(safeFileName("...")).toBe("Без названия");
		expect(safeFileName("   ")).toBe("Без названия");
		expect(safeFileName("")).toBe("Без названия");
	});
});

describe("uniqueFileName", () => {
	it("оставляет свободное имя без изменений", () => {
		expect(uniqueFileName("Топик", new Set())).toBe("Топик");
	});

	it("дописывает номер, если имя занято", () => {
		expect(uniqueFileName("Топик", new Set(["Топик"]))).toBe("Топик 2");
	});

	it("ищет первый свободный номер", () => {
		const taken = new Set(["Топик", "Топик 2", "Топик 3"]);
		expect(uniqueFileName("Топик", taken)).toBe("Топик 4");
	});

	it("занимает пропущенный номер", () => {
		expect(uniqueFileName("Топик", new Set(["Топик", "Топик 3"]))).toBe("Топик 2");
	});

	it("сравнивает имена без учёта регистра", () => {
		expect(uniqueFileName("Топик", new Set(["топик"]))).toBe("Топик 2");
		expect(uniqueFileName("Топик", new Set(["ТОПИК", "топик 2"]))).toBe("Топик 3");
	});

	it("не смотрит на чужие имена в папке", () => {
		expect(uniqueFileName("Топик", new Set(["Другое", "Топик 2"]))).toBe("Топик");
	});
});
