// E-Ronda RT 01 / RW 05 KebonAgung
// ---------------------------------------------------------------------------
// CATATAN KEAMANAN
// - Tidak ada PIN / password di file ini. Login diperiksa oleh Firebase Auth.
// - Hak admin ditentukan oleh akun yang login (dicek server lewat firestore.rules),
//   BUKAN oleh variabel di browser. Menyembunyikan tombol hanya soal tampilan.
// - Semua data dari database ditampilkan lewat esc() supaya tidak bisa menyisipkan HTML/skrip.
// - apiKey Firebase di bawah memang publik (bukan rahasia). Yang melindungi data adalah firestore.rules.
// ---------------------------------------------------------------------------

const KODE_RT = 'KBN01';
const EMAIL_ADMIN = 'admin@e-ronda-kebonagung.firebaseapp.com';
const EMAIL_WARGA = 'warga@e-ronda-kebonagung.firebaseapp.com';
const NAMA_RT = 'RT 01 / RW 05 KebonAgung';
const LOGO = 'https://i.ibb.co.com/21BpG3JY/RT-01.png';
const FB = 'https://www.gstatic.com/firebasejs/11.6.1/';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAmQN1gOPKs6Up2rxLK0d94t1_9f3flRAw',
  authDomain: 'e-ronda-kebonagung.firebaseapp.com',
  projectId: 'e-ronda-kebonagung',
  storageBucket: 'e-ronda-kebonagung.firebasestorage.app',
  messagingSenderId: '892632721018',
  appId: '1:892632721018:web:f412f57a7de8f010d9bdc3'
};
const BATAS_DOK = 900000;   // Firestore maks ~1 MB per dokumen; sisakan ruang
const MAKS_FOTO = 6;

// Cegah aplikasi dibuka di dalam iframe situs lain (clickjacking)
if (window.top !== window.self) { try { window.top.location = window.self.location; } catch (e) { document.body.innerHTML = ''; } }

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const rp = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num(n));
const titik = (n) => String(Math.trunc(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const angka = (s) => { const neg = /^\s*-/.test(String(s || '')); const d = String(s || '').replace(/\D/g, ''); return d ? (neg ? -1 : 1) * parseInt(d, 10) : NaN; };
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const URUT_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const STATUS_PRESENSI = ['Hadir', 'Izin', 'Absen'];
const byNama = (a, b) => String(a.nama || '').localeCompare(String(b.nama || ''), 'id');

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYMD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function tglPanjang(s) { const d = parseYMD(s); return d ? d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : String(s || '-'); }
function tglPendek(s) { const d = parseYMD(s); return d ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : String(s || '-'); }
function hariDari(s) { const d = parseYMD(s); return d ? HARI[d.getDay()] : ''; }
function mingguInfo(s) {
  const d = parseYMD(s); if (!d) return null;
  const senin = new Date(d); senin.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const minggu = new Date(senin); minggu.setDate(senin.getDate() + 6);
  const f = (x) => x.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return { id: ymd(senin), label: `${f(senin)} – ${f(minggu)}` };
}
// Hanya izinkan gambar base64 yang dibuat oleh aplikasi ini (mencegah src="javascript:" / URL pelacak)
function imgAman(src) {
  return (typeof src === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(src)) ? src : '';
}
let idTerakhir = 0;
function idBaru() { let t = Date.now(); if (t <= idTerakhir) t = idTerakhir + 1; idTerakhir = t; return t; }
function bersihTeks(s, maks) { return String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maks); }

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  role: null, loginMode: 'warga',
  warga: [], tipe: [], denda: [], mutasi: [], presensi: {}, rencana: [], aspirasi: [], offset: 0,
  tab: 'beranda', sub: { ronda: 'jadwal', kas: 'tagihan' },
  filter: { tagihan: 'belum', kas: 'semua' },
  presensiTgl: ymd(), grupTerbuka: new Set(), unsub: [], galatDitampilkan: false
};
let fb = null;

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------
async function muatFirebase() {
  const [appM, authM, fsM] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')
  ]);
  const app = appM.initializeApp(FIREBASE_CONFIG);
  fb = { authM, fsM, auth: authM.getAuth(app), db: fsM.getFirestore(app) };
}
const koleksi = (n) => fb.fsM.collection(fb.db, `${KODE_RT}_${n}`);
const dok = (n, id) => fb.fsM.doc(fb.db, `${KODE_RT}_${n}`, String(id));
const batch = () => fb.fsM.writeBatch(fb.db);
const tambah = (n) => fb.fsM.increment(n);
const hapusField = () => fb.fsM.deleteField();

async function simpan(janji, pesanOk) {
  try { await janji; if (pesanOk) toast(pesanOk); return true; }
  catch (e) {
    console.error(e);
    if (e && e.code === 'permission-denied') info('Akses ditolak', 'Akun Anda tidak berhak mengubah data ini.');
    else info('Gagal menyimpan', 'Periksa koneksi internet lalu coba lagi.');
    return false;
  }
}

function pasangListener() {
  lepasListener();
  const on = (q, fn) => S.unsub.push(fb.fsM.onSnapshot(q, fn, galatListener));
  on(koleksi('warga'), (s) => { S.warga = s.docs.map((d) => d.data()).filter((w) => w && w.id != null).map((w) => ({ ...w, id: num(w.id), deposit: num(w.deposit) })); segarkan(); });
  on(koleksi('pengaturan_denda'), (s) => { S.tipe = s.docs.map((d) => d.data()).filter((t) => t && t.tipe).map((t) => ({ ...t, id: num(t.id), nominal: num(t.nominal) })); segarkan(); });
  on(koleksi('denda'), (s) => { S.denda = s.docs.map((d) => d.data()).filter((x) => x && x.id != null).map((x) => ({ ...x, id: num(x.id), wargaId: num(x.wargaId), nominal: num(x.nominal), potonganDeposit: num(x.potonganDeposit) })); segarkan(); });
  on(koleksi('mutasi'), (s) => { S.mutasi = s.docs.map((d) => ({ ...d.data(), _doc: d.id })).filter((m) => m && (m.jenis === 'Pemasukan' || m.jenis === 'Pengeluaran')).map((m) => ({ ...m, id: m.id != null ? num(m.id) : num(m._doc), nominal: num(m.nominal) })); segarkan(); });
  on(koleksi('presensi'), (s) => { const p = {}; s.docs.forEach((d) => { p[d.id] = d.data() || {}; }); S.presensi = p; segarkan(); });
  on(koleksi('rencana'), (s) => { S.rencana = s.docs.map((d) => d.data()).filter((r) => r && r.id != null).map((r) => ({ ...r, id: num(r.id) })); segarkan(); });
  on(koleksi('aspirasi'), (s) => { S.aspirasi = s.docs.map((d) => d.data()).filter((a) => a && a.id != null).map((a) => ({ ...a, id: num(a.id) })); segarkan(); });
  on(dok('pengaturan_kas', 'saldo'), (s) => { S.offset = s.exists() ? num(s.data().offset) : 0; segarkan(); });
}
function lepasListener() { S.unsub.forEach((u) => { try { u(); } catch (e) { /* abaikan */ } }); S.unsub = []; }
function galatListener(e) {
  console.error(e);
  if (S.galatDitampilkan) return;
  S.galatDitampilkan = true;
  if (e && e.code === 'permission-denied') info('Akses data ditolak', 'Sesi Anda mungkin sudah berakhir. Silakan keluar lalu masuk lagi.');
  else toast('Koneksi ke server terputus. Data akan diperbarui otomatis saat online.');
}

let jadwalRender = 0;
function segarkan() {
  if (jadwalRender) return;
  jadwalRender = requestAnimationFrame(() => { jadwalRender = 0; renderTab(); });
}

// ---------------------------------------------------------------------------
// Login / keluar
// ---------------------------------------------------------------------------
let gagalLogin = 0, kunciSampai = 0;

function tampilLogin() {
  lepasListener();
  $('#boot').hidden = true; $('#app').hidden = true; $('#login').hidden = false;
  document.body.classList.remove('is-admin');
  setModeLogin(S.loginMode);
}
function setModeLogin(mode) {
  S.loginMode = mode === 'admin' ? 'admin' : 'warga';
  $$('[data-act="mode-login"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === S.loginMode)));
  const inp = $('#login-kode');
  $('#login-lbl').textContent = S.loginMode === 'admin' ? 'Kata sandi pengurus' : 'PIN warga';
  inp.setAttribute('inputmode', S.loginMode === 'admin' ? 'text' : 'numeric');
  inp.classList.toggle('kode', S.loginMode === 'warga');
  inp.value = ''; $('#login-err').textContent = '';
}
async function prosesLogin(e) {
  e.preventDefault();
  const err = $('#login-err'), btn = $('#login-btn'), inp = $('#login-kode');
  const sisa = Math.ceil((kunciSampai - Date.now()) / 1000);
  if (sisa > 0) { err.textContent = `Terlalu banyak percobaan. Tunggu ${sisa} detik.`; return; }
  const kode = inp.value;
  if (kode.length < 6) { err.textContent = S.loginMode === 'admin' ? 'Kata sandi minimal 6 karakter.' : 'PIN minimal 6 angka.'; return; }
  btn.disabled = true; btn.textContent = 'Memeriksa…'; err.textContent = '';
  try {
    // Pengurus: sesi hilang saat tab/browser ditutup. Warga: tetap masuk di HP sendiri.
    await fb.authM.setPersistence(fb.auth, S.loginMode === 'admin' ? fb.authM.browserSessionPersistence : fb.authM.browserLocalPersistence);
    await fb.authM.signInWithEmailAndPassword(fb.auth, S.loginMode === 'admin' ? EMAIL_ADMIN : EMAIL_WARGA, kode);
    gagalLogin = 0;
  } catch (ex) {
    const c = (ex && ex.code) || '';
    if (c === 'auth/too-many-requests') err.textContent = 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.';
    else if (c === 'auth/network-request-failed') err.textContent = 'Tidak ada koneksi internet.';
    else {
      gagalLogin++;
      if (gagalLogin >= 5) kunciSampai = Date.now() + Math.min(300, 30 * 2 ** (gagalLogin - 5)) * 1000;
      err.textContent = S.loginMode === 'admin' ? 'Kata sandi salah.' : 'PIN salah.';
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Masuk'; inp.value = '';
  }
}
function masukApp(user) {
  S.role = user.email === EMAIL_ADMIN ? 'admin' : 'warga';
  S.galatDitampilkan = false;
  document.body.classList.toggle('is-admin', S.role === 'admin');
  const peran = $('#peran');
  peran.textContent = S.role === 'admin' ? 'Pengurus' : 'Warga';
  peran.classList.toggle('admin', S.role === 'admin');
  $('#boot').hidden = true; $('#login').hidden = true; $('#app').hidden = false;
  pasangListener();
  gantiTab('beranda');
}
async function keluar() {
  if (!(await konfirmasi('Keluar dari aplikasi?', 'Anda perlu memasukkan PIN lagi untuk masuk.', 'Keluar'))) return;
  lepasListener();
  Object.assign(S, { warga: [], tipe: [], denda: [], mutasi: [], presensi: {}, rencana: [], aspirasi: [], offset: 0, role: null });
  await fb.authM.signOut(fb.auth);
}
const isAdmin = () => S.role === 'admin';

// ---------------------------------------------------------------------------
// Navigasi
// ---------------------------------------------------------------------------
function gantiTab(tab, sub) {
  S.tab = tab;
  if (sub) S.sub[tab] = sub;
  $$('.view').forEach((v) => { v.hidden = v.id !== `v-${tab}`; });
  $$('.tabs button').forEach((b) => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
  renderTab();
}
function renderTab() {
  if (!S.role) return;
  if (S.tab === 'beranda') renderBeranda();
  if (S.tab === 'ronda') renderRonda();
  if (S.tab === 'kas') renderKas();
  if (S.tab === 'info') renderInfo();
}
function setSub(view, sub) {
  S.sub[view] = sub;
  $$(`[data-act="sub"][data-view="${view}"]`).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sub === sub)));
  $$(`#v-${view} > div[id^="${view}-"]`).forEach((el) => { el.hidden = el.id !== `${view}-${sub}`; });
}

// ---------------------------------------------------------------------------
// Hitungan
// ---------------------------------------------------------------------------
const nominalTipe = (tipe) => { const t = S.tipe.find((x) => x.tipe === tipe); return t ? num(t.nominal) : 0; };
const totalMutasi = () => S.mutasi.reduce((s, m) => (m.jenis === 'Pemasukan' ? s + m.nominal : s - m.nominal), 0);
const saldoKas = () => totalMutasi() + S.offset;
const totalTunggakan = () => S.denda.filter((d) => d.status === 'Belum Dibayar').reduce((s, d) => s + d.nominal, 0);
const namaWarga = (id, cadangan) => { const w = S.warga.find((x) => x.id === id); return w ? w.nama : (cadangan || 'Warga'); };
const hariMalamIni = () => HARI[(new Date().getDay() + 1) % 7]; // "malam Senin" = Minggu malam
function statusPresensi(rec, id) { const v = rec && rec[id]; return STATUS_PRESENSI.includes(v) ? v : 'Belum'; }
function ringkasPresensi(tgl) {
  const rec = S.presensi[tgl] || {}; const r = { Hadir: 0, Izin: 0, Absen: 0 };
  Object.keys(rec).forEach((k) => { if (/^\d+$/.test(k) && r[rec[k]] !== undefined) r[rec[k]]++; });
  return r;
}
function fotoPresensi(tgl) { const f = (S.presensi[tgl] || {}).bukti_foto; return Array.isArray(f) ? f.filter(imgAman) : []; }

// ---------------------------------------------------------------------------
// BERANDA
// ---------------------------------------------------------------------------
function renderBeranda() {
  const hari = hariMalamIni();
  const regu = S.warga.filter((w) => w.jadwal === hari).sort(byNama);
  $('#b-malam').innerHTML = `
    <i class="fa-solid fa-lightbulb lampu" aria-hidden="true"></i>
    <p class="kecil">Regu ronda malam ini</p>
    <div class="hari">Malam ${esc(hari)}</div>
    ${regu.length ? `<ul>${regu.map((w) => `<li>${esc(w.nama)}</li>`).join('')}</ul>` : '<p class="kecil">Belum ada warga di regu ini.</p>'}`;

  const saldo = saldoKas();
  $('#b-stats').innerHTML = `
    <button class="stat" data-act="goto" data-tab="kas" data-sub="kas"><span>Saldo kas</span><b style="color:${saldo < 0 ? 'var(--merah)' : 'inherit'}">${rp(saldo)}</b></button>
    <button class="stat" data-act="goto" data-tab="kas" data-sub="tagihan"><span>Tunggakan</span><b style="color:var(--merah)">${rp(totalTunggakan())}</b></button>
    <button class="stat lebar" data-act="goto" data-tab="ronda" data-sub="jadwal"><span>Warga terdaftar</span><b>${S.warga.length} orang</b></button>`;

  const tgl = Object.keys(S.presensi).filter((t) => parseYMD(t)).filter((t) => {
    const r = ringkasPresensi(t); return r.Hadir + r.Izin + r.Absen > 0 || fotoPresensi(t).length > 0;
  }).sort((a, b) => b.localeCompare(a)).slice(0, 6);
  $('#b-presensi').innerHTML = tgl.length ? tgl.map((t) => {
    const r = ringkasPresensi(t); const foto = fotoPresensi(t).length;
    return `<button class="item" data-act="buka-presensi" data-tgl="${esc(t)}">
      <div class="bulat"><i class="fa-regular fa-calendar"></i></div>
      <div class="isi"><b>${esc(tglPanjang(t))}</b><small>${r.Hadir} hadir · ${r.Izin} izin · ${r.Absen} absen${foto ? ` · ${foto} foto` : ''}</small></div>
      <i class="fa-solid fa-chevron-right redup"></i></button>`;
  }).join('') : '<div class="kosong">Belum ada presensi yang dicatat.</div>';
}

// ---------------------------------------------------------------------------
// RONDA — jadwal
// ---------------------------------------------------------------------------
function renderRonda() {
  setSub('ronda', S.sub.ronda);
  if (S.sub.ronda === 'jadwal') renderJadwal(); else renderPresensi();
}
function renderJadwal() {
  const malam = hariMalamIni();
  const grup = {}; URUT_HARI.forEach((h) => { grup[h] = []; });
  const tanpa = [];
  S.warga.forEach((w) => (grup[w.jadwal] ? grup[w.jadwal].push(w) : tanpa.push(w)));
  const kartu = (judul, list, isMalam) => `
    <div class="hari-kartu ${isMalam ? 'malam-ini' : ''}">
      <div class="hari-kepala"><b>${esc(judul)}</b>
        <span class="baris">${isMalam ? '<span class="tanda-malam">Malam ini</span>' : ''}<span class="redup kecil">${list.length} orang</span></span></div>
      ${list.sort(byNama).map((w) => {
        const isi = `<div class="isi"><b>${esc(w.nama)}</b><small>${esc(w.tipe || '-')}${w.wa ? ' · <i class="fa-brands fa-whatsapp"></i> ada WA' : ''}</small></div>`;
        return isAdmin()
          ? `<button class="warga-baris" data-act="edit-warga" data-id="${w.id}">${isi}<i class="fa-solid fa-pen redup kecil"></i></button>`
          : `<div class="warga-baris">${isi}</div>`;
      }).join('')}
    </div>`;
  let html = URUT_HARI.filter((h) => grup[h].length).map((h) => kartu(h, grup[h], h === malam)).join('');
  if (tanpa.length) html += kartu('Tanpa jadwal', tanpa, false);
  $('#jadwal-list').innerHTML = html || '<div class="kosong">Belum ada warga. Pengurus bisa menambahkan lewat tombol “Tambah warga”.</div>';
}

// ---------------------------------------------------------------------------
// RONDA — presensi
// ---------------------------------------------------------------------------
function renderPresensi() {
  const tgl = S.presensiTgl, hari = hariDari(tgl), rec = S.presensi[tgl] || {};
  const inp = $('#p-tgl'); if (inp.value !== tgl) inp.value = tgl;
  $('#p-hari').textContent = hari;
  const regu = S.warga.filter((w) => w.jadwal === hari).sort(byNama);
  $('#p-list').innerHTML = regu.length ? regu.map((w) => {
    const st = statusPresensi(rec, w.id), ket = rec[`${w.id}_ket`];
    const aksi = isAdmin() ? `<div class="p-aksi">
        ${STATUS_PRESENSI.map((s) => `<button data-act="presensi" data-id="${w.id}" data-st="${s}" aria-pressed="${st === s}">${s}</button>`).join('')}
        <button data-act="presensi" data-id="${w.id}" data-st="Hapus" aria-label="Kosongkan status" ${st === 'Belum' ? 'disabled' : ''}><i class="fa-solid fa-rotate-left"></i></button>
      </div>` : '';
    return `<div class="p-baris">
      <div class="baris antara"><div><b>${esc(w.nama)}</b> <span class="redup kecil">${esc(w.tipe || '')}</span></div>
        <span class="st st-${st}">${st === 'Belum' ? 'Belum dicatat' : st}</span></div>
      ${st === 'Izin' && ket ? `<p class="kecil redup" style="margin:4px 0 0">Keterangan: ${esc(ket)}</p>` : ''}
      ${aksi}</div>`;
  }).join('') : `<div class="kosong">Tidak ada warga yang terjadwal hari ${esc(hari || '-')}.</div>`;

  const foto = fotoPresensi(tgl);
  $('#p-foto').innerHTML = foto.length ? foto.map((src, i) => `
    <div class="foto"><button data-act="lihat-foto" data-sumber="presensi" data-idx="${i}" aria-label="Lihat foto ${i + 1}"><img src="${esc(src)}" alt=""></button>
    ${isAdmin() ? `<button class="hapus" data-act="hapus-foto-presensi" data-idx="${i}" aria-label="Hapus foto"><i class="fa-solid fa-xmark"></i></button>` : ''}</div>`).join('')
    : '<span class="redup kecil">Belum ada foto untuk tanggal ini.</span>';
}

async function setPresensi(wargaId, status, ketIzin) {
  if (!isAdmin()) return;
  const tgl = S.presensiTgl;
  const w = S.warga.find((x) => x.id === wargaId); if (!w || !parseYMD(tgl)) return;
  const prev = statusPresensi(S.presensi[tgl], wargaId);
  if (status === prev && status !== 'Izin') return;

  const b = batch();
  const payload = {};
  if (status === 'Hapus') { payload[wargaId] = hapusField(); payload[`${wargaId}_ket`] = hapusField(); }
  else { payload[wargaId] = status; payload[`${wargaId}_ket`] = status === 'Izin' && ketIzin ? ketIzin : hapusField(); }
  b.set(dok('presensi', tgl), payload, { merge: true });

  if (status === 'Absen' && prev !== 'Absen') {
    const nominal = nominalTipe(w.tipe);
    if (nominal > 0) {
      const id = idBaru(), deposit = Math.max(0, num(w.deposit));
      const potong = Math.min(deposit, nominal), sisa = nominal - potong;
      if (potong > 0) b.update(dok('warga', w.id), { deposit: tambah(-potong) });
      const data = { id, wargaId: w.id, namaWarga: w.nama, tanggal: tgl, nominal: sisa === 0 ? nominal : sisa,
        status: sisa === 0 ? 'Lunas' : 'Belum Dibayar',
        keterangan: potong === 0 ? `Tidak berangkat (${tgl})` : (sisa === 0 ? `Tidak berangkat (${tgl}) - Lunas dipotong Deposit` : `Tidak berangkat (${tgl}) - Sisa setelah dipotong Deposit`) };
      if (potong > 0) data.potonganDeposit = potong;
      b.set(dok('denda', id), data);
    }
  } else if (prev === 'Absen' && status !== 'Absen') {
    const terkait = S.denda.filter((d) => d.wargaId === wargaId && d.tanggal === tgl && String(d.keterangan || '').includes('Tidak berangkat'));
    const sudahDibayarTunai = terkait.some((d) => d.status === 'Lunas' && !(d.potonganDeposit >= d.nominal));
    if (sudahDibayarTunai && !(await konfirmasi('Denda sudah dibayar', 'Denda untuk tanggal ini sudah lunas dibayar. Tagihannya akan dihapus, tapi pemasukan di kas tidak ikut terhapus. Lanjutkan?', 'Lanjutkan'))) return;
    terkait.forEach((d) => {
      if (d.potonganDeposit > 0) b.update(dok('warga', wargaId), { deposit: tambah(d.potonganDeposit) });
      b.delete(dok('denda', d.id));
    });
  }
  await simpan(b.commit(), `${w.nama}: ${status === 'Hapus' ? 'status dikosongkan' : status}`);
}

function bukaIzin(wargaId) {
  const w = S.warga.find((x) => x.id === wargaId); if (!w) return;
  const ketLama = (S.presensi[S.presensiTgl] || {})[`${wargaId}_ket`] || '';
  bukaSheet('Keterangan izin', `
    <form id="f">
      <p class="redup" style="margin-top:0">${esc(w.nama)} · ${esc(tglPanjang(S.presensiTgl))}</p>
      <div class="fld"><label class="lbl" for="f-ket">Alasan</label>
        <input id="f-ket" class="inp" maxlength="120" required placeholder="Contoh: sakit, dinas luar kota" value="${esc(ketLama)}"></div>
      <div class="sheet-kaki"><button type="button" class="btn lembut" data-act="tutup-sheet">Batal</button><button class="btn">Simpan izin</button></div>
    </form>`, (root) => {
    formSubmit(root, async () => {
      const ket = bersihTeks($('#f-ket', root).value, 120);
      if (!ket) return info('Keterangan kosong', 'Isi alasan izin terlebih dahulu.');
      tutupSheet(); await setPresensi(wargaId, 'Izin', ket);
    });
  });
}

async function unggahFotoPresensi(input) {
  if (!isAdmin() || !input.files || !input.files.length) return;
  const tgl = S.presensiTgl, lama = fotoPresensi(tgl);
  const lbl = $('#p-foto-lbl');
  try {
    if (lama.length + input.files.length > MAKS_FOTO) return info('Terlalu banyak foto', `Maksimal ${MAKS_FOTO} foto per tanggal.`);
    lbl.textContent = 'Memproses…'; input.disabled = true;
    const baru = await prosesFoto(input.files);
    const semua = lama.concat(baru);
    if (ukuran(semua) > BATAS_DOK) return info('Foto terlalu besar', 'Total ukuran foto untuk tanggal ini melebihi batas. Kurangi jumlah foto.');
    await simpan(fb.fsM.setDoc(dok('presensi', tgl), { bukti_foto: semua }, { merge: true }), 'Foto kegiatan ditambahkan.');
  } catch (e) { console.error(e); info('Gagal memproses foto', 'Pastikan file yang dipilih adalah gambar.'); }
  finally { lbl.textContent = 'Tambah foto'; input.disabled = false; input.value = ''; }
}
async function hapusFotoPresensi(idx) {
  if (!(await konfirmasi('Hapus foto?', 'Foto ini akan dihapus permanen.', 'Hapus', true))) return;
  const foto = fotoPresensi(S.presensiTgl); foto.splice(idx, 1);
  await simpan(fb.fsM.setDoc(dok('presensi', S.presensiTgl), { bukti_foto: foto }, { merge: true }), 'Foto dihapus.');
}

// ---------------------------------------------------------------------------
// Warga & tipe iuran (pengurus)
// ---------------------------------------------------------------------------
function formWarga(id) {
  const w = id != null ? S.warga.find((x) => x.id === id) : null;
  if (!S.tipe.length) return info('Tipe iuran belum ada', 'Tambahkan tipe iuran dulu lewat tombol “Tipe iuran”.');
  bukaSheet(w ? 'Ubah data warga' : 'Tambah warga', `
    <form id="f">
      <div class="fld"><label class="lbl" for="f-nama">Nama lengkap</label><input id="f-nama" class="inp" maxlength="60" required value="${esc(w ? w.nama : '')}"></div>
      <div class="grid2">
        <div class="fld"><label class="lbl" for="f-tipe">Tipe iuran</label><select id="f-tipe" class="inp">
          ${S.tipe.map((t) => `<option value="${esc(t.tipe)}" ${w && w.tipe === t.tipe ? 'selected' : ''}>${esc(t.tipe)} (${rp(t.nominal)})</option>`).join('')}</select></div>
        <div class="fld"><label class="lbl" for="f-jadwal">Jadwal ronda</label><select id="f-jadwal" class="inp">
          ${URUT_HARI.map((h) => `<option ${w && w.jadwal === h ? 'selected' : ''}>${h}</option>`).join('')}</select></div>
      </div>
      <div class="fld"><label class="lbl" for="f-wa">Nomor WhatsApp (opsional)</label><input id="f-wa" class="inp" inputmode="tel" maxlength="16" placeholder="08123456789" value="${esc(w ? w.wa || '' : '')}"></div>
      <div class="sheet-kaki">
        ${w ? '<button type="button" class="btn lembut" data-act="hapus-warga" style="flex:0 0 auto;color:var(--merah)" aria-label="Hapus warga"><i class="fa-solid fa-trash"></i></button>' : ''}
        <button type="button" class="btn lembut" data-act="tutup-sheet">Batal</button><button class="btn">Simpan</button></div>
    </form>`, (root) => {
    const hapus = $('[data-act="hapus-warga"]', root); if (hapus) hapus.dataset.id = w.id;
    formSubmit(root, async () => {
      const nama = bersihTeks($('#f-nama', root).value, 60);
      const wa = $('#f-wa', root).value.replace(/\D/g, '');
      const tipe = $('#f-tipe', root).value, jadwal = $('#f-jadwal', root).value;
      if (!nama) return info('Nama kosong', 'Nama lengkap wajib diisi.');
      if (wa && (wa.length < 9 || wa.length > 15)) return info('Nomor WA tidak valid', 'Nomor WhatsApp harus 9–15 angka.');
      if (!S.tipe.some((t) => t.tipe === tipe) || !URUT_HARI.includes(jadwal)) return;
      const newId = w ? w.id : idBaru();
      const data = { nama, tipe, jadwal, wa };
      if (!w) Object.assign(data, { id: newId, deposit: 0 });
      if (await simpan(fb.fsM.setDoc(dok('warga', newId), data, { merge: true }), w ? 'Data warga diperbarui.' : 'Warga ditambahkan.')) tutupSheet();
    });
  });
}
async function hapusWarga(id) {
  const w = S.warga.find((x) => x.id === id); if (!w) return;
  const hutang = S.denda.filter((d) => d.wargaId === id && d.status === 'Belum Dibayar').reduce((s, d) => s + d.nominal, 0);
  const pesan = `${w.nama} akan dihapus dari jadwal.` + (hutang ? `\nMasih ada tunggakan ${rp(hutang)} yang tetap tercatat.` : '') + (w.deposit ? `\nSaldo deposit ${rp(w.deposit)} akan ikut hilang.` : '');
  if (!(await konfirmasi('Hapus warga?', pesan, 'Hapus', true))) return;
  if (await simpan(fb.fsM.deleteDoc(dok('warga', id)), 'Warga dihapus.')) tutupSheet();
}

function kelolaTipe() {
  const render = (root) => {
    $('#tipe-list', root).innerHTML = S.tipe.length ? S.tipe.slice().sort((a, b) => b.nominal - a.nominal).map((t) => {
      const dipakai = S.warga.filter((w) => w.tipe === t.tipe).length;
      return `<div class="item"><div class="isi"><b>${esc(t.tipe)}</b><small>${rp(t.nominal)} per absen · ${dipakai} warga</small></div>
        <button class="btn kecil lembut" data-act="hapus-tipe" data-id="${t.id}" ${dipakai ? 'disabled title="Masih dipakai warga"' : ''} aria-label="Hapus tipe"><i class="fa-solid fa-trash"></i></button></div>`;
    }).join('') : '<div class="kosong">Belum ada tipe.</div>';
  };
  bukaSheet('Tipe iuran', `
    <p class="redup kecil" style="margin-top:0">Nominal ini dikenakan otomatis sebagai denda saat warga tercatat absen.</p>
    <div id="tipe-list" class="daftar"></div>
    <form id="f" style="margin-top:16px">
      <div class="grid2">
        <div class="fld"><label class="lbl" for="f-tn">Nama tipe</label><input id="f-tn" class="inp" maxlength="30" required placeholder="Reguler"></div>
        <div class="fld"><label class="lbl" for="f-tnom">Nominal (Rp)</label><input id="f-tnom" class="inp rupiah" inputmode="numeric" required placeholder="10.000"></div>
      </div>
      <button class="btn full">Tambah tipe</button>
    </form>`, (root) => {
    render(root);
    root._segarkan = () => render(root);
    formSubmit(root, async () => {
      const nama = bersihTeks($('#f-tn', root).value, 30), nom = angka($('#f-tnom', root).value);
      if (!nama || !Number.isFinite(nom) || nom < 0) return info('Data tidak valid', 'Isi nama tipe dan nominal dengan benar.');
      if (S.tipe.some((t) => t.tipe.toLowerCase() === nama.toLowerCase())) return info('Sudah ada', 'Tipe dengan nama itu sudah ada.');
      const id = idBaru();
      if (await simpan(fb.fsM.setDoc(dok('pengaturan_denda', id), { id, tipe: nama, nominal: nom }), 'Tipe ditambahkan.')) {
        $('#f-tn', root).value = ''; $('#f-tnom', root).value = '';
      }
    });
  });
}
async function hapusTipe(id) {
  const t = S.tipe.find((x) => x.id === id); if (!t) return;
  if (S.warga.some((w) => w.tipe === t.tipe)) return info('Masih dipakai', 'Pindahkan dulu warga yang memakai tipe ini.');
  if (!(await konfirmasi('Hapus tipe?', `Tipe “${t.tipe}” akan dihapus.`, 'Hapus', true))) return;
  await simpan(fb.fsM.deleteDoc(dok('pengaturan_denda', id)), 'Tipe dihapus.');
}

// ---------------------------------------------------------------------------
// KAS — tagihan
// ---------------------------------------------------------------------------
function renderKas() {
  setSub('kas', S.sub.kas);
  $$('[data-act="filter"]').forEach((b) => b.setAttribute('aria-pressed', String(S.filter[b.dataset.f] === b.dataset.v)));
  if (S.sub.kas === 'tagihan') renderTagihan();
  if (S.sub.kas === 'kas') renderMutasi();
  if (S.sub.kas === 'deposit') renderDeposit();
}
function renderTagihan() {
  const f = S.filter.tagihan;
  const list = S.denda.filter((d) => f === 'semua' || (f === 'belum' ? d.status === 'Belum Dibayar' : d.status !== 'Belum Dibayar'));
  const totalBelum = totalTunggakan();
  const jmlWarga = new Set(S.denda.filter((d) => d.status === 'Belum Dibayar').map((d) => d.wargaId)).size;
  $('#tagihan-ringkas').innerHTML = `<span class="redup kecil">Total belum lunas${jmlWarga ? ` · ${jmlWarga} warga` : ''}</span><b style="display:block;font-size:19px;color:${totalBelum ? 'var(--merah)' : 'var(--hijau)'}">${rp(totalBelum)}</b>`;

  const grup = new Map();
  list.forEach((d) => { if (!grup.has(d.wargaId)) grup.set(d.wargaId, []); grup.get(d.wargaId).push(d); });
  const urut = [...grup.entries()].map(([id, items]) => ({
    id, nama: namaWarga(id, items[0].namaWarga), items: items.sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal))),
    belum: items.filter((d) => d.status === 'Belum Dibayar').reduce((s, d) => s + d.nominal, 0),
    total: items.reduce((s, d) => s + d.nominal, 0)
  })).sort((a, b) => b.belum - a.belum || a.nama.localeCompare(b.nama, 'id'));

  $('#tagihan-list').innerHTML = urut.length ? urut.map((g) => `
    <details class="grup" data-kunci="w${g.id}" ${S.grupTerbuka.has(`w${g.id}`) ? 'open' : ''}>
      <summary>
        <div class="bulat ${g.belum ? 'keluar' : 'masuk'}"><i class="fa-solid ${g.belum ? 'fa-receipt' : 'fa-check'}"></i></div>
        <div class="isi" style="flex:1;min-width:0"><b>${esc(g.nama)}</b><small class="redup">${g.items.length} catatan</small></div>
        <b class="${g.belum ? 'uang-keluar' : 'uang-masuk'}">${rp(g.belum || g.total)}</b>
        <i class="fa-solid fa-chevron-down panah"></i>
      </summary>
      <div class="grup-isi">
        ${g.items.map((d) => {
          const lunas = d.status !== 'Belum Dibayar';
          return `<div class="tagihan-baris">
            <div class="isi"><b>${esc(tglPendek(d.tanggal))}</b><br><span class="redup kecil">${esc(d.keterangan || '')}</span></div>
            <div style="text-align:right"><b>${rp(d.nominal)}</b><br>
              ${isAdmin() && !lunas ? `<button class="btn kecil hijau" data-act="bayar-denda" data-id="${d.id}">Bayar</button>` : `<span class="st ${lunas ? 'st-Lunas' : 'st-Belum'}">${lunas ? 'Lunas' : 'Belum'}</span>`}
            </div>
            ${isAdmin() ? `<button class="ikon-btn" style="color:var(--redup);width:32px" data-act="edit-denda" data-id="${d.id}" aria-label="Ubah tagihan"><i class="fa-solid fa-ellipsis-vertical"></i></button>` : ''}
          </div>`;
        }).join('')}
        ${isAdmin() && g.belum ? `<button class="btn kecil hijau full" style="margin-top:8px" data-act="nota-wa" data-id="${g.id}"><i class="fa-brands fa-whatsapp"></i> Kirim nota tagihan</button>` : ''}
      </div>
    </details>`).join('') : `<div class="kosong">${f === 'belum' ? 'Tidak ada tunggakan. Semua warga sudah lunas.' : 'Belum ada catatan tagihan.'}</div>`;
}

async function bayarDenda(id) {
  const d = S.denda.find((x) => x.id === id); if (!d || d.status !== 'Belum Dibayar') return;
  if (!(await konfirmasi('Terima pembayaran?', `${namaWarga(d.wargaId, d.namaWarga)} membayar ${rp(d.nominal)} untuk ${tglPendek(d.tanggal)}. Uang akan masuk ke kas.`, 'Terima', false))) return;
  const b = batch(), idm = idBaru();
  b.update(dok('denda', d.id), { status: 'Lunas' });
  b.set(dok('mutasi', idm), { id: idm, tanggal: ymd(), jenis: 'Pemasukan', nominal: d.nominal, kategori: 'Denda', keterangan: `Pembayaran Denda: ${d.namaWarga} (${d.tanggal})` });
  await simpan(b.commit(), 'Pembayaran diterima dan masuk kas.');
}
function editDenda(id) {
  const d = S.denda.find((x) => x.id === id); if (!d) return;
  bukaSheet('Ubah tagihan', `
    <form id="f">
      <p class="redup" style="margin-top:0">${esc(namaWarga(d.wargaId, d.namaWarga))} · ${esc(tglPanjang(d.tanggal))}</p>
      <div class="fld"><label class="lbl" for="f-nom">Nominal (Rp)</label><input id="f-nom" class="inp rupiah" inputmode="numeric" required value="${titik(d.nominal)}"></div>
      <div class="fld"><label class="lbl" for="f-ket">Keterangan</label><input id="f-ket" class="inp" maxlength="120" required value="${esc(d.keterangan || '')}"></div>
      <div class="sheet-kaki">
        <button type="button" class="btn lembut" data-act="hapus-denda" data-id="${d.id}" style="flex:0 0 auto;color:var(--merah)" aria-label="Hapus tagihan"><i class="fa-solid fa-trash"></i></button>
        <button type="button" class="btn lembut" data-act="tutup-sheet">Batal</button><button class="btn">Simpan</button></div>
    </form>`, (root) => {
    formSubmit(root, async () => {
      const nominal = angka($('#f-nom', root).value), ket = bersihTeks($('#f-ket', root).value, 120);
      if (!Number.isFinite(nominal) || nominal <= 0 || !ket) return info('Data tidak valid', 'Isi nominal dan keterangan dengan benar.');
      if (await simpan(fb.fsM.updateDoc(dok('denda', d.id), { nominal, keterangan: ket }), 'Tagihan diperbarui.')) tutupSheet();
    });
  });
}
async function hapusDenda(id) {
  const d = S.denda.find((x) => x.id === id); if (!d) return;
  const pesan = 'Tagihan ini akan dihapus.' + (d.potonganDeposit > 0 ? `\nPotongan deposit ${rp(d.potonganDeposit)} dikembalikan ke warga.` : '') + (d.status === 'Lunas' && !(d.potonganDeposit >= d.nominal) ? '\nPemasukan di kas tidak ikut terhapus.' : '');
  if (!(await konfirmasi('Hapus tagihan?', pesan, 'Hapus', true))) return;
  const b = batch();
  if (d.potonganDeposit > 0 && S.warga.some((w) => w.id === d.wargaId)) b.update(dok('warga', d.wargaId), { deposit: tambah(d.potonganDeposit) });
  b.delete(dok('denda', d.id));
  if (await simpan(b.commit(), 'Tagihan dihapus.')) tutupSheet();
}

// ---------------------------------------------------------------------------
// KAS — mutasi (pemasukan & pengeluaran/realisasi jadi satu)
// ---------------------------------------------------------------------------
function renderMutasi() {
  const saldo = saldoKas();
  const el = $('#kas-saldo'); el.textContent = rp(saldo); el.style.color = saldo < 0 ? '#FFB4A8' : '';
  const f = S.filter.kas;
  const list = S.mutasi.filter((m) => f === 'semua' || (f === 'masuk' ? m.jenis === 'Pemasukan' : m.jenis === 'Pengeluaran'))
    .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)) || b.id - a.id);
  $('#kas-list').innerHTML = list.length ? list.map((m) => {
    const masuk = m.jenis === 'Pemasukan', foto = Array.isArray(m.bukti) ? m.bukti.filter(imgAman).length : 0;
    return `<button class="item" data-act="detail-mutasi" data-id="${m.id}">
      <div class="bulat ${masuk ? 'masuk' : 'keluar'}"><i class="fa-solid ${masuk ? 'fa-arrow-down' : 'fa-arrow-up'}"></i></div>
      <div class="isi"><b>${esc(m.keterangan || (masuk ? 'Pemasukan' : 'Pengeluaran'))}</b><small>${esc(tglPendek(m.tanggal))}${m.kategori === 'Denda' || m.kategori === 'Deposit' ? ` · ${esc(m.kategori)}` : ''}${foto ? ` · <i class="fa-solid fa-image"></i> ${foto}` : ''}</small></div>
      <span class="${masuk ? 'uang-masuk' : 'uang-keluar'}">${masuk ? '+' : '−'}${rp(m.nominal)}</span></button>`;
  }).join('') : '<div class="kosong">Belum ada transaksi kas.</div>';
}
const mutasiSistem = (m) => m.kategori === 'Denda' || m.kategori === 'Deposit';

function detailMutasi(id) {
  const m = S.mutasi.find((x) => x.id === id); if (!m) return;
  const masuk = m.jenis === 'Pemasukan', foto = Array.isArray(m.bukti) ? m.bukti.filter(imgAman) : [];
  bukaSheet(masuk ? 'Pemasukan' : 'Pengeluaran', `
    <p class="${masuk ? 'uang-masuk' : 'uang-keluar'}" style="font-size:26px;margin:0">${masuk ? '+' : '−'}${rp(m.nominal)}</p>
    <p style="margin:6px 0 2px;white-space:pre-line;overflow-wrap:anywhere">${esc(m.keterangan || '-')}</p>
    <p class="redup kecil" style="margin:0 0 14px">${esc(tglPanjang(m.tanggal))}${mutasiSistem(m) ? ` · <span class="st st-sistem">Otomatis: ${esc(m.kategori)}</span>` : ''}</p>
    ${foto.length ? `<p class="lbl">Bukti foto</p><div class="foto-grid">${foto.map((_, i) => `<div class="foto"><button data-act="lihat-foto" data-sumber="mutasi" data-id="${m.id}" data-idx="${i}" aria-label="Lihat foto ${i + 1}"><img src="${esc(foto[i])}" alt=""></button></div>`).join('')}</div>` : (masuk ? '' : '<p class="redup kecil">Tidak ada foto bukti.</p>')}
    ${isAdmin() ? `<div class="sheet-kaki" style="margin-top:18px">
      <button class="btn lembut" data-act="hapus-mutasi" data-id="${m.id}" style="color:var(--merah)"><i class="fa-solid fa-trash"></i> Hapus</button>
      ${mutasiSistem(m) ? '' : `<button class="btn" data-act="edit-mutasi" data-id="${m.id}"><i class="fa-solid fa-pen"></i> Ubah</button>`}</div>` : ''}`);
}

function formMutasi(id) {
  if (!isAdmin()) return;
  const m = id != null ? S.mutasi.find((x) => x.id === id) : null;
  if (m && mutasiSistem(m)) return;
  let fotoSementara = m && Array.isArray(m.bukti) ? m.bukti.filter(imgAman) : [];
  const jenisAwal = m ? m.jenis : 'Pengeluaran';
  bukaSheet(m ? 'Ubah transaksi' : 'Catat transaksi', `
    <form id="f">
      <div class="seg" role="radiogroup" aria-label="Jenis transaksi">
        <button type="button" data-jenis="Pemasukan" aria-selected="${jenisAwal === 'Pemasukan'}">Pemasukan</button>
        <button type="button" data-jenis="Pengeluaran" aria-selected="${jenisAwal === 'Pengeluaran'}">Pengeluaran</button>
      </div>
      <div class="grid2">
        <div class="fld"><label class="lbl" for="f-tgl">Tanggal</label><input id="f-tgl" class="inp" type="date" required value="${esc(m ? m.tanggal : ymd())}"></div>
        <div class="fld"><label class="lbl" for="f-nom">Nominal (Rp)</label><input id="f-nom" class="inp rupiah" inputmode="numeric" required placeholder="50.000" value="${m ? titik(m.nominal) : ''}"></div>
      </div>
      <div class="fld"><label class="lbl" for="f-ket">Keterangan</label><textarea id="f-ket" class="inp" maxlength="300" required placeholder="Contoh: servis lampu pos ronda">${esc(m ? m.keterangan || '' : '')}</textarea></div>
      <div class="fld"><span class="lbl">Bukti foto <span class="redup" style="font-weight:500">(disarankan untuk pengeluaran)</span></span>
        <div id="f-foto" class="foto-grid"></div>
        <label class="btn kecil lembut unggah" style="margin-top:8px"><i class="fa-solid fa-camera"></i> <span id="f-foto-lbl">Pilih foto</span><input id="f-foto-in" type="file" accept="image/*" multiple></label>
      </div>
      <div class="sheet-kaki"><button type="button" class="btn lembut" data-act="tutup-sheet">Batal</button><button id="f-simpan" class="btn">Simpan</button></div>
    </form>`, (root) => {
    let jenis = jenisAwal;
    $$('[data-jenis]', root).forEach((b) => b.addEventListener('click', () => {
      jenis = b.dataset.jenis; $$('[data-jenis]', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    }));
    const gambarFoto = () => {
      $('#f-foto', root).innerHTML = fotoSementara.length ? fotoSementara.map((src, i) => `<div class="foto"><button type="button" tabindex="-1"><img src="${esc(src)}" alt=""></button><button type="button" class="hapus" data-hapus="${i}" aria-label="Hapus foto"><i class="fa-solid fa-xmark"></i></button></div>`).join('') : '<span class="redup kecil">Belum ada foto.</span>';
      $$('[data-hapus]', root).forEach((b) => b.addEventListener('click', () => { fotoSementara.splice(+b.dataset.hapus, 1); gambarFoto(); }));
    };
    gambarFoto();
    const inp = $('#f-foto-in', root), simpanBtn = $('#f-simpan', root);
    inp.addEventListener('change', async () => {
      if (!inp.files.length) return;
      if (fotoSementara.length + inp.files.length > MAKS_FOTO) { inp.value = ''; return info('Terlalu banyak foto', `Maksimal ${MAKS_FOTO} foto per transaksi.`); }
      $('#f-foto-lbl', root).textContent = 'Memproses…'; simpanBtn.disabled = true;
      try { fotoSementara = fotoSementara.concat(await prosesFoto(inp.files)); gambarFoto(); }
      catch (e) { info('Gagal memproses foto', 'Pastikan file yang dipilih adalah gambar.'); }
      finally { $('#f-foto-lbl', root).textContent = 'Pilih foto'; simpanBtn.disabled = false; inp.value = ''; }
    });
    formSubmit(root, async () => {
      const tgl = $('#f-tgl', root).value, nominal = angka($('#f-nom', root).value), ket = bersihTeks($('#f-ket', root).value, 300);
      if (!parseYMD(tgl) || !Number.isFinite(nominal) || nominal <= 0 || !ket) return info('Data belum lengkap', 'Isi tanggal, nominal, dan keterangan dengan benar.');
      if (ukuran(fotoSementara) + ket.length > BATAS_DOK) return info('Foto terlalu besar', 'Kurangi jumlah foto lalu coba lagi.');
      const newId = m ? m.id : idBaru();
      const data = { tanggal: tgl, jenis, nominal, keterangan: ket, bukti: fotoSementara, kategori: jenis === 'Pemasukan' ? 'Lainnya' : 'Pengeluaran' };
      if (!m) data.id = newId;
      if (await simpan(fb.fsM.setDoc(dok('mutasi', m ? m._doc : newId), data, { merge: true }), m ? 'Transaksi diperbarui.' : 'Transaksi dicatat.')) tutupSheet();
    });
  });
}
async function hapusMutasi(id) {
  const m = S.mutasi.find((x) => x.id === id); if (!m) return;
  const pesan = `${m.jenis} ${rp(m.nominal)} akan dihapus dan saldo kas ikut berubah.` + (mutasiSistem(m) ? `\nIni dicatat otomatis (${m.kategori}); status ${m.kategori === 'Denda' ? 'tagihan' : 'deposit'} warga tidak ikut berubah.` : '');
  if (!(await konfirmasi('Hapus transaksi?', pesan, 'Hapus', true))) return;
  if (await simpan(fb.fsM.deleteDoc(dok('mutasi', m._doc)), 'Transaksi dihapus.')) tutupSheet();
}
function sesuaikanSaldo() {
  bukaSheet('Sesuaikan saldo kas', `
    <form id="f">
      <p class="redup kecil" style="margin-top:0">Gunakan hanya jika saldo di aplikasi berbeda dengan uang kas sebenarnya. Selisihnya disimpan sebagai penyesuaian, tanpa menambah riwayat transaksi.</p>
      <div class="fld"><label class="lbl" for="f-saldo">Saldo kas sebenarnya (Rp)</label><input id="f-saldo" class="inp rupiah" inputmode="numeric" required value="${saldoKas() < 0 ? '-' : ''}${titik(Math.abs(saldoKas()))}"></div>
      <p class="bantu">Penyesuaian saat ini: ${rp(S.offset)}</p>
      <div class="sheet-kaki"><button type="button" class="btn lembut" data-act="tutup-sheet">Batal</button><button class="btn">Simpan saldo</button></div>
    </form>`, (root) => {
    formSubmit(root, async () => {
      const target = angka($('#f-saldo', root).value);
      if (!Number.isFinite(target)) return info('Nominal tidak valid', 'Masukkan angka saldo.');
      if (await simpan(fb.fsM.setDoc(dok('pengaturan_kas', 'saldo'), { offset: target - totalMutasi() }, { merge: true }), 'Saldo kas disesuaikan.')) tutupSheet();
    });
  });
}

// ---------------------------------------------------------------------------
// KAS — deposit
// ---------------------------------------------------------------------------
function renderDeposit() {
  $('#dep-total').textContent = rp(S.warga.reduce((s, w) => s + Math.max(0, w.deposit), 0));
  const list = S.warga.filter((w) => w.deposit > 0).sort((a, b) => b.deposit - a.deposit);
  $('#dep-list').innerHTML = list.length ? list.map((w) => {
    const isi = `<div class="bulat masuk"><i class="fa-solid fa-piggy-bank"></i></div><div class="isi"><b>${esc(w.nama)}</b><small>${esc(w.tipe || '')} · jadwal ${esc(w.jadwal || '-')}</small></div><span class="uang-masuk">${rp(w.deposit)}</span>`;
    return isAdmin() ? `<button class="item" data-act="edit-deposit" data-id="${w.id}">${isi}</button>` : `<div class="item">${isi}</div>`;
  }).join('') : '<div class="kosong">Belum ada warga yang menitipkan deposit.</div>';
}
function formDeposit() {
  if (!S.warga.length) return info('Belum ada warga', 'Tambahkan warga terlebih dahulu.');
  bukaSheet('Tambah deposit', `
    <form id="f">
      <div class="fld"><label class="lbl" for="f-w">Warga</label><select id="f-w" class="inp">
        ${S.warga.slice().sort(byNama).map((w) => `<option value="${w.id}">${esc(w.nama)} — saldo ${rp(w.deposit)}</option>`).join('')}</select></div>
      <div class="fld"><label class="lbl" for="f-nom">Nominal yang dititipkan (Rp)</label><input id="f-nom" class="inp rupiah" inputmode="numeric" required placeholder="20.000"></div>
      <p class="bantu">Uang deposit otomatis dicatat sebagai pemasukan kas.</p>
      <div class="sheet-kaki"><button type="button" class="btn lembut" data-act="tutup-sheet">Batal</button><button class="btn">Simpan deposit</button></div>
    </form>`, (root) => {
    formSubmit(root, async () => {
      const w = S.warga.find((x) => x.id === num($('#f-w', root).value)), nominal = angka($('#f-nom', root).value);
      if (!w || !Number.isFinite(nominal) || nominal <= 0) return info('Data tidak valid', 'Pilih warga dan isi nominal dengan benar.');
      const b = batch(), idm = idBaru();
      b.update(dok('warga', w.id), { deposit: tambah(nominal) });
      b.set(dok('mutasi', idm), { id: idm, tanggal: ymd(), jenis: 'Pemasukan', nominal, kategori: 'Deposit', keterangan: `Penambahan Deposit: Bpk/Ibu ${w.nama}` });
      if (await simpan(b.commit(), 'Deposit ditambahkan dan masuk kas.')) tutupSheet();
    });
  });
}
function editDeposit(id) {
  const w = S.warga.find((x) => x.id === id); if (!w) return;
  bukaSheet('Koreksi saldo deposit', `
    <form id="f">
      <p class="redup" style="margin-top:0">${esc(w.nama)}</p>
      <div class="fld"><label class="lbl" for="f-nom">Saldo deposit (Rp)</label><input id="f-nom" class="inp rupiah" inputmode="numeric" required value="${titik(w.deposit)}"></div>
      <p class="bantu">Koreksi ini tidak dicatat di riwayat kas. Jika ada uang keluar/masuk, catat juga di menu Kas.</p>
      <div class="sheet-kaki"><button type="button" class="btn lembut" data-act="tutup-sheet">Batal</button><button class="btn">Simpan</button></div>
    </form>`, (root) => {
    formSubmit(root, async () => {
      const nominal = angka($('#f-nom', root).value);
      if (!Number.isFinite(nominal) || nominal < 0) return info('Nominal tidak valid', 'Saldo deposit tidak boleh negatif.');
      if (await simpan(fb.fsM.updateDoc(dok('warga', w.id), { deposit: nominal }), 'Saldo deposit diperbarui.')) tutupSheet();
    });
  });
}

// ---------------------------------------------------------------------------
// INFO — rencana & aspirasi
// ---------------------------------------------------------------------------
function renderInfo() {
  const warnaStatus = (s) => (s === 'Selesai' ? 'st-Lunas' : s === 'Sedang Berjalan' ? 'st-Izin' : 'st-sistem');
  $('#rencana-list').innerHTML = S.rencana.length ? S.rencana.slice().sort((a, b) => b.id - a.id).map((r) => `
    <button class="rencana" data-act="detail-rencana" data-id="${r.id}">
      <div class="baris antara"><b>${esc(r.judul)}</b><span class="st ${warnaStatus(r.status)}">${esc(r.status)}</span></div>
      <p>${esc(r.deskripsi)}</p></button>`).join('') : '<div class="kosong">Belum ada rencana program.</div>';

  $('#aspirasi-list').innerHTML = S.aspirasi.length ? S.aspirasi.slice().sort((a, b) => b.id - a.id).map((a) => `
    <div class="aspirasi">
      <div class="baris antara"><b>${esc(a.nama || 'Warga (Anonim)')}</b><span class="redup kecil">${esc(a.tanggal || '')}</span></div>
      <p class="teks">${esc(a.teks)}</p>
      ${a.tanggapan ? `<div class="tanggapan"><b>Tanggapan pengurus:</b>\n${esc(a.tanggapan)}</div>` : ''}
      ${isAdmin() ? `<div class="baris" style="margin-top:10px">
        <button class="btn kecil lembut" data-act="tanggapi" data-id="${a.id}"><i class="fa-solid fa-reply"></i> ${a.tanggapan ? 'Ubah tanggapan' : 'Tanggapi'}</button>
        <button class="btn kecil lembut" data-act="hapus-aspirasi" data-id="${a.id}" style="color:var(--merah)"><i class="fa-solid fa-trash"></i> Hapus</button></div>` : ''}
    </div>`).join('') : '<div class="kosong">Belum ada aspirasi. Sampaikan saran Anda lewat tombol “Tulis”.</div>';

  $('#btn-pasang').hidden = !promptPasang;
}

function detailRencana(id) {
  const r = S.rencana.find((x) => x.id === id); if (!r) return;
  bukaSheet(r.judul, `
    <p class="baris"><span class="st ${r.status === 'Selesai' ? 'st-Lunas' : r.status === 'Sedang Berjalan' ? 'st-Izin' : 'st-sistem'}">${esc(r.status)}</span><span class="redup kecil">Diperbarui ${esc(r.tanggal || '-')}</span></p>
    <p style="white-space:pre-line;overflow-wrap:anywhere">${esc(r.deskripsi)}</p>
    ${isAdmin() ? `<div class="sheet-kaki"><button class="btn lembut" data-act="hapus-rencana" data-id="${r.id}" style="color:var(--merah)"><i class="fa-solid fa-trash"></i> Hapus</button><button class="btn" data-act="edit-rencana" data-id="${r.id}"><i class="fa-solid fa-pen"></i> Ubah</button></div>` : ''}`);
}
function formRencana(id) {
  const r = id != null ? S.rencana.find((x) => x.id === id) : null;
  bukaSheet(r ? 'Ubah program' : 'Program baru', `
    <form id="f">
      <div class="fld"><label class="lbl" for="f-j">Nama program</label><input id="f-j" class="inp" maxlength="100" required placeholder="Perbaikan pos kamling" value="${esc(r ? r.judul : '')}"></div>
      <div class="fld"><label class="lbl" for="f-s">Status</label><select id="f-s" class="inp">
        ${['Direncanakan', 'Sedang Berjalan', 'Selesai'].map((s) => `<option ${r && r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="fld"><label class="lbl" for="f-d">Deskripsi</label><textarea id="f-d" class="inp" maxlength="2000" required rows="5">${esc(r ? r.deskripsi : '')}</textarea></div>
      <div class="sheet-kaki"><button type="button" class="btn lembut" data-act="tutup-sheet">Batal</button><button class="btn">Simpan</button></div>
    </form>`, (root) => {
    formSubmit(root, async () => {
      const judul = bersihTeks($('#f-j', root).value, 100), deskripsi = bersihTeks($('#f-d', root).value, 2000), status = $('#f-s', root).value;
      if (!judul || !deskripsi) return info('Data belum lengkap', 'Nama program dan deskripsi wajib diisi.');
      const newId = r ? r.id : idBaru();
      const data = { judul, deskripsi, status, tanggal: new Date().toLocaleDateString('id-ID') };
      if (!r) data.id = newId;
      if (await simpan(fb.fsM.setDoc(dok('rencana', newId), data, { merge: true }), 'Program disimpan.')) tutupSheet();
    });
  });
}
async function hapusRencana(id) {
  if (!(await konfirmasi('Hapus program?', 'Program ini akan dihapus dari daftar.', 'Hapus', true))) return;
  if (await simpan(fb.fsM.deleteDoc(dok('rencana', id)), 'Program dihapus.')) tutupSheet();
}

function formAspirasi() {
  bukaSheet('Tulis aspirasi', `
    <form id="f">
      <div class="fld"><label class="lbl" for="f-n">Nama (boleh dikosongkan)</label><input id="f-n" class="inp" maxlength="60" placeholder="Anonim"></div>
      <div class="fld"><label class="lbl" for="f-t">Kritik, saran, atau usulan</label><textarea id="f-t" class="inp" maxlength="1000" required rows="5"></textarea>
        <p class="bantu" id="f-hitung">0 / 1000</p></div>
      <div class="sheet-kaki"><button type="button" class="btn lembut" data-act="tutup-sheet">Batal</button><button class="btn"><i class="fa-solid fa-paper-plane"></i> Kirim</button></div>
    </form>`, (root) => {
    const t = $('#f-t', root);
    t.addEventListener('input', () => { $('#f-hitung', root).textContent = `${t.value.length} / 1000`; });
    formSubmit(root, async () => {
      const nama = bersihTeks($('#f-n', root).value, 60) || 'Warga (Anonim)', teks = bersihTeks(t.value, 1000);
      if (!teks) return info('Aspirasi kosong', 'Tulis isi aspirasi Anda terlebih dahulu.');
      const id = idBaru();
      const data = { id, nama, teks, tanggapan: null, tanggal: new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).slice(0, 40) };
      if (await simpan(fb.fsM.setDoc(dok('aspirasi', id), data), 'Aspirasi terkirim. Terima kasih!')) tutupSheet();
    });
  });
}
function formTanggapan(id) {
  const a = S.aspirasi.find((x) => x.id === id); if (!a) return;
  bukaSheet('Tanggapan pengurus', `
    <form id="f">
      <p class="redup kecil" style="margin-top:0;white-space:pre-line;overflow-wrap:anywhere">“${esc(a.teks)}”</p>
      <div class="fld"><label class="lbl" for="f-t">Tanggapan</label><textarea id="f-t" class="inp" maxlength="1000" rows="4">${esc(a.tanggapan || '')}</textarea>
        <p class="bantu">Kosongkan lalu simpan untuk menghapus tanggapan.</p></div>
      <div class="sheet-kaki"><button type="button" class="btn lembut" data-act="tutup-sheet">Batal</button><button class="btn">Simpan tanggapan</button></div>
    </form>`, (root) => {
    formSubmit(root, async () => {
      const tanggapan = bersihTeks($('#f-t', root).value, 1000) || null;
      if (await simpan(fb.fsM.updateDoc(dok('aspirasi', a.id), { tanggapan }), 'Tanggapan disimpan.')) tutupSheet();
    });
  });
}
async function hapusAspirasi(id) {
  if (!(await konfirmasi('Hapus aspirasi?', 'Aspirasi ini akan dihapus permanen.', 'Hapus', true))) return;
  await simpan(fb.fsM.deleteDoc(dok('aspirasi', id)), 'Aspirasi dihapus.');
}

// ---------------------------------------------------------------------------
// Foto: kompres + watermark tanggal
// ---------------------------------------------------------------------------
const ukuran = (arr) => arr.reduce((s, x) => s + String(x).length, 0);
let logoCache;
function muatLogo() {
  if (logoCache !== undefined) return Promise.resolve(logoCache);
  return new Promise((res) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { logoCache = img; res(img); };
    img.onerror = () => { logoCache = null; res(null); };
    img.src = LOGO;
  });
}
function bacaGambar(file) {
  return new Promise((res, rej) => {
    if (!/^image\//.test(file.type)) return rej(new Error('bukan gambar'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('gagal baca')); };
    img.src = url;
  });
}
async function prosesFoto(files) {
  const logo = await muatLogo(), hasil = [];
  for (const file of Array.from(files)) {
    const img = await bacaGambar(file);
    const skala = Math.min(1, 800 / Math.max(img.width, img.height));
    const w = Math.round(img.width * skala), h = Math.round(img.height * skala);
    const buat = (pakaiLogo) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      const teks = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const fs = Math.max(12, Math.floor(w * 0.035)); ctx.font = `bold ${fs}px sans-serif`;
      const tw = ctx.measureText(teks).width, pad = fs * 0.5, x = w - tw - pad * 2 - 10, y = h - fs - pad * 2 - 10;
      if (pakaiLogo && logo) { const ls = Math.max(50, Math.floor(w * 0.12)); ctx.drawImage(logo, w - ls - 10, y - ls - 8, ls, ls); }
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x, y, tw + pad * 2, fs + pad * 2);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.fillText(teks, x + pad, y + pad);
      return c.toDataURL('image/jpeg', 0.72);
    };
    let data; try { data = buat(true); } catch (e) { data = buat(false); }
    hasil.push(data);
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// Nota WhatsApp per warga
// ---------------------------------------------------------------------------
function kirimNotaWA(wargaId) {
  const list = S.denda.filter((d) => d.wargaId === wargaId && d.status === 'Belum Dibayar').sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
  if (!list.length) return toast('Warga ini tidak punya tunggakan.');
  const w = S.warga.find((x) => x.id === wargaId), nama = namaWarga(wargaId, list[0].namaWarga);
  const total = list.reduce((s, d) => s + d.nominal, 0);
  let pesan = `Assalamu'alaikum Wr. Wb.\nMohon maaf mengganggu waktunya Bpk/Ibu *${nama}*. 🙏\n\n`;
  pesan += list.length > 1
    ? `Berikut kami sampaikan rekap *${list.length} tagihan* kas/denda ronda yang belum diselesaikan.\n\n*TOTAL TAGIHAN: ${rp(total)}*\n\n_(Rincian ada pada gambar nota terlampir)_`
    : `Berikut kami lampirkan nota tagihan kas/denda ronda yang belum diselesaikan:\n\nTgl ${list[0].tanggal} - ${list[0].keterangan} (*${rp(list[0].nominal)}*)`;
  pesan += `\n\nMohon perkenannya untuk dapat diselesaikan. Terima kasih atas partisipasi dan kerjasamanya.\n\nHormat kami,\n*Pengurus ${NAMA_RT}*`;
  const gambar = gambarNota(list, nama);
  bukaSheet('Kirim nota tagihan', `
    <img src="${esc(gambar)}" alt="Pratinjau nota" style="width:100%;border:1px solid var(--garis);border-radius:10px">
    <div class="fld" style="margin-top:12px"><label class="lbl" for="f-pesan">Pesan WhatsApp</label><textarea id="f-pesan" class="inp" rows="7">${esc(pesan)}</textarea></div>
    ${w && w.wa ? '' : '<p class="bantu" style="color:var(--merah)">Nomor WA warga ini belum tercatat. Nota akan diunduh untuk dikirim manual.</p>'}
    <div class="sheet-kaki"><button class="btn hijau" id="f-kirim"><i class="fa-brands fa-whatsapp"></i> Bagikan</button></div>`, (root) => {
    $('#f-kirim', root).addEventListener('click', async () => {
      const teks = $('#f-pesan', root).value;
      const file = new File([dataUrlKeBlob(gambar)], `Nota_${nama.replace(/[^\w]+/g, '_')}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ title: 'Nota Tagihan Ronda', text: teks, files: [file] }); tutupSheet(); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      const a = document.createElement('a'); a.download = file.name; a.href = URL.createObjectURL(file); a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      tutupSheet();
      const noWA = w && w.wa ? formatWA(w.wa) : '';
      if (noWA) {
        await info('Nota sudah diunduh', 'Setelah WhatsApp terbuka, lampirkan gambar nota yang baru diunduh ke dalam obrolan.');
        window.open(`https://wa.me/${noWA}?text=${encodeURIComponent(teks)}`, '_blank', 'noopener');
      } else info('Nota sudah diunduh', 'Kirim gambar nota ke warga secara manual.');
    });
  });
}
function formatWA(no) { let d = String(no).replace(/\D/g, ''); if (d.startsWith('0')) d = '62' + d.slice(1); return /^\d{9,15}$/.test(d) ? d : ''; }
function dataUrlKeBlob(url) {
  const [kepala, isi] = url.split(','); const mime = /data:([^;]+)/.exec(kepala)[1];
  const bin = atob(isi), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function gambarNota(list, nama) {
  const tinggi = 360 + list.length * 35, c = document.createElement('canvas'); c.width = 600; c.height = tinggi;
  const x = c.getContext('2d');
  x.fillStyle = '#F3F5F8'; x.fillRect(0, 0, 600, tinggi);
  x.fillStyle = '#1E2A44'; x.fillRect(0, 0, 600, 90);
  x.fillStyle = '#F2B233'; x.fillRect(0, 86, 600, 4);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = 'bold 28px sans-serif'; x.fillText('NOTA TAGIHAN E-RONDA', 300, 42);
  x.font = '16px sans-serif'; x.fillText(NAMA_RT, 300, 70);
  x.fillStyle = '#fff'; x.fillRect(30, 110, 540, tinggi - 160);
  x.textAlign = 'left'; x.fillStyle = '#667085'; x.font = '16px sans-serif'; x.fillText('Kepada Yth,', 60, 150);
  x.fillStyle = '#1B2230'; x.font = 'bold 22px sans-serif'; x.fillText(('Bpk/Ibu ' + nama).slice(0, 40), 60, 180);
  x.strokeStyle = '#E3E7ED'; x.lineWidth = 2; x.beginPath(); x.moveTo(60, 200); x.lineTo(540, 200); x.stroke();
  x.fillStyle = '#667085'; x.font = '16px sans-serif'; x.fillText('Rincian tagihan:', 60, 230);
  let y = 265, total = 0;
  list.forEach((d, i) => {
    x.fillStyle = '#1B2230'; x.font = 'bold 14px sans-serif'; x.fillText(`${i + 1}. ${tglPendek(d.tanggal)}`, 60, y);
    x.font = '14px sans-serif'; const k = String(d.keterangan || ''); x.fillText(k.length > 28 ? k.slice(0, 28) + '…' : k, 220, y);
    x.textAlign = 'right'; x.font = 'bold 14px sans-serif'; x.fillText(rp(d.nominal), 540, y); x.textAlign = 'left';
    total += d.nominal; y += 35;
  });
  x.fillStyle = '#FBEAE7'; x.fillRect(60, y + 10, 480, 50);
  x.fillStyle = '#C8412E'; x.font = 'bold 18px sans-serif'; x.fillText('TOTAL', 80, y + 42);
  x.textAlign = 'right'; x.font = 'bold 24px sans-serif'; x.fillText(rp(total), 520, y + 43);
  x.textAlign = 'center'; x.font = '12px sans-serif'; x.fillStyle = '#98A2B3';
  x.fillText('Dicetak oleh E-Ronda pada ' + new Date().toLocaleString('id-ID'), 300, tinggi - 20);
  return c.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Cetak PDF (laporan kas, rekap tunggakan, nota A4) — satu menu
// ---------------------------------------------------------------------------
let jsPdfSiap = null;
function muatSkrip(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
function muatJsPDF() {
  if (!jsPdfSiap) jsPdfSiap = muatSkrip('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    .then(() => muatSkrip('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js'))
    .catch((e) => { jsPdfSiap = null; throw e; });
  return jsPdfSiap;
}
function menuCetak() {
  const tunggak = S.denda.filter((d) => d.status === 'Belum Dibayar');
  const minggu = new Map(); tunggak.forEach((d) => { const m = mingguInfo(d.tanggal); if (m) minggu.set(m.id, m.label); });
  const opsiMinggu = [...minggu.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([id, l]) => `<option value="m:${esc(id)}">${esc(l)}</option>`).join('');
  const wargaT = new Map(); tunggak.forEach((d) => wargaT.set(d.wargaId, namaWarga(d.wargaId, d.namaWarga)));
  const opsiWarga = [...wargaT.entries()].sort((a, b) => a[1].localeCompare(b[1], 'id')).map(([id, n]) => `<option value="w:${id}">${esc(n)}</option>`).join('');
  const awalBulan = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  bukaSheet('Cetak laporan', `
    <div class="kartu" style="margin-bottom:12px"><b>Laporan kas</b>
      <div class="grid2" style="margin-top:10px"><div class="fld"><label class="lbl" for="c-dari">Dari</label><input id="c-dari" type="date" class="inp" value="${awalBulan}"></div>
      <div class="fld"><label class="lbl" for="c-sampai">Sampai</label><input id="c-sampai" type="date" class="inp" value="${ymd()}"></div></div>
      <div class="baris"><button class="btn kecil" data-cetak="kas-rentang">Cetak periode ini</button><button class="btn kecil lembut" data-cetak="kas-semua">Cetak semua</button></div></div>
    <div class="kartu" style="margin-bottom:12px"><b>Rekap tunggakan</b>
      ${tunggak.length ? `<div class="fld" style="margin-top:10px"><select id="c-rekap" class="inp"><option value="semua">Semua tunggakan</option><optgroup label="Per minggu">${opsiMinggu}</optgroup></select></div>
      <button class="btn kecil" data-cetak="rekap">Cetak rekap</button>` : '<p class="redup kecil">Tidak ada tunggakan saat ini.</p>'}</div>
    <div class="kartu"><b>Nota tagihan A4</b> <span class="redup kecil">(6 nota per halaman)</span>
      ${tunggak.length ? `<div class="fld" style="margin-top:10px"><select id="c-nota" class="inp"><option value="semua">Semua warga</option><optgroup label="Per minggu">${opsiMinggu}</optgroup><optgroup label="Per warga">${opsiWarga}</optgroup></select></div>
      <button class="btn kecil" data-cetak="nota">Cetak nota</button>` : '<p class="redup kecil">Tidak ada tunggakan saat ini.</p>'}</div>`, (root) => {
    $$('[data-cetak]', root).forEach((b) => b.addEventListener('click', async () => {
      const jenis = b.dataset.cetak;
      if (jenis === 'kas-rentang') {
        const dari = $('#c-dari', root).value, sampai = $('#c-sampai', root).value;
        if (!parseYMD(dari) || !parseYMD(sampai) || dari > sampai) return info('Periode tidak valid', 'Tanggal awal harus sebelum tanggal akhir.');
      }
      b.disabled = true; const teksAsli = b.textContent; b.textContent = 'Menyiapkan…';
      try {
        await muatJsPDF();
        if (jenis === 'kas-rentang') pdfKas($('#c-dari', root).value, $('#c-sampai', root).value);
        if (jenis === 'kas-semua') pdfKas(null, null);
        if (jenis === 'rekap') pdfRekap($('#c-rekap', root).value);
        if (jenis === 'nota') pdfNota($('#c-nota', root).value);
      } catch (e) { console.error(e); info('Gagal membuat PDF', 'Periksa koneksi internet lalu coba lagi.'); }
      finally { b.disabled = false; b.textContent = teksAsli; }
    }));
  });
}
function filterTunggakan(pilihan) {
  let t = S.denda.filter((d) => d.status === 'Belum Dibayar');
  if (pilihan.startsWith('m:')) t = t.filter((d) => { const m = mingguInfo(d.tanggal); return m && m.id === pilihan.slice(2); });
  if (pilihan.startsWith('w:')) t = t.filter((d) => d.wargaId === num(pilihan.slice(2)));
  return t.map((d) => ({ ...d, namaWarga: namaWarga(d.wargaId, d.namaWarga) }));
}
function kepalaPdf(doc, judul, sub) {
  doc.setFontSize(15); doc.setFont('helvetica', 'bold'); doc.text(judul, 14, 15);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text(NAMA_RT, 14, 21);
  if (sub) doc.text(sub, 14, 26);
  doc.text('Dicetak: ' + new Date().toLocaleString('id-ID'), 14, sub ? 31 : 26);
  return sub ? 36 : 31;
}
function pdfKas(dari, sampai) {
  const doc = new window.jspdf.jsPDF('p', 'mm', 'a4');
  let data = S.mutasi.slice().sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)) || a.id - b.id);
  let saldoAwal = 0;
  if (dari) {
    saldoAwal = data.filter((d) => d.tanggal < dari).reduce((s, d) => (d.jenis === 'Pemasukan' ? s + d.nominal : s - d.nominal), 0);
    data = data.filter((d) => d.tanggal >= dari && d.tanggal <= sampai);
  }
  const y0 = kepalaPdf(doc, 'Laporan Mutasi Kas & Realisasi', dari ? `Periode: ${tglPendek(dari)} s/d ${tglPendek(sampai)}` : 'Periode: seluruh data');
  const rows = []; let saldo = saldoAwal, masuk = 0, keluar = 0;
  if (dari) rows.push(['-', '-', 'SALDO AWAL', 'Akumulasi sebelum periode', '-', '-', rp(saldoAwal)]);
  data.forEach((d, i) => {
    const m = d.jenis === 'Pemasukan';
    if (m) { saldo += d.nominal; masuk += d.nominal; } else { saldo -= d.nominal; keluar += d.nominal; }
    rows.push([String(i + 1), tglPendek(d.tanggal), d.kategori || d.jenis, String(d.keterangan || ''), m ? rp(d.nominal) : '-', m ? '-' : rp(d.nominal), rp(saldo)]);
  });
  rows.push(['', '', 'TOTAL', `Masuk: ${rp(masuk)} | Keluar: ${rp(keluar)}`, '', '', '']);
  doc.autoTable({
    head: [['No', 'Tanggal', 'Kategori', 'Keterangan', 'Masuk', 'Keluar', 'Saldo']], body: rows, startY: y0, theme: 'grid',
    styles: { fontSize: 8 }, headStyles: { fillColor: [30, 42, 68], textColor: 255 },
    columnStyles: { 0: { halign: 'center', cellWidth: 8 }, 1: { cellWidth: 20 }, 2: { cellWidth: 20 }, 4: { halign: 'right', cellWidth: 22 }, 5: { halign: 'right', cellWidth: 22 }, 6: { halign: 'right', cellWidth: 25, fontStyle: 'bold' } },
    didParseCell: (c) => { if (c.row.raw[2] === 'SALDO AWAL' || c.row.raw[2] === 'TOTAL') { c.cell.styles.fontStyle = 'bold'; c.cell.styles.fillColor = [243, 245, 248]; } }
  });
  let y = doc.lastAutoTable.finalY + 10; if (y > 255) { doc.addPage(); y = 20; }
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  if (S.offset) { doc.text(`Penyesuaian saldo manual: ${rp(S.offset)}`, 14, y); y += 6; }
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(`SALDO KAS RT SAAT INI: ${rp(saldoKas())}`, 14, y + 2);
  doc.save(`Laporan_Kas_${dari ? dari + '_' + sampai : 'Semua'}.pdf`);
}
function pdfRekap(pilihan) {
  const t = filterTunggakan(pilihan); if (!t.length) return toast('Tidak ada tunggakan untuk pilihan ini.');
  const doc = new window.jspdf.jsPDF();
  let y = kepalaPdf(doc, pilihan === 'semua' ? 'Rekap Seluruh Tunggakan' : `Rekap Tunggakan ${mingguInfo(pilihan.slice(2)).label}`);
  const grupM = new Map();
  t.forEach((d) => { const m = mingguInfo(d.tanggal) || { id: '-', label: '-' }; if (!grupM.has(m.id)) grupM.set(m.id, { label: m.label, items: [] }); grupM.get(m.id).items.push(d); });
  let totalSemua = 0;
  [...grupM.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([, g]) => {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 42, 68); doc.text(`Minggu: ${g.label}`, 14, y);
    let sub = 0;
    const rows = g.items.sort((a, b) => a.namaWarga.localeCompare(b.namaWarga, 'id')).map((d, i) => { sub += d.nominal; return [i + 1, d.namaWarga, tglPanjang(d.tanggal), String(d.keterangan || ''), rp(d.nominal)]; });
    totalSemua += sub;
    doc.autoTable({ head: [['No', 'Nama', 'Tanggal', 'Keterangan', 'Nominal']], body: rows, startY: y + 3, theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: [243, 245, 248], textColor: [27, 34, 48] }, columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 4: { halign: 'right', fontStyle: 'bold' } } });
    y = doc.lastAutoTable.finalY + 6; doc.setFontSize(9); doc.setTextColor(200, 65, 46); doc.text(`Subtotal: ${rp(sub)}`, 14, y); y += 10;
  });
  doc.setTextColor(0); doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(`Total tunggakan: ${rp(totalSemua)}`, 14, y);
  doc.addPage(); doc.setFontSize(14); doc.text('Rekap per warga', 14, 20);
  const perW = new Map(); t.forEach((d) => { const g = perW.get(d.wargaId) || { nama: d.namaWarga, n: 0, total: 0 }; g.n++; g.total += d.nominal; perW.set(d.wargaId, g); });
  const rows = [...perW.values()].sort((a, b) => a.nama.localeCompare(b.nama, 'id')).map((g, i) => [i + 1, g.nama, `${g.n} tagihan`, rp(g.total)]);
  rows.push(['', 'TOTAL', '', rp(totalSemua)]);
  doc.autoTable({ head: [['No', 'Nama', 'Jumlah', 'Total']], body: rows, startY: 26, theme: 'grid', styles: { fontSize: 9 }, headStyles: { fillColor: [200, 65, 46], textColor: 255 },
    columnStyles: { 0: { halign: 'center', cellWidth: 15 }, 2: { halign: 'center', cellWidth: 35 }, 3: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: (c) => { if (c.row.raw[1] === 'TOTAL') { c.cell.styles.fontStyle = 'bold'; c.cell.styles.fillColor = [251, 234, 231]; } } });
  doc.save(`Rekap_Tunggakan_${ymd()}.pdf`);
}
function pdfNota(pilihan) {
  const t = filterTunggakan(pilihan); if (!t.length) return toast('Tidak ada tagihan untuk pilihan ini.');
  const doc = new window.jspdf.jsPDF('p', 'mm', 'a4');
  const perW = new Map(); t.forEach((d) => { const g = perW.get(d.wargaId) || { nama: d.namaWarga, total: 0, items: [] }; g.items.push(d); g.total += d.nominal; perW.set(d.wargaId, g); });
  const W = 90, H = 88;
  [...perW.values()].sort((a, b) => a.nama.localeCompare(b.nama, 'id')).forEach((g, i) => {
    if (i > 0 && i % 6 === 0) doc.addPage();
    const x = 10 + ((i % 6) % 2) * (W + 10), y = 10 + Math.floor((i % 6) / 2) * (H + 10);
    const mingguSet = new Set(g.items.map((d) => (mingguInfo(d.tanggal) || {}).label));
    const periode = pilihan.startsWith('m:') || mingguSet.size === 1 ? [...mingguSet][0] : 'Akumulasi tunggakan';
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.rect(x, y, W, H);
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 42, 68); doc.text('NOTA TAGIHAN E-RONDA', x + W / 2, y + 8, { align: 'center' });
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(102, 112, 133); doc.text(NAMA_RT, x + W / 2, y + 12.5, { align: 'center' });
    doc.setDrawColor(210); doc.line(x + 5, y + 15, x + W - 5, y + 15);
    doc.setFontSize(9); doc.setTextColor(27, 34, 48); doc.text('Kepada Yth,', x + 5, y + 20);
    doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(200, 65, 46); doc.text(`Periode: ${periode || '-'}`, x + W - 5, y + 20, { align: 'right' });
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(27, 34, 48); doc.text(('Bpk/Ibu ' + g.nama).slice(0, 38), x + 5, y + 25);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(102, 112, 133); doc.text('Rincian tagihan:', x + 5, y + 31);
    let iy = y + 36; doc.setTextColor(27, 34, 48);
    g.items.sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal))).slice(0, 6).forEach((d, k) => {
      doc.text(`${k + 1}. ${tglPendek(d.tanggal)}`, x + 5, iy);
      const ket = String(d.keterangan || ''); doc.text(ket.length > 22 ? ket.slice(0, 22) + '...' : ket, x + 32, iy);
      doc.text(rp(d.nominal), x + W - 5, iy, { align: 'right' }); iy += 5;
    });
    if (g.items.length > 6) { doc.setFont('helvetica', 'italic'); doc.text(`... dan ${g.items.length - 6} rincian lainnya`, x + 5, iy); doc.setFont('helvetica', 'normal'); }
    doc.setFillColor(251, 234, 231); doc.rect(x + 5, y + 68, W - 10, 10, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(200, 65, 46); doc.text('TOTAL', x + 8, y + 74.5);
    doc.setFontSize(11); doc.text(rp(g.total), x + W - 8, y + 74.5, { align: 'right' });
    doc.setFontSize(6); doc.setFont('helvetica', 'italic'); doc.setTextColor(150); doc.text('Dicetak: ' + new Date().toLocaleString('id-ID'), x + W / 2, y + 84, { align: 'center' });
  });
  doc.save(`Nota_Tagihan_A4_${ymd()}.pdf`);
}

// ---------------------------------------------------------------------------
// Sheet, dialog, toast, lightbox
// ---------------------------------------------------------------------------
let sheetAktif = null, fokusSebelum = null;
function bukaSheet(judul, html, onMount) {
  fokusSebelum = document.activeElement;
  $('#sheet-judul').textContent = judul;
  const isi = $('#sheet-isi'); isi.innerHTML = html;
  $('#sheet').hidden = false; document.body.style.overflow = 'hidden';
  sheetAktif = isi;
  if (onMount) onMount(isi);
  const pertama = isi.querySelector('input:not([type=hidden]):not([type=file]),textarea,select');
  if (pertama && window.matchMedia('(min-width:700px)').matches) pertama.focus();
  return isi;
}
function tutupSheet() {
  $('#sheet').hidden = true; $('#sheet-isi').innerHTML = ''; document.body.style.overflow = ''; sheetAktif = null;
  if (fokusSebelum && fokusSebelum.focus) try { fokusSebelum.focus(); } catch (e) { /* abaikan */ }
}
function formSubmit(root, fn) {
  const f = $('form', root); if (!f) return;
  let sibuk = false;
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); if (sibuk) return; sibuk = true;
    const btn = f.querySelector('button:not([type=button])'); if (btn) btn.disabled = true;
    try { await fn(); } finally { sibuk = false; if (btn && btn.isConnected) btn.disabled = false; }
  });
}
function dialog(judul, pesan, okLabel, bahaya, denganBatal) {
  return new Promise((res) => {
    $('#dialog-judul').textContent = judul; $('#dialog-pesan').textContent = pesan;
    const ok = $('#dialog-ok'), batal = $('#dialog-batal');
    ok.textContent = okLabel; ok.className = 'btn' + (bahaya ? ' merah' : ''); batal.hidden = !denganBatal;
    $('#dialog').hidden = false; ok.focus();
    const selesai = (v) => { $('#dialog').hidden = true; ok.onclick = batal.onclick = null; res(v); };
    ok.onclick = () => selesai(true); batal.onclick = () => selesai(false);
  });
}
const konfirmasi = (judul, pesan, okLabel = 'Ya', bahaya = false) => dialog(judul, pesan, okLabel, bahaya, true);
const info = (judul, pesan) => dialog(judul, pesan, 'Mengerti', false, false);
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800); }
function lihatFoto(src) { const s = imgAman(src); if (!s) return; $('#lightbox-img').src = s; $('#lightbox').hidden = false; }

// ---------------------------------------------------------------------------
// PWA (tanpa pop-up berulang)
// ---------------------------------------------------------------------------
let promptPasang = null;
function siapkanPWA() {
  try {
    const manifest = { name: 'E-Ronda RT 01', short_name: 'E-Ronda', start_url: location.href.split('#')[0], display: 'standalone', background_color: '#1E2A44', theme_color: '#1E2A44',
      icons: [{ src: 'https://i.ibb.co.com/wFKTHKyj/RT-01.png', sizes: '512x512', type: 'image/png' }] };
    const l = document.createElement('link'); l.rel = 'manifest';
    l.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
    document.head.appendChild(l);
  } catch (e) { /* abaikan */ }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptPasang = e; if (S.tab === 'info') renderInfo(); });
  window.addEventListener('appinstalled', () => { promptPasang = null; toast('E-Ronda terpasang di layar utama.'); });
}

// ---------------------------------------------------------------------------
// Event (delegasi — tidak ada onclick di HTML)
// ---------------------------------------------------------------------------
const AKSI = {
  'mode-login': (el) => setModeLogin(el.dataset.mode),
  keluar: () => keluar(),
  tab: (el) => gantiTab(el.dataset.tab),
  goto: (el) => gantiTab(el.dataset.tab, el.dataset.sub),
  sub: (el) => { S.sub[el.dataset.view] = el.dataset.sub; renderTab(); },
  filter: (el) => { S.filter[el.dataset.f] = el.dataset.v; renderTab(); },
  'buka-presensi': (el) => { S.presensiTgl = el.dataset.tgl === 'hari-ini' ? ymd() : el.dataset.tgl; gantiTab('ronda', 'presensi'); },
  'geser-tgl': (el) => { const d = parseYMD(S.presensiTgl) || new Date(); d.setDate(d.getDate() + num(el.dataset.d)); S.presensiTgl = ymd(d); renderPresensi(); },
  presensi: (el) => { if (el.dataset.st === 'Izin') bukaIzin(num(el.dataset.id)); else if (el.dataset.st === 'Hapus') konfirmasi('Kosongkan status?', 'Status presensi warga ini akan dihapus. Denda absen (jika ada) ikut dibatalkan.', 'Kosongkan').then((ok) => ok && setPresensi(num(el.dataset.id), 'Hapus')); else setPresensi(num(el.dataset.id), el.dataset.st); },
  'lihat-foto': (el) => {
    const i = num(el.dataset.idx);
    if (el.dataset.sumber === 'presensi') lihatFoto(fotoPresensi(S.presensiTgl)[i]);
    else { const m = S.mutasi.find((x) => x.id === num(el.dataset.id)); if (m && Array.isArray(m.bukti)) lihatFoto(m.bukti.filter(imgAman)[i]); }
  },
  'hapus-foto-presensi': (el) => hapusFotoPresensi(num(el.dataset.idx)),
  'tutup-lightbox': () => { $('#lightbox').hidden = true; $('#lightbox-img').removeAttribute('src'); },
  'tutup-sheet': () => tutupSheet(),
  'warga-baru': () => formWarga(null),
  'edit-warga': (el) => formWarga(num(el.dataset.id)),
  'hapus-warga': (el) => hapusWarga(num(el.dataset.id)),
  'kelola-tipe': () => kelolaTipe(),
  'hapus-tipe': (el) => hapusTipe(num(el.dataset.id)),
  'bayar-denda': (el) => bayarDenda(num(el.dataset.id)),
  'edit-denda': (el) => editDenda(num(el.dataset.id)),
  'hapus-denda': (el) => hapusDenda(num(el.dataset.id)),
  'nota-wa': (el) => kirimNotaWA(num(el.dataset.id)),
  'mutasi-baru': () => formMutasi(null),
  'detail-mutasi': (el) => detailMutasi(num(el.dataset.id)),
  'edit-mutasi': (el) => formMutasi(num(el.dataset.id)),
  'hapus-mutasi': (el) => hapusMutasi(num(el.dataset.id)),
  'sesuaikan-saldo': () => sesuaikanSaldo(),
  'deposit-baru': () => formDeposit(),
  'edit-deposit': (el) => editDeposit(num(el.dataset.id)),
  cetak: () => menuCetak(),
  'detail-rencana': (el) => detailRencana(num(el.dataset.id)),
  'rencana-baru': () => formRencana(null),
  'edit-rencana': (el) => formRencana(num(el.dataset.id)),
  'hapus-rencana': (el) => hapusRencana(num(el.dataset.id)),
  'aspirasi-baru': () => formAspirasi(),
  tanggapi: (el) => formTanggapan(num(el.dataset.id)),
  'hapus-aspirasi': (el) => hapusAspirasi(num(el.dataset.id)),
  'pasang-app': async () => { if (!promptPasang) return; promptPasang.prompt(); await promptPasang.userChoice; promptPasang = null; renderInfo(); }
};
// Aksi yang hanya untuk pengurus (tetap diblokir server lewat firestore.rules)
const AKSI_ADMIN = new Set(['warga-baru', 'edit-warga', 'hapus-warga', 'kelola-tipe', 'hapus-tipe', 'bayar-denda', 'edit-denda', 'hapus-denda', 'nota-wa', 'mutasi-baru', 'edit-mutasi', 'hapus-mutasi', 'sesuaikan-saldo', 'deposit-baru', 'edit-deposit', 'cetak', 'rencana-baru', 'edit-rencana', 'hapus-rencana', 'tanggapi', 'hapus-aspirasi', 'hapus-foto-presensi', 'presensi']);

function pasangEvent() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const act = el.dataset.act, fn = AKSI[act]; if (!fn) return;
    if (AKSI_ADMIN.has(act) && !isAdmin()) return;
    e.preventDefault(); fn(el, e);
  });
  $('#form-login').addEventListener('submit', prosesLogin);
  $('#p-tgl').addEventListener('change', (e) => { if (parseYMD(e.target.value)) { S.presensiTgl = e.target.value; renderPresensi(); } });
  $('#p-foto-input').addEventListener('change', (e) => unggahFotoPresensi(e.target));
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') tutupSheet(); });
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') AKSI['tutup-lightbox'](); });
  document.addEventListener('toggle', (e) => {
    const d = e.target; if (!(d instanceof HTMLDetailsElement) || !d.dataset.kunci) return;
    if (d.open) S.grupTerbuka.add(d.dataset.kunci); else S.grupTerbuka.delete(d.dataset.kunci);
  }, true);
  document.addEventListener('input', (e) => {
    const el = e.target; if (!el.classList || !el.classList.contains('rupiah')) return;
    const neg = el.value.trim().startsWith('-') && el.id === 'f-saldo';
    const d = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    el.value = (neg ? '-' : '') + (d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#lightbox').hidden) AKSI['tutup-lightbox']();
    else if (!$('#dialog').hidden) $('#dialog-batal').hidden ? $('#dialog-ok').click() : $('#dialog-batal').click();
    else if (!$('#sheet').hidden) tutupSheet();
  });
  // Tombol kembali di HP: tutup lembar/foto dulu, lalu kembali ke Beranda
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => {
    history.pushState(null, '', location.href);
    if (!$('#lightbox').hidden) AKSI['tutup-lightbox']();
    else if (!$('#sheet').hidden) tutupSheet();
    else if (S.role && S.tab !== 'beranda') gantiTab('beranda');
  });
}

// ---------------------------------------------------------------------------
// Mulai
// ---------------------------------------------------------------------------
async function mulai() {
  pasangEvent();
  siapkanPWA();
  try { await muatFirebase(); }
  catch (e) {
    console.error(e);
    $('#boot-msg').textContent = 'Tidak bisa terhubung ke server. Periksa koneksi internet.';
    const b = $('#boot-ulang'); b.hidden = false; b.onclick = () => location.reload();
    return;
  }
  fb.authM.onAuthStateChanged(fb.auth, (user) => {
    if (user && (user.email === EMAIL_ADMIN || user.email === EMAIL_WARGA)) masukApp(user);
    else { if (user) fb.authM.signOut(fb.auth); S.role = null; tampilLogin(); }
  });
}
mulai();
