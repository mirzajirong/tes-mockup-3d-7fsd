# Editor Suite Studio

Aplikasi web **mockup 3D real-time** untuk kaus/jersey. Tempel desain pada UV map interaktif, atur kain dan material, pencahayaan studio, latar, dan kamera, lalu ekspor **gambar resolusi tinggi** dan **video turntable 360°**, semuanya langsung di browser.

Domain produksi: `studio.editorsuite.id`

## Fitur

- **Editor 3D real-time:** layer desain (geser, skala, rotasi, opacity, blend mode), UV canvas, material kain (Drifit, Piqué, Mesh) dengan sheen, clearcoat, dan subsurface.
- **Scene:** 4 preset pencahayaan, latar (kotak-kotak, warna, gradien, gambar), dinding, lantai, bayangan, kamera, timeline turntable.
- **Export:** gambar (PNG/JPEG, sisi terpanjang 2048 px) dan video (MP4/WebM, 30/60 fps, 1–30 detik, maks 1080p).
- **Akun:** login OTP email atau OAuth (Supabase Auth), dashboard profil dan status langganan.
- **Langganan Pro:** pembayaran per periode lewat Xendit, aktif otomatis setelah pembayaran.
- **Panel admin (Super Admin):** user, langganan, pembayaran, export, unduh CSV, beri/cabut Pro, suspend, dan hapus user.
- **Kualitas grafis adaptif:** Otomatis, Tinggi, atau Hemat (lebih ringan untuk HP).

### Free vs Pro

| | Tamu / Free | Pro |
|---|---|---|
| Editor penuh | Ya | Ya |
| Model 3D | O-Neck | Semua (10 model) |
| Export gambar dan video | Tidak | Ya, dengan kuota harian |

Kuota export, harga, dan masa aktif diatur lewat environment variable (lihat tabel di bawah). Nilai bawaan kode: 50 gambar/hari, 10 video/hari, 30 hari. Rincian aturan bisnis ada di dokumentasi.

## Tech Stack

| Bagian | Teknologi |
|---|---|
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS 4, Zustand |
| 3D | Three.js, React Three Fiber, drei |
| Export | WebCodecs, `mp4-muxer`, `webm-muxer`, Web Worker |
| Backend | Node.js 22, Express 4, zod, helmet, express-rate-limit, pino |
| Data | Supabase (Auth, Postgres dengan RLS, Realtime, Storage) |
| Pembayaran | Xendit Invoice API |
| Aset model | Cloudflare R2 (S3 API) atau Supabase Storage |

## Cara Menjalankan

Prasyarat: **Node.js 22.x** dan npm.

```bash
npm ci            # pasang dependensi (sesuai package-lock.json)
npm run dev       # server pengembangan di http://localhost:3000
```

Tanpa `.env`, aplikasi berjalan di **mode `mock`** (data dummy di memori, tanpa backend). Cocok untuk mencoba editor dan UI. Login demo dan akun admin demo ada di `src/lib/api/mock/index.ts`.

> **Peringatan:** mode `mock` adalah nilai bawaan bila `VITE_API_MODE` kosong. Jangan dipakai di produksi.

### Menjalankan dengan backend penuh

1. Salin `.env.example` menjadi `.env` dan isi nilainya (tabel di bawah).
2. Siapkan Supabase: jalankan file di `supabase/migrations/` secara berurutan, lalu lakukan **setup database tambahan** (fungsi RPC, pencabutan hak, kolom export, Realtime) sesuai `docs/PRODUCT-DOCUMENTATION.md` bagian 7.3.
3. Jadikan akun admin pertama lewat SQL: `update public.profiles set role = 'Super Admin' where email = 'YOUR_ADMIN_EMAIL';`
4. Isi `VITE_API_MODE=supabase`, lalu `npm run dev`.
5. Webhook Xendit memerlukan URL publik (deploy atau tunnel); tidak bisa diuji di `localhost`.

## Skrip npm

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server pengembangan (Express + Vite) |
| `npm run build` | Build produksi ke `dist/` |
| `npm start` | Jalankan server produksi (`node server.js`) |
| `npm run lint` | Pemeriksaan tipe (`tsc --noEmit`) |
| `npm run preview` | Pratinjau build Vite |

Belum ada tes otomatis dan CI. Verifikasi saat ini: `npm run lint` dan `npm run build`.

## Environment Variables

Salin dari `.env.example`. **Jangan commit `.env` dan jangan pernah memberi awalan `VITE_` pada secret.**

| Variabel | Lingkup | Keterangan |
|---|---|---|
| `NODE_ENV` | Server | `production` di produksi |
| `PORT` | Server | Port server (default 3000) |
| `APP_URL` | Server | URL aplikasi, dipakai untuk redirect pembayaran |
| `TRUST_PROXY` | Server | Jumlah proxy tepercaya (default 1) |
| `ENABLE_STRICT_HEADERS` | Server | `true` mengaktifkan CSP, HSTS, dan sebagainya (butuh `NODE_ENV=production`) |
| `SUPABASE_URL` | Server | URL proyek Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Server, **rahasia** | Kunci service role Supabase |
| `ASSET_STORAGE_DRIVER` | Server | `supabase` (default) atau `r2` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_MODELS` | Server, **rahasia** | Wajib bila driver `r2` (token read-only untuk server) |
| `XENDIT_SECRET_KEY`, `XENDIT_CALLBACK_TOKEN` | Server, **rahasia** | Pembayaran; kunci Test dan Live berbeda |
| `PRO_PRICE_IDR` | Server | Harga Pro (default 99000) |
| `PRO_PERIOD_DAYS` | Server | Masa aktif per pembayaran (default 30) |
| `EXPORT_DAILY_LIMIT_VIDEO`, `EXPORT_DAILY_LIMIT_IMAGE` | Server | Kuota harian (default 10 dan 50) |
| `LOG_LEVEL` | Server | Level log pino (default `info`) |
| `VITE_API_MODE` | Klien, **saat build** | `mock` atau `supabase` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Klien, saat build | URL dan kunci anon Supabase (publik, dibatasi RLS) |

Variabel `VITE_*` ditanam saat build. Setelah mengubahnya, build ulang.

> `GEMINI_API_KEY` di `.env.example` adalah sisa template Google AI Studio dan tidak dipakai aplikasi.

## Struktur Proyek

```text
server.js              Entry: menyajikan dist/ (SPA) dan API; dev memakai Vite middleware
server/
├── index.js           Helmet/CSP, parser, router /api/v1, error handler
├── config.js          Validasi env (zod)
├── routes/            health, me, auth, assets, payments, webhooks, exports, admin
├── middleware/        auth (JWT, admin, suspend), rateLimit
└── lib/               storage (R2/Supabase), xendit, audit, logger, supabase
supabase/migrations/   Skema database (lihat catatan setup tambahan)
scripts/               upload-assets.mjs (unggah model .glb ke R2/Supabase)
docs/                  Panduan R2 dan dokumentasi produk
public/
├── models/            01.O-Neck.glb (model gratis; model Pro tidak disimpan di repo)
└── assets/            SVG UV map tiap model dan logo
src/
├── canvas/            Viewport Three.js/R3F, model, material, cahaya, bayangan, kamera
├── components/        Header, Timeline, ExportModal, UpgradeModal, PaymentReturnHandler, kontrol UI
├── config/            Katalog model (.glb ↔ .svg) dan konstanta
├── features/
│   ├── editor/        Panel Design, Material, Position, Lighting, Background, Scene, UV canvas
│   ├── auth/          Modal login
│   ├── dashboard/     Profil dan status langganan pengguna
│   └── admin/         Panel admin
├── hooks/             Pintasan keyboard
├── lib/               API adapter (mock/supabase), texture compositor, export engine, model loader
├── store/             Zustand: editorStore, authStore, uiStore
├── workers/           Web Worker encoder video
├── App.tsx            Layout aplikasi desktop dan mobile
├── main.tsx           Titik masuk
└── types.ts           Tipe domain
```

## Arsitektur Singkat

```text
Browser (React + R3F) ──REST /api/v1 + Bearer JWT──► Express ──► Supabase (Auth, Postgres)
        │                                              ├──► Xendit (invoice, webhook)
        │ signed URL 120 detik                         └──► R2 / Supabase Storage (model Pro)
        └──────────────── memuat .glb ◄───────────────────────┘
Render export (gambar/video) berjalan di browser; server hanya memberi izin dan kuota.
```

Prinsip: server adalah penegak akses (model Pro, export, admin). Klien hanya UX. Secret hanya di server.

## Deployment

- Alur: Google AI Studio → GitHub (`main`) → hosting Node.js.
- Pengaturan yang dipakai: preset Express, Node 22.x, package manager npm, entry `server.js`.
- Build: `npm run build`. Start: `npm start`. Health check: `/api/v1/health`.
- Produksi: isi semua env di dashboard hosting (bukan di repo), `NODE_ENV=production`, dan pertimbangkan `ENABLE_STRICT_HEADERS=true`.
- Model Pro **tidak** disimpan di git. Unggah ke bucket private memakai `scripts/upload-assets.mjs`; panduan R2 di `docs/R2-SETUP.md`.

## Keamanan (ringkas)

Row Level Security di semua tabel, penulisan database hanya lewat server, model Pro lewat signed URL berumur 120 detik setelah cek entitlement, webhook Xendit diverifikasi ulang ke API Xendit, rate limiting per grup endpoint, validasi input dengan zod, dan audit log. Detail dan celah yang diketahui ada di dokumentasi.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| `docs/PRD.md` | Kebutuhan produk per fitur |
| `docs/PRODUCT-DOCUMENTATION.md` | Dokumentasi lengkap: aturan bisnis, arsitektur, panduan kode, deployment, keamanan, maintenance, masalah yang diketahui, roadmap, changelog |
| `docs/AI-DEVELOPMENT-CONTEXT.md` | Ringkasan konteks untuk AI asisten pengembangan |
| `docs/R2-SETUP.md` | Panduan Cloudflare R2 |

Sebelum mengubah fitur yang ada, baca implementasi saat ini dan pertahankan perilakunya kecuali diminta lain.