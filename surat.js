// Surat Keterangan/Pengantar — Warga Kebon Agung RT01/05
// ---------------------------------------------------------------------------
// ALUR
//  1. Warga  : menu "Surat pengantar" -> isi data diri -> Kirim (disimpan ke koleksi KBN01_surat).
//  2. Pengurus: menu "Permintaan surat" -> daftar kartu (badge Baru / Sudah direspon...).
//              Klik kartu -> form surat terisi otomatis -> Ketua RT melengkapi -> Cetak.
//              Setelah dicetak kartu ditandai "Sudah direspon dan ditindaklanjuti" dan
//              pengurus diingatkan menghapus data (No. KK/KTP) dari database.
//
// KEAMANAN
//  - Modul ini memakai koneksi Firebase yang sama dengan ronda.js (getApp), tanpa kunci baru.
//  - Yang menentukan siapa boleh membaca/menghapus adalah firestore.rules (koleksi KBN01_surat:
//    warga hanya boleh MENGIRIM). Menyembunyikan tombol hanya soal tampilan.
//  - Semua data dipasang lewat esc()/textContent, tidak ada skrip/handler inline (sesuai CSP).
//  - Data warga tidak disimpan di perangkat; hanya kop surat & nama pejabat (localStorage).
// ---------------------------------------------------------------------------
'use strict';

const FB = 'https://www.gstatic.com/firebasejs/11.6.1/';   // harus sama persis dengan ronda.js
const KOLEKSI = 'KBN01_surat';
const EMAIL_ADMIN = 'admin@e-ronda-kebonagung.firebaseapp.com';
const EMAIL_WARGA = 'warga@e-ronda-kebonagung.firebaseapp.com';
const KUNCI_PENGATURAN = 'ronda.surat.pengaturan.v1';
const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const AGAMA = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'];
const STATUS_NIKAH = ['Kawin', 'Belum Kawin', 'Janda', 'Duda'];
const TINGGI_SETENGAH_A4_MM = 148.5;
// Kop & pejabat yang diingat di perangkat ini (BUKAN data warga).
const KOLOM_PENGATURAN = ['s-kab','s-kec','s-desa','s-rt','s-rw','s-rwangka','s-ketuart','s-ketuarw','s-kertas'];

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const bersih = (s, maks) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maks);
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
function el(tag, kelas, teks) {
  const e = document.createElement(tag);
  if (kelas) e.className = kelas;
  if (teks !== undefined && teks !== null) e.textContent = teks;
  return e;
}
let idTerakhir = 0;
function idBaru() { let t = Date.now(); if (t <= idTerakhir) t = idTerakhir + 1; idTerakhir = t; return t; }

/* ---------- tanggal ---------- */
function tanggalIndo(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${d} ${BULAN[m - 1]} ${y}`;
}
function hariIni() {
  const n = new Date(), p = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}
function tambahBulan(iso) {
  // +1 bulan; 31 Jan -> 28/29 Feb (tidak melompat ke bulan berikutnya)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  let [y, m, d] = iso.split('-').map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  d = Math.min(d, new Date(y, m, 0).getDate());
  const p = (x) => String(x).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}
const stempelWaktu = () => new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).slice(0, 40);
const angkaSaja = (s) => String(s || '').replace(/[\s.\-]/g, '');
const samarkan = (n) => (/^\d{16}$/.test(n) ? `••••${n.slice(-4)}` : (n ? '••••' : ''));

/* ---------- dialog & toast (memakai elemen yang sama dengan ronda.js) ---------- */
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
let fs = null, db = null, peran = null, unsubSurat = null;
let daftar = [];            // permintaan surat (hanya terisi untuk pengurus)

async function sambung() {
  let appM, authM, fsM;
  try {
    [appM, authM, fsM] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
  } catch (e) { console.error(e); return; }
  for (let i = 0; i < 150 && appM.getApps().length === 0; i++) await tunggu(200); // tunggu ronda.js
  if (!appM.getApps().length) return;
  const app = appM.getApp();
  db = fsM.getFirestore(app); fs = fsM;
  authM.onAuthStateChanged(authM.getAuth(app), (u) => aturPeran(u));
}
function aturPeran(user) {
  peran = user && user.email === EMAIL_ADMIN ? 'admin' : (user && user.email === EMAIL_WARGA ? 'warga' : null);
  if (unsubSurat) { try { unsubSurat(); } catch (_) { /* abaikan */ } unsubSurat = null; }
  daftar = [];
  const label = $('surat-label'); if (label) label.textContent = peran === 'admin' ? 'Permintaan surat' : 'Surat pengantar';
  if (peran !== 'admin') { $('surat').hidden = true; $('surat-daftar').hidden = true; bersihkanData(); sinkronBody(); }
  if (!peran) tutupSemua();
  if (peran === 'admin') {
    unsubSurat = fs.onSnapshot(fs.collection(db, KOLEKSI), (snap) => {
      daftar = snap.docs.map((d) => ({ ...d.data(), _doc: d.id, id: num(d.data().id) }));
      renderDaftar(); perbaruiBadge();
    }, (e) => console.error(e));
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
const kirimKeDb = (id, data) => tulis(fs.setDoc(fs.doc(db, KOLEKSI, String(id)), data), 'Permintaan terkirim. Ketua RT akan memproses surat Anda.');
const hapusDariDb = (docId) => tulis(fs.deleteDoc(fs.doc(db, KOLEKSI, String(docId))), 'Permintaan dihapus.');

function perbaruiBadge() {
  const b = $('surat-badge'); if (!b) return;
  const n = peran === 'admin' ? daftar.filter((x) => x.respon === 'Baru').length : 0;
  b.textContent = n > 99 ? '99+' : String(n); b.hidden = n === 0;
}

/* ---------- overlay: buka/tutup ---------- */
const OVERLAY = ['surat-warga', 'surat', 'surat-daftar'];   // urutan: paling atas dulu
let pemicu = null;
function sinkronBody() { document.body.classList.toggle('surat-terbuka', OVERLAY.some((id) => !$(id).hidden)); }
function bukaOverlay(id) { pemicu = document.activeElement; $(id).hidden = false; $(id).scrollTop = 0; sinkronBody(); }
function bersihkanData() {
  // Hapus data pemohon (termasuk No. KK/KTP) dari layar begitu form ditutup
  bersihkanFormSurat();
  $('surat-cetak').replaceChildren();
  $('surat-warga-form').reset();
  permintaanAktif = null;
  $('surat-sumber').hidden = true;
}
function tutupOverlay(id) {
  $(id).hidden = true; sinkronBody();
  if (id === 'surat' || id === 'surat-warga') bersihkanData();
  if (pemicu && pemicu.isConnected && pemicu.focus) try { pemicu.focus(); } catch (_) { /* abaikan */ }
}
function tutupTeratas() { const id = OVERLAY.find((x) => !$(x).hidden); if (id) tutupOverlay(id); return !!id; }
function tutupSemua() { OVERLAY.forEach((id) => { $(id).hidden = true; }); bersihkanData(); sinkronBody(); }

/* =====================================================================
   1) FORM WARGA
   ===================================================================== */
function bukaWarga() {
  $('surat-warga-form').reset();
  $('sw-err').textContent = '';
  bukaOverlay('surat-warga');
  $('sw-nama').focus({ preventScroll: true });
}
function ambilWarga() {
  return {
    nama: bersih($('sw-nama').value, 80),
    tempatLahir: bersih($('sw-tempat').value, 60),
    tglLahir: $('sw-tgllahir').value,
    warga: bersih($('sw-warga').value, 40) || 'Indonesia',
    agama: $('sw-agama').value,
    kerja: bersih($('sw-kerja').value, 60),
    statusNikah: $('sw-status').value,
    kk: angkaSaja($('sw-kk').value),
    ktp: angkaSaja($('sw-ktp').value),
    perlu: bersih($('sw-perlu').value, 300),
  };
}
function periksaWarga(d) {
  if (!d.nama) return 'Nama lengkap wajib diisi.';
  if (!AGAMA.includes(d.agama)) return 'Pilih agama.';
  if (!STATUS_NIKAH.includes(d.statusNikah)) return 'Pilih status.';
  if (d.tglLahir && !/^\d{4}-\d{2}-\d{2}$/.test(d.tglLahir)) return 'Tanggal lahir tidak valid.';
  if (d.kk && !/^\d{16}$/.test(d.kk)) return 'No. KK harus 16 angka (atau kosongkan).';
  if (d.ktp && !/^\d{16}$/.test(d.ktp)) return 'No. KTP harus 16 angka (atau kosongkan).';
  if (!d.perlu) return 'Isi keperluan surat.';
  return '';
}
let sibukKirim = false;
async function kirimWarga() {
  if (sibukKirim || !fs) return;
  const d = ambilWarga(), salah = periksaWarga(d);
  $('sw-err').textContent = salah;
  if (salah) return;
  sibukKirim = true; const tombol = $('sw-kirim'); tombol.disabled = true;
  try {
    const id = idBaru();
    // Bentuk & nama field HARUS sama dengan suratValid() di firestore.rules
    const data = { id, ...d, tanggal: stempelWaktu(), respon: 'Baru' };
    if (await kirimKeDb(id, data)) { $('surat-warga-form').reset(); tutupOverlay('surat-warga'); }
  } finally { sibukKirim = false; tombol.disabled = false; }
}

/* =====================================================================
   2) DAFTAR PERMINTAAN (pengurus)
   ===================================================================== */
function bukaDaftar() { renderDaftar(); bukaOverlay('surat-daftar'); }
function renderDaftar() {
  const wadah = $('sd-list'); if (!wadah) return;
  const urut = daftar.slice().sort((a, b) => (a.respon === b.respon ? 0 : a.respon === 'Baru' ? -1 : 1) || b.id - a.id);
  const selesai = urut.filter((x) => x.respon !== 'Baru');
  const ingat = $('sd-ingat');
  ingat.hidden = selesai.length === 0;
  if (selesai.length) $('sd-ingat-teks').textContent = `${selesai.length} permintaan sudah ditindaklanjuti tetapi masih menyimpan data warga (termasuk No. KK/KTP). Hapus setelah surat dicetak agar data tidak menumpuk.`;

  wadah.innerHTML = urut.length ? urut.map((x) => {
    const baru = x.respon === 'Baru';
    const bukti = [x.kk ? `KK ${samarkan(x.kk)}` : '', x.ktp ? `KTP ${samarkan(x.ktp)}` : ''].filter(Boolean).join(' · ');
    return `<div class="pos" data-surat="buka-permintaan" data-id="${esc(x._doc)}" style="cursor:pointer">
      <div class="baris antara"><span class="st ${baru ? 'st-Baru' : 'st-Selesai'}">${baru ? 'Baru' : 'Sudah direspon dan ditindaklanjuti'}</span><span class="redup kecil">${esc(x.tanggal || '')}</span></div>
      <b style="display:block;font-size:16px;margin-top:8px;overflow-wrap:anywhere">${esc(x.nama)}</b>
      <p class="redup kecil" style="margin:2px 0 0">${esc([x.kerja, x.agama].filter(Boolean).join(' · '))}${bukti ? ` · ${esc(bukti)}` : ''}</p>
      <p class="teks"><b>Keperluan:</b> ${esc(x.perlu)}</p>
      ${baru ? '' : `<p class="bantu" style="color:var(--kuning);font-weight:700"><i class="fa-solid fa-triangle-exclamation"></i> Data pemohon masih tersimpan. Hapus jika surat sudah dicetak.${x.ditindaklanjuti ? ` (Diproses ${esc(x.ditindaklanjuti)})` : ''}</p>`}
      <div class="baris" style="margin-top:10px">
        <button type="button" class="btn kecil oranye" data-surat="buka-permintaan" data-id="${esc(x._doc)}"><i class="fa-solid fa-file-signature"></i> ${baru ? 'Buka & lengkapi' : 'Buka lagi'}</button>
        <button type="button" class="btn kecil lembut" data-surat="hapus-permintaan" data-id="${esc(x._doc)}" style="color:var(--merah)"><i class="fa-solid fa-trash"></i> Hapus</button>
      </div></div>`;
  }).join('') : '<div class="kosong">Belum ada permintaan surat dari warga.</div>';
}
async function hapusPermintaan(docId) {
  const x = daftar.find((d) => d._doc === docId); if (!x) return;
  const pesan = `Permintaan atas nama ${x.nama} akan dihapus permanen, termasuk No. KK/KTP yang tersimpan.` + (x.respon === 'Baru' ? '\nSurat untuk permintaan ini belum ditindaklanjuti.' : '');
  if (!(await konfirmasi('Hapus permintaan?', pesan, 'Hapus', true))) return;
  await hapusDariDb(docId);
}
async function hapusSelesai() {
  const ids = daftar.filter((x) => x.respon !== 'Baru').map((x) => x._doc);
  if (!ids.length) return;
  if (!(await konfirmasi('Hapus yang sudah selesai?', `${ids.length} permintaan yang sudah ditindaklanjuti akan dihapus permanen, termasuk No. KK/KTP.`, 'Hapus semua', true))) return;
  const b = fs.writeBatch(db);
  ids.forEach((id) => b.delete(fs.doc(db, KOLEKSI, String(id))));
  await tulis(b.commit(), `${ids.length} permintaan dihapus.`);
}

/* =====================================================================
   3) FORM SURAT (pengurus) + CETAK
   ===================================================================== */
let sampaiManual = false;      // true bila pengurus mengubah tanggal "sampai" sendiri
let permintaanAktif = null;    // dokumen permintaan yang sedang dikerjakan (null = surat manual)
let menungguPasca = null;      // permintaan yang menunggu pengingat hapus setelah cetak

function baca(id) { return ($(id).value || '').trim(); }
function muatPengaturan() {
  try {
    const raw = localStorage.getItem(KUNCI_PENGATURAN); if (!raw) return;
    const o = JSON.parse(raw); if (!o || typeof o !== 'object') return;
    for (const id of KOLOM_PENGATURAN) if (typeof o[id] === 'string') $(id).value = o[id].slice(0, 80);
  } catch (_) { /* abaikan */ }
}
function simpanPengaturan() {
  try {
    const o = {}; for (const id of KOLOM_PENGATURAN) o[id] = baca(id);
    localStorage.setItem(KUNCI_PENGATURAN, JSON.stringify(o));
  } catch (_) { /* abaikan */ }
}
function isiMasaBerlaku() {
  if (!$('s-dari').value) $('s-dari').value = hariIni();
  if (!sampaiManual) $('s-sampai').value = tambahBulan($('s-dari').value);
}
function bersihkanFormSurat() {
  for (const f of $('surat-form').querySelectorAll('input, textarea, select')) {
    if (KOLOM_PENGATURAN.includes(f.id)) continue;   // kop & pejabat tetap
    if (f.tagName === 'SELECT') f.selectedIndex = 0; else f.value = '';
  }
  $('s-warga').value = 'Indonesia';
  $('s-tgl').value = hariIni();
  $('s-dari').value = ''; sampaiManual = false; isiMasaBerlaku();
  $('surat-err').textContent = '';
}
function bukaFormSurat(item) {
  bersihkanFormSurat();
  permintaanAktif = item || null;
  if (item) {
    $('s-nama').value = item.nama || ''; $('s-tempat').value = item.tempatLahir || ''; $('s-tgllahir').value = item.tglLahir || '';
    $('s-warga').value = item.warga || 'Indonesia'; $('s-agama').value = item.agama || ''; $('s-kerja').value = item.kerja || '';
    $('s-status').value = item.statusNikah || ''; $('s-kk').value = item.kk || ''; $('s-ktp').value = item.ktp || '';
    $('s-perlu').value = item.perlu || '';
  }
  $('surat-sumber').hidden = !item;
  bukaOverlay('surat');
  $('s-nomor').focus({ preventScroll: true });
}
function ambilData() {
  return {
    kab: baca('s-kab'), kec: baca('s-kec'), desa: baca('s-desa'),
    rt: baca('s-rt'), rw: baca('s-rw'), rwAngka: baca('s-rwangka'),
    ketuaRT: baca('s-ketuart'), ketuaRW: baca('s-ketuarw'),
    kertas: ['14x18', 'a4'].includes($('s-kertas').value) ? $('s-kertas').value : 'setengah',
    nomor: baca('s-nomor'), tgl: $('s-tgl').value,
    rwNomor: baca('s-rw-nomor'), rwTgl: $('s-rw-tgl').value,
    nama: baca('s-nama'), tempat: baca('s-tempat'), tglLahir: $('s-tgllahir').value,
    warga: baca('s-warga') || 'Indonesia', agama: $('s-agama').value, kerja: baca('s-kerja'),
    status: $('s-status').value, kk: angkaSaja($('s-kk').value), ktp: angkaSaja($('s-ktp').value),
    perlu: baca('s-perlu'), dari: $('s-dari').value, sampai: $('s-sampai').value,
  };
}
function periksa(d) {
  if (!d.nama) return 'Nama wajib diisi.';
  if (d.kk && !/^\d{16}$/.test(d.kk)) return 'No. KK harus 16 angka (atau kosongkan untuk ditulis tangan).';
  if (d.ktp && !/^\d{16}$/.test(d.ktp)) return 'No. KTP harus 16 angka (atau kosongkan untuk ditulis tangan).';
  if (d.dari && d.sampai && d.sampai < d.dari) return 'Tanggal "sampai" tidak boleh lebih awal dari tanggal "mulai".';
  return '';
}

/* ---------- lembar cetak ---------- */
function isian(teks, lebar) {
  const s = el('span', teks ? 'sc-isi' : 'sc-isi sc-kosong', teks || '');
  if (!teks && lebar) s.style.minWidth = lebar;
  return s;
}
function baris(label, ...isi) {
  const tr = document.createElement('tr');
  tr.append(el('td', null, label), el('td', null, ':'));
  const td = document.createElement('td'); td.append(...isi); tr.append(td);
  return tr;
}
function bangunSurat(d) {
  const lembar = $('surat-cetak');
  lembar.replaceChildren();
  lembar.dataset.kertas = d.kertas;
  const sempit = d.kertas === '14x18';
  const w = (mm) => `${Math.round(mm * (sempit ? 0.72 : 1))}mm`;

  const kop = el('div', 'sc-kop');
  kop.append(el('div', null, d.kab ? `Pemerintah Kabupaten ${d.kab}` : 'Pemerintah Kabupaten'));
  kop.append(el('div', null, d.kec ? `Kecamatan ${d.kec}` : 'Kecamatan'));
  kop.append(el('div', null, d.desa ? `Desa ${d.desa}` : 'Desa'));
  kop.append(el('div', 'sc-kop-rt', `RT ${d.rt || '....'} – RW ${d.rw || '....'}`));

  const judul = el('div', 'sc-judul');
  judul.append(el('div', 'sc-judul-utama', 'SURAT KETERANGAN/PENGANTAR'));
  judul.append(el('div', null, `Nomor : ${d.nomor || '.....'}/RT ${d.rt || '....'}/${d.rw || '..'}/P`));

  const pembuka = el('p', 'sc-p', 'Yang bertanda tangan di bawah ini menerangkan bahwa :');

  const tabel = el('table', 'sc-tabel'), tb = document.createElement('tbody');
  const lahir = [d.tempat, tanggalIndo(d.tglLahir)].filter(Boolean).join(', ');
  const status = d.status || 'Kawin/Belum Kawin/Janda/Duda';
  const tinggal = document.createElement('div');
  tinggal.append(el('div', null, `RT ${d.rt || '.....'} /RW ${d.rw || '..'}`), el('div', null, `Desa ${d.desa || '.....'}`));
  const bukti = document.createElement('span');
  if (sempit) bukti.append('KK No. ', isian(d.kk, '48mm'), el('br'), 'KTP No. ', isian(d.ktp, '48mm'));
  else bukti.append('KK No. ', isian(d.kk, '38mm'), '  KTP No. ', isian(d.ktp, '38mm'));
  const perlu = d.perlu
    ? el('div', 'sc-perlu', d.perlu)
    : (() => { const wadah = document.createElement('div'); wadah.append(isian('', w(70)), el('br'), isian('', w(70))); return wadah; })();

  tb.append(
    baris('Nama', isian(d.nama, w(70))),
    baris('Tempat/ tgl. Lahir', isian(lahir, w(70))),
    baris('Kewarganegaraan', isian(d.warga, w(70))),
    baris('Agama', isian(d.agama, w(70))),
    baris('Pekerjaan', isian(d.kerja, w(70))),
    baris('Status', isian(status)),
    baris('Tempat tinggal', tinggal),
    baris('Surat bukti diri', bukti),
    baris('Keperluan', perlu),
  );
  tabel.append(tb);

  const berlaku = el('p', 'sc-p');
  berlaku.append('Surat ini berlaku mulai tanggal ', isian(tanggalIndo(d.dari), w(32)), ' sd ', isian(tanggalIndo(d.sampai), w(32)));
  berlaku.append(el('br'), 'Dan hanya berlaku sampai tingkat Desa.');

  const penutup = el('p', 'sc-p', 'Demikian agar dapat digunakan sebagaimana mestinya, dan bagi yang berkepentingan harap maklum.');

  const rw = el('div', 'sc-rw');
  rw.append(el('div', null, `Nomor : ${d.rwNomor || '.....'}/RW ${d.rw || '..'}/P`), el('div', null, `Tanggal : ${tanggalIndo(d.rwTgl) || '..............'}`));

  const ttd = el('div', 'sc-ttd');
  const kiri = el('div', 'sc-kol');
  kiri.append(el('div', null, 'Pemegang Surat'), el('div', 'sc-ruang'), el('div', 'sc-nama', d.nama));
  const tengah = el('div', 'sc-kol');
  tengah.append(el('div', null, 'Mengetahui'), el('div', null, `Ketua RW.${d.rwAngka || '..'}`), el('div', 'sc-ruang'), el('div', 'sc-nama', d.ketuaRW || '\u00A0'));
  const kanan = el('div', 'sc-kol');
  kanan.append(el('div', null, `${d.desa || '........'}, ${tanggalIndo(d.tgl) || '..............'}`), el('div', null, `Ketua RT.${d.rt || '..'}`), el('div', 'sc-ruang'), el('div', 'sc-nama', d.ketuaRT || '\u00A0'));
  ttd.append(kiri, tengah, kanan);

  lembar.append(kop, judul, pembuka, tabel, berlaku, penutup, rw, ttd);
}
// Kecilkan huruf otomatis bila isi tidak muat di kertas.
function sesuaikanUkuran() {
  const lembar = $('surat-cetak');
  lembar.classList.add('mengukur');
  let pt = 10; lembar.style.fontSize = `${pt}pt`;
  while (lembar.scrollHeight > lembar.clientHeight + 1 && pt > 7) { pt -= 0.25; lembar.style.fontSize = `${pt}pt`; }
  const muat = lembar.scrollHeight <= lembar.clientHeight + 1;
  lembar.classList.remove('mengukur');
  return muat;
}

/* ---------- cetak + tindak lanjut ---------- */
let gayaHalaman = null;
function bersihkanCetak() {
  document.body.classList.remove('cetak-surat');
  if (gayaHalaman) { gayaHalaman.remove(); gayaHalaman = null; }
}
function setelahCetak() {
  bersihkanCetak();
  const it = menungguPasca; menungguPasca = null;
  if (it) ingatkanHapus(it);
}
async function tandaiSelesai(item) {
  if (!item || item.respon === 'Ditindaklanjuti' || !fs) return;
  await tulis(fs.updateDoc(fs.doc(db, KOLEKSI, String(item._doc)), { respon: 'Ditindaklanjuti', ditindaklanjuti: stempelWaktu() }));
}
async function ingatkanHapus(item) {
  const ya = await konfirmasi('Hapus data warga ini?',
    'Surat sudah dicetak. Data pemohon (termasuk No. KK/KTP) masih tersimpan di database. Sebaiknya dihapus sekarang agar data warga tidak menumpuk.',
    'Hapus sekarang', true);
  if (!ya) return toast('Kartu ditandai selesai. Ingat hapus datanya nanti.');
  if (await hapusDariDb(item._doc)) { permintaanAktif = null; if (!$('surat').hidden) tutupOverlay('surat'); }
}
function cetak() {
  const d = ambilData(), salah = periksa(d);
  $('surat-err').textContent = salah;
  if (salah) return;
  simpanPengaturan();
  bangunSurat(d);
  if (!sesuaikanUkuran()) { $('surat-err').textContent = 'Isi terlalu panjang untuk satu lembar. Persingkat bagian "Keperluan".'; return; }

  bersihkanCetak();
  gayaHalaman = document.createElement('style');
  if (d.kertas === 'a4') gayaHalaman.textContent = '@page{size:A4 portrait;margin:0}';
  else if (d.kertas === '14x18') gayaHalaman.textContent = '@page{size:140mm 180mm;margin:0}';
  else gayaHalaman.textContent = `@page{size:210mm ${TINGGI_SETENGAH_A4_MM}mm;margin:0}`;
  document.head.append(gayaHalaman);
  document.body.classList.add('cetak-surat');

  if (permintaanAktif) { menungguPasca = permintaanAktif; tandaiSelesai(permintaanAktif); }
  window.addEventListener('afterprint', setelahCetak, { once: true });
  window.print();
}

/* ---------- pasang ---------- */
function mulai() {
  if (!$('surat')) return;
  muatPengaturan();

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-surat]'); if (!t) return;
    const aksi = t.dataset.surat, adm = peran === 'admin';
    if (aksi === 'menu') { if (peran === 'admin') bukaDaftar(); else if (peran === 'warga') bukaWarga(); return; }
    if (aksi === 'tutup-warga') return tutupOverlay('surat-warga');
    if (aksi === 'tutup-daftar') return tutupOverlay('surat-daftar');
    if (aksi === 'tutup') return tutupOverlay('surat');
    if (!adm) return;                                    // aksi di bawah ini hanya untuk pengurus
    if (aksi === 'manual') bukaFormSurat(null);
    else if (aksi === 'buka-permintaan') { const x = daftar.find((d) => d._doc === t.dataset.id); if (x) bukaFormSurat(x); }
    else if (aksi === 'hapus-permintaan') hapusPermintaan(t.dataset.id);
    else if (aksi === 'hapus-selesai') hapusSelesai();
    else if (aksi === 'cetak') cetak();
    else if (aksi === 'kosongkan') { permintaanAktif = null; $('surat-sumber').hidden = true; bersihkanFormSurat(); $('s-nama').focus(); }
  });
  $('surat-warga-form').addEventListener('submit', (e) => { e.preventDefault(); kirimWarga(); });
  $('surat-form').addEventListener('submit', (e) => { e.preventDefault(); if (peran === 'admin') cetak(); });
  $('s-dari').addEventListener('input', isiMasaBerlaku);
  $('s-sampai').addEventListener('input', () => { sampaiManual = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !$('dialog').hidden || !$('lightbox').hidden) return;
    tutupTeratas();
  });
  window.addEventListener('popstate', () => { tutupTeratas(); });   // tombol kembali di HP
  sambung();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mulai);
else mulai();
