import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Тестируем только src/lib/ — код, не зависящий от Obsidian.
		// UI и точка входа проверяются руками в vault-test.
		include: ["tests/**/*.test.ts"],
		environment: "node",
	},
});
