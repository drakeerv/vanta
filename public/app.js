// ===== State =====
let currentLightboxImageId = null;
let currentLightboxTags = [];
let currentTagQuery = '';
let allImages = [];
let allTags = [];
let bulkTagMode = false;
let bulkSelected = new Set();
let bulkTags = [];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ===== Utilities =====
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function updateImageCache(id, tags) {
    const idx = allImages.findIndex(img => img.id === id);
    if (idx !== -1) allImages[idx].tags = tags;
}

// ===== Generic Modal System =====
function openModal(id) {
    document.getElementById(id).classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
    document.body.style.overflow = '';
}

// ===== Menus =====
function toggleMobileMenu() {
    document.getElementById('actionsMenu').classList.toggle('open');
}

function toggleToolsMenu() {
    document.getElementById('toolsDropdown').classList.toggle('open');
}

// ===== Upload =====
function openUploadModal() { openModal('uploadModal'); }

function closeUploadModal() {
    closeModal('uploadModal');
    clearUpload();
}

function showFileSelection() {
    const fileInput = document.getElementById('fileInput');
    const msg = document.getElementById('uploadMessage');
    const count = fileInput.files.length;
    let oversized = 0;
    for (let i = 0; i < count; i++) {
        if (fileInput.files[i].size > MAX_FILE_SIZE) oversized++;
    }
    if (oversized > 0) {
        msg.innerText = `${oversized} file(s) exceed 50 MB limit`;
        msg.className = 'error';
    } else {
        msg.innerText = '';
        msg.className = '';
    }
    document.getElementById('fileName').innerText =
        count === 1 ? fileInput.files[0].name : `${count} files selected`;
    document.getElementById('uploadActions').style.display = 'flex';
}

function clearUpload() {
    document.getElementById('fileInput').value = '';
    document.getElementById('uploadActions').style.display = 'none';
    document.getElementById('uploadMessage').innerText = '';
}

async function uploadImage() {
    const files = document.getElementById('fileInput').files;
    const msg = document.getElementById('uploadMessage');
    const btn = document.getElementById('uploadBtn');

    if (files.length === 0) {
        msg.innerText = 'Please select a file';
        msg.className = 'error';
        return;
    }

    btn.disabled = true;
    msg.className = '';
    let successCount = 0, errorCount = 0;

    for (let i = 0; i < files.length; i++) {
        if (files[i].size > MAX_FILE_SIZE) { errorCount++; continue; }
        msg.innerText = `Uploading ${i + 1} of ${files.length}...`;
        const formData = new FormData();
        formData.append('file', files[i]);
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            if (res.ok) successCount++;
            else errorCount++;
        } catch { errorCount++; }
    }

    btn.disabled = false;
    if (errorCount === 0) {
        msg.innerText = `${successCount} image${successCount > 1 ? 's' : ''} uploaded`;
        msg.className = 'success';
        setTimeout(closeUploadModal, 1000);
        loadImages();
    } else if (successCount > 0) {
        msg.innerText = `${successCount} uploaded, ${errorCount} failed`;
        msg.className = 'error';
        loadImages();
    } else {
        msg.innerText = 'Upload failed';
        msg.className = 'error';
    }
}

// ===== Lightbox =====
function openLightbox(id) {
    currentLightboxImageId = id;
    const image = allImages.find(img => img.id === id);
    currentLightboxTags = image ? (image.tags || []) : [];
    const img = document.getElementById('lightbox-img');
    img.src = '';
    img.src = `/api/images/${id}/high`;
    document.getElementById('lightbox-download').href = `/api/images/${id}/original`;
    renderLightboxTags();
    document.getElementById('lightbox').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    document.getElementById('lightbox').style.display = 'none';
    document.body.style.overflow = '';
    currentLightboxImageId = null;
    currentLightboxTags = [];
    closeTagModal();
    closeInfoModal();
}

function renderLightboxTags() {
    const container = document.getElementById('lightboxTags');
    container.innerHTML = currentLightboxTags.length === 0 ? '' :
        currentLightboxTags.map(tag => `<span class="tag-chip small">${tag}</span>`).join('');
}

async function deleteCurrentLightboxImage() {
    if (currentLightboxImageId && await deleteImage(currentLightboxImageId)) {
        closeLightbox();
    }
}

// ===== Tag Modal =====
function openTagModal() {
    openModal('tagModal');
    renderCurrentTags();
}

function closeTagModal() {
    closeModal('tagModal');
    document.getElementById('newTagInput').value = '';
}

function renderCurrentTags() {
    const container = document.getElementById('currentTags');
    if (currentLightboxTags.length === 0) {
        container.innerHTML = '<p class="hint">No tags yet</p>';
    } else {
        container.innerHTML = currentLightboxTags.map(tag =>
            `<span class="tag-chip">${tag} <button onclick="removeTagFromImage('${tag}')">&times;</button></span>`
        ).join('');
    }
}

async function addTagToImage() {
    const input = document.getElementById('newTagInput');
    const tags = input.value.trim().split(/\s+/).filter(t => t.length > 0);
    if (tags.length === 0 || !currentLightboxImageId) return;

    let successCount = 0;
    input.disabled = true;

    for (const tag of tags) {
        try {
            const res = await fetch(`/api/images/${currentLightboxImageId}/tags`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag })
            });
            if (res.ok) {
                const entry = await res.json();
                currentLightboxTags = entry.tags;
                updateImageCache(currentLightboxImageId, entry.tags);
                successCount++;
            }
        } catch (e) { console.error('Error adding tag:', tag, e); }
    }

    input.disabled = false;
    if (successCount > 0) {
        renderCurrentTags();
        renderLightboxTags();
        input.value = '';
        loadTags();
    } else {
        alert('Failed to add tags');
    }
}

async function removeTagFromImage(tag) {
    if (!currentLightboxImageId) return;
    try {
        const res = await fetch(
            `/api/images/${currentLightboxImageId}/tags?tag=${encodeURIComponent(tag)}`,
            { method: 'DELETE' }
        );
        if (res.ok) {
            const entry = await res.json();
            currentLightboxTags = entry.tags;
            updateImageCache(currentLightboxImageId, entry.tags);
            renderCurrentTags();
            renderLightboxTags();
            loadTags();
        }
    } catch { alert('Error removing tag'); }
}

// ===== Info Modal =====
function openInfoModal() {
    openModal('infoModal');
    renderInfoContent();
}

function closeInfoModal() { closeModal('infoModal'); }

function renderInfoContent() {
    const image = allImages.find(img => img.id === currentLightboxImageId);
    const container = document.getElementById('infoContent');
    if (!image) { container.innerHTML = '<p>Image not found</p>'; return; }
    const created = new Date(image.created_at * 1000).toLocaleString();
    container.innerHTML = `
        <div class="info-row"><span class="info-label">ID</span><span class="info-value mono">${image.id}</span></div>
        <div class="info-row"><span class="info-label">Format</span><span class="info-value">${image.original_mime}</span></div>
        <div class="info-row"><span class="info-label">Original Size</span><span class="info-value">${formatBytes(image.original_size)}</span></div>
        <div class="info-row"><span class="info-label">Created</span><span class="info-value">${created}</span></div>
        <div class="info-row"><span class="info-label">Variants</span><span class="info-value">${(image.variants || []).join(', ') || 'None'}</span></div>
        <div class="info-row"><span class="info-label">Tags</span><span class="info-value">${(image.tags || []).join(', ') || 'None'}</span></div>
    `;
}

// ===== Tag Search & Suggestions =====
function searchByTags() {
    currentTagQuery = document.getElementById('tagSearch').value.trim();
    loadImages();
    hideSuggestions();
}

function hideSuggestions() {
    document.querySelectorAll('.tag-suggestions').forEach(el => el.style.display = 'none');
}

function setupTagSuggestions(inputId, containerId) {
    const input = document.getElementById(inputId);
    const container = document.getElementById(containerId);
    if (!input || !container) return;

    const show = () => {
        const words = input.value.split(/\s+/);
        const currentWord = words[words.length - 1] || '';
        const isExclude = currentWord.startsWith('-');
        const searchTerm = isExclude ? currentWord.slice(1) : currentWord;

        if (searchTerm.length === 0) { container.style.display = 'none'; return; }

        const matches = allTags
            .filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .slice(0, 8);

        if (matches.length === 0) { container.style.display = 'none'; return; }

        container.innerHTML = matches.map(t => {
            const val = (isExclude ? '-' : '') + t.name;
            return `<div class="suggestion" role="button">${val}</div>`;
        }).join('');
        container.style.display = 'block';

        container.querySelectorAll('.suggestion').forEach(child => {
            child.onclick = (e) => {
                e.preventDefault();
                words[words.length - 1] = child.innerText;
                input.value = words.join(' ') + ' ';
                input.focus();
                container.style.display = 'none';
            };
        });
    };

    input.addEventListener('input', show);
    input.addEventListener('focus', () => { if (input.value) show(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSuggestions(); });
    input.addEventListener('blur', () => setTimeout(hideSuggestions, 150));
}

// ===== Bulk Tag =====
function openBulkTagMode() {
    bulkTagMode = false;
    bulkSelected.clear();
    bulkTags = [];
    document.getElementById('actionsMenu').classList.remove('open');
    document.getElementById('toolsDropdown').classList.remove('open');
    document.getElementById('bulkTagName').value = '';
    renderBulkTagChips();
    openModal('bulkTagModal');
    document.getElementById('bulkTagName').focus();
}

function startBulkSelection() {
    if (bulkTags.length === 0) { alert('Add at least one tag first'); return; }
    closeModal('bulkTagModal');
    bulkTagMode = true;
    document.getElementById('bulkTagBanner').style.display = 'flex';
    updateBulkGallery();
}

function cancelBulkTag() {
    bulkTagMode = false;
    bulkSelected.clear();
    bulkTags = [];
    closeModal('bulkTagModal');
    document.getElementById('bulkTagBanner').style.display = 'none';
    updateBulkGallery();
}

function addBulkTag(name) {
    const t = name.trim().toLowerCase();
    if (t && !bulkTags.includes(t)) { bulkTags.push(t); renderBulkTagChips(); }
}

function removeBulkTag(name) {
    bulkTags = bulkTags.filter(t => t !== name);
    renderBulkTagChips();
}

function renderBulkTagChips() {
    const container = document.getElementById('bulkTagsDisplay');
    container.innerHTML = bulkTags.length === 0
        ? '<p class="hint" style="margin:0;">No tags added yet</p>'
        : bulkTags.map(tag =>
            `<span class="tag-chip">${tag} <button onclick="removeBulkTag('${tag}')">&times;</button></span>`
        ).join('');
    const btn = document.getElementById('bulkStartBtn');
    if (btn) btn.disabled = bulkTags.length === 0;
}

function imageHasAllBulkTags(img) {
    const imgTags = (img.tags || []).map(t => t.toLowerCase());
    return bulkTags.every(t => imgTags.includes(t));
}

function updateBulkGallery() {
    const cards = document.getElementById('gallery').querySelectorAll('.image-card');
    const hasTags = bulkTags.length > 0;

    cards.forEach(card => {
        const imgId = card.dataset.imageId;
        if (!imgId) return;
        card.classList.remove('bulk-mode', 'bulk-selected', 'bulk-dimmed');
        if (!bulkTagMode) return;
        card.classList.add('bulk-mode');
        const img = allImages.find(i => i.id === imgId);
        if (!img) return;
        const wasOriginal = hasTags && imageHasAllBulkTags(img);
        const toggled = bulkSelected.has(imgId);
        card.classList.toggle('bulk-selected', wasOriginal !== toggled);
        if (hasTags && wasOriginal === toggled) card.classList.add('bulk-dimmed');
    });

    let count = 0;
    allImages.forEach(img => {
        const wasOriginal = hasTags && imageHasAllBulkTags(img);
        if (wasOriginal !== bulkSelected.has(img.id)) count++;
    });
    document.getElementById('bulkTagCount').innerText = `${count} selected`;
}

function handleBulkClick(imageId) {
    if (bulkSelected.has(imageId)) bulkSelected.delete(imageId);
    else bulkSelected.add(imageId);
    updateBulkGallery();
}

async function applyBulkTag() {
    if (bulkTags.length === 0) return;
    const btn = document.getElementById('bulkTagSaveBtn');
    btn.disabled = true;
    btn.innerText = 'Applying...';
    let errors = 0;

    for (const img of allImages) {
        const wasOriginal = imageHasAllBulkTags(img);
        const toggled = bulkSelected.has(img.id);
        const shouldHave = wasOriginal !== toggled;

        if (shouldHave && !wasOriginal) {
            for (const tag of bulkTags) {
                if ((img.tags || []).map(t => t.toLowerCase()).includes(tag)) continue;
                try {
                    const res = await fetch(`/api/images/${img.id}/tags`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tag })
                    });
                    if (res.ok) updateImageCache(img.id, (await res.json()).tags);
                    else errors++;
                } catch { errors++; }
            }
        } else if (!shouldHave && wasOriginal) {
            for (const tag of bulkTags) {
                try {
                    const res = await fetch(
                        `/api/images/${img.id}/tags?tag=${encodeURIComponent(tag)}`,
                        { method: 'DELETE' }
                    );
                    if (res.ok) updateImageCache(img.id, (await res.json()).tags);
                    else errors++;
                } catch { errors++; }
            }
        }
    }

    btn.disabled = false;
    btn.innerText = 'Apply';
    if (errors > 0) alert(`${errors} operation(s) failed`);
    cancelBulkTag();
    loadImages();
    loadTags();
}

// ===== Rename Tag =====
function openRenameTagModal() {
    document.getElementById('actionsMenu').classList.remove('open');
    document.getElementById('toolsDropdown').classList.remove('open');
    openModal('renameTagModal');
    document.getElementById('renameOldTag').value = '';
    document.getElementById('renameNewTag').value = '';
    document.getElementById('renameTagMsg').innerText = '';
    document.getElementById('renameOldTag').focus();
}

function closeRenameTagModal() { closeModal('renameTagModal'); }

async function executeRenameTag() {
    const oldTag = document.getElementById('renameOldTag').value.trim();
    const newTag = document.getElementById('renameNewTag').value.trim();
    const msg = document.getElementById('renameTagMsg');
    if (!oldTag || !newTag) {
        msg.innerText = 'Both fields are required';
        msg.className = 'error';
        return;
    }

    const btn = document.getElementById('renameTagBtn');
    btn.disabled = true;
    btn.innerText = 'Renaming...';

    try {
        const res = await fetch('/api/tags/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_tag: oldTag, new_tag: newTag })
        });
        if (res.ok) {
            const data = await res.json();
            msg.innerText = `Renamed across ${data.renamed} image(s)`;
            msg.className = 'success';
            loadImages();
            loadTags();
            setTimeout(closeRenameTagModal, 1200);
        } else {
            msg.innerText = 'Error: ' + await res.text();
            msg.className = 'error';
        }
    } catch {
        msg.innerText = 'Failed to rename tag';
        msg.className = 'error';
    }

    btn.disabled = false;
    btn.innerText = 'Rename';
}

// ===== Auth =====
async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/unlock';
}

async function lockVault() {
    await fetch('/api/lock', { method: 'POST' });
    window.location.href = '/unlock';
}

// ===== Data Loading =====
async function loadTags() {
    try {
        const res = await fetch('/api/tags');
        if (res.ok) allTags = (await res.json()).map(t => ({ name: t, count: 0 }));
    } catch (e) { console.error('Failed to load tags', e); }
}

async function loadImages() {
    const gallery = document.getElementById('gallery');
    gallery.innerHTML = '<p>Loading...</p>';

    try {
        const url = currentTagQuery
            ? `/api/images?q=${encodeURIComponent(currentTagQuery)}`
            : '/api/images';
        const res = await fetch(url);
        if (res.status === 403 || res.status === 401) {
            window.location.href = '/unlock';
            return;
        }
        if (!res.ok) throw new Error('Failed to load images');

        const images = await res.json();
        allImages = images;
        gallery.innerHTML = '';
        document.getElementById('imageCount').innerText = `(${images.length})`;

        if (images.length === 0) {
            gallery.innerHTML = currentTagQuery
                ? '<p>No images match this search.</p>'
                : '<p>No images yet. Upload some!</p>';
            return;
        }

        images.forEach(image => {
            const div = document.createElement('div');
            div.className = 'image-card';
            div.dataset.imageId = image.id;
            div.onclick = () => bulkTagMode ? handleBulkClick(image.id) : openLightbox(image.id);
            const img = document.createElement('img');
            img.src = `/api/images/${image.id}/thumbnail`;
            img.loading = 'lazy';
            img.alt = 'Encrypted Image';
            div.appendChild(img);
            gallery.appendChild(div);
        });

        if (bulkTagMode) updateBulkGallery();
    } catch (e) { gallery.innerText = `Error: ${e.message}`; }
}

async function deleteImage(id) {
    if (!confirm('Delete this image?')) return false;
    try {
        const res = await fetch(`/api/images/${id}`, { method: 'DELETE' });
        if (res.ok) { loadImages(); loadTags(); return true; }
        alert('Failed to delete image');
        return false;
    } catch { alert('Error deleting image'); return false; }
}

// ===== Event Listeners =====
// Single delegated click handler for overlay close + menu close
document.addEventListener('click', (e) => {
    // Close modal overlays when clicking the backdrop
    if (e.target.classList.contains('modal-overlay')) {
        if (e.target.id === 'bulkTagModal') cancelBulkTag();
        else closeModal(e.target.id);
    }
    // Close mobile menu on outside click
    if (!e.target.closest('#actionsMenu') && !e.target.closest('#hamburgerBtn')) {
        document.getElementById('actionsMenu').classList.remove('open');
    }
    // Close tools dropdown on outside click
    if (!e.target.closest('.dropdown')) {
        document.getElementById('toolsDropdown').classList.remove('open');
    }
});

// Escape key
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (bulkTagMode || document.getElementById('bulkTagModal').classList.contains('active')) {
        cancelBulkTag();
        return;
    }
    closeLightbox();
    closeUploadModal();
    closeTagModal();
    closeInfoModal();
    closeRenameTagModal();
});

// Lightbox overlay click
document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') closeLightbox();
});

// Upload drag & drop
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) { fileInput.files = e.dataTransfer.files; showFileSelection(); }
});
fileInput.addEventListener('change', () => { if (fileInput.files.length > 0) showFileSelection(); });

// Enter key bindings
document.getElementById('newTagInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTagToImage();
});
document.getElementById('tagSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); searchByTags(); }
});
document.getElementById('bulkTagName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.target.value.split(/\s+/).filter(t => t.length > 0).forEach(t => addBulkTag(t));
        e.target.value = '';
    } else if (e.key === 'Backspace' && e.target.value === '' && bulkTags.length > 0) {
        removeBulkTag(bulkTags[bulkTags.length - 1]);
    }
});

// Tag suggestions
setupTagSuggestions('tagSearch', 'tagSuggestions');
setupTagSuggestions('newTagInput', 'addTagSuggestions');
setupTagSuggestions('bulkTagName', 'bulkTagSuggestions');
setupTagSuggestions('renameOldTag', 'renameOldTagSuggestions');

// ===== Init =====
loadImages();
loadTags();
