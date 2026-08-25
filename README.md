# Topic Feed

Плагин Obsidian: Topic Feed

> Заготовка. Опиши здесь, что плагин делает, — этот текст увидят те, кто найдёт его на GitHub.

## Возможности

- Команда «Поздороваться» показывает уведомление

## Установка

### Вручную

1. Скачай `main.js`, `manifest.json` и `styles.css` из [последнего релиза](https://github.com/n3224461-hash/topic-feed/releases/latest)
2. Положи их в папку `<хранилище>/.obsidian/plugins/topic-feed/`
3. Перезапусти Obsidian и включи плагин в настройках

### Через BRAT

Добавь `n3224461-hash/topic-feed` в плагин [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Настройки

| Параметр | По умолчанию | Что делает |
|---|---|---|
| Кого приветствовать | `мир` | Подставляется в текст уведомления |

## Разработка

```bash
npm install
npm run dev      # сборка в vault-test с авто-перезагрузкой
npm test         # тесты логики
npm run build    # сборка релиза
```

Требуется Node.js 20 или новее.

## Лицензия

MIT — см. [LICENSE](LICENSE).
