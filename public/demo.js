(() => {
  const base = new URL('../', location.href);
  const memory = {};
  globalThis.browser = {
    runtime: {getURL: path => new URL(path, base).href, getManifest: () => ({version: '0.3.0 · ДЕМО'}), onMessage: {addListener() {}}},
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
  add(opening);
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
    if (!input.textContent.trim()) return;
    document.getElementById('demo-status').textContent = 'Локальное действие принято. Это демо, запросы в ChatGPT не отправляются.';
    const p = document.createElement('p'); p.dataset.messageAuthorRole = 'user'; p.textContent = input.textContent;
    document.getElementById('conversation').append(p); input.replaceChildren();
    document.getElementById('stream-demo').click();
  });
})();
