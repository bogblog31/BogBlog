/**************************************************
 * CONFIG — replace these with your published CSV links
 **************************************************/
const FACILITIES_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTkCSuWf7Rr2NpPRuHto4Y-RcWrTZbZMCvb15v3pdag-HK5WHy7jBtytswR93tAwgdBe_DqCLC5hx8e/pub?gid=0&single=true&output=csv';
const SECTIONS_URL   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTkCSuWf7Rr2NpPRuHto4Y-RcWrTZbZMCvb15v3pdag-HK5WHy7jBtytswR93tAwgdBe_DqCLC5hx8e/pub?gid=1505966964&single=true&output=csv';
const IMAGES_URL     = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTkCSuWf7Rr2NpPRuHto4Y-RcWrTZbZMCvb15v3pdag-HK5WHy7jBtytswR93tAwgdBe_DqCLC5hx8e/pub?gid=1369622257&single=true&output=csv';

// Local archived JSON (optional)
const OLD_FAC_PATH = 'data/old_facilities.json';
const OLD_SEC_PATH = 'data/old_sections.json';
const OLD_IMG_PATH = 'data/old_images.json';

/**************************************************
 * Map initialization
 **************************************************/
const map = L.map('map').setView([20, 0], 2);

// prevent popup clicks from propagating to the map ---
map.on('popupopen', function(e) {
  const popupEl = e.popup.getElement();
  if (!popupEl) return;

  // disable propagation and map closing behavior
  L.DomEvent.disableClickPropagation(popupEl);
  L.DomEvent.disableScrollPropagation(popupEl);

  // also explicitly stop propagation for mouse and pointer events
  popupEl.addEventListener('mousedown', stopPopupClick, true);
  popupEl.addEventListener('mouseup', stopPopupClick, true);
  popupEl.addEventListener('click', stopPopupClick, true);
  popupEl.addEventListener('dblclick', stopPopupClick, true);
  popupEl.addEventListener('contextmenu', stopPopupClick, true);
  popupEl.addEventListener('pointerdown', stopPopupClick, true);
  popupEl.addEventListener('pointerup', stopPopupClick, true);
});

function stopPopupClick(e) {
  e.stopPropagation();
}

// OpenStrretMap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

/**************************************************
 * Robust CSV parser (handles quoted fields)
 * returns array of objects (keys from header)
 **************************************************/
function parseCSVtoObjects(csvText) {
  if (!csvText || csvText.trim() === '') return [];
  const lines = csvText.split(/\r\n|\n|\r/);

  function parseLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' ) {
        if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  // find header row
  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === '') headerIdx++;
  if (headerIdx >= lines.length) return [];
  const headers = parseLine(lines[headerIdx]).map(h => h.trim());

  const objs = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    const fields = parseLine(raw);
    while (fields.length < headers.length) fields.push('');
    const obj = {};
    headers.forEach((h, idx) => obj[h.trim()] = (fields[idx] || '').trim());
    objs.push(obj);
  }
  return objs;
}

/**************************************************
 * Load sheets + optional local JSON archives
 **************************************************/
Promise.all([
  fetch(FACILITIES_URL).then(r => r.text()).catch(() => ''),
  fetch(SECTIONS_URL).then(r => r.text()).catch(() => ''),
  fetch(IMAGES_URL).then(r => r.text()).catch(() => ''),
  fetch(OLD_FAC_PATH).then(r => r.json()).catch(() => []),
  fetch(OLD_SEC_PATH).then(r => r.json()).catch(() => []),
  fetch(OLD_IMG_PATH).then(r => r.json()).catch(() => [])
])
.then(([facCSV, secCSV, imgCSV, oldFac, oldSec, oldImg]) => {
  const sheetFacilities = parseCSVtoObjects(facCSV);
  const sheetSections   = parseCSVtoObjects(secCSV);
  const sheetImages     = parseCSVtoObjects(imgCSV);

  const facilities = [...(oldFac || []), ...sheetFacilities];
  const sections   = [...(oldSec || []), ...sheetSections];
  const images     = [...(oldImg || []), ...sheetImages];

  buildExpandablePopups(facilities, sections, images);
})
.catch(err => {
  console.error('Load error:', err);
  alert('Failed to load data. See console.');
});

/**************************************************
 * Core: Create one marker per facility and expandable popups
 **************************************************/
function buildExpandablePopups(facilities, sections, images) {
  // prepare image lookup: key = facility_id + '||' + section_name
  const imageMap = {};
  images.forEach(img => {
    const url = img.image_url || img.url || img.image || '';
    const facId = String(img.facility_id || img.facilityId || img.id || '');
    const secName = String(img.section_name || img.sectionName || img.section || '');
    const key = facId + '||' + secName;
    if (!imageMap[key]) imageMap[key] = [];
    if (url) imageMap[key].push(url);
  });

  // index sections by facility id
  const sectionsByFacility = {};
  sections.forEach(s => {
    const facId = String(s.facility_id || s.facilityId || s.id || '');
    if (!sectionsByFacility[facId]) sectionsByFacility[facId] = [];
    sectionsByFacility[facId].push({
      section_name: s.section_name || s.sectionName || s.section || '',
      floor: String(s.floor || s.level || ''),
      lat: s.lat || s.latitude || '',
      lng: s.lng || s.longitude || '',
      description: s.description || s.desc || ''
    });
  });

  // create marker for each facility
  window._facilityMarkers = window._facilityMarkers || {}; // global lookup
  facilities.forEach(f => {
    const id = String(f.id || f.facility_id || f.facilityId || '');
    const name = f.name || f.title || '';
    const lat = parseFloat(f.lat || f.latitude || '');
    const lng = parseFloat(f.lng || f.longitude || '');
    if (!name || isNaN(lat) || isNaN(lng)) return;

    // build section list HTML grouped by floor
    const secList = sectionsByFacility[id] || [];
    const floors = {};
    secList.forEach(s => {
      const floorKey = (s.floor !== undefined && s.floor !== '') ? String(s.floor) : 'Unspecified';
      floors[floorKey] = floors[floorKey] || [];
      floors[floorKey].push(s);
    });

    let sectionListHTML = '';
    if (Object.keys(floors).length === 0) {
      sectionListHTML = '<p><em>No sections defined for this facility.</em></p>';
    } else {
      sectionListHTML = '<div>';
      Object.keys(floors).forEach(floor => {
        sectionListHTML += `<strong>Floor ${sanitizeHTML(floor)}</strong><ul class="section-list">`;
        floors[floor].forEach(s => {
          const secEsc = sanitizeHTML(s.section_name || '(unnamed)');
          sectionListHTML += `<li>
            <span class="section-link" onclick="showSectionInPopup('${escapeJS(id)}','${escapeJS(s.section_name)}')">${secEsc}</span>
            <small style="color:#666;margin-left:6px;">${sanitizeHTML(s.description || '')}</small>
          </li>`;
        });
        sectionListHTML += '</ul>';
      });
      sectionListHTML += '</div>';
    }

    const facilityHTML = `
      <div id="fac-${escapeId(id)}">
        <h3>${sanitizeHTML(name)}</h3>
        <p><b>Sport:</b> ${sanitizeHTML(f.sport || '')}</p>
        <p>${sanitizeHTML(f.description || f.desc || '')}</p>
        <hr />
        <div class="facility-sections">${sectionListHTML}</div>
        <div style="margin-top:8px;"><small style="color:#666">Click a section to view photos and details.</small></div>
      </div>
    `;

    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup(facilityHTML);

    // store useful data on marker
    marker._facility = { id, name, sport: f.sport || '', description: f.description || f.desc || '', lat, lng };
    marker._sections = secList;
    marker._imageMap = imageMap;

    window._facilityMarkers[id] = marker;
  });

  // expose function to show section inside the popup
  window.showSectionInPopup = function(facilityIdRaw, sectionNameRaw) {
    const facilityId = String(unescapeJS(facilityIdRaw || ''));
    const sectionName = String(unescapeJS(sectionNameRaw || ''));

    const marker = window._facilityMarkers && window._facilityMarkers[facilityId];
    if (!marker) { console.warn('No marker for facility', facilityId); return; }

    // find the section in the marker's section list
    let section = (marker._sections || []).find(s => String(s.section_name) === String(sectionName));
    if (!section) {
      // fallback: case-insensitive match
      section = (marker._sections || []).find(s => String(s.section_name).toLowerCase() === String(sectionName).toLowerCase());
    }
    if (!section) {
      console.warn('Section not found', sectionName, 'for facility', facilityId);
      alert('Section not found.');
      return;
    }

    // compose image gallery: try exact key, else facility-wide key
    const keyExact = facilityId + '||' + (section.section_name || '');
    const keyFac = facilityId + '||';
    const imgs = (marker._imageMap && (marker._imageMap[keyExact] || marker._imageMap[keyFac])) || [];

    let galleryHTML = '';
    if (imgs.length === 0) {
      galleryHTML = '<p><em>No images for this section.</em></p>';
    } else {
      const lbGroup = 'lb-' + escapeId(facilityId) + '-' + escapeId(section.section_name || '');
      galleryHTML = imgs.map(u => {
        const esc = sanitizeHTML(u);
        return `<a href="${esc}" data-lightbox="${lbGroup}" data-title="${sanitizeHTML(section.section_name)}">
                  <img src="${esc}" alt="${sanitizeHTML(section.section_name)}" />
                </a>`;
      }).join('');
    }

    // section view HTML
    const sectionHTML = `
      <div>
        <h3>${sanitizeHTML(marker._facility.name)} — ${sanitizeHTML(section.section_name)}</h3>
        <p><b>Floor:</b> ${sanitizeHTML(section.floor || '')}</p>
        <p>${sanitizeHTML(section.description || '')}</p>
        <div class="popup-gallery">${galleryHTML}</div>
        <div style="margin-top:8px;">
          <span class="popup-action" onclick="backToFacilityView('${escapeJS(facilityId)}')">Back to facility</span>
          <span class="popup-action" onclick="panToSection('${escapeJS(facilityId)}','${escapeJS(section.section_name)}')">Center on this section</span>
        </div>
      </div>
    `;

    const popup = marker.getPopup();
    popup.setContent(sectionHTML);
    popup.update();
    if (!map.hasLayer(popup)) marker.openPopup();
  };

  // restore facility popup
  window.backToFacilityView = function(facilityIdRaw) {
    const facilityId = String(unescapeJS(facilityIdRaw || ''));
    const marker = window._facilityMarkers && window._facilityMarkers[facilityId];
    if (!marker) return;

    // rebuild the facility HTML the same way as when creating markers
    const secList = marker._sections || [];
    const floors = {};
    secList.forEach(s => {
      const fk = (s.floor !== undefined && s.floor !== '') ? String(s.floor) : 'Unspecified';
      floors[fk] = floors[fk] || [];
      floors[fk].push(s);
    });

    let sectionListHTML = '';
    if (Object.keys(floors).length === 0) {
      sectionListHTML = '<p><em>No sections defined for this facility.</em></p>';
    } else {
      sectionListHTML = '<div>';
      Object.keys(floors).forEach(floor => {
        sectionListHTML += `<strong>Floor ${sanitizeHTML(floor)}</strong><ul class="section-list">`;
        floors[floor].forEach(s => {
          sectionListHTML += `<li>
            <span class="section-link" onclick="showSectionInPopup('${escapeJS(facilityId)}','${escapeJS(s.section_name)}')">${sanitizeHTML(s.section_name || '(unnamed)')}</span>
            <small style="color:#666;margin-left:6px;">${sanitizeHTML(s.description || '')}</small>
          </li>`;
        });
        sectionListHTML += '</ul>';
      });
      sectionListHTML += '</div>';
    }

    const facilityHTML = `
      <div>
        <h3>${sanitizeHTML(marker._facility.name)}</h3>
        <p><b>Sport:</b> ${sanitizeHTML(marker._facility.sport || '')}</p>
        <p>${sanitizeHTML(marker._facility.description || '')}</p>
        <hr />
        <div>${sectionListHTML}</div>
      </div>
    `;

    const popup = marker.getPopup();
    popup.setContent(facilityHTML);
    popup.update();
    if (!map.hasLayer(popup)) marker.openPopup();
  };

  // pan to section coords (if available)
  window.panToSection = function(facilityIdRaw, sectionNameRaw) {
    const facilityId = String(unescapeJS(facilityIdRaw || ''));
    const sectionName = String(unescapeJS(sectionNameRaw || ''));
    const marker = window._facilityMarkers && window._facilityMarkers[facilityId];
    if (!marker) return;

    const section = (marker._sections || []).find(s => String(s.section_name) === String(sectionName)) ||
                    (marker._sections || []).find(s => String(s.section_name).toLowerCase() === String(sectionName).toLowerCase());
    if (!section) { alert('Section coordinates not found.'); return; }

    const lat = parseFloat(section.lat);
    const lng = parseFloat(section.lng);
    if (isNaN(lat) || isNaN(lng)) { alert('Section coordinates not available.'); return; }

    map.setView([lat, lng], 18, { animate: true });
  };
}

/**************************************************
 * Small helpers
 **************************************************/
function sanitizeHTML(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeId(s) { return String(s).replace(/[^a-z0-9_\-]/gi, '_'); }
function escapeJS(s) { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"'); }
function unescapeJS(s) { return String(s).replace(/\\'/g,"'").replace(/\\"/g,'"').replace(/\\\\/g,'\\'); }




