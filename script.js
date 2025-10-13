// === CONFIG ===
const FACILITIES_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTkCSuWf7Rr2NpPRuHto4Y-RcWrTZbZMCvb15v3pdag-HK5WHy7jBtytswR93tAwgdBe_DqCLC5hx8e/pub?gid=0&single=true&output=csv';
const SECTIONS_URL   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTkCSuWf7Rr2NpPRuHto4Y-RcWrTZbZMCvb15v3pdag-HK5WHy7jBtytswR93tAwgdBe_DqCLC5hx8e/pub?gid=1505966964&single=true&output=csv';
const IMAGES_URL     = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTkCSuWf7Rr2NpPRuHto4Y-RcWrTZbZMCvb15v3pdag-HK5WHy7jBtytswR93tAwgdBe_DqCLC5hx8e/pub?gid=1369622257&single=true&output=csv';

const OLD_FAC_PATH = 'data/old_facilities.json';
const OLD_SEC_PATH = 'data/old_sections.json';
const OLD_IMG_PATH = 'data/old_images.json';

// === MAP SETUP ===
const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// global markers array for filtering
const markers = [];

// === DATA LOADING ===
Promise.all([
  fetch(FACILITIES_URL).then(r => r.text()),
  fetch(SECTIONS_URL).then(r => r.text()),
  fetch(IMAGES_URL).then(r => r.text()),
  fetch(OLD_FAC_PATH).then(r => r.json()),
  fetch(OLD_SEC_PATH).then(r => r.json()),
  fetch(OLD_IMG_PATH).then(r => r.json())
])
.then(([facCSV, secCSV, imgCSV, oldFac, oldSec, oldImg]) => {
  const facilities = parseCSV(facCSV); // returns array of objects
  const sections = parseCSV(secCSV);
  const images = parseCSV(imgCSV);

  // combine old JSON + sheets objects
  const allFacilities = [...oldFac, ...facilities];
  const allSections   = [...oldSec, ...sections];
  const allImages     = [...oldImg, ...images];

  initializeMap(allFacilities, allSections, allImages);
})
.catch(err => console.error('Data load error:', err));

// === UTILITIES ===
function parseCSV(text) {
  if (!text) return [];
  const rows = text.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i] : ''; });
    return obj;
  });
}

// === MAP LOGIC ===
function initializeMap(facilities, sections, images) {
  // map images keyed by facility_id + section_name
  const imageMap = {};
  images.forEach(img => {
    const key = `${img.facility_id || img.id}_${img.section_name || ''}`;
    if (!imageMap[key]) imageMap[key] = [];
    imageMap[key].push(img.image_url || img.url || img.image_url);
  });

  // gather unique floors (use string values)
  const floorSet = new Set();
  sections.forEach(s => { if (s.floor !== undefined && s.floor !== '') floorSet.add(String(s.floor)); });
  const floors = Array.from(floorSet).sort((a,b) => {
    // try numeric sort when possible
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  // create markers for sections
  sections.forEach(sec => {
    const fac = facilities.find(f => String(f.id) === String(sec.facility_id));
    if (!fac) return;
    if (!sec.lat || !sec.lng) return;

    const imgs = imageMap[`${fac.id}_${sec.section_name}`] || imageMap[`${fac.id}_`] || [];
    const gallery = imgs.map((img, i) =>
      `<a href="${img}" data-lightbox="${fac.name}-${sec.section_name}" data-title="${sec.section_name}">
         <img src="${img}" alt="${fac.name}" />
       </a>`
    ).join('');

    const popupHTML = `
      <div>
        <h3>${fac.name} – ${sec.section_name}</h3>
        <p><b>Sport:</b> ${fac.sport || ''}</p>
        <p>${sec.description || ''}</p>
        <div class="popup-gallery">${gallery}</div>
      </div>
    `;

    const marker = L.marker([parseFloat(sec.lat), parseFloat(sec.lng)]);
    marker.bindPopup(popupHTML);
    marker.floor = String(sec.floor || ''); // store floor as string
    marker.facility_id = String(sec.facility_id || '');

    marker.addTo(map);
    markers.push(marker);
  });

  // Create a Leaflet control for the floor selector (topright)
  const FloorControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      const container = L.DomUtil.create('div', 'floor-control');
      container.style.background = 'white';
      container.style.padding = '8px 10px';
      container.style.borderRadius = '6px';
      container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';
      container.innerHTML = `<label style="margin-right:6px;font-weight:600">Floor:</label>
        <select id="floorDropdown" style="min-width:120px;cursor:pointer">
          <option value="all">All Floors</option>
        </select>`;
      // prevent map interactions when interacting with the control
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      return container;
    }
  });
  map.addControl(new FloorControl());

  // populate dropdown
  const dropdown = document.getElementById('floorDropdown');
  floors.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = isNaN(Number(f)) ? `${f}` : `Floor ${f}`;
    dropdown.appendChild(opt);
  });

  // event listener for filtering
  dropdown.addEventListener('change', e => {
    const selected = e.target.value;
    markers.forEach(m => {
      const shouldShow = (selected === 'all') || (String(m.floor) === String(selected));
      if (shouldShow) {
        if (!map.hasLayer(m)) m.addTo(map);
      } else {
        if (map.hasLayer(m)) map.removeLayer(m);
      }
    });
  });
}
