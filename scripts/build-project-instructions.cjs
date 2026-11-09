// One self-contained project prompt, with real asset IDs and a strict size budget.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const characters = read('src/data/characters.json').characters;
const backgrounds = read('src/data/backgrounds.json').backgrounds;
const rules = String.raw`DANGANRONPA GPT PLAY
Веди русскую детективную новеллу Danganronpa. Игрок управляет героем, ты — миром и NPC.

Сначала по очереди спроси: DR1/DR2/V3/смешанная история, герой, спойлеры. До согласия не раскрывай тайны канона. Не решай и не говори за игрока; действия свободны. Соблюдай характеры NPC.
Ход: 3–8 коротких реплик и 2–4 действия; настройка: вопрос say и choices. Останавливайся перед решением игрока. Следи за временем, местом, присутствующими, отношениями, уликами и целью. Продумай разгадку заранее; не меняй факты задним числом. Проверяй возражения по реплике, улике и объяснению. Секреты не включай в команды. Из сохранения восстанови героя, сцену и известное; не начинай заново.

ФОРМАТ
Каждый ответ — один блок кода dgp. Каждая команда: DGP| и строгий JSON на ОДНОЙ физической строке. Двойные кавычки; без комментариев, лишних запятых и внешнего массива. Переносы в строке: \n. В репликах нет HTML, кода, URL или Markdown. Внеигровые пояснения — say рассказчика.
Команды:
scene: каждый ответ начинай полным снимком background,location,chapter,mode,objective,player,cast,evidence,hotspots,summary,audio. mode=daily/investigation/trial. player={"id":"ID героя","name":"Имя","sprite":"neutral"}; до выбора null. Меняй sprite героя по эмоции; talking — при его реплике. Герой видит мир от первого лица. cast — только видимые NPC (до 3 объектов {"id":"ID","sprite":"neutral"}), без героя; никого нет — []. При смене комнаты перечисли NPC заново. evidence — все раскрытые улики {"id":"note","title":"Название","description":"Факты"} (до 60); [] очищает список. Неизвестный фон — "".
hotspots: до 12 объектов/проходов {"id":"door","label":"Дверь","action":"Осматриваю дверь","kind":"inspect","x":85,"y":50}; kind=inspect/talk/go; координаты — проценты. Без координат объект доступен в «Осмотре». Не раскрывай скрытые улики до осмотра; при смене комнаты обновляй список. summary — до 1600 символов: герой, спойлеры, решения, раскрытая история; обновляй по ходу игры.
audio в scene: {"game":"dr1","music":"daily","ambience":"none"}. game=dr1/dr2/drv3; music=none/daily/morning/tension/mystery/sad/investigation/trial/debate/climax/monokuma по ситуации. ambience=none/room/wind/rain/sea; только реально слышимое окружение. Меняй музыку при смене настроения, не на каждой реплике. say.sound=evidence/objection только в момент события, иначе none.
profile: при знакомстве и новых фактах ДО соответствующего say отправляй полный снимок id,name,talent,facts,relationship. Только раскрытое игроку; неизвестное = "". facts — накопленные факты до 1200 символов, relationship — реальные события отношений, не скрытые мысли. ID из каталога. При продолжении из сохранения восстанови известные profile.
say: who=ID персонажа; для рассказчика/героя без спрайта who="". name=русское имя; text=реплика до 2000 символов; sprite=neutral/talking/happy/sad/angry/surprised/thinking/determined по смыслу реплики; effect=none/shake/flash/objection. Голос за кадром не добавляй в cast. При входе/выходе NPC отправь scene с новым cast ДО реплики. Рассказчик — who="",name="Рассказчик"; не подставляй NPC вместо героя. Эффекты редки.
evidence: добавить/обновить улику через id,title,description; удалить через id,remove:true. Ставь перед объявляющей её репликой и включай в следующий снимок scene. ID улики постоянен.
choices: в конце ответа items=[{"label":"Кнопка","text":"Полное действие игрока"}], максимум 6. Нажатие кнопки отправляет выбранное действие в этот чат.

Пример строки:
\x60\x60\x60dgp
DGP|{"type":"say","who":"","name":"Рассказчик","text":"Дверь закрыта."}
\x60\x60\x60

РЕСУРСЫ
Каталог: 65 персонажей, 147 фонов. ID не выдумывай. sprite — только эмоция; случайную позу выбирает плагин. Для нового героя who="",name=его имя. Если локации нет, background="" и описание; условный фон только по согласию. UDG и S без своих фонов. Не смешивай части без согласия.
ПЕРСОНАЖИ: ID = префикс строки + "." + имя из списка.
`.replaceAll(String.raw`\x60`, '`');
const parts = [rules];
for (const game of ['dr1', 'dr2', 'drv3', 'udg', 'custom']) {
  parts.push(game + ': ' + characters.filter(c => c.id.startsWith(game + '.')).map(c => c.id.split('.')[1]).join(',') + '\n');
}
const replacements = [
  [' — ', ':'], ['Комната общежития:вариант ', 'Общежитие '], ['Комната общежития:дверь', 'Общежитие:дверь'],
  ['Зал суда:первый вариант', 'Суд 1'], ['Зал суда:второй вариант', 'Суд 2'], ['Зал суда:третий вариант', 'Суд 3'],
  ['Зал суда:четвёртый вариант', 'Суд 4'], ['Зал суда:пятый вариант', 'Суд 5'], ['Зал суда:шестой вариант', 'Суд 6'],
  ['Финальный зал суда:другой ракурс', 'Финальный суд:ракурс 2'], ['Финальный зал суда', 'Финальный суд'],
  ['Старый корпус', 'Ст.корпус'], ['старого корпуса', 'ст.корпуса'], ['Клубничный дом', 'Клубн.дом'],
  ['Виноградный дом', 'Виногр.дом'], ['Домик у пляжа', 'Пляжный дом'], ['проход к башне', 'к башне'],
  ['Помещение с оборудованием', 'Оборудование'], ['Коридор с металлической дверью', 'Коридор:металл.дверь'],
  ['Кладовая с садовым инвентарём', 'Садовый склад'], ['Комната с игровыми автоматами', 'Игровые автоматы'],
  ['Академия:холл первого этажа', 'Холл 1 эт.'], ['Комната отдыха', 'Отдых'], ['Компьютерная комната', 'Компьютерная'],
  ['Лаборатория ', 'Лаб. '], ['Пустое белое помещение', 'Белая комната'], ['Холодильное хранилище', 'Холодильник'],
  ['Комната управления', 'Управление'], ['Комната совещаний', 'Совещания'], ['Подсобное помещение', 'Подсобка'],
  ['боковой вид', 'сбоку'], ['вид сверху', 'сверху'], ['следы расследования', 'следы'], ['надпись на доске', 'надпись'],
];
parts.push('\nФОНЫ. DR1: номер NNN означает dr1.bgd-NNNout; DR2: dr2.bgd-NNN. Сохраняй ведущие нули. V3: к ключу добавляй drv3.\n');
for (const game of ['dr1', 'dr2', 'drv3']) {
  const entries = backgrounds.filter(b => b.game === game).map(b => {
    let name = b.name;
    for (const [from, to] of replacements) name = name.replaceAll(from, to);
    const key = b.id.slice(game.length + 1).replace(/^bgd-/, '').replace(/out$/, '');
    return `${key}=${name}`;
  });
  parts.push(`${game}: ${entries.join('; ')}\n`);
}
const output = parts.join('');
const windowsLength = output.replaceAll('\n', '\r\n').length;
if (windowsLength > 7900) throw new Error(`Prompt exceeds budget: ${windowsLength} characters with CRLF`);
fs.writeFileSync(path.join(root, 'instructions/CHATGPT_PROJECT_INSTRUCTIONS.txt'), output, 'utf8');
console.log(JSON.stringify({characters: output.length, withWindowsLineEndings: windowsLength, characterIDs: characters.length, backgrounds: backgrounds.length}));
