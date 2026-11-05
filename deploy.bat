@echo off
title NoxarianetApp - Deploy to GitHub
echo =====================================================
echo    NoxarianetApp - Auto Git Push to GitHub
echo =====================================================
echo [1/3] Menyiapkan perubahan (git add -A)...
git add -A
echo.
echo [2/3] Menyimpan commit (git commit)...
git commit -m "feat: integrate FinCloud Dynamic QRIS v1.0 and enable real-time top-up credit"
echo.
echo [3/3] Mengunggah ke GitHub (git push origin main)...
git push origin main
echo.
echo =====================================================
echo    SELESAI! Kode telah berhasil diunggah ke GitHub.
echo    Silakan klik Start / Restart pada panel FinCloud.
echo =====================================================
echo.
pause
