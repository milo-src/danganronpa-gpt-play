# Ресурсы

## Общие правила

- Готовые файлы для отображения лежат в `public/assets/`.
- Оригиналы, большие архивы, PSD и промежуточные результаты лежат в `source-assets/`; эта папка не должна попадать в сборку расширения.
- В путях используй латиницу, строчные буквы и дефисы: `makoto-naegi`, `classroom-day.webp`. Отображаемые имена в JSON могут быть на любом языке.
- Пути в каталогах и описаниях ресурсов указываются от корня `public/`, с `/`, без начального `/`: `assets/characters/dr1/makoto-naegi/sprites/neutral.png`.
- Не записывай в каталоги абсолютные пути компьютера. Будущий загрузчик преобразует относительный путь в URL ресурса расширения.

## Персонажи и спрайты

Путь: `public/assets/characters/<game>/<character>/`.

Группы: `dr1`, `dr2`, `drv3`, `custom`. Новые группы можно добавлять по мере необходимости.

В каждой папке персонажа:

| Файл или папка | Назначение |
| --- | --- |
| `character.json` | ID, отображаемое имя, спрайт по умолчанию, соответствие эмоций файлам |
| `sprites/` | Прозрачные изображения персонажа для основной сцены |
| `portraits/` | Маленькие изображения для истории диалогов, меню и списка участников |

Копируемый образец находится в `public/assets/characters/_template/character.example.json`. Это только пример: перечисленные в нём изображения пока отсутствуют, а сам шаблон не включён в каталог.

Пример рабочего набора:

```text
characters/dr1/makoto-naegi/
  character.json
  sprites/neutral.png
  sprites/happy.png
  sprites/angry.png
  sprites/angry-02.png
  sprites/thinking.png
  portraits/default.png
```

У персонажа должен быть постоянный ID с группой, например `dr1.makoto-naegi`. Это позволяет отдельно хранить версии одного персонажа из разных игр. Отображаемое имя можно менять без изменения ID.

Названия эмоций — ключи в `sprites`: `neutral`, `happy`, `angry`, `sad`, `surprised`, `thinking`, `confident`. Необязательно иметь весь список. Для дополнительной позы подходит ключ `angry-02`. Если исходные картинки называются `001.png`, `002.png`, их можно оставить: соответствие эмоций задаётся в JSON.

`defaultSprite` должен ссылаться на существующий ключ в `sprites`. При неизвестной эмоции будущий движок должен показывать этот спрайт. Поле `portrait` необязательно: если портрета нет, убери поле из описания.

Для спрайтов подходят PNG или WebP с прозрачностью. В пределах одного персонажа желательно сохранять одинаковые размеры холста и положение ног: при переключении эмоций персонаж не будет прыгать. Не обрезай каждую позу вплотную независимо от остальных.

### Как подготовить набор

1. Скопируй `_template/` в `dr1/makoto-naegi/` или другую нужную папку.
2. Положи готовые картинки в `sprites/`, а портрет — в `portraits/`, если он есть.
3. Переименуй `character.example.json` в `character.json`.
4. Замени примерные ID, имя и пути. Удали записи о картинках, которых нет.
5. Когда набор готов для подключения, добавь запись в массив `characters` файла `src/data/characters.json`:

```json
{
  "id": "dr1.makoto-naegi",
  "manifest": "assets/characters/dr1/makoto-naegi/character.json"
}
```

ID в каталоге и в `character.json` должен совпадать. Пустой каталог в репозитории намеренный: реальные наборы пока не добавлены. Регистрация описывает будущий контракт загрузчика; сама по себе она пока не запускает отображение.

## Фоны

Группируй варианты по локации:

```text
backgrounds/dr1/classroom/day.webp
backgrounds/dr1/classroom/night.webp
backgrounds/dr1/trial-room/default.webp
backgrounds/custom/bedroom/day.webp
```

Для начала удобно готовить фоны 16:9. Они заполняют сцену, а спрайты накладываются сверху. Каталог фонов стоит добавить, когда появятся первые реальные локации.

## Музыка, звуки и голоса

```text
audio/music/daily-life/calm-theme.ogg
audio/music/trial/debate-theme.ogg
audio/sfx/dialogue/text-tick.ogg
audio/sfx/ui/confirm.ogg
audio/sfx/trial/objection.ogg
audio/voices/dr1/makoto-naegi/objection.ogg
```

Музыку разделяй по игровому режиму, короткие звуки — по назначению, голосовые реплики — по персонажу. Не клади звуковые файлы в папки со спрайтами.

## Интерфейс, эффекты и шрифты

```text
ui/dialogue/nameplate.png
ui/dialogue/textbox.png
ui/icons/evidence.svg
ui/cursors/default.png
effects/trial/objection-overlay.png
effects/transitions/flash.png
fonts/dialogue-regular.woff2
```

Изображения интерфейса хранятся здесь, а правила их размещения и анимации — в `src/ui/`. Иконки расширения для браузера находятся отдельно в `public/icons/`.
