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
  const facilities = parseCSV(facCSV);
  const sections = parseCSV(secCSV);
  const images = parseCSV(imgCSV);

  const allFacilities = [...oldFac, ...toObjects(facilities)];
  const allSections   = [...oldSec, ...toObjects(sections)];
  const allImages     = [...oldImg, ...toObjects(images)];

  initializeMap(allFacilities, allSections, allImages);
})
.catch(err => console.error('Data load error:', err));

// === UTILITIES ===
function parseCSV(text) {
  const rows = text.trim().split('\n').map(r => r.split(',').map(c => c.trim()));
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = r[i]);
    return obj;
  });
}
function toObjects(rows) { return rows; }

// === MAP LOGIC ===
function initializeMap(facilities, sections, images) {
  const imageMap = {};
  images.forEach(img => {
    const key = `${img.facility_id}_${img.section_name || ''}`;
    if (!imageMap[key]) imageMap[key] = [];
    imageMap[key].push(img.image_url);
  });

  // Collect unique floor numbers
  const floors = [...new Set(sections.map(s => s.floor))].sort();
  const floorDropdown = document.getElementById('floorDropdown');
  floors.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = `Floor ${f}`;
    floorDropdown.appendChild(opt);
  });

  const markers = [];

  sections.forEach(sec => {
    const fac = facilities.find(f => f.id === sec.facility_id);
    if (!fac || !sec.lat || !sec.lng) return;

    const imgs = imageMap[`${fac.id}_${sec.section_name}`] || [];
    const gallery = imgs.map((img, i) =>
      `<a href="${img}" data-lightbox="${fac.name}" data-title="${sec.section_name}">
         <img src="${img}" alt="${fac.name}" />
       </a>`
    ).join('');

    const popupHTML = `
      <div>
        <h3>${fac.name} – ${sec.section_name}</h3>
        <p><b>Sport:</b> ${fac.sport}</p>
        <p>${sec.description}</p>
        <div class="popup-gallery">${gallery}</div>
      </div>
    `;

    const marker = L.marker([parseFloat(sec.lat), parseFloat(sec.lng)])
      .bindPopup(popupHTML)
      .addTo(map);

    marker.floor = sec.floor;
    markers.push(marker);
  });

  // === FLOOR SELECTOR FILTER ===
  floorDropdown.addEventListener('change', e => {
    const selected = e.target.value;
    markers.forEach(m => {
      const visible = selected === 'all' || m.floor === selected;
      if (visible) m.addTo(map);
      else map.removeLayer(m);
    });
  });
}
