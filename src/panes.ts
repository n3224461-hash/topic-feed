import type { App, WorkspaceLeaf, WorkspaceParent, WorkspaceSplit } from "obsidian";

/**
 * Панели рабочей области.
 *
 * Obsidian не даёт публичного способа спросить «какая панель левее»: он знает
 * только «текущую» вкладку — ту, где последний раз был фокус. Отсюда и берётся
 * непредсказуемость.
 *
 * Порядок панелей берём с экрана: у каждой вкладки есть контейнер, у него —
 * ближайший `.workspace-tabs`, это и есть панель. Её координата слева даёт
 * порядок, который видит пользователь. Дерево `rootSplit` для этого не годится:
 * его поле children в публичных типах не описано.
 */
interface Pane {
	parent: WorkspaceParent;
	/** Любая вкладка панели — на случай, если «недавней» у неё ещё не было. */
	leaf: WorkspaceLeaf;
	left: number;
}

/** Панели вкладок рабочей области — слева направо. */
function panes(app: App): Pane[] {
	const found = new Map<HTMLElement, Pane>();

	app.workspace.iterateRootLeaves((leaf) => {
		// Вкладки всплывающих окон живут в своей системе координат — не их дело.
		if (leaf.getContainer() !== app.workspace.rootSplit) return;

		const el = leaf.view.containerEl.closest<HTMLElement>(".workspace-tabs");
		if (!el || found.has(el)) return;

		found.set(el, {
			parent: leaf.parent,
			leaf,
			left: el.getBoundingClientRect().left,
		});
	});

	return [...found.values()].sort((a, b) => a.left - b.left);
}

/** Вкладка панели: недавняя, а если она закреплена — новая рядом с ней. */
function tabIn(app: App, pane: Pane): WorkspaceLeaf {
	const recent = app.workspace.getMostRecentLeaf(pane.parent) ?? pane.leaf;
	if (!recent.getViewState().pinned) return recent;

	return app.workspace.createLeafInParent(pane.parent as WorkspaceSplit, -1);
}

/** Вкладка в крайней левой панели рабочей области. */
export function leftPaneLeaf(app: App): WorkspaceLeaf {
	const pane = panes(app)[0];
	return pane ? tabIn(app, pane) : app.workspace.getLeaf(false);
}

/**
 * Вкладка в панели справа от заданной. Такой панели нет — отделяем новую.
 * `newTab` заводит отдельную вкладку вместо переиспользования текущей.
 */
export function rightPaneLeaf(app: App, leaf: WorkspaceLeaf, newTab = false): WorkspaceLeaf {
	const all = panes(app);
	const index = all.findIndex((pane) => pane.parent === leaf.parent);
	const next = index >= 0 ? all[index + 1] : undefined;

	if (!next) return app.workspace.createLeafBySplit(leaf, "vertical");

	return newTab
		? app.workspace.createLeafInParent(next.parent as WorkspaceSplit, -1)
		: tabIn(app, next);
}

/** Лежит ли вкладка в крайней левой панели. Панель одна — считаем, что да. */
export function inLeftPane(app: App, leaf: WorkspaceLeaf): boolean {
	const all = panes(app);
	const first = all[0];
	return !first || all.length < 2 || leaf.parent === first.parent;
}
