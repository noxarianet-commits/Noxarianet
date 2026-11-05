const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');

class QrisDynamic {
    static cachedStaticPayload = null;

    /**
     * Decode QRIS PNG Image URL to raw EMVCo String
     */
    static async decodeQrisUrl(imageUrl) {
        if (this.cachedStaticPayload) {
            return this.cachedStaticPayload;
        }

        try {
            const response = await fetch(imageUrl);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            return new Promise((resolve, reject) => {
                new PNG({ filterType: 4 }).parse(buffer, (err, image) => {
                    if (err) return reject(err);
                    const code = jsQR(image.data, image.width, image.height);
                    if (code && code.data) {
                        QrisDynamic.cachedStaticPayload = code.data;
                        resolve(code.data);
                    } else {
                        reject(new Error("Gagal membaca QR Code dari gambar QRIS."));
                    }
                });
            });
        } catch (error) {
            throw error;
        }
    }

    /**
     * Hitung CRC16-CCITT (0x1021)
     */
    static crc16(str) {
        let crc = 0xFFFF;
        for (let c = 0; c < str.length; c++) {
            crc ^= str.charCodeAt(c) << 8;
            for (let i = 0; i < 8; i++) {
                if (crc & 0x8000) {
                    crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
                } else {
                    crc = (crc << 1) & 0xFFFF;
                }
            }
        }
        return crc.toString(16).toUpperCase().padStart(4, '0');
    }

    /**
     * Ubah Static QRIS EMVCo String menjadi Dynamic QRIS dengan Nominal Pas
     */
    static makeDynamicPayload(staticPayload, amount) {
        // 1. Ubah Tag 010211 (Static) -> 010212 (Dynamic)
        let payload = staticPayload.replace('010211', '010212');

        // 2. Hapus CRC (6304XXXX) lama di bagian paling belakang jika ada
        const crcIndex = payload.lastIndexOf('6304');
        if (crcIndex !== -1) {
            payload = payload.substring(0, crcIndex);
        }

        // 3. Format Tag 54 (Transaction Amount)
        const amountStr = amount.toString();
        const amountLen = String(amountStr.length).padStart(2, '0');
        const tag54 = '54' + amountLen + amountStr;

        // Sisipkan Tag 54 setelah Tag 5303360 (IDR)
        const currIndex = payload.indexOf('5303360');
        if (currIndex !== -1) {
            payload = payload.substring(0, currIndex + 7) + tag54 + payload.substring(currIndex + 7);
        }

        // 4. Tambahkan '6304' lalu hitung CRC16 baru
        payload += '6304';
        const checksum = this.crc16(payload);

        return payload + checksum;
    }

    /**
     * Generate Gambar QR Code Base64 dari Dynamic Payload
     */
    static async generateDynamicQrisImage(staticImageUrl, amount) {
        const staticPayload = await this.decodeQrisUrl(staticImageUrl);
        const dynamicPayload = this.makeDynamicPayload(staticPayload, amount);
        const base64Qr = await QRCode.toDataURL(dynamicPayload, {
            margin: 2,
            width: 300,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });

        return {
            payload: dynamicPayload,
            qrImage: base64Qr
        };
    }
}

module.exports = QrisDynamic;
