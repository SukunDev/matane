# Akun, kunci, dan rahasia

Semua yang harus kamu siapkan sendiri untuk `matane-extensions`, beserta tempat setiap nilai disimpan. Tidak ada satu pun rahasia yang masuk ke git.

## Ringkasan nilai

| Nilai | Jenis | Disimpan di | Dipakai oleh |
|---|---|---|---|
| Kunci privat repo (PEM) | **rahasia** | secret `MR_REPO_KEY` di repo `matane-extensions` + password manager | workflow **Publish** (menandatangani `index.json`) |
| Kunci publik repo (`ed25519:…`) | publik | variable `MR_REPO_PUBLIC_KEY` di repo `matane-extensions` + kode app (`official.ts`) | workflow Publish (verifikasi), app (status "Official · Verified") |
| URL repo (`https://…/matane-extensions/`) | publik | variable `REPO_URL` di repo `matane-extensions` + kode app | cek versi di CI, repo default di app |
| Token npm | **rahasia** | secret `NPM_TOKEN` di repo **matane** | workflow `publish-sdk.yml` |

## 1. Organisasi dan token npm

1. Masuk ke [npmjs.com](https://www.npmjs.com), lalu buka **Add Organization**. Nama: `matane` (gratis untuk paket publik). Kalau nama itu sudah diambil orang, pilih nama lain dan kabari aku, karena nama paket ikut berubah.
2. Aktifkan **2FA** di akun npm (wajib untuk menerbitkan).
3. Buka **Access Tokens → Generate New Token → Granular Access Token**:
   - Expiration: maksimal yang diizinkan (catat tanggalnya untuk diperpanjang);
   - Packages and scopes: **Read and write**, hanya untuk scope `@matane`;
   - Organizations: tidak perlu.
4. Salin token (hanya ditampilkan sekali), lalu buka repo **matane** di GitHub → **Settings → Secrets and variables → Actions → New repository secret**, dengan nama `NPM_TOKEN`.

Workflow penerbitan memakai *provenance* (npm menandai paket sebagai dibangun oleh GitHub Actions dari repo ini). Itu tidak butuh pengaturan tambahan selain `id-token: write` di workflow.

## 2. Repo GitHub dan Pages

1. Buat repo **publik** baru `matane-extensions` tanpa README, .gitignore, atau lisensi (isinya dari `templates/`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Actions → General → Workflow permissions:** biarkan "Read repository contents". Workflow meminta izin tambahan sendiri (`pages: write`, `issues: write`).
4. (Disarankan) **Settings → Branches → Add rule** untuk `main`: wajib lewat PR dan CI hijau. Setiap perubahan extension jadi tertinjau sebelum ditandatangani.
5. (Opsional) **Settings → Pages → Custom domain**, misalnya `extensions.matane.app`, lalu centang "Enforce HTTPS". Kalau dipakai, URL inilah yang ditanam di app.

URL Pages default: `https://<akun>.github.io/matane-extensions/`. Simpan sebagai **variable** (bukan secret) `REPO_URL` di **Settings → Secrets and variables → Actions → Variables**. Nilai ini baru ada setelah Publish pertama berhasil, jadi cek versi di CI melewatkan dirinya selama variable ini kosong.

## 3. Kunci tanda tangan

Kunci dibuat **di komputermu**, bukan di CI, supaya kunci privat tidak pernah tercatat di log mana pun.

```sh
# Di folder mana saja di luar repo git mana pun
npx @matane/extension-cli repo keygen --out matane-repo-key.pem
# → Public key: ed25519:AbC…=
```

Sebelum paket npm terbit, perintah yang sama bisa dijalankan dari repo matane: `pnpm --filter mangadex exec mr-ext repo keygen --out ~/matane-repo-key.pem`.

Lalu:

1. **Secret** `MR_REPO_KEY` di repo `matane-extensions`: tempel **seluruh isi** file PEM, termasuk baris `-----BEGIN PRIVATE KEY-----` dan `-----END PRIVATE KEY-----`.
2. **Variable** `MR_REPO_PUBLIC_KEY`: kunci publik `ed25519:…`. Workflow Publish memverifikasi repo yang baru dibangun terhadap kunci ini, jadi secret yang salah tempel langsung ketahuan.
3. Kirimkan kunci publiknya kepadaku untuk ditanam di app.
4. Simpan file PEM di password manager (sebagai lampiran atau catatan aman), lalu **hapus dari disk**. `keygen` membuat file dengan izin `600` dan tidak pernah menimpa file yang sudah ada.

### Kalau kunci bocor atau hilang

App hanya memercayai kunci yang tertanam di dalamnya, jadi mengganti kunci **butuh rilis app baru**:

1. Buat kunci baru (`keygen`), lalu ganti secret dan variable-nya.
2. Rilis app yang memuat **kedua** kunci di `OFFICIAL_KEYS` (lama dan baru), supaya pengguna yang belum update tetap bisa sinkron sampai Publish memakai kunci baru.
3. Setelah sebagian besar pengguna memakai rilis itu, publish dengan kunci baru. Kunci lama dihapus dari app di rilis berikutnya.

Kalau kunci **bocor** (bukan hilang), langkah 2 memuat kunci baru saja. Pengguna lama akan melihat "index tidak ditandatangani dengan kunci yang dipercaya" sampai mereka update. Itu memang perilaku yang benar: app menolak index yang ditandatangani kunci tak dikenal.

## 4. Yang kukerjakan setelah semua di atas siap

- Menerbitkan SDK: kamu cukup push tag `sdk-v0.1.0` di repo matane (workflow `publish-sdk.yml`).
- Mengisi repo `matane-extensions` dari `templates/` (lihat [`struktur-repo.md`](struktur-repo.md)).
- Menanam kunci publik + URL di app (lihat [`perubahan-di-app.md`](perubahan-di-app.md)).
