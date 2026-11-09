(() => {
  'use strict';
  const D = globalThis.DGP;
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  D.installExtras = (p, controls) => {
    const sound = new D.Sound({url: p.url}); let currentMode = 'daily', epoch = 0, imported = null;
    for (const [layer, media] of Object.entries({music: sound.audio, ambience: sound.ambient, typing: sound.tick, effect: sound.fx})) {
      media.hidden = true; media.dataset.audioLayer = layer; p.shadow.append(media);
    }
    p.notes = '';
    const action = (label, text) => p.button(label, () => { p.actions.onDraft(text); }, 'game-action');
    const syncSound = () => {
      sound.configure(p.settings, p.enabled && !p.collapsed && !document.hidden, p.currentState || {mode: currentMode});
      audioButton.textContent = p.settings.sound ? 'Звук: вкл' : 'Звук: выкл';
    };
    const audioButton = p.button('Звук: выкл', async () => {
      if (p.settings.sound) { p.actions.onSettings({sound: false}); syncSound(); return; }
      await sound.unlock();
      p.actions.onSettings({sound: true}); syncSound();
      if (!sound.catalog && !Object.keys(sound.tracks).length) {
        p.notice('Локальный аудиопак не найден. Импортируй его из установленных игр или добавь свой файл в настройках.');
        p.toggleDrawer('settings');
      }
    });
    controls.prepend(p.button('Осмотр', () => p.toggleDrawer('inspect')), p.button('Справочник', () => p.toggleDrawer('handbook')),
      p.button('Сохранение', () => p.toggleDrawer('save')));
    controls.append(audioButton);
    sound.onError = message => p.notice(message);
    sound.load().then(() => {
      syncSound();
      if (!p.drawer.hidden && p.drawerName === 'settings') p.drawSettings();
    });
    const markers = el('div', null, 'hotspots'); p.stage.append(markers);
    const objectDetail = (title, text) => {
      p.drawerName = 'inspect'; p.drawer.hidden = false; p.renderDrawer();
      const card = el('article', null, 'object-detail'); card.append(el('h3', title), action('Выполнить действие', text)); p.drawer.append(card);
    };
    const trialButton = p.button('Возразить / предъявить', () => p.toggleDrawer('trial'), 'trial-action');
    p.dialogue.querySelector('.dialogue-actions').prepend(trialButton); trialButton.hidden = true;
    const download = (text, filename, type) => {
      const url = URL.createObjectURL(new Blob([text], {type})); const link = el('a'); link.href = url; link.download = filename;
      p.shadow.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    const render = name => {
      const state = p.currentState || {}, profiles = state.profiles || [];
      if (name === 'inspect') {
        p.drawer.append(el('p', state.location || 'Сцена ещё не началась', 'objective'));
        for (const c of state.cast || []) {
          const who = profiles.find(x => x.id === c.id)?.name || D.assets.characters[c.id]?.name || c.id;
          p.drawer.append(action(`Поговорить: ${who}`, `Обращаюсь к ${who} (${c.id}). Начинаю разговор, не решай мой ответ за меня.`));
        }
        for (const h of state.hotspots || []) p.drawer.append(action(`${{inspect:'Осмотреть',talk:'Поговорить',go:'Перейти'}[h.kind]}: ${h.label}`, h.action));
        if (!state.hotspots?.length) p.drawer.append(el('p', 'Объекты появятся, когда ведущий опишет доступные места для осмотра.'));
        p.drawer.append(action('Осмотреться вокруг', 'Осматриваюсь вокруг. Опиши только видимые объекты и доступные проходы; укажи их в scene.hotspots, не раскрывая скрытых улик.'));
        return true;
      }
      if (name === 'handbook') {
        p.drawer.append(el('p', state.objective || 'Цель ещё не задана', 'objective'));
        if (state.summary) p.drawer.append(el('h3', 'Известная история'), el('p', state.summary));
        if (!profiles.length) p.drawer.append(el('p', 'Здесь появятся персонажи, с которыми ты познакомился. Скрытых биографий и спойлеров нет.'));
        for (const person of profiles.filter(person => person.id !== state.player?.id)) {
          const card = el('article', null, 'profile-card'); const sprite = D.resolveSprite(person.id, 'neutral');
          const image = el('img'); image.src = p.url(sprite.path); image.alt = ''; image.loading = 'lazy';
          card.append(image, el('h3', person.name), el('p', person.talent || 'Талант ещё не раскрыт'),
            el('p', person.facts || 'Дополнительные факты ещё не известны.'));
          if (person.relationship) card.append(el('p', `Отношения: ${person.relationship}`));
          p.drawer.append(card);
        }
        const label = el('label', 'Мои заметки'); const notes = el('textarea'); notes.rows = 5; notes.maxLength = 8000; notes.value = p.notes;
        notes.setAttribute('aria-label', 'Мои заметки'); notes.placeholder = 'Твои наблюдения и версии. Сохраняются для этого чата.';
        notes.addEventListener('input', () => { p.notes = notes.value; p.actions.onNotes?.(notes.value); });
        label.append(notes); p.drawer.append(label); return true;
      }
      if (name === 'trial') {
        const lines = (p.meta?.history || []).filter(d => d.who && d.who !== state.player?.id).slice(-20), evidence = state.evidence || [];
        p.drawer.append(el('p', 'Выбери конкретную реплику, улику и объясни противоречие. Ведущий проверит его по фактам.'));
        if (!lines.length || !evidence.length) { p.drawer.append(el('p', 'Нужны уже прочитанная реплика собеседника и хотя бы одна найденная улика.')); return true; }
        const statements = el('select'); statements.setAttribute('aria-label', 'Утверждение');
        lines.forEach((d, i) => { const option = el('option', `${d.name || D.assets.characters[d.who]?.name}: ${d.text.slice(0, 130)}`); option.value = i; statements.append(option); });
        statements.value = String(lines.length - 1);
        const bullets = el('select'); bullets.setAttribute('aria-label', 'Улика');
        evidence.forEach((e, i) => { const option = el('option', e.title); option.value = i; bullets.append(option); });
        const quote = el('blockquote'), facts = el('p');
        const update = () => { quote.textContent = lines[Number(statements.value)].text; facts.textContent = evidence[Number(bullets.value)].description; };
        statements.addEventListener('change', update); bullets.addEventListener('change', update); update();
        const reason = el('textarea'); reason.rows = 4; reason.maxLength = 1000; reason.setAttribute('aria-label', 'В чём противоречие'); reason.placeholder = 'Объясни, почему улика противоречит этой реплике…';
        const submit = p.button('ВОЗРАЖЕНИЕ!', () => {
          try { const message = D.features.objection(lines[Number(statements.value)], evidence[Number(bullets.value)], reason.value); sound.effect('objection'); p.actions.onDraft(message, {longAction: true}); }
          catch (error) { p.notice(error.message); reason.focus(); }
        }, 'game-action objection-button');
        p.drawer.append(el('label', 'Утверждение'), statements, quote, el('label', 'Улика'), bullets, facts, reason, submit); return true;
      }
      if (name === 'save') {
        p.drawer.append(el('p', 'Сохранение включает текущую прочитанную сцену, улики, знакомых персонажей, заметки и последние 60 реплик. Скрытые планы модели и непрочитанные события в него не входят.'));
        const create = () => D.features.snapshot(p.currentState || {}, p.meta?.history || [], p.notes);
        const exportJson = p.button('Скачать сохранение (.json)', () => download(JSON.stringify(create(), null, 2), 'danganronpa-save.json', 'application/json'));
        exportJson.disabled = !state.dialogue;
        const exportText = p.button('Скачать текст для нового чата', () => { try { download(D.features.continuation(create()), 'danganronpa-continue.txt', 'text/plain;charset=utf-8'); } catch (error) { p.notice(error.message); } });
        exportText.disabled = !state.dialogue;
        const askSummary = action('Обновить краткую историю', 'Обнови summary текущей сцены: краткая история, выбор героя, режим спойлеров, текущие цели и только уже раскрытые факты. Не продолжай время, не раскрывай секреты; ответь полным scene и коротким say в DGP.');
        const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', 'Загрузить сохранение');
        const error = el('p'); error.setAttribute('role', 'status');
        file.addEventListener('change', async () => {
          const selected = file.files?.[0], startEpoch = epoch; if (!selected) return;
          try {
            if (selected.size > 2000000) throw Error('Файл слишком большой. Выбери сохранение DGP размером до 2 МБ.');
            const candidate = D.features.readSave(await selected.text()); if (startEpoch !== epoch) return;
            imported = candidate; p.renderDrawer();
          } catch (e) { error.textContent = e.message; }
        });
        p.drawer.append(exportJson, exportText, askSummary, el('h3', 'Продолжить из файла'), file, error);
        if (imported) {
          p.drawer.append(el('p', `${imported.scene.player?.name || 'Герой не указан'} · ${imported.scene.location} · Улик: ${imported.scene.evidence?.length || 0}`));
          const preview = el('textarea'); preview.readOnly = true; preview.rows = 8; preview.setAttribute('aria-label', 'Предпросмотр сохранения');
          try { preview.value = D.features.continuation(imported); } catch (e) { error.textContent = e.message; return true; }
          p.drawer.append(preview, p.button('Продолжить в этом чате', () => {
            p.actions.onNotes?.(imported.notes); p.notes = imported.notes;
            p.actions.onDraft(preview.value, {longAction: true});
          }, 'game-action'), el('p', 'Кнопка отправит показанный текст в открытый чат. Для новой истории сначала открой новый чат нужного проекта и включи дополнение.'));
        }
        return true;
      }
      return false;
    };
    const settings = () => {
      const box = el('section');
      box.append(el('h3', 'Оригинальный звук'), el('p', sound.catalog
        ? 'Подключён локальный аудиопак из игр. Часть и музыка выбираются по сцене; ниже можно заменить отдельные треки своими файлами.'
        : 'Аудиопак не найден. scripts/import-game-audio.py импортирует звук из установленных Steam-игр. Можно выбрать собственные файлы ниже.'));
      const playing = sound.record();
      box.append(el('p', `Сейчас: ${sound.game.toUpperCase()} · ${playing?.name || 'тишина'}`));
      const games = el('select'), cues = el('select');
      games.setAttribute('aria-label', 'Часть игры для настройки звука'); cues.setAttribute('aria-label', 'Музыка или окружение');
      for (const [id, name] of [['dr1', 'Danganronpa 1'], ['dr2', 'Danganronpa 2'], ['drv3', 'Danganronpa V3']]) {
        const option = el('option', name); option.value = id; games.append(option);
      }
      games.value = sound.game;
      for (const [id, name] of Object.entries({daily:'Повседневность', morning:'Утро', tension:'Тревога', mystery:'Тайна', sad:'Печаль', investigation:'Расследование', trial:'Суд', debate:'Спор', climax:'Разгадка', monokuma:'Монокума'})) {
        const option = el('option', name); option.value = 'music:' + id; cues.append(option);
      }
      for (const [id, name] of Object.entries({room:'Помещение', wind:'Ветер', rain:'Дождь', sea:'Море'})) {
        const option = el('option', 'Окружение: ' + name); option.value = 'ambience:' + id; cues.append(option);
      }
      const file = el('input'); file.type = 'file'; file.accept = 'audio/*,.mp3,.ogg,.wav,.m4a'; file.setAttribute('aria-label', 'Заменить звук своим файлом');
      const selected = el('p');
      const slot = () => games.value + ':' + cues.value;
      const remove = p.button('Вернуть звук из игры', async () => {
        try { await sound.removeTrack(slot()); update(); syncSound(); }
        catch (error) { p.notice(error.message); }
      });
      const update = () => {
        const [layer, cue] = cues.value.split(':');
        const track = sound.tracks[slot()] || sound.catalog?.games?.[games.value]?.[layer]?.[cue];
        selected.textContent = track ? track.name : 'Не подключён: тишина';
        remove.disabled = !sound.tracks[slot()];
      };
      games.addEventListener('change', update); cues.addEventListener('change', update);
      file.addEventListener('change', async () => {
        if (!file.files?.[0]) return;
        const target = slot();
        try { await sound.setTrack(target, file.files[0]); update(); syncSound(); p.notice('Файл сохранён для выбранной части и ситуации.'); }
        catch (error) { p.notice(error.message); }
      });
      update(); box.append(games, cues, selected, file, remove);
      for (const [key, label] of [['musicVolume','Музыка'], ['typingVolume','Щелчки печати'], ['effectsVolume','Звуки событий'], ['ambientVolume','Окружение']]) {
        const row = el('label', label, 'setting'), input = el('input'); input.type = 'range'; input.min = 0; input.max = 100; input.value = Math.round((p.settings[key] ?? .25) * 100); input.setAttribute('aria-label', label);
        input.addEventListener('change', () => p.actions.onSettings({[key]: Number(input.value) / 100})); row.append(input); box.append(row);
      }
      return box;
    };
    p.extras = {render, settings, sound, syncSound,
      update() {
        const state = p.currentState; currentMode = state.mode; syncSound();
        audioButton.textContent = p.settings.sound ? 'Звук: вкл' : 'Звук: выкл';
        const cue = state.dialogue?.sound !== 'none' && state.dialogue?.sound || (state.dialogue?.effect === 'objection' ? 'objection' : '');
        // Typing is driven by visible letters, never by a scene command or rerender.
        if (cue && cue !== 'type') sound.effect(cue, p.meta?.key || JSON.stringify(state.dialogue));
        markers.replaceChildren();
        for (const h of state.hotspots || []) {
          if (h.x == null || h.y == null) continue;
          const button = p.button(h.label, () => objectDetail(h.label, h.action), 'hotspot');
          button.style.left = h.x + '%'; button.style.top = h.y + '%'; markers.append(button);
        }
        for (const figure of p.cast.children) {
          if (figure.classList.contains('leaving')) continue;
          if (figure.classList.contains('protagonist')) continue;
          if (figure.querySelector('button')) continue;
          const id = figure.dataset.character, name = state.profiles.find(x => x.id === id)?.name || D.assets.characters[id]?.name || id;
          const button = p.button(`Поговорить: ${name}`, () => objectDetail(name, `Обращаюсь к ${name} (${id}). Начинаю разговор.`), 'actor-talk');
          figure.append(button);
        }
        trialButton.hidden = !state.evidence.length || !(p.meta?.history || []).some(d => d.who && d.who !== state.player?.id);
      },
      reset() { epoch++; imported = null; sound.seen.clear(); p.notes = ''; markers.replaceChildren(); sound.stop(); },
      dispose() { epoch++; sound.dispose(); }
    };
  };
})();
