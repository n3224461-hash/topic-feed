import { describe, expect, it } from "vitest";
import {
	TOPIC_TYPE,
	isTopicFrontmatter,
	makeTopicLink,
	parseTopicLink,
} from "../src/lib/topic-link";

describe("isTopicFrontmatter", () => {
	it("узнаёт топик по точному значению type", () => {
		expect(isTopicFrontmatter({ type: TOPIC_TYPE })).toBe(true);
	});

	it("не смотрит на регистр и обрамляющие пробелы", () => {
		expect(isTopicFrontmatter({ type: "  Topic " })).toBe(true);
		expect(isTopicFrontmatter({ type: "TOPIC" })).toBe(true);
	});

	it("отклоняет другое значение type", () => {
		expect(isTopicFrontmatter({ type: "note" })).toBe(false);
	});

	it("отклоняет отсутствие свойств и отсутствие type", () => {
		expect(isTopicFrontmatter(undefined)).toBe(false);
		expect(isTopicFrontmatter(null)).toBe(false);
		expect(isTopicFrontmatter({})).toBe(false);
	});

	it("отклоняет нестроковый type", () => {
		expect(isTopicFrontmatter({ type: 1 })).toBe(false);
		expect(isTopicFrontmatter({ type: ["topic"] })).toBe(false);
		expect(isTopicFrontmatter({ type: null })).toBe(false);
	});
});

describe("parseTopicLink", () => {
	it("читает простую викиссылку", () => {
		expect(parseTopicLink("[[Курс]]")).toBe("Курс");
	});

	it("сохраняет путь с папкой", () => {
		expect(parseTopicLink("[[папка/Курс]]")).toBe("папка/Курс");
	});

	it("отбрасывает алиас", () => {
		expect(parseTopicLink("[[папка/Курс|алиас]]")).toBe("папка/Курс");
	});

	it("отбрасывает якорь", () => {
		expect(parseTopicLink("[[Курс#Раздел]]")).toBe("Курс");
	});

	it("принимает имя без скобок", () => {
		expect(parseTopicLink("Курс")).toBe("Курс");
	});

	it("срезает пробелы снаружи и внутри скобок", () => {
		expect(parseTopicLink("  [[ Курс ]]  ")).toBe("Курс");
	});

	it("берёт первый непустой элемент списка", () => {
		expect(parseTopicLink(["[[Курс]]", "[[Другое]]"])).toBe("Курс");
		expect(parseTopicLink(["", "[[Другое]]"])).toBe("Другое");
	});

	it("возвращает null для пустых значений", () => {
		expect(parseTopicLink("")).toBeNull();
		expect(parseTopicLink("   ")).toBeNull();
		expect(parseTopicLink("[[]]")).toBeNull();
		expect(parseTopicLink("[[ ]]")).toBeNull();
		expect(parseTopicLink([])).toBeNull();
	});

	it("возвращает null для значений не того типа", () => {
		expect(parseTopicLink(null)).toBeNull();
		expect(parseTopicLink(undefined)).toBeNull();
		expect(parseTopicLink(42)).toBeNull();
		expect(parseTopicLink({ path: "Курс" })).toBeNull();
	});
});

describe("makeTopicLink", () => {
	it("оборачивает имя в двойные скобки", () => {
		expect(makeTopicLink("Курс")).toBe("[[Курс]]");
	});

	it("срезает обрамляющие пробелы", () => {
		expect(makeTopicLink("  Курс  ")).toBe("[[Курс]]");
	});

	it("не экранирует имя с путём", () => {
		expect(makeTopicLink("папка/Курс")).toBe("[[папка/Курс]]");
	});

	it("бросает ошибку на пустом имени", () => {
		expect(() => makeTopicLink("   ")).toThrow(/Имя топика/);
	});
});
