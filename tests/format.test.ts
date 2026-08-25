import { describe, expect, it } from "vitest";
import { formatItems } from "../src/lib/format";

describe("formatItems", () => {
	it("показывает список целиком, если он короткий", () => {
		expect(formatItems(["а", "б"])).toEqual(["а", "б"]);
	});

	it("обрезает длинный список и считает остаток", () => {
		const items = Array.from({ length: 13 }, (_, i) => `n${i}`);
		const result = formatItems(items, 3);
		expect(result).toEqual(["n0", "n1", "n2", "…и ещё 10"]);
	});

	it("не добавляет остаток, когда длина совпадает с лимитом", () => {
		expect(formatItems(["а", "б"], 2)).toEqual(["а", "б"]);
	});
});
