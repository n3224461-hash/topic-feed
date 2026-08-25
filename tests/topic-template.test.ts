import { describe, expect, it } from "vitest";
import { newTopicContent } from "../src/lib/topic-template";
import { isTopicFrontmatter } from "../src/lib/topic-link";

describe("newTopicContent", () => {
	it("начинается с блока свойств", () => {
		expect(newTopicContent().startsWith("---\n")).toBe(true);
	});

	it("объявляет заметку топиком", () => {
		expect(newTopicContent()).toContain("type: topic");
	});

	it("свойство распознаётся разбором свойств", () => {
		const type = newTopicContent().split("\n")[1]?.split(": ")[1] ?? "";
		expect(isTopicFrontmatter({ type })).toBe(true);
	});

	it("оставляет пустое тело — описание топика пишет пользователь", () => {
		const body = newTopicContent().split("---\n")[2] ?? "";
		expect(body.trim()).toBe("");
	});
});
