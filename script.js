/***********************
 * CONFIG - REPLACE THESE with your sheet URLs
 ***********************/
const FACILITIES_URL = 'https://docs.google.com/spreadsheets/d/e/YOUR_FACILITIES_SHEET_ID/pub?output=csv';
const SECTIONS_URL   = 'https://docs.google.com/spreadsheets/d/e/YOUR_SECTIONS_SHEET_ID/pub?output=csv';
const IMAGES_URL     = 'https://docs.google.com/spreadsheets/d/e/YOUR_IMAGES_SHEET_ID/pub?output=csv';

// Local archived JSON (optional)
const OLD_FAC_PATH = 'data/old_facilities.json';
const OLD_SEC_PATH = 'data/old_sections.json';
const OLD_IMG_PATH = 'data/old_images.json';

/***********************
 * MAP INIT
 ***********************/
const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

/***********************
 * Utilities: robust CSV parser (handles quoted fields)
 * Returns array of objects with keys from header row
 ***********************/
function parseCSVtoObjects(csvText) {
  if (!csvText || csvText.trim() === '') return [];

  // normalize newlines
  const lines = csvText.split(/\r\n|\n|\r/);

  // CSV row -> array of fields (handles quotes and embedded commas)
  function parseLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' ) {
        if (inQuotes && line[i+1] === '"') {
          // escaped quote
          cur += '"';
          i++; // skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result;
  }

  // find first non-empty header line
  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === '') headerIdx++;
  if (headerIdx >= lines.length) return [];
  const headers = parseLine(lines[headerIdx]).map(h => h.trim());

  const objects = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    const fields = parseLine(raw);
    // pad fields to header length
    while (fields.length < headers.length) fields.push('');
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h.trim()] = fields[idx] !== undefined ? fields[idx].trim() : '';
    });
    objects.push(obj);
  }
  return objects;
}

/***********************
 * Load both Google Sheets (CSV) and local JSON files (archived)
 ***********************/
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

  // unify shape: prefer sheet fields; archived JSON expected to have same keys
  const facilities = [...(oldFac || []), ...sheetFacilities];
  const sections   = [...(oldSec || []), ...sheetSections];
  const images     = [...(oldImg || []), ...sheetImages];

  setupFacilities(facilities, sections, images);
})
.catch(err => {
  console.error('Failed loading data:', err);
  alert('Failed to load facility data. Check console for details.');
});

/***********************
 * Core logic: build facility markers and expandable popups
 ***********************/
function setupFacilities(facilities, sections, images) {
  // Build image lookup: key = facility_id + '||' + section_name
  const imageMap = {};
  images.forEach(img => {
    // support multiple possible field names for image URL
    const url = img.image_url || img.url || img.image || '';
    const facId = String(img.facility_id || img.facilityId || img.id || '');
    const sectionName = String(img.section_name || img.sectionName || img.section || '');
    const key = facId + '||' + sectionName;
    if (!imageMap[key]) imageMap[key] = [];
    if (url) imageMap[key].push(url);
  });

  // Index sections by facility id
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

  // Create facility markers (one marker per facility)
  facilities.forEach(f => {
    const id = String(f.id || f.facility_id || f.facilityId || '');
    const name = f.name || f.title || '';
    const lat = parseFloat(f.lat || f.latitude || '');
    const lng = parseFloat(f.lng || f.longitude || '');
    if (!name || isNaN(lat) || isNaN(lng)) return;

    // Build facility popup HTML (with section list)
    const secList = sectionsByFacility[id] || [];

    const floorsGrouped = {}; // floor -> array of sections
    secList.forEach(s => {
      const floorKey = (s.floor !== undefined && s.floor !== '') ? String(s.floor) : 'Unspecified';
      if (!floorsGrouped[floorKey]) floorsGrouped[floorKey] = [];
      floorsGrouped[floorKey].push(s);
    });

    // container IDs to be unique per facility
    const popupContainerId = `popup-fac-${escapeId(id)}`;
    const sectionListId = `section-list-${escapeId(id)}`;

    // Build section list HTML with clickable links (calls showSection)
    let sectionListHTML = '';
    if (Object.keys(floorsGrouped).length === 0) {
      sectionListHTML = '<p><em>No sections defined for this facility.</em></p>';
    } else {
      sectionListHTML = '<div>';
      Object.keys(floorsGrouped).forEach(floor => {
        sectionListHTML += `<strong>Floor ${sanitizeHTML(floor)}</strong><ul class="section-list">`;
        floorsGrouped[floor].forEach(s => {
          const secNameEsc = sanitizeHTML(s.section_name || '(unnamed)');
          // link calls window.showSectionInPopup
          sectionListHTML += `<li>
            <span class="section-link" onclick="showSectionInPopup('${escapeJS(id)}','${escapeJS(s.section_name)}')">${secNameEsc}</span>
            <small style="color:#666;margin-left:6px;">${sanitizeHTML(s.description || '')}</small>
          </li>`;
        });
        sectionListHTML += '</ul>';
      });
      sectionListHTML += '</div>';
    }

    const facilityPopupHTML = `
      <div id="${popupContainerId}">
        <h3>${sanitizeHTML(name)}</h3>
        <p><b>Sport:</b> ${sanitizeHTML(f.sport || '')}</p>
        <p>${sanitizeHTML(f.description || f.desc || '')}</p>
        <hr />
        <div id="${sectionListId}">
          ${sectionListHTML}
        </div>
        <div style="margin-top:8px;">
          <small style="color:#666">Click a section to view photos and details.</small>
        </div>
      </div>
    `;

    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup(facilityPopupHTML);

    // store useful data on marker for later (used by showSectionInPopup)
    marker.facility = {
      id,
      name,
      sport: f.sport || '',
      description: f.description || f.desc || '',
      lat, lng
    };
    // keep refs available globally
    marker._sections = secList;
    marker._imageMap = imageMap;

    // store marker by facility id for quick access
    window._facilityMarkers = window._facilityMarkers || {};
    window._facilityMarkers[id] = marker;
  });

  // Expose helper to show section content inside the facility popup
  window.showSectionInPopup = function(facilityIdRaw, sectionNameRaw) {
    const facilityId = String(unescapeJS(facilityIdRaw || ''));
    const sectionName = String(unescapeJS(sectionNameRaw || ''));

    const marker = (window._facilityMarkers && window._facilityMarkers[facilityId]) ? window._facilityMarkers[facilityId] : null;
    if (!marker) {
      console.warn('Facility marker not found for id', facilityId);
      return;
    }

    // find section record
    const secList = marker._sections || [];
    const section = secList.find(s => String(s.section_name) === String(sectionName));
    if (!section) {
      // maybe section name blank or mismatch; fallback: try startsWith or case-insensitive
      const alt = secList.find(s => String(s.section_name).toLowerCase() === String(sectionName).toLowerCase());
      if (alt) section = alt;
    }
    if (!section) {
      console.warn('Section not found on facility', facilityId, sectionName);
      return;
    }

    // build gallery from imageMap: try key facilityId||sectionName, then facilityId||''
    const keyExact = facilityId + '||' + (section.section_name || '');
    const keyFacility = facilityId + '||';
    const imgs = (marker._imageMap && (marker._imageMap[keyExact] || marker._imageMap[keyFacility])) || [];

    // Compose section view HTML
    let galleryHTML = '';
    if (imgs.length === 0) {
      galleryHTML = '<p><em>No images for this section.</em></p>';
    } else {
      galleryHTML = imgs.map((u, idx) => {
        const esc = sanitizeHTML(u);
        // data-lightbox attribute should be unique per section to allow grouping
        const lbGroup = `lb-${escapeId(facilityId)}-${escapeId(section.section_name)}`;
        return `<a href="${esc}" data-lightbox="${lbGroup}" data-title="${sanitizeHTML(section.section_name)}">
                  <img src="${esc}" alt="${sanitizeHTML(section.section_name)}" />
                </a>`;
      }).join('');
    }

    const sectionContentHTML = `
      <div>
        <h3>${sanitizeHTML(marker.facility.name)} — ${sanitizeHTML(section.section_name)}</h3>
        <p><b>Floor:</b> ${sanitizeHTML(section.floor || '')}</p>
        <p>${sanitizeHTML(section.description || '')}</p>
        <div class="popup-gallery">${galleryHTML}</div>
        <div style="margin-top:8px;">
          <span class="popup-action" onclick="backToFacilityView('${escapeJS(facilityId)}')">Back to facility</span>
          <span class="popup-action" onclick="panToSection('${escapeJS(facilityId)}','${escapeJS(section.section_name)}')">Center on this section</span>
        </div>
      </div>
    `;

    // Replace popup content
    const popup = marker.getPopup();
    popup.setContent(sectionContentHTML);
    popup.update();
    // reopen to ensure content updates (if it's already open)
    if (!map.hasLayer(popup)) {
      marker.openPopup();
    }

    // reinitialize lightbox (Lightbox2 auto-initializes via attributes on anchors; no extra call needed)
  };

  // back to facility view (restores the original listing)
  window.backToFacilityView = function(facilityIdRaw) {
    const facilityId = String(unescapeJS(facilityIdRaw || ''));
    const marker = (window._facilityMarkers && window._facilityMarkers[facilityId]) ? window._facilityMarkers[facilityId] : null;
    if (!marker) return;

    // reconstruct the original facility popup HTML by simulating click (we stored original popup content in bind time)
    // easiest: create facility popup again using marker.facility and its sections
    const fac = marker.facility;
    const secList = marker._sections || [];

    const floorsGrouped = {};
    secList.forEach(s => {
      const floorKey = (s.floor !== undefined && s.floor !== '') ? String(s.floor) : 'Unspecified';
      if (!floorsGrouped[floorKey]) floorsGrouped[floorKey] = [];
      floorsGrouped[floorKey].push(s);
    });

    let sectionListHTML = '';
    if (Object.keys(floorsGrouped).length === 0) {
      sectionListHTML = '<p><em>No sections defined for this facility.</em></p>';
    } else {
      sectionListHTML = '<div>';
      Object.keys(floorsGrouped).forEach(floor => {
        sectionListHTML += `<strong>Floor ${sanitizeHTML(floor)}</strong><ul class="section-list">`;
        floorsGrouped[floor].forEach(s => {
          sectionListHTML += `<li>
            <span class="section-link" onclick="showSectionInPopup('${escapeJS(facilityId)}','${escapeJS(s.section_name)}')">${sanitizeHTML(s.section_name)}</span>
            <small style="color:#666;margin-left:6px;">${sanitizeHTML(s.description || '')}</small>
          </li>`;
        });
        sectionListHTML += '</ul>';
      });
      sectionListHTML += '</div>';
    }

    const facilityPopupHTML = `
      <div>
        <h3>${sanitizeHTML(fac.name)}</h3>
        <p><b>Sport:</b> ${sanitizeHTML(fac.sport || '')}</p>
        <p>${sanitizeHTML(fac.description || '')}</p>
        <hr />
        <div>${sectionListHTML}</div>
      </div>
    `;

    const popup = marker.getPopup();
    popup.setContent(facilityPopupHTML);
    popup.update();
    if (!map.hasLayer(popup)) {
      marker.openPopup();
    }
  };

  // pan/zoom to the section coordinates if available
  window.panToSection = function(facilityIdRaw, sectionNameRaw) {
    const facilityId = String(unescapeJS(facilityIdRaw || ''));
    const sectionName = String(unescapeJS(sectionNameRaw || ''));
    const marker = (window._facilityMarkers && window._facilityMarkers[facilityId]) ? window._facilityMarkers[facilityId] : null;
    if (!marker) return;
    const secList = marker._sections || [];
    const section = secList.find(s => String(s.section_name) === String(sectionName));
    if (!section) {
      alert('Section coordinates not found.');
      return;
    }
    const lat = parseFloat(section.lat);
    const lng = parseFloat(section.lng);
    if (isNaN(lat) || isNaN(lng)) {
      alert('Section coordinates not available.');
      return;
    }
    map.setView([lat, lng], 18, { animate: true });
  };
}

/***********************
 * Small sanitization helpers
 ***********************/
function sanitizeHTML(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeId(s) { return String(s).replace(/[^a-z0-9_\-]/gi, '_'); }
function escapeJS(s) { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"'); }
function unescapeJS(s) { return String(s).replace(/\\'/g,"'").replace(/\\"/g,'"').replace(/\\\\/g,'\\'); }
