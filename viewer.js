(() => {
  'use strict';
  const root = document.getElementById('family-viewer');
  const q = selector => root.querySelector(selector);
  const days = JSON.parse(document.getElementById('reports').textContent);
  const storageKey = 'little-days-viewer-v1';
  const indexForId = id => days.findIndex(day => day.id === id || day.sourceIds.includes(id));
  if (!days.length) {
    q('.date-heading').textContent = '아직 보관된 기록이 없어요.';
    q('.date-heading').classList.add('empty');
    ['.photos', '.letter', '.bottom'].forEach(selector => q(selector).hidden = true);
    return;
  }

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
  const hashIndex = indexForId(location.hash.slice(1));
  const savedIndex = indexForId(saved.id);
  let dayIndex = hashIndex >= 0 ? hashIndex : savedIndex >= 0 ? savedIndex : days.length - 1;
  let largeText = saved.largeText === true;
  let photoIndex = 0;
  let activeDialog = null;
  let returnFocus = null;
  let closingHistory = false;
  let afterClose = null;
  let scale = 1, panX = 0, panY = 0;
  let gesture = null, lastTap = 0;
  const pointers = new Map();
  const stage = q('.zoom-stage');
  const zoomImage = q('.zoom-img');
  const retry = document.createElement('button');
  retry.className = 'zoom-retry';
  retry.textContent = '사진 다시 불러오기';
  retry.hidden = true;
  stage.append(retry);
  const preloaded = new Set();

  function remember() {
    try { localStorage.setItem(storageKey, JSON.stringify({ id: days[dayIndex].id, largeText })); } catch {}
  }
  function updateAddress() {
    try {
      history.replaceState({ ...history.state, albumDay: days[dayIndex].id }, '', '#' + days[dayIndex].id);
    } catch {}
  }
  function updateFont() {
    q('.copy').classList.toggle('large', largeText);
    const label = largeText ? '글씨 작게' : '글씨 크게';
    q('.font-button').setAttribute('aria-label', label);
    q('.font-button').title = label;
    q('.font-button').setAttribute('aria-pressed', String(largeText));
  }
  function renderDay() {
    const day = days[dayIndex];
    const date = new Date(day.date + 'T12:00:00');
    const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'long' }).format(date);
    q('.date-label').textContent = `${day.className} 알림장 · ${day.date.replaceAll('-', '.')}(${weekday})`;
    q('.copy').textContent = day.content;
    q('.sign').textContent = day.className + '에서 보내온 알림장';
    q('.day-prev').disabled = dayIndex === 0;
    q('.day-next').disabled = dayIndex === days.length - 1;
    const shortDate = record => {
      if (!record) return '—';
      const name = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(new Date(record.date + 'T12:00:00'));
      return `${record.date.slice(5).replace('-', '.')}(${name})`;
    };
    const previous = days[dayIndex - 1], next = days[dayIndex + 1];
    q('.prev-date').textContent = shortDate(previous);
    q('.current-date').textContent = shortDate(day);
    q('.next-date').textContent = shortDate(next);
    q('.day-prev').setAttribute('aria-label', previous ? `${previous.date} 이전 알림장` : '이전 알림장 없음');
    q('.day-next').setAttribute('aria-label', next ? `${next.date} 다음 알림장` : '다음 알림장 없음');
    q('.find').setAttribute('aria-label', `${day.date} 날짜 선택`);
    q('.find').title = '날짜 선택';
    updateFont();
    const strip = q('.photos');
    strip.replaceChildren();
    strip.hidden = !day.photos.length;
    day.photos.forEach((photo, index) => {
      const button = document.createElement('button');
      button.className = 'photo-button';
      button.setAttribute('aria-label', `사진 ${index + 1} 크게 보기`);
      const image = new Image();
      image.alt = `${day.date} 사진 ${index + 1}`;
      image.draggable = false;
      image.decoding = 'async';
      const open = () => openPhoto(index, button);
      const load = () => {
        button.classList.remove('failed');
        button.replaceChildren(image);
        button.onclick = open;
        image.src = photo.thumbnail;
      };
      image.onerror = () => {
        button.classList.add('failed');
        button.textContent = '사진 다시 불러오기';
        button.onclick = load;
      };
      load();
      strip.append(button);
    });
    const videos = q('.videos');
    videos.replaceChildren();
    videos.hidden = !day.videos.length;
    day.videos.forEach(src => {
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'none';
      video.src = src;
      videos.append(video);
    });
    document.title = `${day.date} · 작은 날의 기록`;
    updateAddress();
  }
  function selectDay(index) {
    if (index < 0 || index >= days.length) return;
    q('.videos').querySelectorAll('video').forEach(video => video.pause());
    dayIndex = index;
    photoIndex = 0;
    renderDay();
    window.scrollTo({ top: 0, behavior: 'instant' });
    remember();
  }
  function openDialog(name, trigger) {
    if (activeDialog || closingHistory) return false;
    returnFocus = trigger;
    activeDialog = name;
    q('.' + name).showModal();
    document.body.style.overflow = 'hidden';
    try { history.pushState({ ...history.state, albumOverlay: name }, ''); } catch {}
    q(name === 'dates' ? '.close-dates' : '.close-zoom').focus();
    return true;
  }
  function finishClose() {
    if (activeDialog) {
      q('.' + activeDialog).close();
      activeDialog = null;
    }
    pointers.clear();
    gesture = null;
    lastTap = 0;
    document.body.style.overflow = '';
    returnFocus?.focus({ preventScroll: true });
    closingHistory = false;
    const callback = afterClose;
    afterClose = null;
    callback?.();
  }
  function closeDialog(callback) {
    if (!activeDialog || closingHistory) return;
    afterClose = typeof callback === 'function' ? callback : null;
    if (history.state?.albumOverlay) {
      closingHistory = true;
      history.back();
    } else finishClose();
  }
  function openDates(trigger) {
    if (activeDialog || closingHistory) return;
    const list = q('.month-list');
    list.replaceChildren();
    const months = new Map();
    days.forEach((day, index) => {
      const month = day.date.slice(0, 7);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push({ day, index });
    });
    [...months].reverse().forEach(([month, records]) => {
      const details = document.createElement('details');
      details.open = month === days[dayIndex].date.slice(0, 7);
      const summary = document.createElement('summary');
      summary.textContent = `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월 · ${records.length}일`;
      const buttons = document.createElement('div');
      buttons.className = 'month-days';
      records.forEach(({ day, index }) => {
        const button = document.createElement('button');
        button.dataset.dayId = day.id;
        button.setAttribute('aria-label', day.date + ' 알림장');
        if (index === dayIndex) button.setAttribute('aria-current', 'date');
        const label = document.createElement('span');
        label.textContent = Number(day.date.slice(8)) + '일';
        const weekday = document.createElement('small');
        weekday.textContent = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(new Date(day.date + 'T12:00:00'));
        button.append(label, weekday);
        button.onclick = () => closeDialog(() => selectDay(index));
        buttons.append(button);
      });
      details.addEventListener('toggle', () => {
        if (details.open) list.querySelectorAll('details').forEach(other => {
          if (other !== details) other.open = false;
        });
      });
      details.append(summary, buttons);
      list.append(details);
    });
    if (openDialog('dates', trigger)) {
      requestAnimationFrame(() => {
        const current = list.querySelector('[aria-current=date]');
        const details = current?.closest('details');
        if (details) list.scrollTop = Math.max(0, details.offsetTop - list.offsetTop);
      });
    }
  }
  function transform() {
    if (activeDialog !== 'zoom') return;
    const photo = days[dayIndex].photos[photoIndex];
    const width = stage.clientWidth, height = stage.clientHeight;
    const ratio = photo.width / photo.height;
    const fitWidth = Math.min(width, height * ratio);
    const fitHeight = Math.min(height, width / ratio);
    const maxX = Math.max(0, (fitWidth * scale - width) / 2);
    const maxY = Math.max(0, (fitHeight * scale - height) / 2);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
    zoomImage.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    q('.zoom-toggle').textContent = scale > 1 ? '전체 보기 －' : '더 크게 ＋';
  }
  function resetZoom() {
    scale = 1;
    panX = panY = 0;
    transform();
  }
  function zoomAt(next, clientX, clientY) {
    const bounds = stage.getBoundingClientRect();
    const x = clientX - bounds.left - bounds.width / 2;
    const y = clientY - bounds.top - bounds.height / 2;
    const ratio = next / scale;
    panX = x - (x - panX) * ratio;
    panY = y - (y - panY) * ratio;
    scale = next;
    transform();
  }
  function preloadAdjacent() {
    const photos = days[dayIndex].photos;
    [photoIndex - 1, photoIndex + 1].forEach(index => {
      const src = photos[index]?.src;
      if (!src || preloaded.has(src)) return;
      preloaded.add(src);
      const image = new Image();
      image.onerror = () => preloaded.delete(src);
      image.src = src;
    });
  }
  function renderPhoto() {
    const day = days[dayIndex];
    const photo = day.photos[photoIndex];
    retry.hidden = true;
    stage.classList.add('loading');
    stage.setAttribute('aria-busy', 'true');
    zoomImage.alt = `${day.date} 사진 ${photoIndex + 1}`;
    zoomImage.src = photo.src;
    q('.zoom-count').textContent = `${day.date} · ${photoIndex + 1} / ${day.photos.length}`;
    q('.zoom-prev').disabled = photoIndex === 0;
    q('.zoom-next').disabled = photoIndex === day.photos.length - 1;
    resetZoom();
    preloadAdjacent();
  }
  function openPhoto(index, trigger) {
    if (!openDialog('zoom', trigger)) return;
    photoIndex = index;
    lastTap = 0;
    renderPhoto();
  }
  function movePhoto(delta) {
    const index = photoIndex + delta;
    if (index < 0 || index >= days[dayIndex].photos.length) return;
    photoIndex = index;
    lastTap = 0;
    renderPhoto();
  }
  zoomImage.onload = () => {
    stage.classList.remove('loading');
    stage.setAttribute('aria-busy', 'false');
    transform();
  };
  zoomImage.onerror = () => {
    stage.classList.remove('loading');
    stage.setAttribute('aria-busy', 'false');
    retry.hidden = false;
  };
  retry.onclick = renderPhoto;
  q('.day-prev').onclick = () => selectDay(dayIndex - 1);
  q('.day-next').onclick = () => selectDay(dayIndex + 1);
  q('.find').onclick = event => openDates(event.currentTarget);
  q('.date-button').onclick = event => openDates(event.currentTarget);
  q('.font-button').onclick = () => { largeText = !largeText; updateFont(); remember(); };
  q('.close-dates').onclick = q('.close-zoom').onclick = () => closeDialog();
  q('.zoom-prev').onclick = () => movePhoto(-1);
  q('.zoom-next').onclick = () => movePhoto(1);
  q('.zoom-toggle').onclick = () => {
    if (scale > 1) resetZoom();
    else {
      const bounds = stage.getBoundingClientRect();
      zoomAt(2, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    }
  };
  ['dates', 'zoom'].forEach(name => q('.' + name).addEventListener('cancel', event => {
    event.preventDefault();
    closeDialog();
  }));
  stage.onpointerdown = event => {
    if (event.target === retry) return;
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) gesture = { x: event.clientX, y: event.clientY, panX, panY, moved: false, pinch: false };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale, pinch: true, moved: true };
    }
  };
  stage.onpointermove = event => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(Math.max(1, Math.min(4, gesture.scale * distance / Math.max(1, gesture.distance))), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (!gesture.pinch) {
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (Math.hypot(dx, dy) > 8) gesture.moved = true;
      if (scale > 1) { panX = gesture.panX + dx; panY = gesture.panY + dy; transform(); }
    }
  };
  function endPointer(event, cancel = false) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size || !gesture) return;
    if (!cancel && !gesture.pinch) {
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (scale === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) movePhoto(dx < 0 ? 1 : -1);
      else if (!gesture.moved) {
        const now = Date.now();
        if (now - lastTap < 320) {
          if (scale > 1) resetZoom();
          else zoomAt(2, event.clientX, event.clientY);
          lastTap = 0;
        } else lastTap = now;
      }
    }
    gesture = null;
  }
  stage.onpointerup = event => endPointer(event);
  stage.onpointercancel = event => endPointer(event, true);
  root.addEventListener('keydown', event => {
    if (activeDialog === 'zoom' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      movePhoto(event.key === 'ArrowRight' ? 1 : -1);
    }
  });
  window.addEventListener('popstate', () => {
    if (activeDialog || closingHistory) {
      finishClose();
      updateAddress();
      return;
    }
    // A forwarded overlay entry should behave like a normal day URL on reload.
    const index = indexForId(location.hash.slice(1));
    if (index >= 0 && index !== dayIndex) selectDay(index);
    if (history.state?.albumOverlay) {
      const { albumOverlay, ...state } = history.state;
      history.replaceState(state, '');
    }
  });
  window.addEventListener('hashchange', () => {
    if (activeDialog || closingHistory) return;
    const index = indexForId(location.hash.slice(1));
    if (index >= 0 && index !== dayIndex) selectDay(index);
  });
  window.addEventListener('resize', transform);
  // Reloading with a dialog history entry must not leave an invisible overlay state.
  if (history.state?.albumOverlay) {
    const { albumOverlay, ...state } = history.state;
    history.replaceState(state, '');
  }
  renderDay();
})();
