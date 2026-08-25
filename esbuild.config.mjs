import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const production = process.argv[2] === "production";

// В разработке собираем прямо в тестовый vault — Hot Reload подхватит изменения.
// В production собираем в корень плагина: такой формат требует релиз Obsidian.
const PLUGIN_ID = "topic-feed";
const devOutDir = join("..", "..", "vault-test", ".obsidian", "plugins", PLUGIN_ID);
const outDir = production ? "." : devOutDir;

if (!production) {
	mkdirSync(outDir, { recursive: true });
	// Пустой файл-маркер: по нему плагин Hot Reload понимает, что этот плагин
	// нужно перезагружать при изменении main.js.
	writeFileSync(join(outDir, ".hotreload"), "");
}

/** Кладёт рядом с main.js файлы, которые Obsidian читает напрямую. */
function copyStatic() {
	for (const file of ["manifest.json", "styles.css"]) {
		if (existsSync(file) && outDir !== ".") {
			copyFileSync(file, join(outDir, file));
		}
	}
}

const notifyPlugin = {
	name: "notify",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length > 0) return;
			copyStatic();
			console.log(`[${new Date().toLocaleTimeString()}] сборка готова → ${outDir}`);
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	// Obsidian предоставляет эти модули сам — в бандл они попадать не должны.
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	outfile: join(outDir, "main.js"),
	minify: production,
	plugins: [notifyPlugin],
});

if (production) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
	console.log(`Слежу за изменениями. Сборка идёт в ${outDir}`);
}
