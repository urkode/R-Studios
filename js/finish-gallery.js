/* Persistent, on-device gallery for completed sketches. */
const galleryDatabase = 'befaringsskisse-gallery';
const galleryStore = 'sketches';
let savedSketches = [];
let editingSketchId = null;
let activeProjectTitle = '';
window.getSavedSketches = () => savedSketches;

function projectTitle() {
  return activeProjectTitle.trim();
}

function openGalleryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(galleryDatabase, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(galleryStore)) {
        request.result.createObjectStore(galleryStore, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function galleryRequest(mode, action) {
  const database = await openGalleryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(galleryStore, mode);
    const request = action(transaction.objectStore(galleryStore));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

function sketchFileName(sketch, extension = 'pdf') {
  const rawName = (sketch.name || 'skisse').trim().replace(/[\\/:*?"<>|]+/g, '-');
  const withoutExtension = rawName.replace(/\.(jpe?g|pdf)$/i, '') || 'skisse';
  const prefix = projectTitle().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.(jpe?g|pdf)$/i, '');
  return `${prefix ? `${prefix}_` : ''}${withoutExtension}.${extension}`;
}

async function saveSketchRecord(sketch) {
  /* Sketches are deliberately session-only: do not persist images in the browser. */
  return sketch;
}

async function removeSketchRecord(id) {
  return id;
}

function snapshotEditorState() {
  return {
    photoData: photo.toDataURL('image/jpeg', .95),
    width: photo.width,
    height: photo.height,
    strokes: strokes.map(stroke => ({ ...stroke, points: stroke.points.map(point => ({ ...point })) })),
    erasedRegions: erasedRegions.map(region => ({ ...region })),
    text: [...textLayer.querySelectorAll('.text-entry')].map(entry => ({
      value: entry.value,
      x: Number(entry.dataset.x),
      y: Number(entry.dataset.y),
      size: Number(entry.dataset.size),
      color: entry.style.getPropertyValue('--text-color') || '#ffffff'
    }))
  };
}

function addRestoredText(entry) {
  const input = document.createElement('input');
  const layerRect = textLayer.getBoundingClientRect();
  input.className = 'text-entry';
  input.value = entry.value || '';
  input.style.left = `${entry.x / draw.width * layerRect.width}px`;
  input.style.top = `${entry.y / draw.height * layerRect.height}px`;
  input.style.setProperty('--font-size', `${entry.size}px`);
  input.style.setProperty('--text-color', entry.color || '#ffffff');
  input.dataset.x = entry.x;
  input.dataset.y = entry.y;
  input.dataset.size = entry.size;
  input.style.width = `${Math.max(55, input.value.length * entry.size * .64 + 17)}px`;
  input.addEventListener('input', () => {
    if (!input.value.trim()) { input.remove(); return; }
    input.style.width = `${Math.max(55, input.value.length * Number(input.dataset.size) * .64 + 17)}px`;
  });
  makeMovable(input);
  textLayer.append(input);
}

function loadBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function prepareSketchForEditor(sketch) {
  const state = sketch.editorState || {
    photoData: await loadBlobAsDataUrl(sketch.blob),
    width: 0,
    height: 0,
    strokes: [],
    erasedRegions: [],
    text: []
  };
  const source = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = state.photoData;
  });
  return { state, source };
}

function openPreparedSketch(sketch, prepared) {
  const { state, source } = prepared;
  imageData = { width: state.width || source.naturalWidth, height: state.height || source.naturalHeight, src: source };
  setupEditor();
  strokes = (state.strokes || []).map(stroke => ({ ...stroke, points: stroke.points.map(point => ({ ...point })) }));
  erasedRegions = (state.erasedRegions || []).map(region => ({ ...region }));
  conversionSnapshot = null;
  requestAnimationFrame(() => {
    resizeLayers();
    (state.text || []).forEach(addRestoredText);
    render();
  });
  finishedBlob = sketch.blob;
}

async function smoothlyOpenSketch(card, sketch) {
  if (card.dataset.opening === 'true') return;
  card.dataset.opening = 'true';
  editingSketchId = sketch.id;
  try {
    const ready = await prepareSketchForEditor(sketch);
    openPreparedSketch(sketch, ready);
  } catch (_) {
    delete card.dataset.opening;
    editingSketchId = null;
    toast('Kunne ikke åpne skissen igjen.');
  }
}

function renderGallery() {
  const grid = $('#sketchGrid');
  if (!grid) return;
  $('#shareImage').textContent = savedSketches.length === 1 ? 'Lagre skisse' : 'Lagre skisser';
  grid.replaceChildren();

  savedSketches.forEach(sketch => {
    const card = document.createElement('article');
    card.className = 'sketch-card';

    const preview = document.createElement('div');
    preview.className = 'sketch-preview';
    const image = document.createElement('img');
    image.alt = sketch.name ? `Skisse: ${sketch.name}` : 'Ferdig skisse';
    const imageUrl = URL.createObjectURL(sketch.blob);
    image.src = imageUrl;
    image.onload = () => URL.revokeObjectURL(imageUrl);
    preview.append(image);
    preview.onclick = event => {
      if (event.target.closest('.sketch-remove')) return;
      smoothlyOpenSketch(card, sketch);
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'sketch-remove';
    remove.setAttribute('aria-label', 'Slett skisse');
    remove.innerHTML = '&times;';
    remove.onclick = async () => {
      if (!confirm('Er du sikker på at du vil slette denne skissen?')) return;
      await removeSketchRecord(sketch.id);
      savedSketches = savedSketches.filter(item => item.id !== sketch.id);
      if (!savedSketches.length) {
        show('startView');
        return;
      }
      renderGallery();
    };
    preview.append(remove);

    const name = document.createElement('input');
    name.className = 'sketch-name';
    name.type = 'text';
    name.value = sketch.name || '';
    name.placeholder = 'Bildebeskrivelse...';
    name.autocomplete = 'off';
    name.setAttribute('aria-label', 'Filnavn for skissen');
    let nameTimer;
    name.addEventListener('input', () => {
      sketch.name = name.value;
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => saveSketchRecord(sketch).catch(() => {}), 250);
    });

    card.append(preview, name);
    grid.append(card);
  });

  const addCard = document.createElement('button');
  addCard.type = 'button';
  addCard.className = 'sketch-add';
  addCard.setAttribute('aria-label', 'Legg til ny skisse');
  addCard.innerHTML = '<span>+</span><small>Ny skisse</small>';
  addCard.onclick = () => {
    $('#finishImageSourceDialog').classList.remove('hidden', 'is-closing');
  };
  grid.append(addCard);
}

async function loadSavedSketches() {
  savedSketches = [];
  if ('indexedDB' in window) indexedDB.deleteDatabase(galleryDatabase);
  renderGallery();
}

async function addFinishedSketch(blob, pdfBlob, editorState) {
  const sketch = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name: '',
    blob,
    pdfBlob,
    editorState,
    createdAt: Date.now()
  };
  await saveSketchRecord(sketch);
  savedSketches.unshift(sketch);
  renderGallery();
}

async function shareSavedSketches() {
  if (!savedSketches.length) return;
  const files = savedSketches.map(sketch => {
    const isPdf = Boolean(sketch.pdfBlob);
    return new File([isPdf ? sketch.pdfBlob : sketch.blob], sketchFileName(sketch, isPdf ? 'pdf' : 'jpg'), { type: isPdf ? 'application/pdf' : 'image/jpeg' });
  });
  if (navigator.share && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ title: 'Befaringsskisser', files });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  files.forEach(file => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1200);
  });
}

/* The editor creates a new saved item every time the user finishes a sketch. */
$('#backToStart').onclick = async () => {
  const blob = await exportImage();
  if (!blob) return;
  const pdfBlob = exportEditablePdf();
  const editorState = snapshotEditorState();
  finishedBlob = blob;
  if (editingSketchId) {
    const index = savedSketches.findIndex(sketch => sketch.id === editingSketchId);
    if (index !== -1) {
      savedSketches[index] = { ...savedSketches[index], blob, pdfBlob, editorState, updatedAt: Date.now() };
      await saveSketchRecord(savedSketches[index]);
    }
    editingSketchId = null;
    renderGallery();
  } else {
    await addFinishedSketch(blob, pdfBlob, editorState);
  }
  show('finishView');
};

$('#shareImage').onclick = shareSavedSketches;
$('#downloadImage').onclick = () => {};
const projectTitleInput = $('#projectTitle');
projectTitleInput.addEventListener('input', () => {
  activeProjectTitle = projectTitleInput.value;
});
window.resetSketchSession = () => {
  savedSketches = [];
  editingSketchId = null;
  activeProjectTitle = '';
  projectTitleInput.value = '';
  finishedBlob = null;
  strokes = [];
  erasedRegions = [];
  textLayer.replaceChildren();
  photo.width = 0;
  draw.width = 0;
  renderGallery();
  if ('indexedDB' in window) indexedDB.deleteDatabase(galleryDatabase);
};
const finishImageSourceDialog = $('#finishImageSourceDialog');
function closeFinishImageSource() {
  finishImageSourceDialog.classList.add('is-closing');
  const done = event => {
    if (event.target !== finishImageSourceDialog) return;
    finishImageSourceDialog.classList.add('hidden');
    finishImageSourceDialog.classList.remove('is-closing');
    finishImageSourceDialog.removeEventListener('animationend', done);
  };
  finishImageSourceDialog.addEventListener('animationend', done);
}
finishImageSourceDialog.addEventListener('click', event => {
  if (event.target === finishImageSourceDialog) closeFinishImageSource();
});
finishImageSourceDialog.querySelectorAll('.source-choice').forEach(choice => {
  choice.addEventListener('click', closeFinishImageSource);
});
function hideStartImageSource() {
  const dialog = $('#imageSourceDialog');
  dialog.classList.add('hidden');
  dialog.classList.remove('is-closing');
}
['imageUpload', 'cameraUpload'].forEach(id => {
  $(`#${id}`).onchange = event => {
    const file = event.target.files[0];
    hideStartImageSource();
    if (file) loadImage(URL.createObjectURL(file));
    event.target.value = '';
  };
});
loadSavedSketches();
