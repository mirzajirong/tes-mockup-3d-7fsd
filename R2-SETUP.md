# Panduan Setup Cloudflare R2 untuk Penyimpanan Model 3D Privat (`FASE R2`)

Dokumen ini menjelaskan langkah-langkah konfigurasi **Cloudflare R2** sebagai driver penyimpanan objek untuk file model 3D `.glb` privat di **Editor Suite Studio**, termasuk konfigurasi CORS, pembuatan token dengan hak akses minimum (*least privilege*), pengunggahan aset, pengujian, dan prosedur *rollback* ke Supabase Storage.

---

## 1. Membuat Bucket Private di Cloudflare R2

1. Masuk ke **Cloudflare Dashboard** dan pilih menu **R2 Object Storage** di sidebar kiri.
2. Klik tombol **Create bucket**.
3. Masukkan nama bucket, misalnya:
   ```text
   editor-suite-models
   ```
4. Pada bagian **Location**, biarkan **Automatic** (atau pilih *Hint: Asia-Pacific (APAC)* untuk latensi optimal di Indonesia).
5. Klik **Create bucket**.
6. Buka tab **Settings** pada bucket yang baru dibuat dan pastikan:
   - **Public Access (`r2.dev` subdomain)**: **Disabled / Disallow** (bucket **wajib** bersifat privat).
   - **Custom Domains**: Tidak dipasang domain publik tanpa autentikasi; seluruh akses unduhan model Pro dilakukan melalui *presigned URL* berumur pendek (120 detik) dari endpoint backend `/api/v1/assets/model/:modelId`.

> **Catatan Penting**: Model gratis `01.O-Neck.glb` **tidak** disimpan di bucket privat R2, melainkan tetap disajikan secara publik melalui `/models/01.O-Neck.glb`. Hanya model Pro (`02.V-Neck.glb` s.d. `10.Casual-Neck.glb`) yang diunggah ke bucket privat ini.

---

## 2. Konfigurasi CORS untuk `https://studio.editorsuite.id`

Karena browser mengunduh file `.glb` secara langsung dari *presigned URL* R2 menggunakan `fetch(url, { signal })` (untuk mendukung *streaming progress bar* dan pembatalan unduhan `AbortController`), bucket R2 memerlukan kebijakan CORS.

1. Buka bucket Anda di Cloudflare Dashboard → tab **Settings**.
2. Gulir ke bagian **CORS Policy**, lalu klik **Add CORS policy** (atau **Edit CORS policy**).
3. Tempel konfigurasi JSON berikut:

```json
[
  {
    "AllowedOrigins": [
      "https://studio.editorsuite.id"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD"
    ],
    "AllowedHeaders": [
      "Range",
      "If-None-Match",
      "If-Modified-Since"
    ],
    "ExposeHeaders": [
      "Content-Length",
      "Content-Type",
      "Content-Range",
      "ETag",
      "Accept-Ranges"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

> **Tips Pengembangan Lokal**: Jika Anda ingin mengetes langsung dari mesin lokal, Anda dapat menambahkan `"http://localhost:3000"` ke dalam array `"AllowedOrigins"` selama pengujian, lalu menghapusnya kembali saat *production*.
>
> **Catatan Teknis Klien**: Klien (`modelAssetLoader.ts`) memanggil `fetch(url, { signal })` tanpa header `Authorization`, tanpa `credentials`, dan tanpa header kustom agar tidak merusak tanda tangan SigV4 dan tidak memicu *preflight OPTIONS* yang tidak perlu.

---

## 3. Membuat API Token (Read-Only untuk Server & Read-Write untuk Upload Lokal)

Gunakan prinsip *least privilege* dengan memisahkan token untuk **Server Production** (hanya baca) dan **Script Upload Lokal** (baca & tulis).

Catat terlebih dahulu **Account ID** Anda yang tertera di halaman utama **R2 Object Storage** (di sisi kanan atas). Nilai ini akan digunakan sebagai `R2_ACCOUNT_ID`.

### A. Token 1: Server Production (`Object Read Only`)
Token ini dipakai oleh server Express untuk membuat *presigned URL* (`GetObject`). Server tidak pernah menulis atau menghapus file di bucket model.

1. Di halaman utama **R2 Object Storage**, klik **Manage R2 API Tokens** → **Create API token**.
2. **Token name**: `editor-suite-server-models-readonly`
3. **Permissions**: Pilih **Object Read Only**.
4. **Specify bucket(s)**: Pilih **Apply to specific buckets only** → pilih bucket `editor-suite-models`.
5. Klik **Create API Token**.
6. Salin **Access Key ID** (`R2_ACCESS_KEY_ID`) dan **Secret Access Key** (`R2_SECRET_ACCESS_KEY`) untuk disimpan di environment server production.

### B. Token 2: Script Upload Lokal (`Object Read & Write`)
Token ini **hanya** digunakan di komputer lokal/CI saat menjalankan `scripts/upload-assets.mjs` dan **jangan pernah** dipasang di server production.

1. Klik **Manage R2 API Tokens** → **Create API token**.
2. **Token name**: `editor-suite-local-uploader-rw`
3. **Permissions**: Pilih **Object Read & Write**.
4. **Specify bucket(s)**: Pilih **Apply to specific buckets only** → pilih bucket `editor-suite-models`.
5. Klik **Create API Token**.
6. Simpan **Access Key ID** dan **Secret Access Key** ini khusus di mesin lokal untuk proses *seeding/upload* aset.

---

## 4. Mengisi Environment Variables (`.env`)

Jangan pernah memberi awalan `VITE_` pada kredensial R2 agar tidak terbundel ke aplikasi klien.

### Konfigurasi di Server Production (`.env` / Secret Manager)
Gunakan **Token Read-Only**:

```dotenv
# Pilih driver 'r2' ('supabase' | 'r2', default: 'supabase')
ASSET_STORAGE_DRIVER=r2

# Kredensial Cloudflare R2 (Gunakan token Object Read Only di server!)
R2_ACCOUNT_ID=isi_account_id_cloudflare_anda
R2_ACCESS_KEY_ID=isi_access_key_id_readonly_server
R2_SECRET_ACCESS_KEY=isi_secret_access_key_readonly_server
R2_BUCKET_MODELS=editor-suite-models
```

> Saat `ENABLE_STRICT_HEADERS=true` dan `ASSET_STORAGE_DRIVER=r2`, server secara otomatis menambahkan `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` ke direktif `connect-src` pada Content Security Policy (CSP).

---

## 5. Menjalankan Script Upload ke R2

Script `scripts/upload-assets.mjs` mengunggah semua file `.glb` yang terdaftar di whitelist (`02.V-Neck.glb` s.d. `10.Casual-Neck.glb`) dengan `ContentType: 'model/gltf-binary'` dan secara otomatis melewati `01.O-Neck.glb` (karena model tersebut tetap publik di `/models`).

Jalankan perintah berikut dari terminal lokal menggunakan **Token Read & Write**:

```bash
R2_ACCOUNT_ID="<account_id>" \
R2_ACCESS_KEY_ID="<rw_access_key_id>" \
R2_SECRET_ACCESS_KEY="<rw_secret_access_key>" \
R2_BUCKET_MODELS="editor-suite-models" \
node scripts/upload-assets.mjs --target=r2 --dir=public/models
```

Jika file `.glb` privat Anda disimpan di folder lokal terpisah (misalnya `./private-models`), gunakan argumen `--dir`:

```bash
R2_ACCOUNT_ID="<account_id>" \
R2_ACCESS_KEY_ID="<rw_access_key_id>" \
R2_SECRET_ACCESS_KEY="<rw_secret_access_key>" \
R2_BUCKET_MODELS="editor-suite-models" \
node scripts/upload-assets.mjs --target=r2 --dir=./private-models
```

Contoh output ringkasan:
```text
=== Ringkasan Upload Aset 3D ===
Target Storage : r2
------------------------------------------------------------------------
Nama File                    |       Ukuran | Status
------------------------------------------------------------------------
01.O-Neck.glb                |    1420.5 KB | SKIPPED (PUBLIC /models)
02.V-Neck.glb                |    1510.2 KB | UPLOADED
03.V-Flat.glb                |    1488.0 KB | UPLOADED
...
------------------------------------------------------------------------
```

---

## 6. Mengetes Endpoint & Presigned URL R2

1. Jalankan server dengan driver `r2`:
   ```bash
   ASSET_STORAGE_DRIVER=r2 npm start
   ```
2. Gunakan `curl` dengan Bearer JWT dari akun berlangganan **Pro** aktif untuk meminta *signed URL* model Pro (mis. `v-neck`):
   ```bash
   curl -i -X GET "https://studio.editorsuite.id/api/v1/assets/model/v-neck" \
     -H "Authorization: Bearer <ACCESS_TOKEN_USER_PRO>"
   ```
3. Pastikan respons berstatus `200 OK` dan mengembalikan JSON:
   ```json
   {
     "url": "https://<account_id>.r2.cloudflarestorage.com/editor-suite-models/02.V-Neck.glb?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
     "expiresIn": 120
   }
   ```
4. Uji unduh langsung URL yang dikembalikan (tanpa header `Authorization`) untuk memastikan objek tersedia dan `Content-Type` bernilai `model/gltf-binary`:
   ```bash
   curl -I "<URL_DARI_RESPONS_DI_ATAS>"
   ```
5. Buka aplikasi di browser (`https://studio.editorsuite.id`), pilih model Pro (mis. **V-Neck**), dan pastikan model 3D beserta indikator progres unduhan berjalan normal tanpa error CORS atau CSP di *DevTools Console*.

---

## 7. Cara Rollback Instan ke Supabase Storage

Jika terjadi kendala pada Cloudflare R2 atau Anda perlu kembali ke penyimpanan Supabase Storage secara instan tanpa mengubah kode aplikasi:

1. Ubah variabel environment `ASSET_STORAGE_DRIVER` di server kembali ke `supabase`:
   ```dotenv
   ASSET_STORAGE_DRIVER=supabase
   ```
   *(Atau hapus/kosongkan variabel `ASSET_STORAGE_DRIVER`, karena nilai default-nya adalah `supabase`).*
2. Restart layanan server (`node server.js` / *redeploy* konfigurasi environment di Cloud Run/server).
3. Server akan langsung kembali menghasilkan *signed URL* dari bucket privat `models` di Supabase Storage tanpa *downtime* skema maupun perubahan di sisi klien.
