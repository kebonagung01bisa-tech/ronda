// Surat Keterangan/Pengantar — E-Ronda RT 01 / RW 05 KebonAgung
// Modul mandiri: tidak mengubah ronda.js, tidak mengirim data ke Firebase/server.
// Semua isi surat dipasang lewat textContent (bukan innerHTML) sehingga aman dari sisipan HTML/skrip.
'use strict';

const KUNCI_PENGATURAN = 'ronda.surat.pengaturan.v1';
const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const TINGGI_SETENGAH_A4_MM = 148.5;
const MM_KE_PX = 96 / 25.4;

// Isian kop & pejabat yang diingat di perangkat ini (BUKAN data warga).
const KOLOM_PENGATURAN = ['s-kab','s-kec','s-desa','s-rt','s-rw','s-ketuart','s-ketuarw','s-kertas'];

const $ = (id) => document.getElementById(id);
let pemicu = null;

/* ---------- util ---------- */
function tanggalIndo(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${d} ${BULAN[m - 1]} ${y}`;
}
function hariIni() {
  const n = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}
function baca(id) { return ($(id).value || '').trim(); }
function el(tag, kelas, teks) {
  const e = document.createElement(tag);
  if (kelas) e.className = kelas;
  if (teks !== undefined && teks !== null) e.textContent = teks;
  return e;
}

/* ---------- pengaturan tersimpan (try/catch: penyimpanan bisa kosong/diblokir) ---------- */
function muatPengaturan() {
  try {
    const raw = localStorage.getItem(KUNCI_PENGATURAN);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return;
    for (const id of KOLOM_PENGATURAN) {
      if (typeof o[id] === 'string') $(id).value = o[id].slice(0, 80);
    }
  } catch (_) { /* abaikan */ }
}
function simpanPengaturan() {
  try {
    const o = {};
    for (const id of KOLOM_PENGATURAN) o[id] = baca(id);
    localStorage.setItem(KUNCI_PENGATURAN, JSON.stringify(o));
  } catch (_) { /* abaikan */ }
}

/* ---------- buka / tutup ---------- */
function buka(tombol) {
  pemicu = tombol || null;
  $('surat').hidden = false;
  document.body.classList.add('surat-terbuka');
  if (!$('s-tgl').value) $('s-tgl').value = hariIni();
  $('surat').scrollTop = 0;
  $('s-nama').focus({ preventScroll: true });
}
function tutup() {
  $('surat').hidden = true;
  document.body.classList.remove('surat-terbuka');
  if (pemicu && pemicu.isConnected) pemicu.focus();
}
function kosongkan() {
  for (const f of $('surat-form').querySelectorAll('input, textarea, select')) {
    if (KOLOM_PENGATURAN.includes(f.id)) continue; // kop & pejabat tetap
    if (f.tagName === 'SELECT') f.selectedIndex = 0; else f.value = '';
  }
  $('s-warga').value = 'Indonesia';
  $('s-tgl').value = hariIni();
  $('surat-err').textContent = '';
  $('s-nama').focus();
}

/* ---------- validasi ---------- */
function ambilData() {
  const angka = (id) => baca(id).replace(/\s+/g, '');
  const d = {
    kab: baca('s-kab'), kec: baca('s-kec'), desa: baca('s-desa'),
    rt: baca('s-rt'), rw: baca('s-rw'),
    ketuaRT: baca('s-ketuart'), ketuaRW: baca('s-ketuarw'),
    kertas: ['14x18', 'a4'].includes($('s-kertas').value) ? $('s-kertas').value : 'setengah',
    nomor: baca('s-nomor'), tgl: $('s-tgl').value,
    rwNomor: baca('s-rw-nomor'), rwTgl: $('s-rw-tgl').value,
    nama: baca('s-nama'), tempat: baca('s-tempat'), tglLahir: $('s-tgllahir').value,
    warga: baca('s-warga') || 'Indonesia', agama: $('s-agama').value, kerja: baca('s-kerja'),
    status: $('s-status').value, kk: angka('s-kk'), ktp: angka('s-ktp'),
    perlu: baca('s-perlu'), dari: $('s-dari').value, sampai: $('s-sampai').value,
  };
  return d;
}
function periksa(d) {
  if (!d.nama) return 'Nama wajib diisi.';
  if (d.kk && !/^\d{16}$/.test(d.kk)) return 'No. KK harus 16 angka (atau kosongkan untuk ditulis tangan).';
  if (d.ktp && !/^\d{16}$/.test(d.ktp)) return 'No. KTP harus 16 angka (atau kosongkan untuk ditulis tangan).';
  if (d.dari && d.sampai && d.sampai < d.dari) return 'Tanggal "sampai" tidak boleh lebih awal dari tanggal "mulai".';
  return '';
}

/* ---------- membangun lembar cetak ---------- */
function isian(teks, lebar) {
  // Isian kosong dicetak sebagai titik-titik supaya bisa ditulis tangan.
  const s = el('span', teks ? 'sc-isi' : 'sc-isi sc-kosong', teks || '');
  if (!teks && lebar) s.style.minWidth = lebar;
  return s;
}
function baris(label, ...isi) {
  const tr = document.createElement('tr');
  tr.append(el('td', null, label), el('td', null, ':'));
  const td = document.createElement('td');
  td.append(...isi);
  tr.append(td);
  return tr;
}
function bangunSurat(d) {
  const lembar = $('surat-cetak');
  lembar.replaceChildren();
  lembar.dataset.kertas = d.kertas;
  const sempit = d.kertas === '14x18';            // kertas 14 × 18 cm: lebih sempit, isian diperpendek
  const w = (mm) => `${Math.round(mm * (sempit ? 0.72 : 1))}mm`;

  const kop = el('div', 'sc-kop');
  const namaKab = d.kab ? `Pemerintah Kabupaten ${d.kab}` : 'Pemerintah Kabupaten';
  kop.append(el('div', null, namaKab));
  kop.append(el('div', null, d.kec ? `Kecamatan ${d.kec}` : 'Kecamatan'));
  kop.append(el('div', null, d.desa ? `Desa ${d.desa}` : 'Desa'));
  kop.append(el('div', 'sc-kop-rt', `RT ${d.rt || '....'} – RW ${d.rw || '....'}`));

  const judul = el('div', 'sc-judul');
  judul.append(el('div', 'sc-judul-utama', 'SURAT KETERANGAN/PENGANTAR'));
  judul.append(el('div', null, `Nomor : ${d.nomor || '.....'}/RT ${d.rt || '....'}/${d.rw || '..'}/P`));

  const pembuka = el('p', 'sc-p', 'Yang bertanda tangan di bawah ini menerangkan bahwa :');

  const tabel = el('table', 'sc-tabel');
  const tb = document.createElement('tbody');
  const lahir = [d.tempat, tanggalIndo(d.tglLahir)].filter(Boolean).join(', ');
  const status = d.status || 'Kawin/Belum Kawin/Janda/Duda';
  const tinggal = document.createElement('div');
  tinggal.append(el('div', null, `RT ${d.rt || '.....'} /RW ${d.rw || '..'}`), el('div', null, `Desa ${d.desa || '.....'}`));
  const bukti = document.createElement('span');
  if (sempit) bukti.append('KK No. ', isian(d.kk, '48mm'), el('br'), 'KTP No. ', isian(d.ktp, '48mm'));
  else bukti.append('KK No. ', isian(d.kk, '38mm'), '  KTP No. ', isian(d.ktp, '38mm'));
  const perlu = d.perlu
    ? el('div', 'sc-perlu', d.perlu)
    : (() => { const w = document.createElement('div'); w.append(isian('', w(70)), el('br'), isian('', w(70))); return w; })();

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
  tengah.append(el('div', null, 'Mengetahui'), el('div', null, `Ketua RW ${d.rw || '..'}`), el('div', 'sc-ruang'), el('div', 'sc-nama', d.ketuaRW || '\u00A0'));
  const kanan = el('div', 'sc-kol');
  kanan.append(el('div', null, `${d.desa || '........'}, ${tanggalIndo(d.tgl) || '..............'}`), el('div', null, `Ketua RT ${d.rt || '..'}`), el('div', 'sc-ruang'), el('div', 'sc-nama', d.ketuaRT || '\u00A0'));
  ttd.append(kiri, tengah, kanan);

  lembar.append(kop, judul, pembuka, tabel, berlaku, penutup, rw, ttd);
}

// Kecilkan huruf otomatis bila isi (mis. keperluan panjang) tidak muat di kertas.
function sesuaikanUkuran() {
  const lembar = $('surat-cetak');
  lembar.classList.add('mengukur');
  let pt = 10;
  lembar.style.fontSize = `${pt}pt`;
  while (lembar.scrollHeight > lembar.clientHeight + 1 && pt > 7) {
    pt -= 0.25;
    lembar.style.fontSize = `${pt}pt`;
  }
  const muat = lembar.scrollHeight <= lembar.clientHeight + 1;
  lembar.classList.remove('mengukur');
  return muat;
}

/* ---------- cetak ---------- */
let gayaHalaman = null;
function bersihkanCetak() {
  document.body.classList.remove('cetak-surat');
  if (gayaHalaman) { gayaHalaman.remove(); gayaHalaman = null; }
}
function cetak() {
  const d = ambilData();
  const salah = periksa(d);
  $('surat-err').textContent = salah;
  if (salah) return;

  simpanPengaturan();
  bangunSurat(d);
  const muat = sesuaikanUkuran();
  if (!muat) {
    $('surat-err').textContent = 'Isi terlalu panjang untuk satu lembar. Persingkat bagian "Keperluan".';
    return;
  }

  bersihkanCetak();
  gayaHalaman = document.createElement('style');
  if (d.kertas === 'a4') gayaHalaman.textContent = '@page{size:A4 portrait;margin:0}';
  else if (d.kertas === '14x18') gayaHalaman.textContent = '@page{size:140mm 180mm;margin:0}';
  else gayaHalaman.textContent = `@page{size:210mm ${TINGGI_SETENGAH_A4_MM}mm;margin:0}`;
  document.head.append(gayaHalaman);
  document.body.classList.add('cetak-surat');
  window.addEventListener('afterprint', bersihkanCetak, { once: true });
  window.print();
}

/* ---------- pasang ---------- */
function mulai() {
  if (!$('surat')) return;
  muatPengaturan();

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-surat]');
    if (!t) return;
    const aksi = t.dataset.surat;
    if (aksi === 'buka') buka(t);
    else if (aksi === 'tutup') tutup();
    else if (aksi === 'cetak') cetak();
    else if (aksi === 'kosongkan') kosongkan();
  });
  $('surat-form').addEventListener('submit', (e) => { e.preventDefault(); cetak(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('surat').hidden) tutup();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mulai);
else mulai();
