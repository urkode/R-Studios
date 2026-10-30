/* Microsoft Graph delegated mail flow. Client and tenant IDs are public identifiers, never secrets. */
(() => {
  const config = {
    clientId: '9f3c1549-65c6-4570-8ff9-1a25e8870689',
    tenantId: 'c3312dd5-4817-4059-a8cb-0e3fb0e0c77c',
    scopes: ['openid', 'profile', 'User.Read', 'Mail.Send', 'Mail.ReadWrite']
  };
  const recipients = [
    ['Morten', 'morten@rumag.com'], ['Lene', 'lene@rumag.com'], ['Geir', 'geir@rumag.com'],
    ['Vegard', 'vegard@rumag.com'], ['Toggi', 'toggi@rumag.com'], ['Ulrik', 'ulrik@rumag.com'],
    ['Sissel', 'sissel@rumag.com'], ['Tom-Kenneth', 'tom-kenneth@rumag.com'], ['Grethe', 'grethe@rumag.com']
  ].map(([name, email]) => ({ name, email }));
  const callbackType = 'r-skisse-entra-code';
  const stateKey = 'r-skisse-mail-state';
  const verifierKey = 'r-skisse-mail-verifier';
  const pendingKey = 'r-skisse-mail-pending';
  const accessTokenKey = 'r-skisse-graph-access-token';
  const accessTokenExpiryKey = 'r-skisse-graph-access-token-expiry';
  const scopeVersionKey = 'r-skisse-graph-scope-version';
  const scopeVersion = 'zip-attachments-v2';
  const maxDesignPngBytes = 3 * 1024 * 1024;
  const callback = new URLSearchParams(location.search);

  if (window.opener && callback.has('code') && callback.has('state')) {
    window.opener.postMessage({ type: callbackType, code: callback.get('code'), state: callback.get('state') }, location.origin);
    window.close();
    return;
  }

  const dialog = document.querySelector('#mailDialog');
  const sentSketchDialog = document.querySelector('#sentSketchDialog');
  const recipientList = document.querySelector('#mailRecipients');
  const filesList = document.querySelector('#mailFiles');
  const note = document.querySelector('#mailNote');
  const send = document.querySelector('#sendMailButton');
  const progress = document.querySelector('#mailProgress');
  const progressBar = document.querySelector('#mailProgressBar');
  const progressLabel = document.querySelector('#mailProgressLabel');
  const redirectUri = location.origin + location.pathname;
  const useRedirectLogin = window.matchMedia('(display-mode: standalone)').matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  let selectedRecipients = [];
  let token = null;
  let tokenExpiresAt = 0;
  let mailToastTimer = null;
  let sendingDotsTimer = null;

  const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const randomString = () => encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = async verifier => encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const readPending = () => { try { return JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch (_) { return null; } };
  const clearAuthAttempt = () => { sessionStorage.removeItem(stateKey); sessionStorage.removeItem(verifierKey); sessionStorage.removeItem(pendingKey); };
  const textBytes = value => new TextEncoder().encode(value);

  function microsoftStatus(ok) {
    const element = document.querySelector('#toast');
    if (!element) return;
    clearTimeout(mailToastTimer);
    element.textContent = ok ? 'Sendt!' : 'Feil!';
    element.style.background = ok ? '#137a45' : '#ae2634';
    element.classList.add('show');
    mailToastTimer = setTimeout(() => { element.classList.remove('show'); element.style.background = ''; }, 3500);
  }

  function cachedToken() {
    if (sessionStorage.getItem(scopeVersionKey) !== scopeVersion) {
      sessionStorage.removeItem(accessTokenKey);
      sessionStorage.removeItem(accessTokenExpiryKey);
      sessionStorage.setItem(scopeVersionKey, scopeVersion);
      return null;
    }
    const cached = sessionStorage.getItem(accessTokenKey);
    const expiresAt = Number(sessionStorage.getItem(accessTokenExpiryKey));
    if (cached && Number.isFinite(expiresAt) && Date.now() < expiresAt - 60000) {
      token = cached;
      tokenExpiresAt = expiresAt;
      return cached;
    }
    sessionStorage.removeItem(accessTokenKey);
    sessionStorage.removeItem(accessTokenExpiryKey);
    return null;
  }

  function cacheToken(accessToken, expiresIn) {
    token = accessToken;
    tokenExpiresAt = Date.now() + Number(expiresIn || 3600) * 1000;
    sessionStorage.setItem(accessTokenKey, token);
    sessionStorage.setItem(accessTokenExpiryKey, String(tokenExpiresAt));
    sessionStorage.setItem(scopeVersionKey, scopeVersion);
    return token;
  }

  function updateSendButton() {
    clearInterval(sendingDotsTimer);
    sendingDotsTimer = null;
    send.disabled = !selectedRecipients.length;
    send.textContent = selectedRecipients.length ? 'Send' : 'Velg mottaker';
  }

  function setProgress(percent, label) {
    progress.classList.remove('hidden');
    progressBar.style.width = Math.max(0, Math.min(100, percent)) + '%';
    progressLabel.textContent = label + ' · ' + Math.round(percent) + ' %';
  }

  function resetProgress() {
    progress.classList.add('hidden');
    progressBar.style.width = '0%';
  }

  function startSendingAnimation() {
    clearInterval(sendingDotsTimer);
    let dotCount = 0;
    const draw = () => {
      dotCount = (dotCount % 3) + 1;
      send.textContent = 'Sender' + '.'.repeat(dotCount);
    };
    draw();
    sendingDotsTimer = setInterval(draw, 420);
  }

  function pdfFiles() {
    return (window.getSavedSketches?.() || [])
      .filter(sketch => sketch.pdfBlob)
      .map(sketch => new File([sketch.mailPdfBlob || sketch.pdfBlob], sketchFileName(sketch, 'pdf'), { type: 'application/pdf' }));
  }

  function zipTime(date) {
    const safe = date instanceof Date ? date : new Date();
    return {
      time: (safe.getHours() << 11) | (safe.getMinutes() << 5) | Math.floor(safe.getSeconds() / 2),
      date: ((safe.getFullYear() - 1980) << 9) | ((safe.getMonth() + 1) << 5) | safe.getDate()
    };
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    let value = 0xffffffff;
    for (let index = 0; index < data.length; index += 1) value = crcTable[(value ^ data[index]) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function u16(view, offset, value) { view.setUint16(offset, value, true); }
  function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  /* PNG, JPEG and PDF data is already compressed. STORE makes a valid ZIP without altering the files. */
  async function createZip(entries) {
    const prepared = await Promise.all(entries.map(async entry => {
      const name = textBytes(entry.name);
      const content = new Uint8Array(await entry.file.arrayBuffer());
      return { name, content, crc: crc32(content), ...zipTime(entry.file.lastModified ? new Date(entry.file.lastModified) : new Date()) };
    }));
    const chunks = [];
    const centralDirectory = [];
    let offset = 0;
    prepared.forEach(entry => {
      const local = new Uint8Array(30 + entry.name.length);
      const view = new DataView(local.buffer);
      u32(view, 0, 0x04034b50); u16(view, 4, 20); u16(view, 6, 0x0800); u16(view, 8, 0);
      u16(view, 10, entry.time); u16(view, 12, entry.date); u32(view, 14, entry.crc);
      u32(view, 18, entry.content.length); u32(view, 22, entry.content.length); u16(view, 26, entry.name.length); u16(view, 28, 0);
      local.set(entry.name, 30);
      chunks.push(local, entry.content);
      const directory = new Uint8Array(46 + entry.name.length);
      const dirView = new DataView(directory.buffer);
      u32(dirView, 0, 0x02014b50); u16(dirView, 4, 20); u16(dirView, 6, 20); u16(dirView, 8, 0x0800); u16(dirView, 10, 0);
      u16(dirView, 12, entry.time); u16(dirView, 14, entry.date); u32(dirView, 16, entry.crc);
      u32(dirView, 20, entry.content.length); u32(dirView, 24, entry.content.length); u16(dirView, 28, entry.name.length);
      u16(dirView, 30, 0); u16(dirView, 32, 0); u16(dirView, 34, 0); u16(dirView, 36, 0); u32(dirView, 38, 0); u32(dirView, 42, offset);
      directory.set(entry.name, 46);
      centralDirectory.push(directory);
      offset += local.length + entry.content.length;
    });
    const centralSize = centralDirectory.reduce((total, part) => total + part.length, 0);
    const footer = new Uint8Array(22);
    const footerView = new DataView(footer.buffer);
    u32(footerView, 0, 0x06054b50); u16(footerView, 4, 0); u16(footerView, 6, 0);
    u16(footerView, 8, prepared.length); u16(footerView, 10, prepared.length); u32(footerView, 12, centralSize); u32(footerView, 16, offset); u16(footerView, 20, 0);
    return new Blob([...chunks, ...centralDirectory, footer], { type: 'application/zip' });
  }

  function imageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Kunne ikke lese originalbildet.'));
      image.src = dataUrl;
    });
  }

  function canvasBlob(canvas, type) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Kunne ikke lage PNG-fil.')), type));
  }

  function drawScaledImage(image, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return canvas;
  }

  async function originalPngFile(sketch) {
    const photoData = sketch.editorState?.photoData;
    if (!photoData) throw new Error('Originalbildet mangler for en skisse.');
    const image = await imageFromDataUrl(photoData);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    let width = sourceWidth;
    let height = sourceHeight;
    let blob = await canvasBlob(drawScaledImage(image, width, height), 'image/png');

    /* PNG has no adjustable quality setting. Reduce pixel dimensions until every
       design image is at most 3 MB, while preserving its aspect ratio. */
    for (let attempt = 0; blob.size > maxDesignPngBytes && attempt < 8; attempt += 1) {
      const scale = Math.max(0.1, Math.min(0.96, Math.sqrt((maxDesignPngBytes * 0.92) / blob.size)));
      const nextWidth = Math.max(320, Math.floor(width * scale));
      const nextHeight = Math.max(320, Math.floor(height * scale));
      if (nextWidth === width && nextHeight === height) break;
      width = nextWidth;
      height = nextHeight;
      blob = await canvasBlob(drawScaledImage(image, width, height), 'image/png');
    }
    if (blob.size > maxDesignPngBytes) throw new Error('Kunne ikke gjøre designbildet lite nok for e-post.');
    return new File([blob], sketchFileName(sketch, 'png'), { type: 'image/png' });
  }

  async function mailAttachments(onProgress = () => {}) {
    const sketches = window.getSavedSketches?.() || [];
    const pdfs = pdfFiles();
    if (!pdfs.length || pdfs.length !== sketches.length) throw new Error('PDF-filene er ikke klare ennå.');
    const pngs = [];
    onProgress(3, 'Klargjør PDF-filer');
    for (const [index, sketch] of sketches.entries()) {
      onProgress(4 + ((index / sketches.length) * 17), 'Klargjør designfil ' + (index + 1) + ' av ' + sketches.length);
      pngs.push(await originalPngFile(sketch));
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    if (sketches.length === 1) {
      onProgress(28, 'Vedlegg klare');
      return [pdfs[0], pngs[0]];
    }
    onProgress(22, 'Pakker PDF-filer');
    const pdfZip = await createZip(pdfs.map(file => ({ name: file.name, file })));
    onProgress(25, 'Pakker designfiler');
    const designZip = await createZip(pngs.map(file => ({ name: file.name, file })));
    onProgress(28, 'Vedlegg klare');
    return [
      new File([pdfZip], 'Befaringsskisser.zip', { type: 'application/zip' }),
      new File([designZip], 'Designfiler.zip', { type: 'application/zip' })
    ];
  }

  async function waitForAttachments() {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      try { return await mailAttachments(); } catch (_) { await new Promise(resolve => setTimeout(resolve, 125)); }
    }
    throw new Error('Vedleggene ble ikke klare.');
  }

  function addFileRow(name, description) {
    const row = document.createElement('div');
    row.className = 'mail-file';
    const label = document.createElement('span');
    label.className = 'mail-file-name';
    label.textContent = name;
    const detail = document.createElement('small');
    detail.className = 'mail-file-detail';
    detail.textContent = description;
    row.append(label, detail);
    return row;
  }

  function renderDialog() {
    selectedRecipients = [];
    updateSendButton();
    recipientList.replaceChildren(...recipients.map(person => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mail-recipient';
      button.textContent = person.name;
      button.onclick = () => {
        const isSelected = selectedRecipients.some(item => item.email === person.email);
        selectedRecipients = isSelected ? selectedRecipients.filter(item => item.email !== person.email) : [...selectedRecipients, person];
        button.classList.toggle('selected', !isSelected);
        updateSendButton();
      };
      return button;
    }));
    const sketches = window.getSavedSketches?.() || [];
    if (sketches.length === 1) {
      filesList.replaceChildren(
        addFileRow(sketchFileName(sketches[0], 'pdf'), 'PDF med tekst og tegning'),
        addFileRow(sketchFileName(sketches[0], 'png'), 'PNG uten redigering (maks 3 MB)')
      );
      return;
    }
    filesList.replaceChildren(
      addFileRow('Befaringsskisser.zip', sketches.length + ' PDF-filer med tekst og tegning'),
      addFileRow('Designfiler.zip', sketches.length + ' PNG-filer uten redigering (maks 3 MB per fil)')
    );
  }

  function openDialog() {
    if (!window.getSavedSketches?.().length) { toast('Ingen skisser er klare ennå.'); return; }
    renderDialog();
    resetProgress();
    document.body.classList.add('mail-dialog-open');
    dialog.classList.remove('hidden', 'is-closing');
  }

  function closeDialog(afterClose) {
    if (dialog.classList.contains('hidden')) { afterClose?.(); return; }
    const card = dialog.querySelector('.mail-card');
    document.body.classList.remove('mail-dialog-open');
    dialog.classList.add('is-closing');
    const done = event => {
      if (event.target !== card) return;
      dialog.classList.add('hidden');
      dialog.classList.remove('is-closing');
      card.removeEventListener('animationend', done);
      afterClose?.();
    };
    card.addEventListener('animationend', done);
  }

  function openSentSketchDialog() {
    document.body.classList.add('mail-dialog-open');
    sentSketchDialog.classList.remove('hidden', 'is-closing');
  }

  function closeSentSketchDialog() {
    sentSketchDialog.classList.add('hidden');
    sentSketchDialog.classList.remove('is-closing');
    document.body.classList.remove('mail-dialog-open');
  }

  async function authorisationUrl(verifier, state) {
    const codeChallenge = await challenge(verifier);
    const url = new URL('https://login.microsoftonline.com/' + config.tenantId + '/oauth2/v2.0/authorize');
    url.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope: config.scopes.join(' '), state, code_challenge: codeChallenge, code_challenge_method: 'S256' });
    return url.toString();
  }

  async function exchangeCode(code, verifier) {
    const body = new URLSearchParams({ client_id: config.clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: config.scopes.join(' ') });
    const response = await fetch('https://login.microsoftonline.com/' + config.tenantId + '/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || 'Microsoft-innloggingen feilet.');
    return cacheToken(data.access_token, data.expires_in);
  }

  async function getToken() {
    if (token && Date.now() < tokenExpiresAt - 60000) return token;
    if (cachedToken()) return token;
    const verifier = randomString();
    const state = randomString();
    const url = await authorisationUrl(verifier, state);
    if (useRedirectLogin) {
      sessionStorage.setItem(stateKey, state);
      sessionStorage.setItem(verifierKey, verifier);
      location.assign(url);
      return null;
    }
    const popup = window.open(url, 'r-skisse-entra', 'popup,width=480,height=720');
    if (!popup) throw new Error('Innloggingsvinduet ble blokkert. Tillat popup-vinduer og prøv igjen.');
    const code = await new Promise((resolve, reject) => {
      const stop = () => { window.removeEventListener('message', receive); clearInterval(closed); };
      const receive = event => {
        if (event.origin !== location.origin || event.data?.type !== callbackType || event.data.state !== state) return;
        stop();
        resolve(event.data.code);
      };
      const closed = setInterval(() => { if (popup.closed) { stop(); reject(new Error('Innloggingen ble avbrutt.')); } }, 350);
      window.addEventListener('message', receive);
    });
    return exchangeCode(code, verifier);
  }

  async function graph(url, accessToken, options = {}) {
    const response = await fetch('https://graph.microsoft.com/v1.0' + url, {
      ...options,
      headers: { Authorization: 'Bearer ' + accessToken, ...(options.headers || {}) }
    });
    if (response.ok) return response;
    const detail = await response.json().catch(() => ({}));
    const failure = new Error(detail.error?.message || 'Microsoft Graph kunne ikke sende e-posten.');
    failure.graphStatus = response.status;
    failure.graphCode = detail.error?.code || 'ukjent_feil';
    failure.graphDetail = detail;
    throw failure;
  }

  async function uploadAttachment(messageId, file, accessToken, onUploaded = () => {}) {
    if (file.size < 3 * 1024 * 1024) {
      const contentBytes = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Kunne ikke lese vedlegget.'));
        reader.readAsDataURL(file);
      });
      await graph('/me/messages/' + messageId + '/attachments', accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ '@odata.type': '#microsoft.graph.fileAttachment', name: file.name, contentType: file.type, contentBytes })
      });
      onUploaded(file.size);
      return;
    }
    const session = await graph('/me/messages/' + messageId + '/attachments/createUploadSession', accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachmentItem: { attachmentType: 'file', name: file.name, size: file.size, contentType: file.type } })
    }).then(response => response.json());
    const data = new Uint8Array(await file.arrayBuffer());
    const chunkSize = 3 * 320 * 1024;
    for (let start = 0; start < data.length; start += chunkSize) {
      const end = Math.min(data.length, start + chunkSize);
      const response = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Length': String(end - start), 'Content-Range': 'bytes ' + start + '-' + (end - 1) + '/' + data.length },
        body: data.slice(start, end)
      });
      if (!response.ok) throw new Error('Kunne ikke laste opp vedlegget til Microsoft.');
      onUploaded(end - start);
    }
  }

  async function sendWithToken(accessToken, attachments, destinationRecipients, noteText, onProgress = () => {}) {
    const body = noteText ? noteText + '\n\nVedlagte filer er laget i R Skisse.' : 'Vedlagte filer er laget i R Skisse.';
    onProgress(30, 'Oppretter e-post');
    const message = await graph('/me/messages', accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'Befaringsskisse', body: { contentType: 'Text', content: body }, toRecipients: destinationRecipients.map(person => ({ emailAddress: { address: person.email } })) })
    }).then(response => response.json());
    const totalBytes = attachments.reduce((total, file) => total + file.size, 0);
    let uploadedBytes = 0;
    for (const file of attachments) {
      await uploadAttachment(message.id, file, accessToken, bytes => {
        uploadedBytes += bytes;
        onProgress(30 + ((uploadedBytes / totalBytes) * 66), 'Laster opp filer');
      });
    }
    onProgress(97, 'Sender e-post');
    await graph('/me/messages/' + message.id + '/send', accessToken, { method: 'POST' });
    onProgress(100, 'Sendt');
  }

  function logFailure(error) {
    console.error('Microsoft Graph sendMail failed', { status: error.graphStatus || 'ikke tilgjengelig', code: error.graphCode || 'ikke tilgjengelig', message: error.message, detail: error.graphDetail || null });
    microsoftStatus(false);
  }

  async function sendMail() {
    if (!selectedRecipients.length) return;
    send.disabled = true;
    send.textContent = 'Pakker filer ...';
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify({ recipients: selectedRecipients.map(person => person.email), note: note.value.trim() }));
      setProgress(1, 'Klargjør vedlegg');
      const attachments = await mailAttachments(setProgress);
      startSendingAnimation();
      const accessToken = await getToken();
      if (!accessToken) return;
      await sendWithToken(accessToken, attachments, selectedRecipients, note.value.trim(), setProgress);
      clearAuthAttempt();
      microsoftStatus(true);
      closeDialog(openSentSketchDialog);
    } catch (error) {
      clearAuthAttempt();
      logFailure(error);
    } finally {
      clearInterval(sendingDotsTimer);
      sendingDotsTimer = null;
      if (!useRedirectLogin) updateSendButton();
    }
  }

  async function resumeRedirectSend() {
    if (!callback.has('code')) return;
    const state = callback.get('state');
    const verifier = sessionStorage.getItem(verifierKey);
    const expectedState = sessionStorage.getItem(stateKey);
    const pending = readPending();
    history.replaceState({}, document.title, redirectUri);
    if (!verifier || !expectedState || state !== expectedState || !pending?.recipients?.length) {
      clearAuthAttempt();
      microsoftStatus(false);
      return;
    }
    try {
      const accessToken = await exchangeCode(callback.get('code'), verifier);
      const destinationRecipients = recipients.filter(person => pending.recipients.includes(person.email));
      const attachments = await waitForAttachments();
      if (!destinationRecipients.length) throw new Error('Kunne ikke gjenopprette e-postutkastet.');
      await sendWithToken(accessToken, attachments, destinationRecipients, pending.note || '');
      clearAuthAttempt();
      microsoftStatus(true);
      openSentSketchDialog();
    } catch (error) {
      clearAuthAttempt();
      logFailure(error);
    }
  }

  document.querySelector('#downloadImage').onclick = openDialog;
  document.querySelector('#closeMailDialog').onclick = () => closeDialog();
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
  send.onclick = sendMail;
  document.querySelector('#keepSentSketches').onclick = closeSentSketchDialog;
  document.querySelector('#discardSentSketches').onclick = async () => { closeSentSketchDialog(); await window.resetSketchSession?.(); show('startView'); };
  resumeRedirectSend();
})();
