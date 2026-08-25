import { describe, expect, it } from "vitest";
import {
	breadcrumbs,
	buildLevel,
	folderFreshness,
	folderHasTopics,
	isInsideFolder,
	type TopicInfo,
	folderTopicCount,
} from "../src/lib/tree";

const topic = (path: string, freshness: number, name = path): TopicInfo => ({
	path,
	name,
	freshness,
});

describe("isInsideFolder", () => {
	it("считает корень вместилищем всего", () => {
		expect(isInsideFolder("Курс.md", "")).toBe(true);
		expect(isInsideFolder("Проекты/Архив/Старое.md", "")).toBe(true);
	});

	it("находит топик непосредственно в папке", () => {
		expect(isInsideFolder("Проекты/Курс.md", "Проекты")).toBe(true);
	});

	it("находит топик во вложенной папке", () => {
		expect(isInsideFolder("Проекты/Архив/Старое.md", "Проекты")).toBe(true);
	});

	it("не путает папку с папкой, у которой совпадает начало имени", () => {
		expect(isInsideFolder("ПроектыДругие/Курс.md", "Проекты")).toBe(false);
	});

	it("не считает одноимённый файл лежащим внутри папки", () => {
		expect(isInsideFolder("Проекты.md", "Проекты")).toBe(false);
	});

	it("не считает топик соседней папки вложенным", () => {
		expect(isInsideFolder("Заметки/Курс.md", "Проекты")).toBe(false);
	});
});

describe("folderFreshness", () => {
	it("берёт максимум по топикам внутри, включая вложенные", () => {
		const topics = [
			topic("Проекты/Курс.md", 100),
			topic("Проекты/Архив/Старое.md", 500),
			topic("Заметки/Другое.md", 900),
		];
		expect(folderFreshness("Проекты", topics)).toBe(500);
	});

	it("даёт 0, если топиков внутри нет", () => {
		expect(folderFreshness("Пусто", [topic("Проекты/Курс.md", 100)])).toBe(0);
	});
});

describe("folderHasTopics", () => {
	it("видит топик во вложенной папке", () => {
		expect(
			folderHasTopics("Проекты", [topic("Проекты/Архив/Старое.md", 1)]),
		).toBe(true);
	});

	it("не видит топиков в пустой папке", () => {
		expect(folderHasTopics("Пусто", [topic("Проекты/Курс.md", 1)])).toBe(false);
	});
});

describe("buildLevel", () => {
	it("сортирует папки и топики одним списком, свежее сверху", () => {
		const allTopics = [
			topic("Архив/Старое.md", 100),
			topic("Свежее.md", 500, "Свежее"),
			topic("Проекты/Новое.md", 900),
		];
		const level = buildLevel({
			folders: ["Архив", "Проекты"],
			topics: [topic("Свежее.md", 500, "Свежее")],
			allTopics,
			onlyFoldersWithTopics: false,
		});
		expect(level.map((n) => n.name)).toEqual(["Проекты", "Свежее", "Архив"]);
	});

	it("поднимает папку со свежим топиком выше холодного топика", () => {
		const level = buildLevel({
			folders: ["Проекты"],
			topics: [topic("Холодное.md", 10, "Холодное")],
			allTopics: [topic("Проекты/Новое.md", 900)],
			onlyFoldersWithTopics: false,
		});
		expect(level[0]).toMatchObject({ kind: "folder", name: "Проекты" });
	});

	it("при равной свежести сортирует по имени", () => {
		const level = buildLevel({
			folders: ["Яблоки", "Арбузы"],
			topics: [topic("Банан.md", 100, "Банан")],
			allTopics: [
				topic("Яблоки/Раз.md", 100),
				topic("Арбузы/Два.md", 100),
				topic("Банан.md", 100, "Банан"),
			],
			onlyFoldersWithTopics: false,
		});
		expect(level.map((n) => n.name)).toEqual(["Арбузы", "Банан", "Яблоки"]);
	});

	it("берёт именем папки последний сегмент пути", () => {
		const level = buildLevel({
			folders: ["Проекты/Архив"],
			topics: [],
			allTopics: [topic("Проекты/Архив/Старое.md", 1)],
			onlyFoldersWithTopics: false,
		});
		expect(level[0]).toMatchObject({ path: "Проекты/Архив", name: "Архив" });
	});

	it("скрывает пустые папки, когда фильтр включён", () => {
		const level = buildLevel({
			folders: ["Пусто", "Проекты"],
			topics: [],
			allTopics: [topic("Проекты/Курс.md", 100)],
			onlyFoldersWithTopics: true,
		});
		expect(level.map((n) => n.name)).toEqual(["Проекты"]);
	});

	it("показывает пустые папки, когда фильтр выключен", () => {
		const level = buildLevel({
			folders: ["Пусто"],
			topics: [],
			allTopics: [],
			onlyFoldersWithTopics: false,
		});
		expect(level).toEqual([
			{ kind: "folder", path: "Пусто", name: "Пусто", freshness: 0 },
		]);
	});

	it("не скрывает топики при включённом фильтре", () => {
		const level = buildLevel({
			folders: ["Пусто"],
			topics: [topic("Курс.md", 0, "Курс")],
			allTopics: [topic("Курс.md", 0, "Курс")],
			onlyFoldersWithTopics: true,
		});
		expect(level.map((n) => n.name)).toEqual(["Курс"]);
	});

	it("берёт имя топика как есть", () => {
		const level = buildLevel({
			folders: [],
			topics: [topic("Проекты/Курс.md", 5, "Курс вайбкодинга")],
			allTopics: [],
			onlyFoldersWithTopics: false,
		});
		expect(level[0]).toEqual({
			kind: "topic",
			path: "Проекты/Курс.md",
			name: "Курс вайбкодинга",
			freshness: 5,
		});
	});
});

describe("breadcrumbs", () => {
	it("даёт пустой список для корня", () => {
		expect(breadcrumbs("")).toEqual([]);
	});

	it("даёт одну крошку для папки верхнего уровня", () => {
		expect(breadcrumbs("Проекты")).toEqual([
			{ name: "Проекты", path: "Проекты" },
		]);
	});

	it("накапливает пути для вложенных папок", () => {
		expect(breadcrumbs("Проекты/Архив/2025")).toEqual([
			{ name: "Проекты", path: "Проекты" },
			{ name: "Архив", path: "Проекты/Архив" },
			{ name: "2025", path: "Проекты/Архив/2025" },
		]);
	});

	it("игнорирует лишние слэши", () => {
		expect(breadcrumbs("/Проекты//Архив/")).toEqual([
			{ name: "Проекты", path: "Проекты" },
			{ name: "Архив", path: "Проекты/Архив" },
		]);
	});
});

describe("folderTopicCount", () => {
	const topics = [
		{ path: "Проекты/Курс.md", name: "Курс", freshness: 5 },
		{ path: "Проекты/Архив/Старое.md", name: "Старое", freshness: 3 },
		{ path: "Дом/Идеи.md", name: "Идеи", freshness: 9 },
	];

	it("считает топики вместе с вложенными папками", () => {
		expect(folderTopicCount("Проекты", topics)).toBe(2);
	});

	it("считает только свою ветку", () => {
		expect(folderTopicCount("Дом", topics)).toBe(1);
	});

	it("в папке без топиков — ноль", () => {
		expect(folderTopicCount("Пусто", topics)).toBe(0);
	});

	it("корень содержит все топики", () => {
		expect(folderTopicCount("", topics)).toBe(3);
	});
});
