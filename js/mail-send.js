/* Microsoft Graph delegated mail flow. Client and tenant IDs are public identifiers, never secrets. */
(() => {
  const config = {
    clientId: '9f3c1549-65c6-4570-8ff9-1a25e8870689',
    tenantId: 'c3312dd5-4817-4059-a8cb-0e3fb0e0c77c',
    scopes: ['openid', 'profile', 'User.Read', 'Mail.Send']
  };
  const recipients = ['morten', 'lene', 'geir', 'vegard', 'toggi', 'ulrik'].map(name => ({ name: name[0].toUpperCase() + name.slice(1), email: `${name}@rumag.com` }));
  const callbackType = 'r-skisse-entra-code';

  /* The same page is the Entra SPA redirect. Return the authorization code to its opener and close. */
  const callback = new URLSearchParams(location.search);
  if (window.opener && callback.has('code') && callback.has('state')) {
    window.opener.postMessage({ type: callbackType, code: callback.get('code'), state: callback.get('state') }, location.origin);
    window.close();
    return;
  }

  const dialog = document.querySelector('#mailDialog');
  const recipientList = document.querySelector('#mailRecipients');
  const filesList = document.querySelector('#mailFiles');
  const note = document.querySelector('#mailNote');
  const send = document.querySelector('#sendMailButton');
  const account = document.querySelector('#mailAccount');
  let selectedRecipients = [];
  let token = null;
  let tokenExpiresAt = 0;
  let graphUser = null;
  let mailToastTimer = null;

  const redirectUri = `${location.origin}${location.pathname}`;
  const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const randomString = () => encode(crypto.getRandomValues(new Uint8Array(32)));
  async function challenge(verifier) { return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))); }
  function updateSendButton() { send.disabled = !selectedRecipients.length; send.textContent = selectedRecipients.length ? 'Send' : 'Velg mottaker'; }
  function microsoftStatus(ok) {
    const element = document.querySelector('#toast');
    if (!element) return;
    clearTimeout(mailToastTimer);
    element.textContent = ok ? 'Sendt!' : 'Feil!';
    element.style.background = ok ? '#137a45' : '#ae2634';
    element.classList.add('show');
    mailToastTimer = setTimeout(() => { element.classList.remove('show'); element.style.background = ''; }, 3500);
  }
  function setAccount() { account.textContent = graphUser ? `Sender som ${graphUser.mail || graphUser.userPrincipalName}` : 'Logg inn med Rumag-konto når du sender.'; }
  function pdfs() { return (window.getSavedSketches?.() || []).filter(sketch => sketch.pdfBlob).map(sketch => ({ sketch, file: new File([sketch.pdfBlob], sketchFileName(sketch, 'pdf'), { type: 'application/pdf' }) })); }
  function renderDialog() {
    selectedRecipients = [];
    updateSendButton();
    recipientList.replaceChildren(...recipients.map(person => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'mail-recipient'; button.textContent = person.name;
      button.onclick = () => {
        const isSelected = selectedRecipients.some(item => item.email === person.email);
        selectedRecipients = isSelected ? selectedRecipients.filter(item => item.email !== person.email) : [...selectedRecipients, person];
        button.classList.toggle('selected', !isSelected);
        updateSendButton();
      };
      return button;
    }));
    const attachments = pdfs();
    filesList.replaceChildren(...attachments.map(({ file }) => {
      const row = document.createElement('div'); row.className = 'mail-file';
      const name = document.createElement('span'); name.className = 'mail-file-name'; name.textContent = file.name;
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'mail-preview'; preview.title = 'Forhåndsvis PDF'; preview.setAttribute('aria-label', `Forhåndsvis ${file.name}`); preview.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>';
      preview.onclick = () => window.open(URL.createObjectURL(file), '_blank', 'noopener'); row.append(name, preview); return row;
    }));
    if (!attachments.length) filesList.textContent = 'Ingen PDF-er er klare ennå.';
    setAccount();
  }
  function openDialog() { if (!window.getSavedSketches?.().length) { toast('Ingen skisser er klare ennå.'); return; } renderDialog(); dialog.classList.remove('hidden', 'is-closing'); }
  function closeDialog() { if (dialog.classList.contains('hidden')) return; dialog.classList.add('is-closing'); const done = event => { if (event.target !== dialog) return; dialog.classList.add('hidden'); dialog.classList.remove('is-closing'); dialog.removeEventListener('animationend', done); }; dialog.addEventListener('animationend', done); }

  async function getToken() {
    if (token && Date.now() < tokenExpiresAt - 60_000) return token;
    const verifier = randomString(); const state = randomString(); const codeChallenge = await challenge(verifier);
    const url = new URL(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope: config.scopes.join(' '), state, code_challenge: codeChallenge, code_challenge_method: 'S256' });
    const popup = window.open(url, 'r-skisse-entra', 'popup,width=480,height=720');
    if (!popup) throw new Error('Innloggingsvinduet ble blokkert. Tillat popup-vinduer og prøv igjen.');
    const code = await new Promise((resolve, reject) => {
      const stop = () => { window.removeEventListener('message', receive); clearInterval(closed); };
      const receive = event => { if (event.origin !== location.origin || event.data?.type !== callbackType || event.data.state !== state) return; stop(); resolve(event.data.code); };
      const closed = setInterval(() => { if (popup.closed) { stop(); reject(new Error('Innloggingen ble avbrutt.')); } }, 350);
      window.addEventListener('message', receive);
    });
    const body = new URLSearchParams({ client_id: config.clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: config.scopes.join(' ') });
    const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const data = await response.json(); if (!response.ok) throw new Error(data.error_description || 'Microsoft-innloggingen feilet.');
    token = data.access_token; tokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
    const profile = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', { headers: { Authorization: `Bearer ${token}` } });
    if (!profile.ok) throw new Error('Kunne ikke hente Rumag-brukeren.'); graphUser = await profile.json(); setAccount(); return token;
  }
  const base64 = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
  async function sendMail() {
    if (!selectedRecipients.length) return;
    const attachments = pdfs(); if (!attachments.length) { toast('Ingen PDF-er er klare for sending.'); return; }
    if (attachments.some(({ file }) => file.size >= 3 * 1024 * 1024)) { toast('En PDF er for stor for denne sendingen.'); return; }
    send.disabled = true; send.textContent = 'Sender …';
    try {
      const accessToken = await getToken();
      const title = projectTitle() || 'Befaringsskisse';
      const body = [`${title}`, note.value.trim(), '', 'Vedlagte PDF-er er laget i R Skisse.'].filter(Boolean).join('\n');
      const payload = { message: { subject: title, body: { contentType: 'Text', content: body }, toRecipients: selectedRecipients.map(person => ({ emailAddress: { address: person.email } })), attachments: await Promise.all(attachments.map(async ({ file }) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: file.name, contentType: 'application/pdf', contentBytes: await base64(file) }))) }, saveToSentItems: true };
      const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error?.message || 'Microsoft Graph kunne ikke sende e-posten.'); }
      closeDialog(); microsoftStatus(true);
    } catch (error) { console.error('Mail sending failed:', error); microsoftStatus(false); } finally { updateSendButton(); }
  }
  document.querySelector('#downloadImage').onclick = openDialog;
  document.querySelector('#closeMailDialog').onclick = closeDialog;
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
  send.onclick = sendMail;
})();
