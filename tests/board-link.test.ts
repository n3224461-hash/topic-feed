import { describe, expect, it } from "vitest";
import {
	BOARD_PROPERTY,
	BOARD_TYPE,
	TASK_TYPE,
	isBoardFrontmatter,
	isTaskFrontmatter,
} from "../src/lib/board-link";
import { isTopicFrontmatter, parseTopicLink } from "../src/lib/topic-link";

describe("isBoardFrontmatter", () => {
	it("узнаёт доску", () => {
		expect(isBoardFrontmatter({ type: BOARD_TYPE })).toBe(true);
	});

	it("не смотрит на регистр и краевые пробелы", () => {
		expect(isBoardFrontmatter({ type: " Kanban " })).toBe(true);
	});

	it("топик доской не считает", () => {
		expect(isBoardFrontmatter({ type: "topic" })).toBe(false);
	});

	it("задачу доской не считает", () => {
		expect(isBoardFrontmatter({ type: TASK_TYPE })).toBe(false);
	});

	it("на пустых свойствах и не-строке возвращает false", () => {
		expect(isBoardFrontmatter(undefined)).toBe(false);
		expect(isBoardFrontmatter(null)).toBe(false);
		expect(isBoardFrontmatter({})).toBe(false);
		expect(isBoardFrontmatter({ type: 42 })).toBe(false);
		expect(isBoardFrontmatter({ type: ["kanban"] })).toBe(false);
	});
});

describe("isTaskFrontmatter", () => {
	it("узнаёт задачу", () => {
		expect(isTaskFrontmatter({ type: TASK_TYPE })).toBe(true);
	});

	it("не смотрит на регистр", () => {
		expect(isTaskFrontmatter({ type: "TASK" })).toBe(true);
	});

	it("доску задачей не считает", () => {
		expect(isTaskFrontmatter({ type: BOARD_TYPE })).toBe(false);
	});
});

describe("виды заметок не пересекаются", () => {
	it("одна заметка не может быть и топиком, и доской", () => {
		const board = { type: BOARD_TYPE };
		expect(isBoardFrontmatter(board)).toBe(true);
		expect(isTopicFrontmatter(board)).toBe(false);
	});
});

describe("ссылка задачи на доску", () => {
	it("разбирается тем же способом, что и ссылка на топик", () => {
		const task = { type: TASK_TYPE, [BOARD_PROPERTY]: "[[Проекты/Сайт|Сайт]]" };
		expect(parseTopicLink(task[BOARD_PROPERTY])).toBe("Проекты/Сайт");
	});

	it("без свойства связи ссылки нет", () => {
		expect(parseTopicLink(undefined)).toBeNull();
	});
});
