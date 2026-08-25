import { describe, expect, it } from "vitest";
import { sortFeed } from "../src/lib/ordering";

describe("sortFeed", () => {
	it("ставит свежие заметки в конец", () => {
		const items = [
			{ path: "б.md", mtime: 300 },
			{ path: "а.md", mtime: 100 },
			{ path: "в.md", mtime: 200 },
		];
		expect(sortFeed(items).map((i) => i.path)).toEqual([
			"а.md",
			"в.md",
			"б.md",
		]);
	});

	it("не мутирует исходный массив", () => {
		const items = [
			{ path: "б.md", mtime: 300 },
			{ path: "а.md", mtime: 100 },
		];
		const result = sortFeed(items);
		expect(items.map((i) => i.path)).toEqual(["б.md", "а.md"]);
		expect(result).not.toBe(items);
	});

	it("при равном времени правки сортирует по пути", () => {
		const items = [
			{ path: "яблоко.md", mtime: 100 },
			{ path: "арбуз.md", mtime: 100 },
			{ path: "банан.md", mtime: 100 },
		];
		expect(sortFeed(items).map((i) => i.path)).toEqual([
			"арбуз.md",
			"банан.md",
			"яблоко.md",
		]);
	});

	it("даёт одинаковый порядок независимо от исходного", () => {
		const a = { path: "а.md", mtime: 100 };
		const b = { path: "б.md", mtime: 100 };
		const c = { path: "в.md", mtime: 100 };
		expect(sortFeed([c, a, b])).toEqual(sortFeed([b, c, a]));
	});

	it("сохраняет дополнительные поля элементов", () => {
		const items = [{ path: "а.md", mtime: 1, title: "Заметка" }];
		expect(sortFeed(items)[0]).toMatchObject({ title: "Заметка" });
	});

	it("возвращает пустой массив для пустого входа", () => {
		expect(sortFeed([])).toEqual([]);
	});
});
