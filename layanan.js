// Layanan warga: (1) Darurat & kontak penting + tombol SOS, (2) Lapor tamu 1x24 jam
// Warga Kebon Agung RT01/05
// ---------------------------------------------------------------------------
// KEAMANAN
//  - Memakai koneksi Firebase yang sama dengan ronda.js (getApp). Tidak ada kunci baru.
//  - Hak akses ditentukan firestore.rules (KBN01_tamu: anggota kirim & baca, hanya pengurus
//    ubah/hapus; KBN01_profil: hanya pengurus ubah). Menyembunyikan tombol hanya soal tampilan.
//  - Semua data dipasang lewat esc(); nomor telepon/WA dipaksa hanya angka sebelum jadi tautan.
//  - Laporan tamu SENGAJA tidak menyimpan NIK/KTP/HP tamu, karena daftar ini bisa dibaca
//    semua akun warga (agar petugas ronda bisa melihat).
// ---------------------------------------------------------------------------
'use strict';

const FB = 'https://www.gstatic.com/firebasejs/11.6.1/';   // harus sama persis dengan ronda.js
const EMAIL_ADMIN = 'admin@e-ronda-kebonagung.firebaseapp.com';
const EMAIL_WARGA = 'warga@e-ronda-kebonagung.firebaseapp.com';
const LOKASI = 'RT 01/RW 05 Kebon Agung, Jatinegara, Sempor, Kebumen';
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const JENIS_TAMU = ['Tamu menginap', 'Warga baru'];
// Nomor darurat nasional (tetap). Nomor lokal (Puskesmas, Polsek, dll.) diisi pengurus.
const NASIONAL = [
  { nama: 'Polisi', no: '110', ket: 'Kejahatan, kecelakaan' },
  { nama: 'Pemadam Kebakaran', no: '113', ket: 'Kebakaran' },
  { nama: 'Ambulans', no: '118', ket: 'Kondisi medis darurat' },
  { nama: 'Darurat umum', no: '112', ket: 'Semua keadaan darurat' },
];
const SOS = [
  { jenis: 'Kebakaran', ikon: 'fa-fire' },
  { jenis: 'Keamanan / kemalingan', ikon: 'fa-user-shield' },
  { jenis: 'Medis / sakit', ikon: 'fa-truck-medical' },
  { jenis: 'Lainnya', ikon: 'fa-circle-exclamation' },
];

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const bersih = (s, maks) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maks);
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
let idTerakhir = 0;
function idBaru() { let t = Date.now(); if (t <= idTerakhir) t = idTerakhir + 1; idTerakhir = t; return t; }
const stempelWaktu = () => new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).slice(0, 40);
function hariIni() { const n = new Date(), p = (x) => String(x).padStart(2, '0'); return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`; }
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function tanggalIndo(iso) {
  if (!ISO.test(iso || '')) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return m >= 1 && m <= 12 ? `${d} ${BULAN[m - 1]} ${y}` : '';
}
const hariBeda = (a, b) => Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
// Hanya angka -> aman dijadikan tautan tel:/wa.me
function nomorWA(no) { let d = String(no || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '62' + d.slice(1); return /^\d{9,15}$/.test(d) ? d : ''; }
function nomorTel(no) { const d = String(no || '').replace(/\D/g, ''); return /^\d{3,15}$/.test(d) ? d : ''; }
const hariMalamIni = () => HARI[(new Date().getDay() + 1) % 7];   // "malam Senin" = Minggu malam

/* ---------- dialog & toast (elemen yang sama dengan ronda.js) ---------- */
function dialog(judul, pesan, okLabel, bahaya, denganBatal) {
  return new Promise((res) => {
    $('dialog-judul').textContent = judul; $('dialog-pesan').textContent = pesan;
    const ok = $('dialog-ok'), batal = $('dialog-batal');
    ok.textContent = okLabel; ok.className = 'btn' + (bahaya ? ' merah' : ''); batal.hidden = !denganBatal;
    $('dialog').hidden = false; ok.focus();
    const selesai = (v) => { $('dialog').hidden = true; ok.onclick = batal.onclick = null; res(v); };
    ok.onclick = () => selesai(true); batal.onclick = () => selesai(false);
  });
}
const konfirmasi = (j, p, ok = 'Ya', bahaya = false) => dialog(j, p, ok, bahaya, true);
const info = (j, p) => dialog(j, p, 'Mengerti', false, false);
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200); }

/* ---------- Firebase: ikut koneksi ronda.js ---------- */
let fs = null, db = null, peran = null, unsubs = [];
let profil = {}, wargaList = [], tamu = [];

async function sambung() {
  let appM, authM, fsM;
  try {
    [appM, authM, fsM] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
  } catch (e) { console.error(e); return; }
  for (let i = 0; i < 150 && appM.getApps().length === 0; i++) await tunggu(200);   // tunggu ronda.js
  if (!appM.getApps().length) return;
  const app = appM.getApp();
  db = fsM.getFirestore(app); fs = fsM;
  authM.onAuthStateChanged(authM.getAuth(app), (u) => aturPeran(u));
}
function lepas() { unsubs.forEach((u) => { try { u(); } catch (_) { /* abaikan */ } }); unsubs = []; }
function aturPeran(user) {
  peran = user && user.email === EMAIL_ADMIN ? 'admin' : (user && user.email === EMAIL_WARGA ? 'warga' : null);
  lepas(); profil = {}; wargaList = []; tamu = [];
  if (peran !== 'admin') { ['darurat-edit'].forEach((id) => { $(id).hidden = true; }); }
  if (!peran) tutupSemua();
  if (peran) {
    const on = (ref, fn) => unsubs.push(fs.onSnapshot(ref, fn, (e) => console.error(e)));
    on(fs.doc(db, 'KBN01_profil', 'utama'), (s) => { profil = s.exists() ? (s.data() || {}) : {}; renderDarurat(); });
    on(fs.collection(db, 'KBN01_warga'), (s) => { wargaList = s.docs.map((d) => d.data()).filter((w) => w && w.nama); renderDarurat(); });
    on(fs.collection(db, 'KBN01_tamu'), (s) => { tamu = s.docs.map((d) => ({ ...d.data(), _doc: d.id, id: num(d.data().id) })); renderTamu(); perbaruiBadge(); });
  }
  perbaruiBadge();
}
async function tulis(janji, pesanOk) {
  try { await janji; if (pesanOk) toast(pesanOk); return true; }
  catch (e) {
    console.error(e);
    if (e && e.code === 'permission-denied') info('Akses ditolak', 'Akun Anda tidak berhak melakukan ini.');
    else info('Gagal menyimpan', 'Periksa koneksi internet lalu coba lagi.');
    return false;
  }
}
function perbaruiBadge() {
  const b = $('tamu-badge'); if (!b) return;
  const n = peran === 'admin' ? tamu.filter((x) => x.status === 'Baru').length : 0;
  b.textContent = n > 99 ? '99+' : String(n); b.hidden = n === 0;
}

/* ---------- overlay ---------- */
const OVERLAY = ['tamu-form', 'darurat-edit', 'tamu', 'darurat'];   // paling atas dulu
let pemicu = null;
const sinkron = () => document.body.classList.toggle('layanan-terbuka', OVERLAY.some((id) => !$(id).hidden));
function buka(id) { pemicu = document.activeElement; $(id).hidden = false; $(id).scrollTop = 0; sinkron(); }
function tutup(id) { $(id).hidden = true; sinkron(); if (pemicu && pemicu.isConnected && pemicu.focus) try { pemicu.focus(); } catch (_) { /* abaikan */ } }
function tutupTeratas() { const id = OVERLAY.find((x) => !$(x).hidden); if (id) tutup(id); return !!id; }
function tutupSemua() { OVERLAY.forEach((id) => { $(id).hidden = true; }); sinkron(); }

/* =====================================================================
   1) DARURAT & KONTAK PENTING
   ===================================================================== */
function kontakKetua() {
  const p = (Array.isArray(profil.pengurus) ? profil.pengurus : []).filter((x) => x && nomorWA(x.wa));
  return p.find((x) => /ketua\s*rt/i.test(String(x.jabatan || ''))) || p.find((x) => /^ketua$/i.test(String(x.jabatan || '').trim())) || p[0] || null;
}
function tombolKontak(no, nama) {
  const wa = nomorWA(no), tel = nomorTel(no);
  return `<span class="baris">${tel ? `<a class="btn kecil hijau" href="tel:${tel}" aria-label="Telepon ${esc(nama)}"><i class="fa-solid fa-phone"></i></a>` : ''}${wa ? `<a class="btn kecil lembut" href="https://wa.me/${wa}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp ${esc(nama)}"><i class="fa-brands fa-whatsapp"></i></a>` : ''}</span>`;
}
function renderDarurat() {
  if (!$('darurat-isi')) return;
  const ketua = kontakKetua();
  const pesan = (jenis) => `🚨 *DARURAT – ${jenis}*\nLokasi: ${LOKASI}.\nMohon bantuan segera.`;
  const sos = ketua
    ? `<div class="sos-grid">${SOS.map((s) => `<a class="btn full merah" href="https://wa.me/${nomorWA(ketua.wa)}?text=${encodeURIComponent(pesan(s.jenis))}" target="_blank" rel="noopener noreferrer"><i class="fa-solid ${s.ikon}"></i> ${esc(s.jenis)}</a>`).join('')}</div>
       <p class="bantu">Membuka WhatsApp ke ${esc(ketua.jabatan || 'pengurus')} ${esc(ketua.nama || '')} dengan pesan darurat yang sudah terisi. Tekan Kirim di WhatsApp. Untuk nyawa terancam, telepon 112 lebih dulu.</p>`
    : `<p class="bantu">Nomor WhatsApp Ketua RT belum diisi.${peran === 'admin' ? ' Isi di Profil → Susunan pengurus.' : ' Pengurus dapat mengisinya di Profil → Susunan pengurus.'} Sementara itu gunakan nomor darurat di bawah.</p>`;

  const hari = hariMalamIni();
  const ronda = wargaList.filter((w) => w.jadwal === hari).sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
  const pengurus = (Array.isArray(profil.pengurus) ? profil.pengurus : []).filter((x) => x && x.nama);
  const lokal = (Array.isArray(profil.darurat) ? profil.darurat : []).filter((x) => x && x.nama && nomorTel(x.no));

  const baris = (nama, sub, no) => `<div class="item"><div class="isi" style="min-width:0"><b style="overflow-wrap:anywhere">${esc(nama)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>${tombolKontak(no, nama)}</div>`;
  $('darurat-isi').innerHTML = `
    <div class="kartu" style="border-color:var(--merah);margin-bottom:14px">
      <b style="color:var(--merah)"><i class="fa-solid fa-triangle-exclamation"></i> Butuh bantuan segera?</b>
      <div style="margin-top:10px">${sos}</div>
    </div>

    <p class="lbl" style="margin:0 0 8px">Nomor darurat</p>
    <div class="daftar" style="margin-bottom:14px">${NASIONAL.concat(lokal.map((x) => ({ nama: bersih(x.nama, 60), no: x.no, ket: bersih(x.ket, 80) }))).map((x) => baris(x.nama, `${x.no}${x.ket ? ' · ' + x.ket : ''}`, x.no)).join('')}</div>
    ${peran === 'admin' ? '<button type="button" class="btn kecil lembut" data-layanan="darurat-ubah" style="margin-bottom:14px"><i class="fa-solid fa-pen"></i> Ubah nomor lokal (Puskesmas, Polsek, dll.)</button>' : ''}
    ${lokal.length || peran === 'admin' ? '' : '<p class="bantu" style="margin-bottom:14px">Nomor Puskesmas dan Polsek setempat belum diisi pengurus.</p>'}

    <p class="lbl" style="margin:0 0 8px">Pengurus RT</p>
    <div class="daftar" style="margin-bottom:14px">${pengurus.length ? pengurus.map((x) => baris(x.nama, x.jabatan || 'Pengurus', x.wa)).join('') : '<div class="kosong">Susunan pengurus belum diisi.</div>'}</div>

    <p class="lbl" style="margin:0 0 8px">Ronda malam ini (${esc(hari)})</p>
    <div class="daftar">${ronda.length ? ronda.map((w) => baris(w.nama, w.wa ? '' : 'Belum ada nomor WA', w.wa)).join('') : '<div class="kosong">Belum ada warga di regu ronda malam ini.</div>'}</div>`;
}
function bukaDarurat() { renderDarurat(); buka('darurat'); }

/* ---- editor nomor lokal (pengurus) ---- */
function barisEditor(x) {
  const r = document.createElement('div'); r.className = 'baris-pengurus';
  const mk = (k, ph, val, maks, mode) => { const i = document.createElement('input'); i.className = 'inp'; i.dataset.k = k; i.placeholder = ph; i.maxLength = maks; i.value = val || ''; if (mode) i.inputMode = mode; return i; };
  const hapus = document.createElement('button'); hapus.type = 'button'; hapus.className = 'ikon-btn'; hapus.dataset.layanan = 'darurat-baris-hapus'; hapus.setAttribute('aria-label', 'Hapus baris'); hapus.style.color = 'var(--merah)';
  hapus.innerHTML = '<i class="fa-solid fa-trash"></i>';
  const ket = mk('ket', 'Keterangan (opsional)', x.ket, 80); ket.classList.add('wa');
  r.append(mk('nama', 'Nama (mis. Puskesmas Sempor)', x.nama, 60), mk('no', 'Nomor telepon', x.no, 20, 'tel'), hapus, ket);
  return r;
}
function bukaEditor() {
  if (peran !== 'admin') return;
  const wadah = $('de-baris'); wadah.replaceChildren();
  const awal = (Array.isArray(profil.darurat) && profil.darurat.length) ? profil.darurat : [{ nama: 'Puskesmas', no: '', ket: '' }, { nama: 'Polsek', no: '', ket: '' }, { nama: 'Pemadam Kebakaran (lokal)', no: '', ket: '' }];
  awal.forEach((x) => wadah.append(barisEditor(x || {})));
  $('de-err').textContent = '';
  buka('darurat-edit');
}
let sibukEditor = false;
async function simpanEditor() {
  if (peran !== 'admin' || sibukEditor) return;
  const data = [...$('de-baris').querySelectorAll('.baris-pengurus')].map((r) => ({
    nama: bersih(r.querySelector('[data-k=nama]').value, 60),
    no: r.querySelector('[data-k=no]').value.replace(/\D/g, '').slice(0, 15),
    ket: bersih(r.querySelector('[data-k=ket]').value, 80),
  })).filter((x) => x.nama || x.no);
  if (data.some((x) => !x.nama || !nomorTel(x.no))) { $('de-err').textContent = 'Setiap baris harus punya nama dan nomor (angka, minimal 3 digit).'; return; }
  sibukEditor = true; $('de-simpan').disabled = true;
  try { if (await tulis(fs.setDoc(fs.doc(db, 'KBN01_profil', 'utama'), { darurat: data }, { merge: true }), 'Nomor darurat disimpan.')) tutup('darurat-edit'); }
  finally { sibukEditor = false; $('de-simpan').disabled = false; }
}

/* =====================================================================
   2) LAPOR TAMU 1x24 JAM
   ===================================================================== */
const tamuAktif = (x) => (x.tglPulang && ISO.test(x.tglPulang) ? x.tglPulang >= hariIni() : hariBeda(hariIni(), x.tglDatang) <= 30);
function renderTamu() {
  const wadah = $('tamu-list'); if (!wadah) return;
  const semua = tamu.slice().sort((a, b) => b.id - a.id);
  const aktif = semua.filter(tamuAktif), lewat = semua.filter((x) => !tamuAktif(x));
  const tampil = peran === 'admin' ? aktif.concat(lewat) : aktif;
  const kartu = (x) => {
    const lw = !tamuAktif(x), baru = x.status === 'Baru';
    return `<div class="pos"${lw ? ' style="opacity:.75"' : ''}>
      <div class="baris antara"><span class="baris"><span class="st st-sistem">${esc(JENIS_TAMU.includes(x.jenis) ? x.jenis : 'Tamu menginap')}</span>${lw ? '<span class="st">Sudah lewat</span>' : (baru ? '<span class="st st-Baru">Baru</span>' : '<span class="st st-Selesai">Sudah dicek</span>')}</span><span class="redup kecil">Dilapor ${esc(x.tanggal || '')}</span></div>
      <b style="display:block;font-size:16px;margin-top:8px;overflow-wrap:anywhere">${esc(x.nama)}${num(x.jumlah) > 1 ? ` (${num(x.jumlah)} orang)` : ''}</b>
      <p class="redup kecil" style="margin:2px 0 0;overflow-wrap:anywhere">Asal: ${esc(x.asal || '-')} · Tuan rumah/pelapor: ${esc(x.tuanRumah)}</p>
      <p class="kecil" style="margin:6px 0 0"><i class="fa-regular fa-calendar"></i> ${esc(tanggalIndo(x.tglDatang))}${x.tglPulang ? ` s/d ${esc(tanggalIndo(x.tglPulang))}` : ''}</p>
      ${x.ket ? `<p class="teks">${esc(x.ket)}</p>` : ''}
      ${peran === 'admin' ? `<div class="baris" style="margin-top:10px">
        ${baru ? `<button type="button" class="btn kecil hijau" data-layanan="tamu-dicek" data-id="${esc(x._doc)}"><i class="fa-solid fa-check"></i> Tandai sudah dicek</button>` : ''}
        <button type="button" class="btn kecil lembut" data-layanan="tamu-hapus" data-id="${esc(x._doc)}" style="color:var(--merah)"><i class="fa-solid fa-trash"></i> Hapus</button></div>` : ''}
    </div>`;
  };
  wadah.innerHTML = tampil.length ? tampil.map(kartu).join('') : '<div class="kosong">Belum ada laporan tamu atau warga baru yang aktif.</div>';
  const nLewat = lewat.length, tombol = $('tamu-hapus-lewat');
  tombol.hidden = !(peran === 'admin' && nLewat); tombol.textContent = `Hapus ${nLewat} laporan yang sudah lewat`;
}
function bukaTamu() { renderTamu(); buka('tamu'); }

function bukaFormTamu() {
  $('tamu-form-el').reset(); $('tf-err').textContent = '';
  $('tf-datang').value = hariIni(); $('tf-jumlah').value = '1';
  buka('tamu-form'); $('tf-nama').focus({ preventScroll: true });
}
function ambilTamu() {
  return {
    jenis: $('tf-jenis').value, nama: bersih($('tf-nama').value, 80), jumlah: Math.trunc(Number($('tf-jumlah').value)),
    asal: bersih($('tf-asal').value, 80), tuanRumah: bersih($('tf-tuan').value, 80),
    tglDatang: $('tf-datang').value, tglPulang: $('tf-pulang').value, ket: bersih($('tf-ket').value, 200),
  };
}
function periksaTamu(d) {
  if (!JENIS_TAMU.includes(d.jenis)) return 'Pilih jenis laporan.';
  if (!d.nama) return 'Nama tamu / warga baru wajib diisi.';
  if (!Number.isInteger(d.jumlah) || d.jumlah < 1 || d.jumlah > 20) return 'Jumlah orang harus 1 sampai 20.';
  if (!d.tuanRumah) return 'Nama tuan rumah / pelapor wajib diisi.';
  if (!ISO.test(d.tglDatang)) return 'Isi tanggal datang.';
  if (d.tglPulang && !ISO.test(d.tglPulang)) return 'Tanggal pulang tidak valid.';
  if (d.tglPulang && d.tglPulang < d.tglDatang) return 'Tanggal pulang tidak boleh sebelum tanggal datang.';
  return '';
}
let sibukTamu = false;
async function kirimTamu() {
  if (sibukTamu || !fs) return;
  const d = ambilTamu(), salah = periksaTamu(d);
  $('tf-err').textContent = salah; if (salah) return;
  sibukTamu = true; $('tf-kirim').disabled = true;
  try {
    const id = idBaru();
    // Bentuk & nama field HARUS sama dengan tamuValid() di firestore.rules
    const data = { id, jenis: d.jenis, nama: d.nama, jumlah: d.jumlah, asal: d.asal, tuanRumah: d.tuanRumah, tglDatang: d.tglDatang, tglPulang: d.tglPulang, ket: d.ket, tanggal: stempelWaktu(), status: 'Baru' };
    if (await tulis(fs.setDoc(fs.doc(db, 'KBN01_tamu', String(id)), data), 'Laporan terkirim. Terima kasih sudah melapor.')) { $('tamu-form-el').reset(); tutup('tamu-form'); }
  } finally { sibukTamu = false; $('tf-kirim').disabled = false; }
}
async function tamuHapus(docId) {
  const x = tamu.find((t) => t._doc === docId); if (!x) return;
  if (!(await konfirmasi('Hapus laporan?', `Laporan ${x.nama} akan dihapus permanen.`, 'Hapus', true))) return;
  await tulis(fs.deleteDoc(fs.doc(db, 'KBN01_tamu', String(docId))), 'Laporan dihapus.');
}
async function tamuHapusLewat() {
  const ids = tamu.filter((x) => !tamuAktif(x)).map((x) => x._doc); if (!ids.length) return;
  if (!(await konfirmasi('Hapus yang sudah lewat?', `${ids.length} laporan yang masa tinggalnya sudah lewat akan dihapus permanen.`, 'Hapus semua', true))) return;
  const b = fs.writeBatch(db); ids.forEach((id) => b.delete(fs.doc(db, 'KBN01_tamu', String(id))));
  await tulis(b.commit(), `${ids.length} laporan dihapus.`);
}

/* ---------- pasang ---------- */
function mulai() {
  if (!$('darurat')) return;
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-layanan]'); if (!t) return;
    const a = t.dataset.layanan, adm = peran === 'admin';
    if (a === 'darurat') { if (peran) bukaDarurat(); return; }
    if (a === 'tamu') { if (peran) bukaTamu(); return; }
    if (a === 'tutup-darurat') return tutup('darurat');
    if (a === 'tutup-tamu') return tutup('tamu');
    if (a === 'tutup-tamu-form') return tutup('tamu-form');
    if (a === 'tutup-editor') return tutup('darurat-edit');
    if (a === 'tamu-baru') { if (peran) bukaFormTamu(); return; }
    if (!adm) return;                              // aksi di bawah ini hanya untuk pengurus
    if (a === 'darurat-ubah') bukaEditor();
    else if (a === 'darurat-baris-tambah') { if ($('de-baris').children.length < 10) $('de-baris').append(barisEditor({})); }
    else if (a === 'darurat-baris-hapus') t.closest('.baris-pengurus').remove();
    else if (a === 'tamu-dicek') tulis(fs.updateDoc(fs.doc(db, 'KBN01_tamu', String(t.dataset.id)), { status: 'Sudah dicek' }), 'Ditandai sudah dicek.');
    else if (a === 'tamu-hapus') tamuHapus(t.dataset.id);
    else if (a === 'tamu-hapus-lewat') tamuHapusLewat();
  });
  $('tamu-form-el').addEventListener('submit', (e) => { e.preventDefault(); kirimTamu(); });
  $('darurat-edit-form').addEventListener('submit', (e) => { e.preventDefault(); simpanEditor(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('dialog').hidden && $('lightbox').hidden) tutupTeratas(); });
  window.addEventListener('popstate', () => { tutupTeratas(); });
  sambung();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mulai);
else mulai();
