import { describe, expect, it } from "vitest";
import { dateLabel, fullDateLabel } from "../src/lib/date-label";

const at = (y: number, m: number, d: number, h = 0, min = 0): number =>
	new Date(y, m - 1, d, h, min).getTime();

describe("dateLabel", () => {
	const now = at(2026, 8, 25, 12, 0);

	it("сегодня показывает только время", () => {
		expect(dateLabel(at(2026, 8, 25, 9, 5), now)).toBe("09:05");
	});

	it("вчера подписывает словом", () => {
		expect(dateLabel(at(2026, 8, 24, 23, 40), now)).toBe("вчера, 23:40");
	});

	it("этот год — день, месяц и время", () => {
		expect(dateLabel(at(2026, 3, 7, 8, 0), now)).toBe("7 мар, 08:00");
	});

	it("прошлый год — полная дата без времени", () => {
		expect(dateLabel(at(2025, 12, 31, 18, 30), now)).toBe("31.12.2025");
	});

	it("вчера считается по календарю, а не по суткам назад", () => {
		// Полночь минус пять минут — это вчера, хотя прошло меньше суток.
		const nowEarly = at(2026, 8, 25, 0, 10);
		expect(dateLabel(at(2026, 8, 24, 23, 55), nowEarly)).toBe("вчера, 23:55");
	});

	it("позавчера этого года показывает дату", () => {
		expect(dateLabel(at(2026, 8, 23, 10, 0), now)).toBe("23 авг, 10:00");
	});
});

describe("fullDateLabel", () => {
	it("собирает дату и время с ведущими нулями", () => {
		expect(fullDateLabel(at(2026, 1, 3, 4, 5))).toBe("03.01.2026 04:05");
	});
});
