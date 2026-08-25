/**
 * Подписи дат под баблами.
 * Чистая логика: не импортирует "obsidian".
 */

const MONTHS = [
	"янв",
	"фев",
	"мар",
	"апр",
	"мая",
	"июн",
	"июл",
	"авг",
	"сен",
	"окт",
	"ноя",
	"дек",
];

/** Короткая подпись правки: чем ближе к сегодня, тем меньше подробностей. */
export function dateLabel(timestamp: number, now: number): string {
	const date = new Date(timestamp);
	const today = startOfDay(new Date(now));
	const day = startOfDay(date);
	const daysApart = Math.round((today.getTime() - day.getTime()) / 86_400_000);

	if (daysApart === 0) return time(date);
	if (daysApart === 1) return `вчера, ${time(date)}`;
	if (date.getFullYear() === new Date(now).getFullYear()) {
		return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${time(date)}`;
	}
	return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** Полная дата — для подсказки о времени создания. */
export function fullDateLabel(timestamp: number): string {
	const date = new Date(timestamp);
	return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${time(date)}`;
}

function time(date: Date): string {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}
