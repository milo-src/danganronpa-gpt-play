(() => {
  const base = new URL('../', location.href);
  const memory = {};
  globalThis.browser = {
    runtime: {getURL: path => new URL(path, base).href, getManifest: () => ({version: '0.4.3 · ДЕМО'}), onMessage: {addListener() {}}},
    storage: {local: {
      async get(key) {
        if (key.startsWith('dgp-session:')) return {[key]: {enabled: true}};
        return {[key]: memory[key]};
      },
      async set(values) { Object.assign(memory, values); }
    }}
  };
  const line = event => 'DGP|' + JSON.stringify(event) + '\n';
  const scene = {type: 'scene', background: 'dr1.bgd-008out', location: 'Класс · Академия «Пик Надежды»',
    chapter: 'Глава 01 / Первое наблюдение', mode: 'investigation', objective: 'Осмотреть класс и выяснить, кто оставил записку.',
    cast: [{id: 'dr1.makoto-naegi', sprite: 'default'}, {id: 'dr1.kyoko-kirigiri', sprite: 'default'}], evidence: []};
  const opening = [scene,
    {type: 'say', who: 'dr1.kyoko-kirigiri', name: 'Кёко Киригири', text: 'Не торопись с выводами. В этой комнате каждая мелочь может оказаться уликой.', effect: 'none'},
    {type: 'say', who: 'dr1.makoto-naegi', name: 'Макото Наэги', text: 'На столе лежит записка… Но кто мог оставить её здесь?', effect: 'none'},
    {type: 'choices', items: [{label: 'Осмотреть записку', text: 'Внимательно осматриваю записку на столе.'}, {label: 'Спросить Кёко', text: 'Спрашиваю Кёко, что показалось ей странным.'}]}];
  let count = 0, streamTimer;
  function add(events, stream = false) {
    clearInterval(streamTimer); document.querySelector('[data-testid="stop-button"]')?.remove();
    const article = document.createElement('article'); article.dataset.messageId = `demo-${++count}`;
    article.dataset.messageAuthorRole = 'assistant';
    const pre = document.createElement('pre'); const code = document.createElement('code'); pre.append(code); article.append(pre);
    document.getElementById('conversation').append(article);
    const text = events.map(line).join('');
    if (!stream) code.textContent = text;
    else {
      const stop = document.createElement('button'); stop.dataset.testid = 'stop-button'; stop.textContent = 'Остановить генерацию';
      document.querySelector('header').append(stop); let pos = 0;
      stop.addEventListener('click', () => { clearInterval(streamTimer); stop.remove(); });
      streamTimer = setInterval(() => {
        pos += 37; code.textContent = text.slice(0, pos);
        if (pos >= text.length) { clearInterval(streamTimer); stop.remove(); }
      }, 80);
    }
  }
  const setup = [
    {type: 'scene', background: '', cast: [], evidence: [], location: 'Главное меню', chapter: 'Новая игра', mode: 'daily'},
    {type: 'say', who: '', name: 'Рассказчик', text: 'Добро пожаловать в Danganronpa! Новая история ждёт своего героя.'},
    {type: 'say', who: '', name: 'Рассказчик', text: 'Где начнётся твоя история? Выбери часть или предложи свой вариант.'},
    {type: 'choices', items: [
      {label: 'Danganronpa 1 · Академия', text: 'Выбираю Danganronpa 1.'},
      {label: 'Danganronpa 2 · Остров', text: 'Выбираю Danganronpa 2.'},
      {label: 'Danganronpa V3', text: 'Выбираю Danganronpa V3.'},
      {label: 'Смешанная история', text: 'Выбираю смешанную историю.'}]}];
  const spriteDemo = [
    {type: 'scene', background: 'drv3.classroom1a', location: 'Класс A', chapter: 'Проверка диалоговых спрайтов', mode: 'daily',
      cast: [{id: 'drv3.kaede-akamatsu', sprite: 'default'}, {id: 'drv3.shuichi-saihara', sprite: 'default'}], evidence: []},
    {type: 'say', who: 'drv3.kaede-akamatsu', name: 'Каэдэ Акамацу', sprite: 'default', text: 'Я Каэдэ Акамацу. Давай попробуем разобраться вместе.'},
    {type: 'say', who: 'drv3.kaede-akamatsu', name: 'Каэдэ Акамацу', sprite: 'happy', text: 'Получилось! Теперь у нас есть зацепка.'},
    {type: 'say', who: 'drv3.shuichi-saihara', name: 'Шуити Сайхара', sprite: 'thinking', text: 'Подожди. Нужно проверить, что означает эта запись.'},
    {type: 'say', who: 'drv3.kaede-akamatsu', name: 'Каэдэ Акамацу', sprite: 'surprised', text: 'Что? Значит, дверь уже была открыта?'},
    {type: 'say', who: 'drv3.kaede-akamatsu', name: 'Каэдэ Акамацу', sprite: 'sad', text: 'Жаль, что мы не заметили этого раньше.'}
  ];
  const params = new URLSearchParams(location.search);
  const emptyRoomDemo = [
    {type: 'scene', background: 'drv3.classroom1a', location: 'Класс A', chapter: 'Проверка перехода', mode: 'daily',
      player: {id: 'drv3.shuichi-saihara', name: 'Шуити Сайхара'}, cast: [{id: 'drv3.kaede-akamatsu'}]},
    {type: 'say', who: 'drv3.kaede-akamatsu', name: 'Каэдэ Акамацу', text: 'Я останусь в классе.'},
    {type: 'scene', background: 'drv3.1f', location: 'Холл первого этажа'},
    {type: 'say', who: '', name: 'Рассказчик', text: 'Ты выходишь из класса. В холле никого нет; Каэдэ осталась за дверью.'},
    {type: 'choices', items: [{label: 'Осмотреть холл', text: 'Осматриваю холл.'}]}
  ];
  const featureScene = {...scene, player: {id: 'dr1.makoto-naegi', name: 'Макото Наэги'}, cast: [{id: 'dr1.kyoko-kirigiri', sprite:'thinking'}],
    summary: 'Макото и Кёко осматривают класс. Игрок нашёл записку с исправленным временем. Канонические спойлеры запрещены.',
    hotspots: [{id:'desk',label:'Стол с запиской',action:'Осматриваю стол и сравниваю чернила на записке.',kind:'inspect',x:25,y:70},
      {id:'door',label:'Дверь класса',action:'Проверяю дверь класса.',kind:'go',x:85,y:45}],
    evidence: [{id:'note',title:'Записка со временем',description:'18:00 исправлено на 19:00 другими чернилами.'}]};
  const featureDemo = [featureScene,
    {type:'profile',id:'dr1.kyoko-kirigiri',name:'Кёко Киригири',talent:'',facts:'Осматривает класс вместе с тобой. Заметила разные чернила.',relationship:'Вы договорились сравнить наблюдения.'},
    {type:'say',who:'dr1.kyoko-kirigiri',name:'Кёко Киригири',sprite:'thinking',text:'На первый взгляд здесь указано 18:00. Но прежде чем сделать вывод, сравни чернила на столе.'},
    {type:'choices',items:[{label:'Проверить записку',text:'Сравниваю цифры на записке.'}]}];
  add(params.has('features') ? featureDemo : params.has('empty-room') ? emptyRoomDemo : params.has('sprites') ? spriteDemo : params.has('menu') ? setup : opening);
  document.getElementById('features-demo').addEventListener('click', () => add(featureDemo));
  document.getElementById('sprites-demo').addEventListener('click', () => add(spriteDemo));
  document.getElementById('stream-demo').addEventListener('click', () => add([
    {...scene, cast: [{id: 'dr1.kyoko-kirigiri', sprite: 'default'}], evidence: [{id: 'note', title: 'Записка на столе', description: 'Время встречи исправлено другим почерком.'}]},
    {type: 'say', who: 'dr1.kyoko-kirigiri', name: 'Кёко Киригири', text: 'Посмотри на цифры. Время встречи кто-то исправил. Теперь нужно узнать, кто видел оригинал.'},
    {type: 'choices', items: [{label: 'Сравнить почерк', text: 'Сравниваю почерк в записке с другими надписями.'}]}], true));
  document.getElementById('trial-demo').addEventListener('click', () => add([
    {...scene, mode: 'trial', background: 'dr1.bgd-009out', location: 'Зал классного суда', chapter: 'Классный суд / Проверка показаний', objective: 'Установить, когда исправили время в записке.',
      evidence: [{id: 'note', title: 'Записка на столе', description: 'Время встречи исправлено другим почерком.'}]},
    {type: 'say', who: 'dr1.makoto-naegi', name: 'Макото Наэги', text: 'Нет, здесь противоречие! Время на записке изменили — значит, кто-то хотел запутать нас.', effect: 'objection'},
    {type: 'say', who: 'dr1.kyoko-kirigiri', name: 'Кёко Киригири', text: 'Хорошее наблюдение. Теперь докажи, когда именно появилась правка.'},
    {type: 'choices', items: [{label: 'Предъявить записку', text: 'Предъявляю записку и указываю на исправленное время.'}]}]));
  document.getElementById('broken-demo').addEventListener('click', () => {
    const p = document.createElement('div'); p.dataset.messageAuthorRole = 'assistant'; p.textContent = 'DGP|{broken}\n';
    document.getElementById('conversation').append(p);
  });
  document.getElementById('reset-demo').addEventListener('click', () => location.reload());
  // Demo-only site behavior. The extension never intercepts native editor keys.
  document.getElementById('prompt-textarea').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); document.getElementById('demo-form').requestSubmit();
    }
  });
  document.getElementById('demo-form').addEventListener('submit', e => {
    e.preventDefault(); const input = document.getElementById('prompt-textarea');
    if (!(input.innerText || input.textContent).trim()) return;
    document.getElementById('demo-status').textContent = 'Локальное действие принято. Это демо, запросы в ChatGPT не отправляются.';
    const p = document.createElement('p'); p.dataset.messageAuthorRole = 'user'; p.textContent = (input.innerText || input.textContent);
    document.getElementById('conversation').append(p); input.replaceChildren();
    if (params.has('features')) add([featureScene,
      {type:'say',who:'dr1.kyoko-kirigiri',name:'Кёко Киригири',sprite:'determined',text:'Да, исходная запись была исправлена на 19:00. Это наблюдение следует сохранить. (Локальная демонстрация.)'},
      {type:'choices',items:[{label:'Проверить дверь',text:'Проверяю дверь класса.'}]}]);
    else document.getElementById('stream-demo').click();
  });
})();
