import { WorkspaceLeaf, type App, type WorkspaceParent } from "obsidian";

/**
 * Панели рабочей области.
 *
 * Obsidian не даёт публичного способа спросить «какая панель левее»: он знает
 * только «текущую» вкладку — ту, где последний раз был фокус. Отсюда и берётся
 * непредсказуемость. Порядок панелей читается из дерева rootSplit: порядок
 * детей в нём совпадает с порядком панелей на экране слева направо.
 */
type Pane = WorkspaceParent & { children?: unknown[] };

/** Панели вкладок рабочей области — слева направо. */
function panes(app: App): Pane[] {
	const found: Pane[] = [];

	const walk = (node: Pane): void => {
		const children = node.children ?? [];
		// Панель вкладок — та, в детях которой лежат сами вкладки.
		if (children.some((child) => child instanceof WorkspaceLeaf)) {
			found.push(node);
			return;
		}
		for (const child of children) walk(child as Pane);
	};

	walk(app.workspace.rootSplit as Pane);
	return found;
}

/**
 * Отдаёт вкладку в заданной панели так, как это сделал бы сам Obsidian:
 * делает недавнюю вкладку панели активной и просит открыть «в текущей».
 * Тогда закреплённая вкладка не перезаписывается — рядом появится новая.
 */
function leafIn(app: App, pane: Pane | undefined): WorkspaceLeaf | null {
	const recent = pane ? app.workspace.getMostRecentLeaf(pane) : null;
	if (!recent) return null;

	app.workspace.setActiveLeaf(recent, { focus: false });
	return app.workspace.getLeaf(false);
}

/** Вкладка в крайней левой панели рабочей области. */
export function leftPaneLeaf(app: App): WorkspaceLeaf {
	return leafIn(app, panes(app)[0]) ?? app.workspace.getLeaf(false);
}

/** Вкладка в панели справа от заданной. Такой панели нет — отделяем новую. */
export function rightPaneLeaf(app: App, leaf: WorkspaceLeaf): WorkspaceLeaf {
	const all = panes(app);
	const index = all.indexOf(leaf.parent as Pane);
	const next = index >= 0 ? all[index + 1] : undefined;

	return leafIn(app, next) ?? app.workspace.createLeafBySplit(leaf, "vertical");
}

/** Лежит ли вкладка в крайней левой панели. Панель одна — считаем, что да. */
export function inLeftPane(app: App, leaf: WorkspaceLeaf): boolean {
	const all = panes(app);
	return all.length < 2 || leaf.parent === all[0];
}
